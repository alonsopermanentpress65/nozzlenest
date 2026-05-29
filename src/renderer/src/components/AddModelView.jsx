import React, { useState, useEffect } from 'react'
import { 
  UploadCloud, 
  FolderPlus, 
  FileSpreadsheet, 
  Database, 
  Trash2, 
  AlertTriangle, 
  Layers, 
  Tag, 
  ShieldAlert,
  CheckSquare
} from 'lucide-react'
import { generateSTLThumbnail } from '../utils/thumbnailGenerator'

export default function AddModelView({ setActiveTab, initialFile, onClearInitialFile }) {
  const [importQueue, setImportQueue] = useState([])
  const [isScanning, setIsScanning] = useState(false)
  const [libraryPath, setLibraryPath] = useState('')
  const [activeTempDirs, setActiveTempDirs] = useState([])
  const [availableTags, setAvailableTags] = useState([])

  // Load library settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await window.api.db.getSettings()
        if (settings && settings.libraryPath) {
          setLibraryPath(settings.libraryPath)
        }
        const tags = await window.api.db.getTags()
        setAvailableTags(tags || [])
      } catch (e) {
        console.error('Failed to load settings in AddModelView:', e)
      }
    }
    loadSettings()
  }, [])

  // Cleanup temp directories on unmount
  useEffect(() => {
    return () => {
      activeTempDirs.forEach(dir => {
        window.api.fs.cleanupTempFolder(dir)
      })
    }
  }, [activeTempDirs])

  const cleanupUnusedTempDirs = (currentQueue) => {
    const usedTempDirs = new Set(currentQueue.filter(i => i.isFromZip && i.tempDir).map(i => i.tempDir))
    
    setActiveTempDirs(prev => {
      const remainingDirs = []
      for (const dir of prev) {
        if (!usedTempDirs.has(dir)) {
          window.api.fs.cleanupTempFolder(dir)
        } else {
          remainingDirs.push(dir)
        }
      }
      return remainingDirs
    })
  }

  // Append new files to import queue and check duplicates
  const processImportList = async (files) => {
    setIsScanning(true)
    const newItems = []
    
    for (const f of files) {
      // Avoid duplicate file paths in current import session
      if (importQueue.some(item => item.path === f.path)) continue

      let duplicateInfo = null
      if (f.hash) {
        try {
          duplicateInfo = await window.api.db.checkDuplicate(f.hash)
        } catch (e) {
          console.error('Error checking duplicate:', e)
        }
      }

      newItems.push({
        name: f.name || 'Unnamed Model',
        fileName: f.fileName,
        path: f.path,
        size: f.size,
        hash: f.hash,
        ext: f.ext,
        duplicateOf: duplicateInfo, // contains { id, name } if exists
        
        isSelected: true,
        
        // Editable fields pre-filled with defaults
        description: '',
        material: 'PLA',
        rating: 3,
        tags: '',
        collections: '',
        notes: ''
      })
    }

    setImportQueue(prev => [...prev, ...newItems])
    setIsScanning(false)
  }

  // Robustly process regular files, directories, and ZIP archives
  const processFilesAndZips = async (filesArray) => {
    const listToStaging = []
    
    for (const f of filesArray) {
      const fileExt = f.ext?.toLowerCase() || f.path?.split('.').pop().toLowerCase()
      
      if (fileExt === 'zip') {
        try {
          const res = await window.api.fs.extractLocalZipToTemp(f.path, libraryPath)
          if (res && res.tempDir && res.files.length > 0) {
            setActiveTempDirs(prev => [...prev, res.tempDir])
            const taggedFiles = res.files.map(extractedFile => ({
              ...extractedFile,
              isFromZip: true,
              tempDir: res.tempDir
            }))
            listToStaging.push(...taggedFiles)
          }
        } catch (zipErr) {
          console.error('Failed to extract local ZIP file:', zipErr)
        }
      } else {
        listToStaging.push(f)
      }
    }
    
    if (listToStaging.length > 0) {
      await processImportList(listToStaging)
    }
  }

  // Handle files passed from shell association double-click
  useEffect(() => {
    async function loadInitialFile() {
      if (initialFile) {
        console.log('AddModelView processing initial file:', initialFile)
        try {
          setIsScanning(true)
          const details = await window.api.fs.getFileDetails(initialFile)
          if (details) {
            await processFilesAndZips([details])
          }
        } catch (e) {
          console.error('Failed to resolve initial file details:', e)
        } finally {
          setIsScanning(false)
          if (onClearInitialFile) onClearInitialFile()
        }
      }
    }
    loadInitialFile()
  }, [initialFile])

  // Trigger system folder scan picker
  const handleScanFolder = async () => {
    try {
      const folderPath = await window.api.fs.selectFolder()
      if (!folderPath) return
      
      setIsScanning(true)
      const files = await window.api.fs.scanFolder(folderPath)
      if (files && files.length > 0) {
        await processFilesAndZips(files)
      } else {
        alert('No STL or 3MF model files were found in this directory.')
      }
    } catch (e) {
      console.error('Failed scanning folder:', e)
    } finally {
      setIsScanning(false)
    }
  }

  // Trigger system file selection picker
  const handleSelectFiles = async () => {
    try {
      const files = await window.api.fs.selectFiles()
      if (files && files.length > 0) {
        setIsScanning(true)
        await processFilesAndZips(files)
      }
    } catch (e) {
      console.error('Failed selecting files:', e)
    } finally {
      setIsScanning(false)
    }
  }

  // Handle Drag & Drop
  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    const droppedFiles = e.dataTransfer.files
    if (!droppedFiles || droppedFiles.length === 0) return

    const pathsToProcess = []
    setIsScanning(true)

    for (let i = 0; i < droppedFiles.length; i++) {
      const item = droppedFiles[i]
      const path = item.path // HTML5 File.path is full system path in Electron!
      if (!path) continue

      try {
        const isDir = await window.api.fs.isDirectory(path)
        if (isDir) {
          const files = await window.api.fs.scanFolder(path)
          pathsToProcess.push(...files)
        } else {
          const ext = path.split('.').pop().toLowerCase()
          if (ext === 'stl' || ext === '3mf' || ext === 'zip') {
            pathsToProcess.push({
              name: item.name.replace(/\.[^/.]+$/, ""),
              fileName: item.name,
              path: path,
              size: item.size,
              ext: ext,
              hash: ''
            })
          }
        }
      } catch (err) {
        console.error('Drop processing failed:', err)
      }
    }

    if (pathsToProcess.length > 0) {
      await processFilesAndZips(pathsToProcess)
    }
    setIsScanning(false)
  }

  // Update card field value
  const handleCardFieldChange = (index, field, value) => {
    setImportQueue(prev => {
      const updated = [...prev]
      updated[index][field] = value
      return updated
    })
  }

  // Remove card from list
  const handleRemoveCard = (index) => {
    setImportQueue(prev => {
      const remaining = prev.filter((_, idx) => idx !== index)
      cleanupUnusedTempDirs(remaining)
      return remaining
    })
  }

  const handleToggleSelectAll = () => {
    const allSelected = importQueue.length > 0 && importQueue.every(item => item.isSelected)
    setImportQueue(prev => prev.map(item => ({ ...item, isSelected: !allSelected })))
  }

  // Core Import Pipeline
  const performImport = async (itemsToImport) => {
    if (itemsToImport.length === 0) return true

    setIsScanning(true)
    try {
      const settings = await window.api.db.getSettings()
      const libPath = settings ? settings.libraryPath : libraryPath

      for (const item of itemsToImport) {
        // 1. Save base database record
        const modelId = await window.api.db.addModel({
          name: item.name,
          description: item.description,
          source_url: '',
          source_site: 'local',
          local_path: 'pending', // finalize once copied
          status: 'not_printed',
          is_favorite: 0,
          rating: item.rating,
          material: item.material,
          notes: item.notes,
          file_hash: item.hash,
          tags: item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          collections: item.collections ? item.collections.split(',').map(c => c.trim()).filter(Boolean) : []
        })

        // 2. Copy model file to dedicated NozzleNest directories
        const copiedPath = await window.api.fs.copyToLibrary(
          item.path,
          libPath,
          modelId,
          item.fileName,
          item.isFromZip,
          item.tempDir
        )

        // 3. Update database record with final copied path
        await window.api.db.updateModel(modelId, {
          local_path: copiedPath
        })

        // 4. Scan the model folder and register all files in model_files
        try {
          const modelFiles = await window.api.fs.scanModelFiles(libPath, modelId)
          if (modelFiles && modelFiles.length > 0) {
            const filesToRegister = modelFiles.map((f, idx) => ({
              file_path: f.path,
              file_name: f.fileName || f.name,
              file_type: f.ext,
              is_primary: f.path === copiedPath
            }))
            await window.api.db.addModelFiles(modelId, filesToRegister)
          } else {
            // Fallback: register the single copied file
            await window.api.db.addModelFiles(modelId, [{
              file_path: copiedPath,
              file_name: item.fileName,
              file_type: item.ext,
              is_primary: true
            }])
          }
        } catch (scanErr) {
          console.warn('Failed to scan model files for local import, using fallback:', scanErr)
          await window.api.db.addModelFiles(modelId, [{
            file_path: copiedPath,
            file_name: item.fileName,
            file_type: item.ext,
            is_primary: true
          }])
        }

        // 5. Generate and save preview image (if applicable)
        try {
          if (item.ext === 'stl' || item.ext === '3mf') {
            // DEFERRED: Thumbnail generation is now handled lazily by the background
            // auto-generator in LibraryView.jsx to prevent WebGL context exhaustion
            // and UI freezing during large batch imports.
            console.log(`[Import] Thumbnail generation deferred for ${item.fileName}`)
          }
        } catch (previewErr) {
          console.warn('[Import] Failed to handle local preview thumbnail deferral', previewErr)
        }
      }

      return true
    } catch (err) {
      console.error('Batch import failed:', err)
      alert('An error occurred during model import. Please verify settings.')
      return false
    } finally {
      setIsScanning(false)
    }
  }

  // Import Selected Batch
  const handleImportSelected = async () => {
    const itemsToImport = importQueue.filter(item => item.isSelected)
    if (itemsToImport.length === 0) {
      alert('No models selected for import.')
      return
    }

    const success = await performImport(itemsToImport)
    if (success) {
      const remainingQueue = importQueue.filter(item => !item.isSelected)
      setImportQueue(remainingQueue)
      cleanupUnusedTempDirs(remainingQueue)

      if (remainingQueue.length === 0) {
        alert('All selected models successfully imported into your nest!')
        setActiveTab('library')
      } else {
        alert(`Successfully imported ${itemsToImport.length} models!`)
      }
    }
  }

  // Import Single Item
  const handleImportSingle = async (index) => {
    const itemToImport = importQueue[index]
    const success = await performImport([itemToImport])
    if (success) {
      const remainingQueue = importQueue.filter((_, idx) => idx !== index)
      setImportQueue(remainingQueue)
      cleanupUnusedTempDirs(remainingQueue)

      if (remainingQueue.length === 0) {
        alert(`Successfully imported "${itemToImport.name}"!`)
        setActiveTab('library')
      } else {
        alert(`Successfully imported "${itemToImport.name}"!`)
      }
    }
  }

  return (
    <div className="view-body" id="add-model-view-body" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Drag & Drop Zone */}
      <div 
        className="dropzone-container" 
        id="import-dropzone"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <UploadCloud className="dropzone-icon animate-pulse" />
        <span className="dropzone-text">Drag & drop your STL / 3MF files or folders here</span>
        <span className="dropzone-subtext">NozzleNest recursively extracts and scans models locally</span>
        
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <button 
            className="btn-primary" 
            id="btn-scan-folders"
            onClick={handleScanFolder}
            style={{ gap: '8px' }}
          >
            <FolderPlus style={{ width: '16px', height: '16px' }} />
            Scan Directory
          </button>
          <button 
            className="btn-secondary" 
            id="btn-scan-files"
            onClick={handleSelectFiles}
            style={{ gap: '8px' }}
          >
            <FileSpreadsheet style={{ width: '16px', height: '16px' }} />
            Browse Files
          </button>
        </div>

        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '14px', textAlign: 'center', maxWidth: '420px', lineHeight: '1.4' }}>
          <strong>Tip:</strong> Windows folder selectors hide model files by default. To scan a folder, navigate to it and click <strong>"Select Folder"</strong>, or click <strong>"Browse Files"</strong> to pick files individually.
        </p>
      </div>

      {/* Batch Import Scrollable List */}
      <div className="scrollable" style={{ flex: 1, paddingBottom: '20px' }} id="import-queue-scroll">
        {importQueue.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                  type="checkbox" 
                  checked={importQueue.length > 0 && importQueue.every(item => item.isSelected)}
                  onChange={handleToggleSelectAll}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent-purple)' }}
                />
                <h3 style={{ fontSize: '16px', fontWeight: 700 }}>
                  Pending Batch Confirmation ({importQueue.length} models)
                </h3>
              </div>
              <button 
                className="btn-accent" 
                id="btn-confirm-import-selected"
                onClick={handleImportSelected}
                disabled={isScanning || importQueue.filter(i => i.isSelected).length === 0}
              >
                Import Selected ({importQueue.filter(i => i.isSelected).length})
              </button>
            </div>

            <div className="import-cards-list" id="import-cards-list">
              {importQueue.map((item, idx) => (
                <div key={idx} className="import-card" id={`import-card-${idx}`} style={{ opacity: item.isSelected ? 1 : 0.5, transition: 'all 0.2s ease-in-out' }}>
                  
                  {/* Full-width Header Row with Checkbox */}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '16px', marginBottom: '-4px' }}>
                    <input 
                      type="checkbox"
                      checked={item.isSelected}
                      onChange={(e) => handleCardFieldChange(idx, 'isSelected', e.target.checked)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent-purple)' }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: item.isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      Select for Import: <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '4px' }}>{item.fileName}</span>
                    </span>
                  </div>

                  {/* Duplicate Alert Indicator */}
                  {item.duplicateOf && (
                    <div 
                      className="badge badge-red import-card-duplicate-badge" 
                      style={{ display: 'flex', gap: '4px', padding: '4px 10px' }}
                      id={`duplicate-badge-${idx}`}
                      title={`SHA-256 hash match with model ID: ${item.duplicateOf.id}`}
                    >
                      <ShieldAlert style={{ width: '12px', height: '12px' }} />
                      <span>Duplicate Warning: "{item.duplicateOf.name}"</span>
                    </div>
                  )}

                  {/* Left Column: File Details & Fields */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="import-form-group">
                      <label className="filter-label" style={{ fontSize: '10px' }}>Model Name</label>
                      <input
                        type="text"
                        className="input-field"
                        id={`import-name-${idx}`}
                        value={item.name}
                        onChange={(e) => handleCardFieldChange(idx, 'name', e.target.value)}
                      />
                    </div>

                    <div className="import-form-group">
                      <label className="filter-label" style={{ fontSize: '10px' }}>Description</label>
                      <textarea
                        className="input-field"
                        id={`import-desc-${idx}`}
                        rows="3"
                        value={item.description}
                        onChange={(e) => handleCardFieldChange(idx, 'description', e.target.value)}
                        placeholder="Add some details about the model..."
                        style={{ resize: 'none', fontFamily: 'inherit' }}
                      />
                    </div>

                    {/* Source File Spec Display */}
                    <div className="glass-card" style={{ display: 'flex', gap: '16px', padding: '10px', fontSize: '11px', background: 'rgba(0,0,0,0.1)' }}>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Format:</span>{' '}
                        <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{item.ext}</span>
                      </div>
                      <div style={{ wordBreak: 'break-all' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Source:</span>{' '}
                        <span style={{ fontWeight: 500 }}>{item.fileName}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Metadata fields */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div className="import-form-group" style={{ flex: 1 }}>
                        <label className="filter-label" style={{ fontSize: '10px' }}>Material</label>
                        <select
                          className="select-field"
                          id={`import-material-${idx}`}
                          value={item.material}
                          onChange={(e) => handleCardFieldChange(idx, 'material', e.target.value)}
                          style={{ width: '100%' }}
                        >
                          <option value="PLA">PLA</option>
                          <option value="PETG">PETG</option>
                          <option value="ABS">ABS</option>
                          <option value="TPU">TPU</option>
                          <option value="Resin">Resin</option>
                        </select>
                      </div>

                      <div className="import-form-group" style={{ flex: 1 }}>
                        <label className="filter-label" style={{ fontSize: '10px' }}>Rating</label>
                        <select
                          className="select-field"
                          id={`import-rating-${idx}`}
                          value={item.rating}
                          onChange={(e) => handleCardFieldChange(idx, 'rating', Number(e.target.value))}
                          style={{ width: '100%' }}
                        >
                          <option value={1}>1 Star</option>
                          <option value={2}>2 Stars</option>
                          <option value={3}>3 Stars</option>
                          <option value={4}>4 Stars</option>
                          <option value={5}>5 Stars</option>
                        </select>
                      </div>
                    </div>

                    <div className="import-form-group">
                      <label className="filter-label" style={{ fontSize: '10px' }}>Tags (comma separated)</label>
                      <input
                        type="text"
                        className="input-field"
                        id={`import-tags-${idx}`}
                        value={item.tags}
                        onChange={(e) => handleCardFieldChange(idx, 'tags', e.target.value)}
                        placeholder="e.g. calibration, accessory"
                      />
                      {availableTags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                          {availableTags.map(t => {
                            const currentTags = item.tags ? item.tags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []
                            const isSelected = currentTags.includes(t.name.toLowerCase())
                            return (
                              <button
                                key={t.id}
                                type="button"
                                className={`badge ${isSelected ? 'badge-purple' : ''}`}
                                style={{ 
                                  cursor: 'pointer', 
                                  opacity: isSelected ? 0.7 : 1, 
                                  background: isSelected ? undefined : 'rgba(255,255,255,0.05)', 
                                  border: isSelected ? undefined : '1px solid var(--border-glass)',
                                  color: isSelected ? undefined : 'var(--text-muted)'
                                }}
                                onClick={() => {
                                  const list = item.tags ? item.tags.split(',').map(s => s.trim()).filter(Boolean) : []
                                  let newTags
                                  if (isSelected) {
                                    newTags = list.filter(n => n.toLowerCase() !== t.name.toLowerCase()).join(', ')
                                  } else {
                                    newTags = [...list, t.name].join(', ')
                                  }
                                  handleCardFieldChange(idx, 'tags', newTags)
                                }}
                              >
                                {t.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="import-form-group">
                      <label className="filter-label" style={{ fontSize: '10px' }}>Collections (comma separated)</label>
                      <input
                        type="text"
                        className="input-field"
                        id={`import-collections-${idx}`}
                        value={item.collections}
                        onChange={(e) => handleCardFieldChange(idx, 'collections', e.target.value)}
                        placeholder="e.g. Printer Upgrades"
                      />
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 'auto' }}>
                      <button
                        className="btn-secondary"
                        id={`btn-remove-import-${idx}`}
                        onClick={() => handleRemoveCard(idx)}
                        style={{ padding: '6px 12px', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--accent-red)', gap: '6px' }}
                      >
                        <Trash2 style={{ width: '14px', height: '14px' }} />
                        <span>Remove Item</span>
                      </button>
                      <button
                        className="btn-accent"
                        id={`btn-import-single-${idx}`}
                        onClick={() => handleImportSingle(idx)}
                        disabled={isScanning || !item.isSelected}
                        style={{ padding: '6px 16px', gap: '6px', opacity: item.isSelected ? 1 : 0.5 }}
                      >
                        <Database style={{ width: '14px', height: '14px' }} />
                        <span>Import Item</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div 
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              padding: '60px 20px', 
              color: 'var(--text-muted)' 
            }}
            id="import-list-empty"
          >
            {isScanning ? (
              <>
                <UploadCloud className="dropzone-icon animate-spin" />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Scanning files...</h3>
                <p style={{ fontSize: '13px' }}>Scanning files recursively and hashing for duplicates...</p>
              </>
            ) : (
              <>
                <Layers style={{ width: '48px', height: '48px', color: 'var(--border-glass-bright)', marginBottom: '16px' }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Import list empty</h3>
                <p style={{ fontSize: '13px' }}>Select directories or browse files to stage your STL/3MF imports.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
