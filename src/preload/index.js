import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // Database API Bridge
  db: {
    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('db:saveSettings', settings),
    getModels: (filters) => ipcRenderer.invoke('db:getModels', filters),
    getModel: (id) => ipcRenderer.invoke('db:getModel', id),
    checkDuplicate: (fileHash) => ipcRenderer.invoke('db:checkDuplicate', fileHash),
    addModel: (model) => ipcRenderer.invoke('db:addModel', model),
    updateModel: (id, updates) => ipcRenderer.invoke('db:updateModel', id, updates),
    deleteModel: (id) => ipcRenderer.invoke('db:deleteModel', id),
    addToQueue: (modelId) => ipcRenderer.invoke('db:addToQueue', modelId),
    removeFromQueue: (modelId) => ipcRenderer.invoke('db:removeFromQueue', modelId),
    updateQueueOrder: (orderedIds) => ipcRenderer.invoke('db:updateQueueOrder', orderedIds),
    logPrint: (modelId, status, notes) => ipcRenderer.invoke('db:logPrint', modelId, status, notes),
    getPrintHistory: (modelId) => ipcRenderer.invoke('db:getPrintHistory', modelId),
    getTags: () => ipcRenderer.invoke('db:getTags'),
    getCollections: () => ipcRenderer.invoke('db:getCollections'),
    addCollection: (name, description, color) => ipcRenderer.invoke('db:addCollection', name, description, color),
    updateCollection: (id, name, description, color) => ipcRenderer.invoke('db:updateCollection', id, name, description, color),
    deleteCollection: (id) => ipcRenderer.invoke('db:deleteCollection', id),
    getDashboardStats: () => ipcRenderer.invoke('db:getDashboardStats'),
    addModelFiles: (modelId, files) => ipcRenderer.invoke('db:addModelFiles', modelId, files),
    getModelFiles: (modelId) => ipcRenderer.invoke('db:getModelFiles', modelId),
    deleteModelFiles: (modelId) => ipcRenderer.invoke('db:deleteModelFiles', modelId)
  },

  // File System API Bridge
  fs: {
    selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
    selectFiles: () => ipcRenderer.invoke('fs:selectFiles'),
    getFileDetails: (filePath) => ipcRenderer.invoke('fs:getFileDetails', filePath),
    scanFolder: (dirPath) => ipcRenderer.invoke('fs:scanFolder', dirPath),
    openFileLocation: (filePath) => ipcRenderer.invoke('fs:openFileLocation', filePath),
    openInSlicer: (filePath, customSlicerPath) => ipcRenderer.invoke('fs:openInSlicer', filePath, customSlicerPath),
    copyToLibrary: (sourcePath, destLibraryPath, modelId, fileName, isFromZip, tempDir) => 
      ipcRenderer.invoke('fs:copyToLibrary', sourcePath, destLibraryPath, modelId, fileName, isFromZip, tempDir),
    savePreviewImage: (destLibraryPath, modelId, sourceImagePathOrBase64) => 
      ipcRenderer.invoke('fs:savePreviewImage', destLibraryPath, modelId, sourceImagePathOrBase64),
    isDirectory: (filePath) => ipcRenderer.invoke('fs:isDirectory', filePath),
    extractLocalZipToTemp: (zipPath, destLibraryPath) => ipcRenderer.invoke('fs:extractLocalZipToTemp', zipPath, destLibraryPath),
    cleanupTempFolder: (tempDir) => ipcRenderer.invoke('fs:cleanupTempFolder', tempDir),
    scanModelFiles: (destLibraryPath, modelId) => ipcRenderer.invoke('fs:scanModelFiles', destLibraryPath, modelId),
    detectSlicers: () => ipcRenderer.invoke('fs:detectSlicers')
  },

  // Download interception events
  downloads: {
    onDetected: (callback) => {
      const listener = (event, data) => callback(data)
      ipcRenderer.on('download:detected', listener)
      return () => ipcRenderer.removeListener('download:detected', listener)
    },
    onProgress: (callback) => {
      const listener = (event, data) => callback(data)
      ipcRenderer.on('download:progress', listener)
      return () => ipcRenderer.removeListener('download:progress', listener)
    },
    onFinished: (callback) => {
      const listener = (event, data) => callback(data)
      ipcRenderer.on('download:finished', listener)
      return () => ipcRenderer.removeListener('download:finished', listener)
    },
    confirmDownload: (downloadId, confirm, metadata) => 
      ipcRenderer.invoke('download:confirm', downloadId, confirm, metadata)
  },

  // Browser helper API
  browser: {
    fetchHtml: (url) => ipcRenderer.invoke('browser:fetchHtml', url),
    printablesGetTags: (modelUrl) => ipcRenderer.invoke('printables:getTags', modelUrl),
    openPopup: (url) => ipcRenderer.invoke('browser:openPopup', url)
  },

  // Update check API
  updates: {
    checkLatestVersion: () => ipcRenderer.invoke('updates:check')
  },

  // Shell context menu and file opening API
  app: {
    getStartupFile: () => ipcRenderer.invoke('app:getStartupFile'),
    onOpenFile: (callback) => {
      const listener = (event, data) => callback(data)
      ipcRenderer.on('file:open', listener)
      return () => ipcRenderer.removeListener('file:open', listener)
    },
    onMouseBack: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('nav:mouse-back', listener)
      return () => ipcRenderer.removeListener('nav:mouse-back', listener)
    },
    onMouseForward: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('nav:mouse-forward', listener)
      return () => ipcRenderer.removeListener('nav:mouse-forward', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
