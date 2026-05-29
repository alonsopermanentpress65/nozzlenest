import React, { useState, useEffect } from 'react'
import { 
  Search, 
  Filter, 
  Grid, 
  List, 
  Star, 
  ExternalLink, 
  Printer, 
  FolderOpen, 
  Edit3, 
  Trash2, 
  X, 
  Heart, 
  Save, 
  Eye, 
  Sparkles, 
  Tag,
  Layers,
  Database,
  File,
  Box,
  ImageIcon,
  RefreshCw,
  CheckSquare,
  Square
} from 'lucide-react'
import ThreeViewer from './ThreeViewer'
import CollectionsManager from './CollectionsManager'
import { generateSTLThumbnail } from '../utils/thumbnailGenerator'

export default function LibraryView({ onQueueChanged, completedDownloadModelId }) {
  // State variables
  const [models, setModels] = useState([])
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'list'
  const [showFilters, setShowFilters] = useState(false)
  const [selectedModels, setSelectedModels] = useState([])
  
  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMaterial, setFilterMaterial] = useState('')
  const [filterCollection, setFilterCollection] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [sortBy, setSortBy] = useState('date') // 'date', 'name', 'rating'

  // Metadata catalogs
  const [tags, setTags] = useState([])
  const [collections, setCollections] = useState([])
  
  // Detail Panel state
  const [selectedModelId, setSelectedModelId] = useState(null)
  const [selectedModel, setSelectedModel] = useState(null)
  const [show3DPreview, setShow3DPreview] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [previewFilePath, setPreviewFilePath] = useState('') // Which file to show in 3D viewer
  const [isFetchingThumb, setIsFetchingThumb] = useState(false)
  const [showCollectionsManager, setShowCollectionsManager] = useState(false)

  // Edit fields state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editMaterial, setEditMaterial] = useState('')
  const [editRating, setEditRating] = useState(0)
  const [editTags, setEditTags] = useState('')
  const [editCollections, setEditCollections] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // Load models on mount or when filters change
  const loadModels = async () => {
    try {
      const filters = {
        search: searchQuery || undefined,
        status: filterStatus || undefined,
        material: filterMaterial || undefined,
        collection_id: filterCollection || undefined,
        tag_id: filterTag || undefined,
        sortBy
      }
      const data = await window.api.db.getModels(filters)
      if (data) {
        setModels(data)
      }
    } catch (err) {
      console.error('Failed to load models:', err)
    }
  }

  // Load tag & collection catalogs
  const loadCatalogs = async () => {
    try {
      const tagsData = await window.api.db.getTags()
      const colsData = await window.api.db.getCollections()
      if (tagsData) setTags(tagsData)
      if (colsData) setCollections(colsData)
    } catch (err) {
      console.error('Failed to load tags or collections:', err)
    }
  }

  useEffect(() => {
    loadModels()
    loadCatalogs()
  }, [searchQuery, filterStatus, filterMaterial, filterCollection, filterTag, sortBy])

  // Reload models when a browser download finishes so the new preview_image_path shows up
  useEffect(() => {
    if (completedDownloadModelId) {
      loadModels()
    }
  }, [completedDownloadModelId])

  // Load single model details when opened
  useEffect(() => {
    if (selectedModelId) {
      fetchModelDetails(selectedModelId)
    } else {
      setSelectedModel(null)
      setShow3DPreview(false)
      setIsEditing(false)
    }
  }, [selectedModelId])

  const fetchModelDetails = async (id) => {
    try {
      const model = await window.api.db.getModel(id)
      if (model) {
        setSelectedModel(model)
        // Default 3D preview to the primary file
        setPreviewFilePath(model.local_path || '')
        // Set edit states
        setEditName(model.name)
        setEditDesc(model.description || '')
        setEditMaterial(model.material || '')
        setEditRating(model.rating || 0)
        setEditTags(model.tags ? model.tags.join(', ') : '')
        setEditCollections(model.collections ? model.collections.join(', ') : '')
        setEditNotes(model.notes || '')
      }
    } catch (e) {
      console.error('Error fetching model details:', e)
    }
  }

  // Toggle favorite
  const handleToggleFavorite = async (id, currentVal, e) => {
    if (e) e.stopPropagation()
    try {
      await window.api.db.updateModel(id, { is_favorite: !currentVal })
      loadModels()
      if (selectedModel && selectedModel.id === id) {
        fetchModelDetails(id)
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
    }
  }

  // Background Auto-Generator for Missing Thumbnails
  useEffect(() => {
    // Find the first local model that needs a thumbnail generated
    const modelNeedsThumb = models.find(m => !m.preview_image_path && !m.source_url && m.local_path)
    
    if (modelNeedsThumb && !isFetchingThumb) {
      const autoGenerate = async () => {
        try {
          setIsFetchingThumb(true)
          const base64 = await generateSTLThumbnail(modelNeedsThumb.local_path)
          if (base64) {
            const settings = await window.api.db.getSettings()
            const res = await window.api.fs.savePreviewImage(settings.libraryPath, modelNeedsThumb.id, base64)
            if (res) {
              // Update the database so it knows the thumbnail exists and stops looping
              await window.api.db.updateModel(modelNeedsThumb.id, { preview_image_path: res })
              
              // Reload models quietly to inject the new preview path
              const filters = {
                search: searchQuery || undefined,
                status: filterStatus || undefined,
                material: filterMaterial || undefined,
                collection_id: filterCollection || undefined,
                tag_id: filterTag || undefined,
                sortBy
              }
              const data = await window.api.db.getModels(filters)
              if (data) setModels(data)
              
              // If the currently viewed details panel matches, update its state immediately
              if (selectedModel && selectedModel.id === modelNeedsThumb.id) {
                setSelectedModel(prev => ({ ...prev, preview_image_path: res.path }))
              }
            }
          }
        } catch (e) {
          console.error('[Auto-Thumb] Failed:', e)
        } finally {
          setIsFetchingThumb(false)
        }
      }
      
      // Delay slightly so we don't hog the render thread continuously
      const timer = setTimeout(autoGenerate, 1500)
      return () => clearTimeout(timer)
    }
  }, [models, isFetchingThumb, searchQuery, filterStatus, filterMaterial, filterCollection, filterTag, sortBy, selectedModel])

  // Add / remove from print queue
  const handleToggleQueue = async (id, status) => {
    try {
      if (status === 'queued') {
        await window.api.db.removeFromQueue(id)
      } else {
        await window.api.db.addToQueue(id)
      }
      loadModels()
      fetchModelDetails(id)
      if (onQueueChanged) onQueueChanged()
    } catch (err) {
      console.error('Failed to update queue state:', err)
    }
  }

  // Open in default Explorer location
  const handleOpenFileLocation = async (filePath) => {
    try {
      await window.api.fs.openFileLocation(filePath)
    } catch (err) {
      console.error('Error opening file location:', err)
    }
  }

  // Open model in Slicer
  const handleOpenInSlicer = async (filePath) => {
    try {
      const settings = await window.api.db.getSettings()
      const customSlicer = settings ? settings.slicerPath : ''
      await window.api.fs.openInSlicer(filePath, customSlicer)
    } catch (err) {
      console.error('Error opening in slicer:', err)
    }
  }

  // Save metadata modifications
  const handleSaveEdits = async () => {
    try {
      const parsedTags = editTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
      
      const parsedCollections = editCollections
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0)

      await window.api.db.updateModel(selectedModel.id, {
        name: editName || 'Unnamed Model',
        description: editDesc,
        material: editMaterial,
        rating: editRating,
        notes: editNotes,
        tags: parsedTags,
        collections: parsedCollections
      })

      setIsEditing(false)
      loadModels()
      loadCatalogs()
      fetchModelDetails(selectedModel.id)
    } catch (err) {
      console.error('Failed to save model edits:', err)
    }
  }

  // Delete model
  const handleDeleteModel = async (id) => {
    const confirm = window.confirm('Are you sure you want to permanently delete this model from your nest? This action cannot be undone.')
    if (!confirm) return

    try {
      await window.api.db.deleteModel(id)
      setSelectedModelId(null)
      loadModels()
      loadCatalogs()
      if (onQueueChanged) onQueueChanged()
    } catch (err) {
      console.error('Failed to delete model:', err)
    }
  }

  // Toggle selection
  const handleToggleSelect = (id, e) => {
    e.stopPropagation()
    setSelectedModels(prev => 
      prev.includes(id) ? prev.filter(modelId => modelId !== id) : [...prev, id]
    )
  }

  // Bulk Delete
  const handleBulkDelete = async () => {
    const confirm = window.confirm(`Are you sure you want to delete ${selectedModels.length} models? This action cannot be undone.`)
    if (!confirm) return

    try {
      // Loop sequentially or use Promise.all. 
      for (const id of selectedModels) {
        await window.api.db.deleteModel(id)
        try {
           await window.api.db.deleteModelFiles(id)
        } catch(e) {} // ignore if no files
      }
      setSelectedModels([])
      setSelectedModelId(null)
      loadModels()
      loadCatalogs()
      if (onQueueChanged) onQueueChanged()
    } catch (err) {
      console.error('Failed to bulk delete models:', err)
    }
  }

  // Retroactively fetch and save a preview image for an existing model
  const handleFetchThumbnail = async () => {
    if (!selectedModel || isFetchingThumb) return
    setIsFetchingThumb(true)
    try {
      const settings = await window.api.db.getSettings()
      const libraryPath = settings?.libraryPath
      if (!libraryPath) throw new Error('Library path not configured')

      const sourceUrl = selectedModel.source_url || ''
      let imageUrl = ''

      // Printables: use the reliable GraphQL API
      if (sourceUrl.includes('printables.com/model/')) {
        const apiResult = await window.api.browser.printablesGetTags(sourceUrl)
        if (apiResult.success && apiResult.imageUrl) {
          imageUrl = apiResult.imageUrl
        }
      }

      if (!imageUrl) {
        alert('Could not find a thumbnail for this model. Make sure it has a source URL set.')
        return
      }

      const savedPath = await window.api.fs.savePreviewImage(libraryPath, selectedModel.id, imageUrl)
      if (savedPath) {
        await window.api.db.updateModel(selectedModel.id, { preview_image_path: savedPath })
        // Refresh the detail view and the grid list
        await fetchModelDetails(selectedModel.id)
        loadModels()
      } else {
        alert('Image download failed — check the terminal for details.')
      }
    } catch (err) {
      console.error('Failed to fetch thumbnail:', err)
      alert('Error fetching thumbnail: ' + err.message)
    } finally {
      setIsFetchingThumb(false)
    }
  }

  return (
    <div className="view-body" id="library-view-body" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showCollectionsManager ? (
        <CollectionsManager 
          onClose={() => setShowCollectionsManager(false)}
          onCollectionsChanged={loadModels}
        />
      ) : (
        <>
          {/* 1. Header Filter Controls */}
          <div className="library-filter-row" id="library-filters-bar">
        {/* Search Input */}
        <div className="library-search-wrapper">
          <Search className="library-search-icon" />
          <input
            type="text"
            className="input-field library-search-input"
            id="library-search-query"
            placeholder="Search by name, tag, or collection..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Expandable filters button */}
        <button
          className={`btn-secondary ${showFilters ? 'active' : ''}`}
          id="btn-toggle-filters"
          onClick={() => setShowFilters(!showFilters)}
          style={{ gap: '8px' }}
        >
          <Filter style={{ width: '16px', height: '16px' }} />
          <span>Filters</span>
        </button>

        {/* Sort Select */}
        <select
          className="select-field"
          style={{ width: '140px' }}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="date">Sort: Date</option>
          <option value="name">Sort: Name</option>
          <option value="rating">Sort: Rating</option>
        </select>

        {/* View Mode Toggle */}
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
          <button
            className={`btn-secondary ${viewMode === 'grid' ? 'active' : ''}`}
            id="btn-view-grid"
            onClick={() => setViewMode('grid')}
            style={{ padding: '6px 10px', minWidth: 'auto', background: viewMode === 'grid' ? 'rgba(124,58,237,0.2)' : 'transparent', border: 'none' }}
          >
            <Grid style={{ width: '16px', height: '16px' }} />
          </button>
          <button
            className={`btn-secondary ${viewMode === 'list' ? 'active' : ''}`}
            id="btn-view-list"
            onClick={() => setViewMode('list')}
            style={{ padding: '6px 10px', minWidth: 'auto', background: viewMode === 'list' ? 'rgba(124,58,237,0.2)' : 'transparent', border: 'none' }}
          >
            <List style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      </div>

      {/* Collections Pill Bar */}
      <div className="collections-pill-bar">
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Collections:
        </span>
        <button
          className={`collection-pill ${filterCollection === '' ? 'active' : ''}`}
          onClick={() => setFilterCollection('')}
        >
          All
        </button>
        {collections.map(c => (
          <button
            key={c.id}
            className={`collection-pill ${filterCollection === String(c.id) ? 'active' : ''}`}
            style={{ '--pill-color': c.color || 'var(--text-secondary)' }}
            onClick={() => setFilterCollection(String(c.id))}
          >
            <div className="collection-pill-dot" style={{ background: c.color || 'var(--text-secondary)' }}></div>
            {c.name} ({c.count || 0})
          </button>
        ))}
        <button 
          className="collection-pill manage-pill"
          onClick={() => setShowCollectionsManager(true)}
        >
          + Manage
        </button>
      </div>

      {/* Expandable Advanced Filters Panel */}
      {showFilters && (
        <div className="expandable-filters-panel" id="advanced-filters-panel">
          {/* Filter Status */}
          <div className="filter-group">
            <label className="filter-label">Print Status</label>
            <select
              className="select-field"
              id="filter-status-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="not_printed">Not Printed</option>
              <option value="queued">In Queue</option>
              <option value="printed">Printed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {/* Filter Material */}
          <div className="filter-group">
            <label className="filter-label">Material</label>
            <select
              className="select-field"
              id="filter-material-select"
              value={filterMaterial}
              onChange={(e) => setFilterMaterial(e.target.value)}
            >
              <option value="">All Materials</option>
              <option value="PLA">PLA</option>
              <option value="PETG">PETG</option>
              <option value="ABS">ABS</option>
              <option value="TPU">TPU</option>
              <option value="Resin">Resin</option>
            </select>
          </div>

          {/* Filter Collection */}
          <div className="filter-group">
            <label className="filter-label">Collection</label>
            <select
              className="select-field"
              id="filter-collection-select"
              value={filterCollection}
              onChange={(e) => setFilterCollection(e.target.value)}
            >
              <option value="">All Collections</option>
              {collections.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
              ))}
            </select>
          </div>

          {/* Filter Tag */}
          <div className="filter-group">
            <label className="filter-label">Tag</label>
            <select
              className="select-field"
              id="filter-tag-select"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            >
              <option value="">All Tags</option>
              {tags.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
              ))}
            </select>
          </div>

        </div>
      )}

      {/* 2. Scrollable Library Grid/List Layout */}
      <div className="scrollable" style={{ flex: 1, paddingTop: '8px' }} id="library-scrollable-container">
        {models.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="models-grid" id="models-grid-view">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={`model-card-grid ${selectedModels.includes(model.id) ? 'selected' : ''}`}
                  id={`model-card-grid-${model.id}`}
                  onClick={() => setSelectedModelId(model.id)}
                >
                  {/* Selection Checkbox Overlay */}
                  <button
                    className={`model-card-checkbox-btn ${selectedModels.includes(model.id) ? 'active' : ''}`}
                    onClick={(e) => handleToggleSelect(model.id, e)}
                  >
                    {selectedModels.includes(model.id) ? <CheckSquare style={{width:'18px',height:'18px',color:'var(--accent-purple)'}} /> : <Square style={{width:'18px',height:'18px',color:'var(--border-glass-bright)'}} />}
                  </button>

                  {/* Favorite Star Overlay */}
                  <button
                    className={`model-card-favorite-btn ${model.is_favorite ? 'active' : ''}`}
                    id={`btn-favorite-${model.id}`}
                    onClick={(e) => handleToggleFavorite(model.id, model.is_favorite, e)}
                  >
                    <Star className="model-card-favorite-icon" fill={model.is_favorite ? 'var(--accent-yellow)' : 'none'} />
                  </button>

                  {/* Thumbnail container */}
                  <div className="model-thumb-container">
                    {model.preview_image_path ? (
                      <img
                        src={`media://${model.preview_image_path}`}
                        alt={model.name}
                        className="model-thumb"
                      />
                    ) : (
                      <div className="model-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)' }}>
                        <Database style={{ width: '36px', height: '36px', color: 'var(--border-glass-bright)' }} />
                      </div>
                    )}
                  </div>

                  {/* Card Info Body */}
                  <div className="model-card-body">
                    <h4 className="model-card-title">{model.name}</h4>
                    
                    {/* One line tags */}
                    <div className="model-card-tags">
                      {model.tags && model.tags.length > 0 ? (
                        model.tags.map((t, i) => (
                          <span key={i} className="model-card-tag">{t}</span>
                        ))
                      ) : (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>No tags</span>
                      )}
                    </div>

                    <div className="model-card-footer">
                      {/* Status badge */}
                      {model.status === 'queued' && <span className="badge badge-cyan">In Queue</span>}
                      {model.status === 'printed' && <span className="badge badge-green">Printed</span>}
                      {model.status === 'failed' && <span className="badge badge-red">Failed</span>}
                      {model.status === 'not_printed' && <span className="badge badge-purple">Not Printed</span>}

                      {/* Material pill */}
                      {model.material && (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {model.material}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // List View
            <div className="models-list" id="models-list-view">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={`model-card-list ${selectedModels.includes(model.id) ? 'selected' : ''}`}
                  id={`model-card-list-${model.id}`}
                  onClick={() => setSelectedModelId(model.id)}
                >
                  {/* Selection Checkbox */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                    <button
                      className="model-list-checkbox-btn"
                      onClick={(e) => handleToggleSelect(model.id, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                    >
                      {selectedModels.includes(model.id) ? <CheckSquare style={{width:'18px',height:'18px',color:'var(--accent-purple)'}} /> : <Square style={{width:'18px',height:'18px',color:'var(--border-glass-bright)'}} />}
                    </button>
                  </div>

                  {/* Small preview image */}
                  {model.preview_image_path ? (
                    <img
                      src={`media://${model.preview_image_path}`}
                      alt={model.name}
                      className="model-list-thumb"
                    />
                  ) : (
                    <div className="model-list-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)' }}>
                      <Database style={{ width: '18px', height: '18px', color: 'var(--border-glass-bright)' }} />
                    </div>
                  )}

                  {/* Grid fields */}
                  <div className="model-list-info">
                    <div className="model-list-name" title={model.name}>
                      {model.name}
                    </div>

                    {/* Status badge */}
                    <div>
                      {model.status === 'queued' && <span className="badge badge-cyan">In Queue</span>}
                      {model.status === 'printed' && <span className="badge badge-green">Printed</span>}
                      {model.status === 'failed' && <span className="badge badge-red">Failed</span>}
                      {model.status === 'not_printed' && <span className="badge badge-purple">Not Printed</span>}
                    </div>

                    {/* Material */}
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {model.material || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </div>

                    {/* Quick actions row inside List card */}
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        className={`model-card-favorite-btn ${model.is_favorite ? 'active' : ''}`}
                        style={{ position: 'relative', top: 'auto', right: 'auto', background: 'rgba(255,255,255,0.03)' }}
                        onClick={(e) => handleToggleFavorite(model.id, model.is_favorite, e)}
                      >
                        <Star className="model-card-favorite-icon" fill={model.is_favorite ? 'var(--accent-yellow)' : 'none'} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div 
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              padding: '80px 20px', 
              color: 'var(--text-muted)' 
            }}
            id="library-list-empty"
          >
            <Layers style={{ width: '48px', height: '48px', color: 'var(--border-glass-bright)', marginBottom: '16px' }} />
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>No models found</h3>
            <p style={{ fontSize: '13px' }}>Try clearing filters or scanning a new local folder.</p>
          </div>
        )}
      </div>

      {/* 3. Detail Slide-over Drawer Panel */}
      {selectedModel && (
        <div className="details-overlay" onClick={() => setSelectedModelId(null)} id="model-details-overlay">
          <div className="details-panel" onClick={(e) => e.stopPropagation()} id="model-details-panel">
            {/* Header */}
            <div className="details-header">
              <span className="details-header-title" id="details-header-model-name">
                {isEditing ? `Editing "${selectedModel.name}"` : selectedModel.name}
              </span>
              <button
                className="details-close-btn"
                id="btn-details-close"
                onClick={() => setSelectedModelId(null)}
              >
                <X className="details-close-icon" />
              </button>
            </div>

            {/* Body */}
            <div className="details-body scrollable" id="details-body-container">
              {/* Media viewer block */}
              {show3DPreview ? (
                // 3D Three.js canvas viewer
                <ThreeViewer 
                  filePath={previewFilePath || selectedModel.local_path} 
                  fileExt={(previewFilePath || selectedModel.local_path).split('.').pop().toLowerCase()} 
                />
              ) : (
                // Image preview box
                <div className="details-image-box" id="details-preview-box">
                  {selectedModel.preview_image_path ? (
                    <img
                      src={`media://${selectedModel.preview_image_path}`}
                      alt={selectedModel.name}
                      className="details-image"
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)' }}>
                      <Database style={{ width: '48px', height: '48px', color: 'var(--border-glass-bright)' }} />
                    </div>
                  )}
                </div>
              )}

                {/* View/Edit Actions */}
              <div className="details-action-bar" id="details-action-bar">
                {/* 3D view toggle */}
                {!isEditing && (
                  <button
                    className={`btn-secondary ${show3DPreview ? 'active' : ''}`}
                    id="btn-toggle-3d"
                    onClick={() => setShow3DPreview(!show3DPreview)}
                    style={{ gap: '6px' }}
                  >
                    {show3DPreview ? <Eye style={{ width: '16px', height: '16px' }} /> : <Sparkles style={{ width: '16px', height: '16px', color: 'var(--accent-purple)' }} />}
                    <span>{show3DPreview ? 'Show Image' : 'Interactive 3D'}</span>
                  </button>
                )}

                {/* Fetch Thumbnail — shown when model has source URL but no preview image */}
                {!isEditing && !selectedModel.preview_image_path && selectedModel.source_url && (
                  <button
                    className="btn-secondary"
                    id="btn-fetch-thumbnail"
                    onClick={handleFetchThumbnail}
                    disabled={isFetchingThumb}
                    style={{ gap: '6px', borderColor: 'rgba(124,58,237,0.4)', color: 'var(--accent-purple)' }}
                    title="Download thumbnail from the model's source page"
                  >
                    {isFetchingThumb
                      ? <RefreshCw style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
                      : <ImageIcon style={{ width: '16px', height: '16px' }} />
                    }
                    <span>{isFetchingThumb ? 'Fetching...' : 'Fetch Thumbnail'}</span>
                  </button>
                )}

                {/* Edit Mode Toggle */}
                {!isEditing ? (
                  <button
                    className="btn-secondary"
                    id="btn-edit-model"
                    onClick={() => setIsEditing(true)}
                    style={{ gap: '6px' }}
                  >
                    <Edit3 style={{ width: '16px', height: '16px' }} />
                    <span>Edit Info</span>
                  </button>
                ) : (
                  <>
                    <button
                      className="btn-primary"
                      id="btn-save-edit-model"
                      onClick={handleSaveEdits}
                      style={{ gap: '6px', background: 'var(--accent-green)' }}
                    >
                      <Save style={{ width: '16px', height: '16px' }} />
                      <span>Save Changes</span>
                    </button>
                    <button
                      className="btn-secondary"
                      id="btn-cancel-edit-model"
                      onClick={() => setIsEditing(false)}
                    >
                      Cancel
                    </button>
                  </>
                )}

                {/* Queue Toggle Action */}
                {!isEditing && (
                  <button
                    className="btn-accent"
                    id="btn-queue-toggle-action"
                    onClick={() => handleToggleQueue(selectedModel.id, selectedModel.status)}
                    style={{ gap: '6px' }}
                  >
                    <Printer style={{ width: '16px', height: '16px' }} />
                    <span>{selectedModel.status === 'queued' ? 'Remove from Queue' : 'Queue Print'}</span>
                  </button>
                )}

                {/* Delete button */}
                <button
                  className="btn-secondary"
                  id="btn-delete-model"
                  onClick={() => handleDeleteModel(selectedModel.id)}
                  style={{ gap: '6px', marginLeft: 'auto', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--accent-red)' }}
                >
                  <Trash2 style={{ width: '16px', height: '16px' }} />
                  <span>Delete</span>
                </button>
              </div>

              {/* 4. Display Content Form (Read / Edit mode) */}
              {!isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} id="details-content-view">
                  {/* Basic Specifications Info */}
                  <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', padding: '20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>Print Status</span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {selectedModel.status === 'queued' && 'In Queue'}
                        {selectedModel.status === 'printed' && 'Printed'}
                        {selectedModel.status === 'failed' && 'Failed'}
                        {selectedModel.status === 'not_printed' && 'Not Printed'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>Material</span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedModel.material || '—'}</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>Rating</span>
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'center', height: '21px' }}>
                        {selectedModel.rating > 0 ? (
                          [1, 2, 3, 4, 5].map((star) => (
                            <Star 
                              key={star} 
                              fill={star <= selectedModel.rating ? 'var(--accent-yellow)' : 'none'} 
                              color={star <= selectedModel.rating ? 'var(--accent-yellow)' : 'var(--text-muted)'} 
                              style={{ width: '14px', height: '14px', opacity: star <= selectedModel.rating ? 1 : 0.3 }} 
                            />
                          ))
                        ) : (
                          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>—</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>Files</span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {selectedModel.file_count > 1 ? `${selectedModel.file_count} files` : (previewFilePath || selectedModel.local_path).split('.').pop().toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Files Subfolder Drawer */}
                  <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Model Files {selectedModel.file_count > 0 ? `(${selectedModel.file_count})` : ''}
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(selectedModel.files && selectedModel.files.length > 0 ? selectedModel.files : [{ file_path: selectedModel.local_path, file_name: selectedModel.local_path.split('\\').pop().split('/').pop(), file_type: selectedModel.local_path.split('.').pop(), is_primary: 1 }]).map((file, idx) => (
                        <div 
                          key={idx} 
                          className="glass-card" 
                          onClick={() => { setPreviewFilePath(file.file_path); setShow3DPreview(true); }}
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '10px', 
                            padding: '10px 12px',
                            cursor: 'pointer',
                            background: previewFilePath === file.file_path ? 'rgba(124, 58, 237, 0.12)' : 'rgba(255,255,255,0.02)',
                            borderColor: previewFilePath === file.file_path ? 'var(--accent-purple)' : 'var(--border-glass)'
                          }}
                        >
                          <File style={{ width: '16px', height: '16px', color: 'var(--text-muted)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {file.file_name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                              {file.file_type} {file.is_primary ? '• Primary' : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button
                              className="btn-secondary"
                              style={{ padding: '6px', minWidth: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); setPreviewFilePath(file.file_path); setShow3DPreview(true); }}
                              title="Preview in 3D"
                            >
                              <Box style={{ width: '14px', height: '14px' }} />
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ padding: '6px', minWidth: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); handleOpenInSlicer(file.file_path); }}
                              title="Open in Slicer"
                            >
                              <ExternalLink style={{ width: '14px', height: '14px' }} />
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ padding: '6px', minWidth: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); handleOpenFileLocation(file.file_path); }}
                              title="Show in Explorer"
                            >
                              <FolderOpen style={{ width: '14px', height: '14px' }} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Description Box */}
                  <div>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700 }}>Description</h4>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {selectedModel.description || 'No description provided.'}
                    </p>
                  </div>

                  {/* Tags Badges */}
                  <div>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 700 }}>Tags</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {selectedModel.tags && selectedModel.tags.length > 0 ? (
                        selectedModel.tags.map((tag, idx) => (
                          <span key={idx} className="badge badge-purple" style={{ gap: '4px' }}>
                            <Tag style={{ width: '10px', height: '10px' }} />
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No tags configured</span>
                      )}
                    </div>
                  </div>

                  {/* Collections Badges */}
                  <div>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 700 }}>Collections</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {selectedModel.collections && selectedModel.collections.length > 0 ? (
                        selectedModel.collections.map((col, idx) => (
                          <span key={idx} className="badge badge-cyan">
                            {col}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Not part of any collections</span>
                      )}
                    </div>
                  </div>

                  {/* Notes & Print History Logs */}
                  {selectedModel.notes && (
                    <div>
                      <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700 }}>Curator Notes</h4>
                      <div className="glass-card" style={{ padding: '12px', fontSize: '13px', background: 'rgba(255,255,255,0.01)', fontStyle: 'italic' }}>
                        {selectedModel.notes}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Edit Metadata Mode
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="details-content-edit">
                  {/* Name field */}
                  <div className="filter-group">
                    <label className="filter-label">Model Name</label>
                    <input
                      type="text"
                      className="input-field"
                      id="edit-model-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>

                  {/* Description field */}
                  <div className="filter-group">
                    <label className="filter-label">Description</label>
                    <textarea
                      className="input-field"
                      id="edit-model-desc"
                      rows="4"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>

                  {/* Material & Rating row */}
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div className="filter-group" style={{ flex: 1 }}>
                      <label className="filter-label">Material</label>
                      <select
                        className="select-field"
                        id="edit-model-material"
                        value={editMaterial}
                        onChange={(e) => setEditMaterial(e.target.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Select Material</option>
                        <option value="PLA">PLA</option>
                        <option value="PETG">PETG</option>
                        <option value="ABS">ABS</option>
                        <option value="TPU">TPU</option>
                        <option value="Resin">Resin</option>
                      </select>
                    </div>

                    <div className="filter-group" style={{ flex: 1 }}>
                      <label className="filter-label">Rating (1-5 Stars)</label>
                      <div style={{ display: 'flex', gap: '6px', height: '40px', alignItems: 'center' }}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => setEditRating(star)}
                            style={{ color: star <= editRating ? 'var(--accent-yellow)' : 'var(--text-muted)' }}
                          >
                            <Star fill={star <= editRating ? 'var(--accent-yellow)' : 'none'} style={{ width: '20px', height: '20px' }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Tags (comma separated) */}
                  <div className="filter-group">
                    <label className="filter-label">Tags (comma separated)</label>
                    <input
                      type="text"
                      className="input-field"
                      id="edit-model-tags"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="e.g. calibration, test, upgrade"
                    />
                    {tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                        {tags.map(t => {
                          const currentTags = editTags ? editTags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []
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
                                const list = editTags ? editTags.split(',').map(s => s.trim()).filter(Boolean) : []
                                if (isSelected) {
                                  setEditTags(list.filter(n => n.toLowerCase() !== t.name.toLowerCase()).join(', '))
                                } else {
                                  setEditTags([...list, t.name].join(', '))
                                }
                              }}
                            >
                              {t.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Collections Selection */}
                  <div className="filter-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="filter-label" style={{ marginBottom: 0 }}>Assign to Collections</label>
                      <button 
                        type="button"
                        className="btn-text" 
                        onClick={() => setShowCollectionsManager(true)}
                        style={{ fontSize: '12px', padding: '2px 6px', color: 'var(--accent-purple)' }}
                      >
                        + Manage Collections
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                      {collections.length === 0 ? (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          No collections created yet. Use the "+ Manage Collections" button to create some!
                        </span>
                      ) : (
                        collections.map(col => {
                          const currentSelected = editCollections ? editCollections.split(',').map(s => s.trim()).filter(Boolean) : []
                          const isSelected = currentSelected.includes(col.name)
                          return (
                            <button
                              key={col.id}
                              type="button"
                              className={`collection-pill ${isSelected ? 'active' : ''}`}
                              onClick={() => {
                                setEditCollections(prev => {
                                  const list = prev ? prev.split(',').map(s => s.trim()).filter(Boolean) : []
                                  if (isSelected) {
                                    return list.filter(n => n !== col.name).join(', ')
                                  } else {
                                    return [...list, col.name].join(', ')
                                  }
                                })
                              }}
                              style={{ 
                                borderColor: isSelected ? col.color : 'var(--border-glass)',
                                background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                                opacity: isSelected ? 1 : 0.5,
                                padding: '4px 10px',
                                gap: '6px'
                              }}
                            >
                              {isSelected ? <CheckSquare style={{width:'14px',height:'14px',color:col.color}} /> : <Square style={{width:'14px',height:'14px',color:'var(--text-muted)'}} />}
                              {col.name}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {/* Curator Notes */}
                  <div className="filter-group">
                    <label className="filter-label">General Notes</label>
                    <textarea
                      className="input-field"
                      id="edit-model-notes"
                      rows="3"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Special print instructions, speeds, temperatures..."
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedModels.length > 0 && (
        <div className="bulk-action-bar" style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 100
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {selectedModels.length} {selectedModels.length === 1 ? 'model' : 'models'} selected
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setSelectedModels(models.map(m => m.id))}>Select All</button>
            <button className="btn-secondary" onClick={() => setSelectedModels([])}>Clear</button>
            <button 
              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '8px 16px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, cursor: 'pointer' }} 
              onClick={handleBulkDelete}
            >
              <Trash2 style={{ width: '16px', height: '16px' }} />
              Delete Selected
            </button>
          </div>
        </div>
      )}
        </>
      )}

    </div>
  )
}
