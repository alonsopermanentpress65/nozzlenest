import React, { useState, useEffect } from 'react'
import { 
  GripVertical, 
  ArrowUp, 
  ArrowDown, 
  CheckCircle, 
  XCircle, 
  ExternalLink, 
  Trash2, 
  Printer, 
  Layers 
} from 'lucide-react'

export default function QueueView({ onQueueChange }) {
  const [queueItems, setQueueItems] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeItem, setActiveItem] = useState(null)
  const [printStatus, setPrintStatus] = useState('success') // 'success' or 'failed'
  const [printNotes, setPrintNotes] = useState('')

  // Load queued models on mount
  const loadQueue = async () => {
    try {
      const queued = await window.api.db.getModels({ status: 'queued', sortBy: 'queue' })
      if (queued) {
        setQueueItems(queued)
        if (onQueueChange) onQueueChange(queued.length)
      }
    } catch (err) {
      console.error('Failed to load printing queue:', err)
    }
  }

  useEffect(() => {
    loadQueue()
  }, [])

  // Open slicer for file
  const handleOpenInSlicer = async (filePath) => {
    try {
      const settings = await window.api.db.getSettings()
      const customSlicer = settings ? settings.slicerPath : ''
      await window.api.fs.openInSlicer(filePath, customSlicer)
    } catch (e) {
      console.error('Error opening slicer:', e)
    }
  }

  // Remove model from printing queue
  const handleRemoveFromQueue = async (id) => {
    try {
      await window.api.db.removeFromQueue(id)
      loadQueue()
    } catch (e) {
      console.error('Failed removing from queue:', e)
    }
  }

  // Reordering handlers using Up/Down controls
  const handleMoveItem = async (index, direction) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= queueItems.length) return

    const updated = [...queueItems]
    const [moved] = updated.splice(index, 1)
    updated.splice(nextIndex, 0, moved)

    // Save updated sorting order to SQLite DB
    try {
      await window.api.db.updateQueueOrder(updated.map(item => item.id))
      setQueueItems(updated)
    } catch (err) {
      console.error('Failed updating queue order:', err)
    }
  }

  // Drag and Drop reordering (HTML5)
  const [draggedIndex, setDraggedIndex] = useState(null)

  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // For transparent drag support
    e.dataTransfer.setData('text/plain', index)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const updated = [...queueItems]
    const [moved] = updated.splice(draggedIndex, 1)
    updated.splice(index, 0, moved)
    
    setQueueItems(updated)
    setDraggedIndex(index)
  }

  const handleDragEnd = async () => {
    setDraggedIndex(null)
    try {
      await window.api.db.updateQueueOrder(queueItems.map(item => item.id))
    } catch (err) {
      console.error('Failed saving drag order:', err)
    }
  }

  // Open Log Print Modal Dialog
  const handleOpenPrintDialog = (item, status) => {
    setActiveItem(item)
    setPrintStatus(status)
    setPrintNotes('')
    setDialogOpen(true)
  }

  // Confirm and Submit Print Log to DB
  const handleConfirmPrintLog = async () => {
    if (!activeItem) return

    try {
      await window.api.db.logPrint(
        activeItem.id,
        printStatus === 'success' ? 'success' : 'failed',
        printNotes
      )
      setDialogOpen(false)
      setActiveItem(null)
      loadQueue()
    } catch (err) {
      console.error('Failed logging print:', err)
    }
  }

  return (
    <div className="view-body" id="queue-view-body" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Scrollable Queue Container */}
      <div className="scrollable" style={{ flex: 1 }} id="queue-scrollable-container">
        {queueItems.length > 0 ? (
          <div className="queue-list" id="queue-items-list">
            {queueItems.map((item, idx) => (
              <div
                key={item.id}
                className="queue-item"
                id={`queue-item-${item.id}`}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                style={{ opacity: draggedIndex === idx ? 0.4 : 1 }}
              >
                {/* Drag Handle */}
                <div className="queue-drag-handle" id={`drag-handle-${item.id}`}>
                  <GripVertical className="queue-drag-icon" />
                </div>

                {/* Arrow up/down controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <button
                    disabled={idx === 0}
                    onClick={() => handleMoveItem(idx, -1)}
                    style={{ color: idx === 0 ? 'var(--text-dark)' : 'var(--text-muted)' }}
                    id={`btn-queue-up-${item.id}`}
                    title="Move Up"
                  >
                    <ArrowUp style={{ width: '14px', height: '14px' }} />
                  </button>
                  <button
                    disabled={idx === queueItems.length - 1}
                    onClick={() => handleMoveItem(idx, 1)}
                    style={{ color: idx === queueItems.length - 1 ? 'var(--text-dark)' : 'var(--text-muted)' }}
                    id={`btn-queue-down-${item.id}`}
                    title="Move Down"
                  >
                    <ArrowDown style={{ width: '14px', height: '14px' }} />
                  </button>
                </div>

                {/* Model Small Preview Image */}
                {item.preview_image_path ? (
                  <img
                    src={`media://${item.preview_image_path}`}
                    alt={item.name}
                    style={{ width: '56px', height: '40px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                ) : (
                  <div style={{ width: '56px', height: '40px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Layers style={{ width: '18px', height: '18px', color: 'var(--border-glass-bright)' }} />
                  </div>
                )}

                {/* Model details info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700 }} id={`queue-item-name-${item.id}`}>
                    {item.name}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>{item.material || 'PLA'}</span>
                    <span>•</span>
                    <span style={{ textTransform: 'uppercase' }}>{item.local_path.split('.').pop()}</span>
                  </div>
                </div>

                {/* Action controls */}
                <div className="queue-actions" id={`queue-actions-${item.id}`}>
                  {/* Open Slicer shortcut */}
                  <button
                    className="btn-secondary"
                    id={`btn-queue-slice-${item.id}`}
                    onClick={() => handleOpenInSlicer(item.local_path)}
                    style={{ padding: '6px 12px', gap: '6px', fontSize: '12px' }}
                    title="Open in Slicer"
                  >
                    <ExternalLink style={{ width: '14px', height: '14px' }} />
                    <span>Slice</span>
                  </button>

                  {/* Mark as printed success */}
                  <button
                    className="btn-secondary"
                    id={`btn-queue-success-${item.id}`}
                    onClick={() => handleOpenPrintDialog(item, 'success')}
                    style={{ padding: '6px 12px', gap: '6px', borderColor: 'rgba(16, 185, 129, 0.2)', color: 'var(--accent-green)', fontSize: '12px' }}
                  >
                    <CheckCircle style={{ width: '14px', height: '14px' }} />
                    <span>Printed</span>
                  </button>

                  {/* Mark as failed print */}
                  <button
                    className="btn-secondary"
                    id={`btn-queue-fail-${item.id}`}
                    onClick={() => handleOpenPrintDialog(item, 'failed')}
                    style={{ padding: '6px 12px', gap: '6px', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--accent-red)', fontSize: '12px' }}
                  >
                    <XCircle style={{ width: '14px', height: '14px' }} />
                    <span>Failed</span>
                  </button>

                  {/* Remove from queue */}
                  <button
                    className="btn-secondary"
                    id={`btn-queue-remove-${item.id}`}
                    onClick={() => handleRemoveFromQueue(item.id)}
                    style={{ padding: '6px 6px', minWidth: 'auto', color: 'var(--text-muted)' }}
                    title="Remove from queue"
                  >
                    <Trash2 style={{ width: '14px', height: '14px' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
            id="queue-list-empty"
          >
            <Printer style={{ width: '48px', height: '48px', color: 'var(--border-glass-bright)', marginBottom: '16px' }} />
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Your print queue is empty</h3>
            <p style={{ fontSize: '13px' }}>Queue models from your Model Library to manage your printing backlog.</p>
          </div>
        )}
      </div>

      {/* 5. Mark Printed / Failed dialog overlay */}
      {dialogOpen && activeItem && (
        <div className="dialog-overlay" onClick={() => setDialogOpen(false)} id="print-log-overlay">
          <div className="dialog-box" onClick={(e) => e.stopPropagation()} id="print-log-dialog">
            <h3 className="dialog-title" id="dialog-title-status">
              {printStatus === 'success' ? 'Log Successful Print' : 'Log Failed Print'}
            </h3>
            <p className="dialog-message" id="dialog-msg-item">
              Log details for **"{activeItem.name}"** to store in print history logs.
            </p>

            <label className="filter-label" style={{ fontSize: '11px', marginBottom: '8px', display: 'block' }}>
              Print Notes (Optional)
            </label>
            <textarea
              className="dialog-textarea"
              id="dialog-notes-input"
              value={printNotes}
              onChange={(e) => setPrintNotes(e.target.value)}
              placeholder={printStatus === 'success' ? 'e.g. Perfect bed adhesion, 0.2mm layer, PLA purple.' : 'e.g. Layer shift at 45mm height, bed adhesion failed.'}
            />

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                className="btn-secondary"
                id="btn-dialog-cancel"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                id="btn-dialog-confirm"
                onClick={handleConfirmPrintLog}
                style={{ background: printStatus === 'success' ? 'var(--accent-green)' : 'var(--accent-red)' }}
              >
                Confirm Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
