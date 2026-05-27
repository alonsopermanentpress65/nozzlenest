import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import DashboardView from './components/DashboardView'
import LibraryView from './components/LibraryView'
import QueueView from './components/QueueView'
import BrowserView from './components/BrowserView'
import SettingsView from './components/SettingsView'
import AddModelView from './components/AddModelView'
import { Download, X, FolderPlus } from 'lucide-react'

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [activePrints, setActivePrints] = useState(0)
  const [downloads, setDownloads] = useState({}) // { [id]: { id, fileName, modelName, status, progress, receivedBytes, totalBytes } }
  const [initialImportFile, setInitialImportFile] = useState(null)
  const [lastCompletedModelId, setLastCompletedModelId] = useState(null)

  // Listen for file-open events from Windows shell association
  useEffect(() => {
    async function checkStartupFile() {
      try {
        if (window.api && window.api.app) {
          const file = await window.api.app.getStartupFile()
          if (file) {
            console.log('Shell association: Opened file on startup:', file)
            setInitialImportFile(file)
            setActiveTab('add_model')
          }
        }
      } catch (err) {
        console.error('Failed to query startup file:', err)
      }
    }
    checkStartupFile()

    if (window.api && window.api.app) {
      const unsub = window.api.app.onOpenFile((filePath) => {
        console.log('Shell association: Opened file while running:', filePath)
        setInitialImportFile(filePath)
        setActiveTab('add_model')
      })
      return () => unsub()
    }
  }, [])

  // Periodically refresh the print queue badge count
  const refreshQueueCount = async () => {
    try {
      const stats = await window.api.db.getDashboardStats()
      if (stats) {
        setActivePrints(stats.activePrints)
      }
    } catch (err) {
      console.error('Failed to load queue badge stats:', err)
    }
  }

  // Load badge count on mount and activeTab changes
  useEffect(() => {
    refreshQueueCount()
  }, [activeTab])

  // Setup global download monitoring listeners
  useEffect(() => {
    const unsubProgress = window.api.downloads.onProgress((data) => {
      console.log('Download progress event:', data)
      setDownloads((prev) => {
        if (!prev[data.id]) return prev // Ignore if not confirmed/initiated
        return {
          ...prev,
          [data.id]: {
            ...prev[data.id],
            status: data.status,
            progress: data.totalBytes > 0 ? (data.receivedBytes / data.totalBytes) * 100 : 0,
            receivedBytes: data.receivedBytes,
            totalBytes: data.totalBytes
          }
        }
      })
    })

    const unsubFinished = window.api.downloads.onFinished((data) => {
      console.log('Download finished event:', data)
      setDownloads((prev) => {
        if (!prev[data.id]) return prev
        const updated = { ...prev }
        updated[data.id] = {
          ...updated[data.id],
          status: data.status,
          progress: data.status === 'completed' ? 100 : updated[data.id].progress
        }
        return updated
      })

      // Refresh stats & queue count in case we finished importing
      refreshQueueCount()

      // Automatically remove successful toasts after 6 seconds
      if (data.status === 'completed') {
        // Signal LibraryView to reload so the newly saved preview_image_path appears
        if (data.modelId) {
          setLastCompletedModelId(data.modelId)
          // Clear after a tick so the next download triggers a fresh reload too
          setTimeout(() => setLastCompletedModelId(null), 200)
        }
        setTimeout(() => {
          setDownloads((prev) => {
            const updated = { ...prev }
            delete updated[data.id]
            return updated
          })
        }, 6000)
      }
    })

    return () => {
      unsubProgress()
      unsubFinished()
    }
  }, [])

  // Callback when a download starts saving in BrowserView
  const handleDownloadStarted = (data) => {
    console.log('Download confirm start:', data)
    
    // Auto-remove if already completed (for extremely fast background downloads)
    if (data.status === 'completed') {
      setTimeout(() => {
        setDownloads((prev) => {
          const updated = { ...prev }
          delete updated[data.id]
          return updated
        })
      }, 6000)
    }

    setDownloads((prev) => {
      // If the download somehow already finished (via background download) before this callback, preserve it
      if (prev[data.id] && prev[data.id].status === 'completed') return prev
      
      return {
        ...prev,
        [data.id]: {
          id: data.id,
          fileName: data.fileName,
          modelName: data.modelName,
          status: data.status || 'starting',
          progress: data.status === 'completed' ? 100 : 0,
          receivedBytes: 0,
          totalBytes: 0
        }
      }
    })
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView setActiveTab={setActiveTab} />
      case 'library':
        return <LibraryView onQueueChanged={refreshQueueCount} completedDownloadModelId={lastCompletedModelId} setActiveTab={setActiveTab} />
      case 'queue':
        return <QueueView onQueueChange={setActivePrints} />
      case 'browser':
        return null
      case 'add_model':
        return (
          <AddModelView 
            setActiveTab={setActiveTab} 
            initialFile={initialImportFile} 
            onClearInitialFile={() => setInitialImportFile(null)} 
          />
        )
      case 'settings':
        return <SettingsView />
      default:
        return <DashboardView setActiveTab={setActiveTab} />
    }
  };

  const getHeaderTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Dashboard'
      case 'library':
        return 'Model Library'
      case 'queue':
        return 'Printing Queue'
      case 'browser':
        return 'Find Models'
      case 'add_model':
        return 'Import Local Files'
      case 'settings':
        return 'Settings'
      default:
        return 'NozzleNest'
    }
  }

  return (
    <div className="app-container" id="app-shell-container">
      {/* Sidebar Navigation Panel */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        activePrints={activePrints} 
      />

      {/* Main Viewport panel */}
      <main className="app-content" id="app-main-viewport">
        {/* Render Page Title (Only if not find-models site browser, which has custom header controls) */}
        {activeTab !== 'browser' && (
          <header className="view-header" id="app-view-header">
            <h1 className="view-title" id="app-view-title">{getHeaderTitle()}</h1>
            {activeTab === 'library' && (
              <button 
                className="btn-primary" 
                onClick={() => setActiveTab('add_model')}
                style={{ marginLeft: 'auto', gap: '6px' }}
              >
                <FolderPlus style={{ width: '16px', height: '16px' }} />
                <span>Import Files</span>
              </button>
            )}
          </header>
        )}

        {/* Dynamic page contents */}
        {activeTab !== 'browser' && renderActiveView()}

        {/* Persistently mounted BrowserView to preserve webview sessions, scroll positions, and states */}
        <div 
          className="browser-view-wrapper" 
          style={{ 
            display: activeTab === 'browser' ? 'flex' : 'none', 
            flex: 1,
            flexDirection: 'column',
            height: '100%', 
            width: '100%',
            overflow: 'hidden'
          }}
          id="persistent-browser-wrapper"
        >
          <BrowserView onDownloadStarted={handleDownloadStarted} />
        </div>

        {/* Floating downloads active process toasts (positioned fixed bottom-right) */}
        <div 
          style={{ 
            position: 'fixed', 
            bottom: '24px', 
            right: '24px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '12px', 
            zIndex: 9999 
          }}
          id="downloads-toast-container"
        >
          {Object.values(downloads).map((dl) => (
            <div key={dl.id} className="download-toast" id={`download-toast-${dl.id}`}>
              <div className="toast-header">
                <div className="toast-title">
                  <Download className={dl.status === 'downloading' ? 'animate-bounce' : ''} style={{ width: '16px', height: '16px' }} />
                  <span>
                    {dl.status === 'starting' && 'Initializing download...'}
                    {dl.status === 'downloading' && 'Downloading model...'}
                    {dl.status === 'completed' && 'Saved to library!'}
                    {dl.status === 'failed' && 'Download failed'}
                    {dl.status === 'interrupted' && 'Download paused/interrupted'}
                  </span>
                </div>
                <button
                  className="btn-secondary"
                  style={{ padding: '2px 6px', minWidth: 'auto', border: 'none', background: 'transparent' }}
                  onClick={() => {
                    setDownloads((prev) => {
                      const updated = { ...prev }
                      delete updated[dl.id]
                      return updated
                    })
                  }}
                  title="Dismiss alert"
                >
                  <X style={{ width: '14px', height: '14px', color: 'var(--text-muted)' }} />
                </button>
              </div>

              <div className="toast-body">
                <div className="toast-item-name" title={dl.modelName}>
                  {dl.modelName}
                </div>
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${dl.progress || 0}%` }}
                  />
                </div>
                <div className="progress-bar-text">
                  <span>
                    {dl.status === 'completed' ? 'Import Complete' : `${Math.round(dl.progress || 0)}%`}
                  </span>
                  <span>
                    {dl.status === 'downloading' && `${(dl.receivedBytes / (1024 * 1024)).toFixed(1)}MB / ${(dl.totalBytes / (1024 * 1024)).toFixed(1)}MB`}
                    {dl.status === 'completed' && '100%'}
                    {dl.status === 'failed' && 'Write error'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
