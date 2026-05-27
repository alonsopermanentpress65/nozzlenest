import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, Edit3, Save } from 'lucide-react'

// Premium tailored HSL color palette
const PRESET_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Yellow
  '#84cc16', // Lime
  '#22c55e', // Green
  '#10b981', // Emerald
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#0ea5e9', // Light Blue
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
  '#f43f5e', // Rose
]

export default function CollectionsManager({ onClose, onCollectionsChanged }) {
  const [collections, setCollections] = useState([])
  const [editingId, setEditingId] = useState(null)
  
  // Form State
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[11]) // Default to Indigo/Purple

  const loadCollections = async () => {
    try {
      const cols = await window.api.db.getCollections()
      setCollections(cols)
    } catch (e) {
      console.error('Failed to load collections', e)
    }
  }

  useEffect(() => {
    loadCollections()
  }, [])

  const handleSave = async () => {
    if (!name.trim()) return

    try {
      if (editingId) {
        await window.api.db.updateCollection(editingId, name.trim(), description.trim(), color)
      } else {
        await window.api.db.addCollection(name.trim(), description.trim(), color)
      }
      
      // Reset form
      setName('')
      setDescription('')
      setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)])
      setEditingId(null)
      
      await loadCollections()
      if (onCollectionsChanged) onCollectionsChanged()
    } catch (e) {
      console.error('Error saving collection', e)
      alert('Failed to save collection. Ensure the name is unique.')
    }
  }

  const handleEdit = (col) => {
    setEditingId(col.id)
    setName(col.name)
    setDescription(col.description || '')
    setColor(col.color || PRESET_COLORS[11])
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setName('')
    setDescription('')
    setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)])
  }

  const handleDelete = async (id, colName) => {
    if (!window.confirm(`Are you sure you want to delete the collection "${colName}"?\n\nThis will remove the collection tag from all models, but your models will not be deleted.`)) {
      return
    }
    
    try {
      await window.api.db.deleteCollection(id)
      if (editingId === id) handleCancelEdit()
      await loadCollections()
      if (onCollectionsChanged) onCollectionsChanged()
    } catch (e) {
      console.error('Error deleting collection', e)
      alert('Failed to delete collection.')
    }
  }

  return (
    <div className="collections-manager-view" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', animation: 'fadeIn 0.2s ease', padding: '12px 32px 32px 32px', overflow: 'hidden' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>Manage Collections</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>Create, edit, and organize your model collections.</p>
        </div>
        <button className="btn-secondary" onClick={onClose} style={{ gap: '8px' }}>
          <X size={18} />
          <span>Back to Library</span>
        </button>
      </div>

      <div className="collections-manager-body" style={{ display: 'flex', flex: 1, gap: '24px', overflow: 'hidden' }}>
        {/* Left Column: Form */}
        <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>
              {editingId ? 'Edit Collection' : 'Create New Collection'}
            </h3>
            
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Collection Name</label>
              <input 
                type="text" 
                className="input-field" 
                placeholder="e.g. Warhammer 40k, Tools, Art"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Description (Optional)</label>
              <input 
                type="text" 
                className="input-field" 
                placeholder="Brief description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label>Collection Color</label>
              <div className="color-picker-grid">
                {PRESET_COLORS.map(c => (
                  <button 
                    key={c}
                    className={`color-picker-swatch ${color === c ? 'active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                    type="button"
                  />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="btn-primary" 
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={handleSave}
                disabled={!name.trim()}
              >
                {editingId ? <Save size={16} /> : <Plus size={16} />}
                <span>{editingId ? 'Save Changes' : 'Create Collection'}</span>
              </button>
              
              {editingId && (
                <button 
                  className="btn-secondary" 
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

        {/* Right Column: List */}
        <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>Existing Collections</h3>
            
            <div className="collections-list-scroll">
              {collections.length === 0 ? (
                <div className="empty-state-text" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  No collections created yet.
                </div>
              ) : (
                collections.map(col => (
                  <div key={col.id} className="collection-list-item">
                    <div className="collection-item-info">
                      <div className="collection-pill-dot" style={{ backgroundColor: col.color || '#7c3aed', boxShadow: `0 0 8px ${col.color || '#7c3aed'}` }} />
                      <div className="collection-item-details">
                        <span className="collection-item-name">{col.name}</span>
                        <span className="collection-item-count">{col.count || 0} {col.count === 1 ? 'Model' : 'Models'}</span>
                      </div>
                    </div>
                    <div className="collection-item-actions">
                      <button className="btn-icon small" onClick={() => handleEdit(col)} title="Edit">
                        <Edit3 size={14} />
                      </button>
                      <button className="btn-icon small danger" onClick={() => handleDelete(col.id, col.name)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
        </div>
      </div>
    </div>
  )
}
