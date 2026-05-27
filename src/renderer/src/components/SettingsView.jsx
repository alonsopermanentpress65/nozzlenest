import React, { useState, useEffect } from 'react'
import { FolderOpen, Save, CheckCircle2, ShieldAlert, RefreshCw, AlertCircle } from 'lucide-react'

export default function SettingsView() {
  const [libraryPath, setLibraryPath] = useState('C:\\NozzleNest')
  const [slicerPath, setSlicerPath] = useState('')
  const [savedStatus, setSavedStatus] = useState(null) // 'success' or 'error'
  const [updateInfo, setUpdateInfo] = useState(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [detectedSlicers, setDetectedSlicers] = useState([])
  const [isDetecting, setIsDetecting] = useState(false)

  const handleAutoDetect = async () => {
    setIsDetecting(true)
    setDetectedSlicers([])
    try {
      const slicers = await window.api.fs.detectSlicers()
      if (slicers && slicers.length === 1) {
        setSlicerPath(slicers[0].path)
      } else if (slicers && slicers.length > 1) {
        setDetectedSlicers(slicers)
      } else {
        alert('No supported slicers found in standard Windows directories.')
      }
    } catch (e) {
      console.error('Failed to detect slicers:', e)
    } finally {
      setIsDetecting(false)
    }
  }

  const handleSelectDetected = (path) => {
    setSlicerPath(path)
    setDetectedSlicers([])
  }

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true)
    setUpdateInfo(null)
    try {
      const res = await window.api.updates.checkLatestVersion()
      if (res && res.hasUpdate) {
        setUpdateInfo({
          type: 'update_available',
          latest: res.latestVersion,
          current: res.currentVersion,
          url: res.url,
          body: res.body
        })
      } else {
        setUpdateInfo({
          type: 'up_to_date'
        })
      }
    } catch (e) {
      console.error('Update check failed:', e)
      setUpdateInfo({
        type: 'error'
      })
    } finally {
      setCheckingUpdates(false)
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const settings = await window.api.db.getSettings()
        if (settings) {
          if (settings.libraryPath) setLibraryPath(settings.libraryPath)
          if (settings.slicerPath) setSlicerPath(settings.slicerPath)
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }
    load()
  }, [])

  const handlePickLibrary = async () => {
    try {
      const folder = await window.api.fs.selectFolder()
      if (folder) {
        setLibraryPath(folder)
      }
    } catch (err) {
      console.error('Error selecting library folder:', err)
    }
  }

  const handlePickSlicer = async () => {
    try {
      const files = await window.api.fs.selectFiles()
      if (files && files.length > 0) {
        setSlicerPath(files[0].path)
      }
    } catch (err) {
      console.error('Error selecting slicer file:', err)
    }
  }

  const handleSave = async () => {
    try {
      const res = await window.api.db.saveSettings({
        libraryPath,
        slicerPath
      })
      if (res && res.success) {
        setSavedStatus('success')
        setTimeout(() => setSavedStatus(null), 3000)
      } else {
        setSavedStatus('error')
        setTimeout(() => setSavedStatus(null), 3000)
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
      setSavedStatus('error')
      setTimeout(() => setSavedStatus(null), 3000)
    }
  }

  return (
    <div className="view-body" id="settings-view-body">
      <div className="settings-list" id="settings-list-container">
        {/* Save Status Notification */}
        {savedStatus === 'success' && (
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'var(--accent-green)', background: 'rgba(16, 185, 129, 0.05)', marginBottom: '16px', padding: '16px' }} id="settings-notify-success">
            <CheckCircle2 style={{ color: 'var(--accent-green)' }} />
            <span style={{ fontWeight: 600 }}>Settings saved successfully! Library directories initialized.</span>
          </div>
        )}
        {savedStatus === 'error' && (
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'var(--accent-red)', background: 'rgba(239, 68, 68, 0.05)', marginBottom: '16px', padding: '16px' }} id="settings-notify-error">
            <ShieldAlert style={{ color: 'var(--accent-red)' }} />
            <span style={{ fontWeight: 600 }}>Failed to save settings. Please verify the folder write permissions.</span>
          </div>
        )}

        {/* Library Path Config Group */}
        <div className="glass-card settings-group" id="settings-group-library">
          <h3 style={{ fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen style={{ width: '18px', height: '18px', color: 'var(--accent-purple)' }} />
            Library Directory
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            All your 3D model files, metadata database, and cached project images are stored here locally. Changing this path will automatically initialize folders in the new location.
          </p>
          <div className="settings-row">
            <input 
              type="text" 
              className="input-field settings-path-input" 
              id="input-settings-library-path"
              value={libraryPath} 
              readOnly 
              placeholder="e.g. C:\NozzleNest"
            />
            <button 
              className="btn-secondary" 
              id="btn-settings-browse-library"
              onClick={handlePickLibrary}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Slicer Config Group */}
        <div className="glass-card settings-group" id="settings-group-slicer">
          <h3 style={{ fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Save style={{ width: '18px', height: '18px', color: 'var(--accent-cyan)' }} />
            Custom Slicer Executable
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            Optional. Link your preferred slicer (e.g. Bambu Studio, OrcaSlicer, PrusaSlicer, or Ultimaker Cura). If empty, files will open in your Windows default system app.
          </p>
          <div className="settings-row">
            <input 
              type="text" 
              className="input-field settings-path-input" 
              id="input-settings-slicer-path"
              value={slicerPath} 
              onChange={(e) => setSlicerPath(e.target.value)} 
              placeholder="System default (or click Browse to select .exe path)"
            />
            <button 
              className="btn-secondary" 
              onClick={handleAutoDetect}
              disabled={isDetecting}
            >
              {isDetecting ? 'Scanning...' : 'Auto-Detect'}
            </button>
            <button 
              className="btn-secondary" 
              id="btn-settings-browse-slicer"
              onClick={handlePickSlicer}
            >
              Browse
            </button>
          </div>
          {detectedSlicers.length > 1 && (
            <div className="glass-card" style={{ marginTop: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', borderColor: 'rgba(124, 58, 237, 0.3)', background: 'rgba(124, 58, 237, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                <AlertCircle style={{ width: '18px', height: '18px', color: 'var(--accent-purple)' }} />
                <span>Multiple Slicers Found! Choose your default:</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {detectedSlicers.map((s, idx) => (
                  <button 
                    key={idx} 
                    className="btn-secondary" 
                    onClick={() => handleSelectDetected(s.path)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Updates Config Group */}
        <div className="glass-card settings-group" id="settings-group-updates">
          <h3 style={{ fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw className={checkingUpdates ? 'spin' : ''} style={{ width: '18px', height: '18px', color: 'var(--accent-cyan)' }} />
            Application Updates
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            NozzleNest is continuously improved. Check if there is a new public release available for download on your GitHub release repository.
          </p>
          <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
            <button 
              className="btn-secondary" 
              id="btn-settings-check-updates"
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
              style={{ minWidth: '150px' }}
            >
              {checkingUpdates ? 'Checking...' : 'Check for Updates'}
            </button>
            
            {updateInfo && updateInfo.type === 'update_available' && (
              <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.05)', width: '100%', padding: '12px', marginTop: '4px' }} id="settings-update-banner">
                <AlertCircle style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: '13px' }}>
                  A next-generation update is available! **{updateInfo.latest}** (Current: {updateInfo.current}).{' '}
                  <a 
                    href={updateInfo.url} 
                    target="_blank" 
                    rel="noreferrer"
                    style={{ color: 'var(--accent-cyan)', textDecoration: 'underline', fontWeight: 600 }}
                  >
                    Download from GitHub Releases
                  </a>
                </span>
              </div>
            )}

            {updateInfo && updateInfo.type === 'up_to_date' && (
              <span style={{ fontSize: '13px', color: 'var(--accent-green)', fontWeight: 600 }} id="settings-update-uptodate">
                ✓ You are running the latest version of NozzleNest!
              </span>
            )}

            {updateInfo && updateInfo.type === 'error' && (
              <span style={{ fontSize: '13px', color: 'var(--accent-red)' }} id="settings-update-error">
                ✗ Failed to contact release server. Please check your internet connection.
              </span>
            )}
          </div>
        </div>

        {/* Save Row */}
        <div className="settings-save-row" id="settings-save-row">
          <button 
            className="btn-primary" 
            id="btn-settings-save"
            onClick={handleSave}
            style={{ width: '140px' }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
