import { dialog, shell, net } from 'electron'
import { join, extname, basename, relative } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { exec } from 'child_process'
import AdmZip from 'adm-zip'
// Decoupled dbApi import to prevent circular dependency issues

// Calculate SHA-256 hash of a file efficiently using streams
function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', (err) => reject(err))
  })
}

// Recursively find STL and 3MF files in a directory
async function scanDirectory(dirPath, filesList = []) {
  try {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const item of items) {
      const fullPath = join(dirPath, item.name)
      if (item.isDirectory()) {
        await scanDirectory(fullPath, filesList)
      } else {
        const ext = extname(item.name).toLowerCase()
        if (ext === '.stl' || ext === '.3mf') {
          const stats = await fs.promises.stat(fullPath)
          let fileHash = ''
          try {
            // Calculate hash for duplicate detection
            fileHash = await getFileHash(fullPath)
          } catch (e) {
            console.error(`Hash calculation failed for ${fullPath}:`, e)
          }
          filesList.push({
            name: basename(item.name, ext),
            fileName: item.name,
            path: fullPath,
            size: stats.size,
            hash: fileHash,
            ext: ext.slice(1) // 'stl' or '3mf'
          })
        }
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', error)
  }
  return filesList
}

export const fsApi = {
  // Folder selector dialog
  selectFolder: async (window, libraryPath) => {
    const result = await dialog.showOpenDialog(window, {
      defaultPath: libraryPath || undefined,
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  },

  // File selector dialog for stl/3mf
  selectFiles: async (window, libraryPath) => {
    const result = await dialog.showOpenDialog(window, {
      defaultPath: libraryPath || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '3D Models & Project Archives', extensions: ['stl', '3mf', 'zip'] }]
    })
    if (result.canceled) return []

    const selectedFiles = []
    for (const filePath of result.filePaths) {
      const stats = await fs.promises.stat(filePath)
      const ext = extname(filePath).toLowerCase()
      let fileHash = ''
      try {
        fileHash = await getFileHash(filePath)
      } catch (e) {
        console.error('Error generating hash:', e)
      }
      selectedFiles.push({
        name: basename(filePath, ext),
        fileName: basename(filePath),
        path: filePath,
        size: stats.size,
        hash: fileHash,
        ext: ext.slice(1)
      })
    }
    return selectedFiles
  },

  // Get details of a single file (hash, name, size, ext)
  getFileDetails: async (filePath) => {
    if (!fs.existsSync(filePath)) return null
    const stats = await fs.promises.stat(filePath)
    const ext = extname(filePath).toLowerCase()
    let fileHash = ''
    try {
      fileHash = await getFileHash(filePath)
    } catch (e) {
      console.error('Error generating hash:', e)
    }
    return {
      name: basename(filePath, ext),
      fileName: basename(filePath),
      path: filePath,
      size: stats.size,
      hash: fileHash,
      ext: ext.slice(1)
    }
  },

  // Scan a directory recursively
  scanFolder: async (dirPath) => {
    return await scanDirectory(dirPath)
  },

  // Open file in standard Windows explorer
  openFileLocation: async (filePath) => {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return true
    }
    return false
  },

  // Open in Slicer
  openInSlicer: async (filePath, customSlicerPath = '') => {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File does not exist' }

    if (customSlicerPath) {
      // Open with custom slicer path
      let command = `"${customSlicerPath}" "${filePath}"`
      if (process.platform === 'darwin' && customSlicerPath.endsWith('.app')) {
        command = `open -a "${customSlicerPath}" "${filePath}"`
      }
      exec(command, (error) => {
        if (error) {
          console.error('Failed to launch custom slicer:', error)
        }
      })
      return { success: true }
    } else {
      // Open with system default application
      try {
        const result = await shell.openPath(filePath)
        if (result) {
          return { success: false, error: result }
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }
  },

  // Copy files to NozzleNest library storage
  copyToLibrary: async (sourcePath, destLibraryPath, modelId, fileName, isFromZip = false, tempDir = '') => {
    const destDir = join(destLibraryPath, 'models', String(modelId), 'files')
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }

    if (isFromZip && tempDir && fs.existsSync(tempDir)) {
      // Copy the entire unzipped temp folder recursively to destDir
      fs.cpSync(tempDir, destDir, { recursive: true })
      // Calculate relative path from tempDir to sourcePath to find the correct local_path
      const relativePath = relative(tempDir, sourcePath)
      const destPath = join(destDir, relativePath)
      return destPath
    } else {
      const destPath = join(destDir, fileName)
      await fs.promises.copyFile(sourcePath, destPath)
      return destPath
    }
  },

  // Save base64 image, local image, or download web image to cached path
  savePreviewImage: async (destLibraryPath, modelId, sourceImagePathOrBase64) => {
    const destDir = join(destLibraryPath, 'models', String(modelId))
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const destPath = join(destDir, 'preview.jpg')

    if (sourceImagePathOrBase64.startsWith('data:image')) {
      // Base64
      const base64Data = sourceImagePathOrBase64.replace(/^data:image\/\w+;base64,/, '')
      await fs.promises.writeFile(destPath, base64Data, 'base64')
      console.log(`[Preview] Saved base64 image for model ${modelId} -> ${destPath}`)
      return destPath
    } else if (sourceImagePathOrBase64.startsWith('http://') || sourceImagePathOrBase64.startsWith('https://')) {
      // Web URL — use browser-like headers so CDNs (e.g. Printables, Thingiverse) don't block the request
      console.log(`[Preview] Downloading image for model ${modelId}: ${sourceImagePathOrBase64}`)
      
      let refererStr = 'https://www.printables.com/'
      try {
        const u = new URL(sourceImagePathOrBase64)
        if (u.hostname.includes('thingiverse')) refererStr = 'https://www.thingiverse.com/'
        else if (u.hostname.includes('makerworld')) refererStr = 'https://makerworld.com/'
        else if (u.hostname.includes('thangs')) refererStr = 'https://thangs.com/'
        else refererStr = `${u.protocol}//${u.host}/`
      } catch(e) {}

      try {
        const response = await net.fetch(sourceImagePathOrBase64, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': refererStr
          }
        })
        if (!response.ok) {
          console.error(`[Preview] Image fetch failed with HTTP ${response.status} for model ${modelId}: ${sourceImagePathOrBase64}`)
          return null
        }
        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        await fs.promises.writeFile(destPath, buffer)
        console.log(`[Preview] Successfully saved preview image for model ${modelId} (${buffer.length} bytes) -> ${destPath}`)
        return destPath
      } catch (e) {
        console.error(`[Preview] Failed to download image for model ${modelId}:`, e.message, '| URL:', sourceImagePathOrBase64)
        return null
      }
    } else if (fs.existsSync(sourceImagePathOrBase64)) {
      // Local file
      await fs.promises.copyFile(sourceImagePathOrBase64, destPath)
      console.log(`[Preview] Copied local image for model ${modelId} -> ${destPath}`)
      return destPath
    }
    console.warn(`[Preview] Image source unrecognized for model ${modelId}:`, sourceImagePathOrBase64?.slice(0, 80))
    return null
  },

  // Check if a path is a directory
  isDirectory: async (filePath) => {
    try {
      const stats = await fs.promises.stat(filePath)
      return stats.isDirectory()
    } catch (e) {
      return false
    }
  },

  // Extract a downloaded ZIP inside C:\NozzleNest\models\[model-id]\files\
  handleZipExtract: async (zipPath, destLibraryPath, modelId) => {
    try {
      const destDir = join(destLibraryPath, 'models', String(modelId), 'files')
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }

      // Wait until the file exists and is readable (Windows sometimes locks it briefly after download)
      let ready = false
      for (let i = 0; i < 50; i++) {
        try {
          if (fs.existsSync(zipPath)) {
            const stats = fs.statSync(zipPath)
            if (stats.size > 0) {
              ready = true
              break
            } else {
              console.warn(`ZIP file exists but is empty at ${zipPath}, attempt ${i + 1}/50`)
            }
          } else {
            console.warn(`ZIP file not yet found at ${zipPath}, attempt ${i + 1}/50`)
          }
        } catch (e) {
          console.warn(`ZIP stat attempt ${i + 1}/50 failed:`, e.message)
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }

      if (!ready) {
        console.error(`ZIP file not found or empty after 10s: ${zipPath}`)
        return null
      }

      // Retry extraction a few times in case the file is momentarily locked
      let lastErr = null
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const zipBuffer = fs.readFileSync(zipPath)
          const zip = new AdmZip(zipBuffer)
          zip.extractAllTo(destDir, true)
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          console.warn(`ZIP extraction attempt ${attempt + 1} failed:`, err.message)
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      if (lastErr) {
        console.error('All ZIP extraction attempts failed:', lastErr)
        return null
      }

      // Recursively scan the extracted files for STL/3MF models
      const extractedFiles = await scanDirectory(destDir)
      if (extractedFiles.length > 0) {
        // Delete the ZIP only after we confirmed valid model files were extracted
        try {
          fs.unlinkSync(zipPath)
        } catch (unlinkErr) {
          console.warn('Could not delete ZIP after extraction:', unlinkErr.message)
        }
        // Return all extracted files so the UI can show them all
        return {
          primaryPath: extractedFiles[0].path,
          allFiles: extractedFiles
        }
      }

      // No model files found – keep the ZIP so the user still has the download
      console.warn('No .stl or .3mf files found in downloaded ZIP, keeping archive intact:', zipPath)
      return null
    } catch (e) {
      console.error('Failed to extract ZIP download:', e)
      return null
    }
  },

  // Extract local ZIP file to temp directory for staging in AddModelView
  extractLocalZipToTemp: async (zipPath, destLibraryPath) => {
    try {
      const uuid = crypto.randomUUID()
      const tempDir = join(destLibraryPath, 'temp', uuid)
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      // Check if file exists, with a retry mechanism for disk flushing
      let exists = fs.existsSync(zipPath)
      if (!exists) {
        console.log(`Local ZIP not found at ${zipPath}, retrying in 200ms...`)
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 200))
          exists = fs.existsSync(zipPath)
          if (exists) break
        }
      }

      if (!exists) {
        console.error(`Local ZIP file does not exist at path: ${zipPath}`)
        return { tempDir: '', files: [] }
      }

      // Extract ZIP
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(tempDir, true)

      // Scan extracted temp directory recursively
      const extractedFiles = await scanDirectory(tempDir)
      return {
        tempDir,
        files: extractedFiles
      }
    } catch (e) {
      console.error('Failed to extract local ZIP to temp:', e)
      return { tempDir: '', files: [] }
    }
  },

  // Scan all files inside a model's files directory
  scanModelFiles: async (destLibraryPath, modelId) => {
    const modelFilesDir = join(destLibraryPath, 'models', String(modelId), 'files')
    if (!fs.existsSync(modelFilesDir)) return []
    return await scanDirectory(modelFilesDir)
  },

  // Cleanup local temp directory
  cleanupTempFolder: async (tempDir) => {
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true })
        return true
      }
    } catch (e) {
      console.error(`Failed to delete temp directory ${tempDir}:`, e)
    }
    return false
  },

  detectSlicers: async () => {
    const foundSlicers = []

    if (process.platform === 'win32') {
      const pathsToSearch = [
        process.env.PROGRAMFILES,
        process.env['PROGRAMFILES(X86)'],
        join(process.env.LOCALAPPDATA || '', 'Programs')
      ].filter(Boolean)

      const knownSlicers = [
        { name: 'Bambu Studio', exe: 'bambu-studio.exe', subDir: 'Bambu Studio' },
        { name: 'Orca Slicer', exe: 'orca-slicer.exe', subDir: 'OrcaSlicer' },
        { name: 'Prusa Slicer', exe: 'prusa-slicer.exe', subDir: 'Prusa3D\\PrusaSlicer' },
        { name: 'UltiMaker Cura', exe: 'Cura.exe', subDir: 'UltiMaker Cura' }
      ]

      for (const base of pathsToSearch) {
        for (const slicer of knownSlicers) {
          const fullPath = join(base, slicer.subDir, slicer.exe)
          if (fs.existsSync(fullPath)) {
            if (!foundSlicers.find(s => s.path === fullPath)) {
              foundSlicers.push({ name: slicer.name, path: fullPath })
            }
          }
        }
      }
    } else if (process.platform === 'darwin') {
      const knownMacApps = [
        { name: 'Bambu Studio', app: 'BambuStudio.app' },
        { name: 'Orca Slicer', app: 'OrcaSlicer.app' },
        { name: 'Prusa Slicer', app: 'PrusaSlicer.app' },
        { name: 'UltiMaker Cura', app: 'UltiMaker Cura.app' }
      ]
      for (const slicer of knownMacApps) {
        const fullPath = join('/Applications', slicer.app)
        if (fs.existsSync(fullPath)) {
          foundSlicers.push({ name: slicer.name, path: fullPath })
        }
      }
    } else if (process.platform === 'linux') {
      // Linux has highly fragmented install paths (AppImage, Flatpak, Snap).
      // We return an empty array to encourage users to manually browse for their executable.
    }
    
    return foundSlicers
  }
}
