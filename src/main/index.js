import { app, shell, BrowserWindow, ipcMain, session, net, protocol, dialog } from 'electron'
import { join, extname, dirname } from 'path'
import crypto from 'crypto'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { dbApi } from './db'
import { fsApi } from './fsApi'

// Register media custom protocol as privileged
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
])

// Global unhandled exception catcher
process.on('uncaughtException', (error) => {
  console.error('Fatal unhandled exception:', error)
  const result = dialog.showMessageBoxSync({
    type: 'error',
    title: 'NozzleNest - Fatal Error',
    message: 'A fatal error occurred and the app must close.',
    detail: `${error.message}\n\n${error.stack || ''}`,
    buttons: ['Report on GitHub', 'Close App']
  })
  if (result === 0) {
    shell.openExternal('https://github.com/papakonnekt/nozzlenest/issues/new')
  }
  app.exit(1)
})

let mainWindow = null
const activeDownloads = new Map()
let fileToImportOnStartup = null

// Parse arguments to find a file path to import
function parseArgvForFile(argv) {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg && !arg.startsWith('-')) {
      const ext = extname(arg).toLowerCase()
      if (ext === '.stl' || ext === '.3mf') {
        try {
          if (fs.existsSync(arg)) {
            return arg
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }
  return null
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Focus the main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      
      const fileToImport = parseArgvForFile(commandLine)
      if (fileToImport) {
        mainWindow.webContents.send('file:open', fileToImport)
      }
    }
  })

  // Capture initial startup file argument
  const startupFile = parseArgvForFile(process.argv)
  if (startupFile) {
    fileToImportOnStartup = startupFile
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'NozzleNest',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0c0e1a',
      symbolColor: '#ffffff',
      height: 32
    },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true // MUST enable webview tag for finding models
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward') {
      mainWindow.webContents.send('nav:mouse-back')
    } else if (cmd === 'browser-forward') {
      mainWindow.webContents.send('nav:mouse-forward')
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Intercept downloads inside webviews (default session + browser partition)
  function attachDownloadHandler(sess) {
    sess.on('will-download', (event, item, webContents) => {
      const fileName = item.getFilename()
      const ext = extname(fileName).toLowerCase()

      if (ext === '.stl' || ext === '.3mf' || ext === '.zip') {
        // Do NOT pause the download. Let it download into temp while the user fills out the import dialog.
        // This prevents CDNs (like Thingiverse) from terminating the connection due to idle timeouts.
        const downloadId = crypto.randomUUID()

        const { libraryPath } = dbApi.getSettings()
        const tempDir = join(libraryPath, 'temp', 'downloads', downloadId)
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }
        const tempPath = join(tempDir, fileName)
        item.setSavePath(tempPath)

        const downloadData = { item, fileName, tempPath, finalState: null }
        activeDownloads.set(downloadId, downloadData)

        // Track if the download finishes BEFORE the user confirms the import
        item.once('done', (event, state) => {
          const dl = activeDownloads.get(downloadId)
          if (dl) {
            dl.finalState = state
          }
        })

        // Get page URL the download was triggered from
        const referer = webContents.getURL()

        // Notify renderer of detected model download
        mainWindow.webContents.send('download:detected', {
          id: downloadId,
          fileName,
          totalBytes: item.getTotalBytes(),
          referer
        })
      }
    })
  }

  // Attach download handler to both sessions
  attachDownloadHandler(session.defaultSession)
  const browserPartitionSession = session.fromPartition('persist:nozzlenest-browser', { cache: true })
  attachDownloadHandler(browserPartitionSession)
}

// Register IPC handlers
function registerIpcHandlers() {
  // SQLite Database API
  ipcMain.handle('db:getSettings', () => dbApi.getSettings())
  ipcMain.handle('db:saveSettings', (_, settings) => {
    const res = dbApi.saveSettings(settings)
    if (res.success && res.libraryPath) {
      session.defaultSession.setDownloadPath(res.libraryPath)
      // Keep browser partition download path in sync too
      session.fromPartition('persist:nozzlenest-browser', { cache: true }).setDownloadPath(res.libraryPath)
    }
    return res
  })
  ipcMain.handle('db:getModels', (_, filters) => dbApi.getModels(filters))
  ipcMain.handle('db:getModel', (_, id) => dbApi.getModel(id))
  ipcMain.handle('db:checkDuplicate', (_, fileHash) => dbApi.checkDuplicate(fileHash))
  ipcMain.handle('db:addModel', (_, model) => dbApi.addModel(model))
  ipcMain.handle('db:updateModel', (_, id, updates) => dbApi.updateModel(id, updates))
  ipcMain.handle('db:deleteModel', (_, id) => dbApi.deleteModel(id))
  
  ipcMain.handle('db:addToQueue', (_, modelId) => dbApi.addToQueue(modelId))
  ipcMain.handle('db:removeFromQueue', (_, modelId) => dbApi.removeFromQueue(modelId))
  ipcMain.handle('db:updateQueueOrder', (_, orderedIds) => dbApi.updateQueueOrder(orderedIds))
  
  ipcMain.handle('db:logPrint', (_, modelId, status, notes) => dbApi.logPrint(modelId, status, notes))
  ipcMain.handle('db:getPrintHistory', (_, modelId) => dbApi.getPrintHistory(modelId))
  
  ipcMain.handle('db:getTags', () => dbApi.getTags())
  ipcMain.handle('db:getCollections', () => dbApi.getCollections())
  ipcMain.handle('db:addCollection', (_, name, description, color) => dbApi.addCollection(name, description, color))
  ipcMain.handle('db:updateCollection', (_, id, name, description, color) => dbApi.updateCollection(id, name, description, color))
  ipcMain.handle('db:deleteCollection', (_, id) => dbApi.deleteCollection(id))
  ipcMain.handle('db:getDashboardStats', () => dbApi.getDashboardStats())
  ipcMain.handle('db:addModelFiles', (_, modelId, files) => dbApi.addModelFiles(modelId, files))
  ipcMain.handle('db:getModelFiles', (_, modelId) => dbApi.getModelFiles(modelId))
  ipcMain.handle('db:deleteModelFiles', (_, modelId) => dbApi.deleteModelFiles(modelId))

  // File System API
  ipcMain.handle('fs:selectFolder', () => {
    const { libraryPath } = dbApi.getSettings()
    return fsApi.selectFolder(mainWindow, libraryPath)
  })
  ipcMain.handle('fs:selectFiles', () => {
    const { libraryPath } = dbApi.getSettings()
    return fsApi.selectFiles(mainWindow, libraryPath)
  })
  ipcMain.handle('fs:getFileDetails', (_, filePath) => fsApi.getFileDetails(filePath))
  ipcMain.handle('fs:scanFolder', (_, dirPath) => fsApi.scanFolder(dirPath))
  ipcMain.handle('fs:openFileLocation', (_, filePath) => fsApi.openFileLocation(filePath))
  ipcMain.handle('fs:openInSlicer', (_, filePath, customSlicerPath) => fsApi.openInSlicer(filePath, customSlicerPath))
  ipcMain.handle('fs:copyToLibrary', (_, sourcePath, destLibraryPath, modelId, fileName, isFromZip, tempDir) => 
    fsApi.copyToLibrary(sourcePath, destLibraryPath, modelId, fileName, isFromZip, tempDir)
  )
  ipcMain.handle('fs:savePreviewImage', (_, destLibraryPath, modelId, sourceImagePathOrBase64) => 
    fsApi.savePreviewImage(destLibraryPath, modelId, sourceImagePathOrBase64)
  )
  ipcMain.handle('fs:isDirectory', (_, filePath) => fsApi.isDirectory(filePath))
  ipcMain.handle('fs:extractLocalZipToTemp', (_, zipPath, destLibraryPath) => fsApi.extractLocalZipToTemp(zipPath, destLibraryPath))
  ipcMain.handle('fs:cleanupTempFolder', (_, tempDir) => fsApi.cleanupTempFolder(tempDir))
  ipcMain.handle('fs:scanModelFiles', (_, destLibraryPath, modelId) => fsApi.scanModelFiles(destLibraryPath, modelId))
  ipcMain.handle('fs:detectSlicers', () => fsApi.detectSlicers())

  // Download confirmation/execution API
  ipcMain.handle('download:confirm', async (_, downloadId, confirm, metadata) => {
    const download = activeDownloads.get(downloadId)
    if (!download) return { success: false, error: 'Download item not found' }

    const { item, fileName, tempPath } = download

    if (!confirm) {
      item.cancel()
      activeDownloads.delete(downloadId)
      // Clean up the temp directory we created in will-download
      try {
        const tempDir = join(dirname(tempPath))
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      } catch (cleanupErr) {
        console.warn('Failed to clean up cancelled download temp dir:', cleanupErr)
      }
      return { success: true, status: 'cancelled' }
    }

    try {
      // 1. Fetch library folder location
      const { libraryPath } = dbApi.getSettings()

      // 2. Insert record in SQLite to secure a unique ID
      const modelId = dbApi.addModel({
        name: metadata.name || fileName.replace(/\.[^/.]+$/, ""),
        description: metadata.description || '',
        source_url: metadata.source_url || '',
        source_site: metadata.source_site || '',
        local_path: 'pending', // update upon download finished
        status: metadata.status || 'not_printed',
        tags: metadata.tags || [],
        collections: metadata.collections || []
      })

      // 3. Prepare final destination directory
      const finalDestDir = join(libraryPath, 'models', String(modelId), 'files')
      if (!fs.existsSync(finalDestDir)) {
        fs.mkdirSync(finalDestDir, { recursive: true })
      }
      const finalDestPath = join(finalDestDir, fileName)

      // 4. Register progress listeners (if still downloading)
      if (!download.finalState) {
        item.on('updated', (event, state) => {
          if (state === 'interrupted') {
            mainWindow.webContents.send('download:progress', { id: downloadId, status: 'interrupted' })
          } else if (state === 'progressing') {
            mainWindow.webContents.send('download:progress', {
              id: downloadId,
              status: 'downloading',
              receivedBytes: item.getReceivedBytes(),
              totalBytes: item.getTotalBytes()
            })
          }
        })
      }

      // 5. Completion Handler Logic
      const handleCompletion = async (state) => {
        activeDownloads.delete(downloadId)
        if (state === 'completed') {
          // Move the file from the temp location (set in will-download) to the final model folder
          console.log(`[Download] Moving from temp: ${tempPath} -> final: ${finalDestPath}`)
          
          let fileMoved = false
          for (let attempt = 0; attempt < 20; attempt++) {
            if (fs.existsSync(tempPath)) {
              try {
                fs.renameSync(tempPath, finalDestPath)
                console.log(`[Download] Successfully moved file to ${finalDestPath}`)
                fileMoved = true
                break
              } catch (moveErr) {
                try {
                  fs.copyFileSync(tempPath, finalDestPath)
                  fs.unlinkSync(tempPath)
                  console.log(`[Download] Successfully copied file to ${finalDestPath}`)
                  fileMoved = true
                  break
                } catch (copyErr) {
                  console.warn(`[Download] Move/copy attempt ${attempt + 1} failed (likely locked by AV):`, copyErr.message)
                  await new Promise(resolve => setTimeout(resolve, 500))
                }
              }
            } else {
              console.error(`[Download] Temp file missing at ${tempPath}`)
              break
            }
          }
          
          if (!fileMoved && fs.existsSync(tempPath)) {
             console.error(`[Download] CRITICAL: Failed to move file after 10 seconds. Leaving in temp.`)
          }

          // Clean up the temp directory
          try {
            const tempDir = dirname(tempPath)
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true })
            }
          } catch (cleanupErr) {
            console.warn('Failed to clean up temp dir:', cleanupErr)
          }

          let finalModelPath = finalDestPath
          let modelFiles = []
          
          const fileExt = extname(fileName).toLowerCase()
          if (fileExt === '.zip') {
            try {
              const extractResult = await fsApi.handleZipExtract(finalDestPath, libraryPath, modelId)
              if (extractResult && extractResult.allFiles && extractResult.allFiles.length > 0) {
                finalModelPath = extractResult.primaryPath
                modelFiles = extractResult.allFiles.map((f, idx) => ({
                  file_path: f.path,
                  file_name: f.fileName || f.name,
                  file_type: f.ext,
                  is_primary: idx === 0
                }))
                console.log(`[Download] ZIP extracted ${modelFiles.length} files for model ${modelId}`)
              }
            } catch (err) {
              console.error('ZIP extraction failed:', err)
            }
          } else {
            // Single-file download (STL/3MF) – also register it in model_files
            modelFiles = [{
              file_path: finalDestPath,
              file_name: fileName,
              file_type: fileExt,
              is_primary: true
            }]
          }

          // Update model path and register all associated files
          dbApi.updateModel(modelId, { local_path: finalModelPath })
          if (modelFiles.length > 0) {
            dbApi.addModelFiles(modelId, modelFiles)
          }

          // ── Stage 1: Save preview image from URL supplied by renderer ──────────
          console.log(`[Download] preview_image_url for model ${modelId}:`, metadata.preview_image_url || '(none)')
          let imageSaved = false
          if (metadata.preview_image_url) {
            try {
              const savedPreviewPath = await fsApi.savePreviewImage(libraryPath, modelId, metadata.preview_image_url)
              if (savedPreviewPath) {
                dbApi.updateModel(modelId, { preview_image_path: savedPreviewPath })
                console.log(`[Download] Stage 1 preview saved for model ${modelId}`)
                imageSaved = true
              } else {
                console.warn(`[Download] savePreviewImage returned null for model ${modelId}`)
              }
            } catch (imgErr) {
              console.error('[Download] Stage 1 image save failed:', imgErr)
            }
          }

          // ── Stage 2: Fallback — fetch image directly from Printables API ──────
          if (!imageSaved) {
            const srcUrl = metadata.source_url || ''
            const printablesMatch = srcUrl.match(/printables\.com\/model\/(\d+)/)
            if (printablesMatch) {
              const printablesId = printablesMatch[1]
              console.log(`[Download] Stage 2 fallback: querying Printables API for model ID ${printablesId}`)
              try {
                const gql = JSON.stringify({
                  query: `query { print(id: ${printablesId}) { images { filePath } } }`
                })
                const apiResp = await net.fetch('https://api.printables.com/graphql/', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Origin': 'https://www.printables.com',
                    'Referer': 'https://www.printables.com/'
                  },
                  body: gql
                })
                if (apiResp.ok) {
                  const apiData = await apiResp.json()
                  const images = apiData?.data?.print?.images || []
                  if (images.length > 0 && images[0].filePath) {
                    const rawPath = images[0].filePath
                    const imageUrl = rawPath.startsWith('http') ? rawPath : `https://media.printables.com/${rawPath}`
                    console.log(`[Download] Stage 2 image URL: ${imageUrl}`)
                    const savedPreviewPath = await fsApi.savePreviewImage(libraryPath, modelId, imageUrl)
                    if (savedPreviewPath) {
                      dbApi.updateModel(modelId, { preview_image_path: savedPreviewPath })
                      console.log(`[Download] Stage 2 preview saved for model ${modelId}`)
                      imageSaved = true
                    }
                  } else {
                    console.warn(`[Download] Stage 2: no images returned from Printables API for model ${printablesId}`)
                  }
                } else {
                  console.warn(`[Download] Stage 2: Printables API returned HTTP ${apiResp.status}`)
                }
              } catch (fbErr) {
                console.error('[Download] Stage 2 fallback image fetch failed:', fbErr)
              }
            }
          }

          mainWindow.webContents.send('download:finished', {
            id: downloadId,
            status: 'completed',
            modelId
          })
        } else {
          // Clean up dummy SQLite record
          dbApi.deleteModel(modelId)
          // Clean up temp file
          try {
            const tempDir = dirname(tempPath)
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true })
            }
          } catch (cleanupErr) {
            console.warn('Failed to clean up failed download temp dir:', cleanupErr)
          }
          mainWindow.webContents.send('download:finished', {
            id: downloadId,
            status: 'failed',
            error: state
          })
        }
      }

      // Execute completion immediately if already finished, else wait
      if (download.finalState) {
        handleCompletion(download.finalState)
      } else {
        item.once('done', async (event, state) => {
          handleCompletion(state)
        })
      }

      return { success: true, status: download.finalState === 'completed' ? 'completed' : 'downloading', modelId }
    } catch (err) {
      item.cancel()
      activeDownloads.delete(downloadId)
      console.error('Error confirming download:', err)
      return { success: false, error: err.message }
    }
  })

  // GitHub Release update checker API
  ipcMain.handle('updates:check', async () => {
    try {
      const response = await net.fetch('https://api.github.com/repos/papakonnekt/nozzlenest-release/releases/latest', {
        headers: { 'User-Agent': 'NozzleNest-App' }
      })
      if (!response.ok) return { hasUpdate: false }
      
      const data = await response.json()
      const latestVersion = data.tag_name
      const currentVersion = app.getVersion()

      const cleanLatest = latestVersion.replace(/^v/, '')
      const cleanCurrent = currentVersion.replace(/^v/, '')

      if (cleanLatest !== cleanCurrent) {
        return {
          hasUpdate: true,
          latestVersion,
          currentVersion,
          url: data.html_url,
          body: data.body
        }
      }
      return { hasUpdate: false }
    } catch (e) {
      console.error('Failed to check for updates:', e)
      return { hasUpdate: false }
    }
  })

  // Startup file retrieval API
  ipcMain.handle('app:getStartupFile', () => {
    const file = fileToImportOnStartup
    fileToImportOnStartup = null // Clear after first read
    return file
  })

  // Printables GraphQL API: fetch model tags by model ID (extracted from URL)
  // Runs in main process — no CORS, no CSP, no SPA hydration timing issues
  ipcMain.handle('printables:getTags', async (_, modelUrl) => {
    try {
      // Extract numeric model ID from URL like:
      //   https://www.printables.com/model/1434993-skeleton-hand-bookstop/files
      const match = modelUrl.match(/\/model\/(\d+)/)
      if (!match) return { success: false, tags: [], error: 'Could not extract model ID from URL' }
      const modelId = match[1]

      // Query the Printables GraphQL API — includes images so we can use the first as thumbnail
      const gql = JSON.stringify({
        query: `query PrintProfile($id: ID!) {
          print(id: $id) {
            id
            name
            summary
            tags { name }
            images {
              filePath
            }
          }
        }`,
        variables: { id: modelId }
      })

      const response = await net.fetch('https://api.printables.com/graphql/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://www.printables.com',
          'Referer': 'https://www.printables.com/'
        },
        body: gql
      })

      if (!response.ok) {
        return { success: false, tags: [], error: `GraphQL HTTP ${response.status}` }
      }

      const data = await response.json()
      const print = data?.data?.print
      if (!print) return { success: false, tags: [], error: 'No print data in response' }

      const tags = (print.tags || []).map(t => (t.name || '').trim().toLowerCase()).filter(Boolean)
      const name = print.name || ''
      const summary = print.summary || ''

      // Extract the first model image from the images array
      let imageUrl = ''
      const images = print.images || []
      if (images.length > 0 && images[0].filePath) {
        const rawPath = images[0].filePath
        // filePath can be a full URL or a relative path — normalise it
        if (rawPath.startsWith('http')) {
          imageUrl = rawPath
        } else {
          imageUrl = `https://media.printables.com/${rawPath}`
        }
      }

      console.log(`[Printables API] Model ${modelId}: "${name}", ${tags.length} tags, image: ${imageUrl ? 'yes' : 'none'}`)
      return { success: true, tags, name, summary, modelId, imageUrl }
    } catch (err) {
      console.error('[Printables API] getTags failed:', err)
      return { success: false, tags: [], error: err.message }
    }
  })

  // Browser helper: fetch HTML from a URL (no CORS restrictions in main process)
  ipcMain.handle('browser:fetchHtml', async (_, url) => {
    try {
      const response = await net.fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        }
      })
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}`, status: response.status }
      }
      const html = await response.text()
      return { success: true, html, url }
    } catch (err) {
      console.error('browser:fetchHtml failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Open a popup BrowserWindow for OAuth flows (e.g. Google login)
  ipcMain.handle('browser:openPopup', async (_, url) => {
    const popup = new BrowserWindow({
      width: 520,
      height: 680,
      parent: mainWindow,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Sign In',
      webPreferences: {
        // No preload — this is a bare external browser window for OAuth
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:nozzlenest-browser'
      }
    })

    popup.once('ready-to-show', () => popup.show())

    // Allow the popup itself to open further OAuth redirect windows
    popup.webContents.setWindowOpenHandler((details) => {
      popup.loadURL(details.url)
      return { action: 'deny' }
    })

    popup.loadURL(url)
    return { success: true }
  })
}

app.whenReady().then(() => {
  // Register media custom protocol handler to fetch local files securely
  protocol.handle('media', (request) => {
    try {
      let filePath = ''
      if (request.url.includes('?path=')) {
        const url = new URL(request.url)
        filePath = url.searchParams.get('path')
      } else {
        const urlStr = request.url.slice('media://'.length)
        const decoded = decodeURIComponent(urlStr)
        // If it's Windows and starts with a drive letter without colon (e.g., 'c/NozzleNest' or 'c\NozzleNest')
        if (process.platform === 'win32') {
          if (/^[a-zA-Z][/\\]/.test(decoded)) {
            filePath = decoded[0] + ':' + decoded.slice(1)
          } else {
            filePath = decoded
          }
        } else {
          filePath = decoded
        }
      }

      if (!filePath) return new Response('Path not specified', { status: 400 })
      return net.fetch(pathToFileURL(filePath).toString()).then((response) => {
        const headers = new Headers(response.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        })
      })
    } catch (e) {
      console.error('Failed to handle media protocol:', e)
      return new Response('Internal error', { status: 500 })
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.papakonnekt.nozzlenest')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Crash Reporting for Renderer Processes
  app.on('render-process-gone', (event, webContents, details) => {
    if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
      dialog.showMessageBox({
        type: 'error',
        title: 'NozzleNest - Process Crashed',
        message: 'The main rendering process has crashed.',
        detail: `Reason: ${details.reason}`,
        buttons: ['Report on GitHub', 'Restart App', 'Close']
      }).then((result) => {
        if (result.response === 0) {
          shell.openExternal('https://github.com/papakonnekt/nozzlenest/issues/new')
        } else if (result.response === 1) {
          app.relaunch()
          app.exit(0)
        } else {
          app.exit(0)
        }
      })
    }
  })

  app.on('child-process-gone', (event, details) => {
    if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
      console.error('Child process crashed:', details)
    }
  })

  // Initialize SQLite and folders
  const { libraryPath } = dbApi.getSettings()
  if (libraryPath) {
    session.defaultSession.setDownloadPath(libraryPath)
    // Also set download path on the persistent browser partition
    const browserPartition = session.fromPartition('persist:nozzlenest-browser', { cache: true })
    browserPartition.setDownloadPath(libraryPath)
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

