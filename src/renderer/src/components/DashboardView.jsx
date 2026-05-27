import React, { useState, useEffect } from 'react'
import { 
  Database, 
  Printer, 
  Layers, 
  HardDrive, 
  PlusCircle, 
  Search, 
  Settings, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  Clock 
} from 'lucide-react'

export default function DashboardView({ setActiveTab }) {
  const [stats, setStats] = useState({
    totalModels: 0,
    activePrints: 0,
    printedModels: 0,
    failedPrints: 0,
    storageBytes: 0,
    recentActivity: []
  })

  const loadStats = async () => {
    try {
      const dashboardData = await window.api.db.getDashboardStats()
      if (dashboardData) {
        setStats(dashboardData)
      }
    } catch (err) {
      console.error('Failed to load dashboard stats:', err)
    }
  }

  useEffect(() => {
    loadStats()
  }, [])

  // Format storage size
  const formatBytes = (bytes, decimals = 1) => {
    if (!bytes || bytes === 0) return '0.0 MB'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    // Skip Bytes / KB if we want a clean next-gen look, default to MB minimum
    if (i < 2) return (bytes / (1024 * 1024)).toFixed(dm) + ' MB'
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  // Format activity timestamps
  const formatTimeAgo = (dateString) => {
    if (!dateString) return ''
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now - date
      const diffMins = Math.floor(diffMs / (1000 * 60))
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      return `${diffDays}d ago`
    } catch (e) {
      return ''
    }
  }

  return (
    <div className="view-body" id="dashboard-view-body">
      {/* 1. Stats Row */}
      <div className="db-grid" id="dashboard-stats-grid">
        {/* Total Models */}
        <div className="glass-card db-stat-card" id="stat-card-total">
          <div className="stat-header">
            <span>Total Models</span>
            <Database className="stat-icon" style={{ color: 'var(--accent-purple)' }} />
          </div>
          <div className="stat-value" id="val-stat-total">{stats.totalModels}</div>
          <div className="stat-footer">
            Saved <span>locally</span> on your PC
          </div>
        </div>

        {/* Printing Queue */}
        <div className="glass-card db-stat-card" id="stat-card-queue">
          <div className="stat-header">
            <span>Print Queue</span>
            <Printer className="stat-icon" style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <div className="stat-value" id="val-stat-queue">{stats.activePrints}</div>
          <div className="stat-footer">
            Models waiting in queue
          </div>
        </div>

        {/* Printed Success Rate */}
        <div className="glass-card db-stat-card" id="stat-card-success">
          <div className="stat-header">
            <span>Successful Prints</span>
            <Layers className="stat-icon" style={{ color: 'var(--accent-green)' }} />
          </div>
          <div className="stat-value" id="val-stat-printed">{stats.printedModels}</div>
          <div className="stat-footer">
            Total completed prints
          </div>
        </div>

        {/* Storage Used */}
        <div className="glass-card db-stat-card" id="stat-card-storage">
          <div className="stat-header">
            <span>Storage Size</span>
            <HardDrive className="stat-icon" style={{ color: 'var(--accent-yellow)' }} />
          </div>
          <div className="stat-value" style={{ fontSize: '24px', paddingTop: '8px' }} id="val-stat-storage">
            {formatBytes(stats.storageBytes)}
          </div>
          <div className="stat-footer">
            Library size on disk
          </div>
        </div>
      </div>

      {/* 2. Split Activity and Quick Actions Row */}
      <div className="db-split-row" id="dashboard-split-row">
        {/* Left Column: Recent Activity Feed */}
        <div className="glass-card" id="dashboard-recent-activity">
          <h3 className="db-section-title">
            <Clock className="db-section-title-icon" />
            Recent Activity
          </h3>

          <div className="activity-list" id="activity-list-container">
            {stats.recentActivity && stats.recentActivity.length > 0 ? (
              stats.recentActivity.map((activity, idx) => {
                const isAdded = activity.type === 'added'
                const isPrinted = activity.type === 'printed'
                const isFailed = activity.type === 'failed'

                return (
                  <div key={idx} className="activity-item" id={`activity-item-${idx}`}>
                    {/* Thumbnail preview or fallback icon */}
                    {activity.preview ? (
                      <img 
                        src={`media://${activity.preview}`} 
                        alt={activity.name} 
                        className="activity-thumb"
                      />
                    ) : (
                      <div className="activity-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Database style={{ width: '18px', height: '18px', color: 'var(--text-muted)' }} />
                      </div>
                    )}

                    {/* Activity info */}
                    <div className="activity-info">
                      <div className="activity-name" title={activity.name}>
                        {activity.name}
                      </div>
                      <div className="activity-details">
                        {isAdded && (
                          <>
                            <span className="badge badge-purple" style={{ padding: '1px 6px', fontSize: '9px' }}>New Import</span>
                            <span style={{ color: 'var(--text-muted)' }}>added to your nest</span>
                          </>
                        )}
                        {isPrinted && (
                          <>
                            <span className="badge badge-green" style={{ padding: '1px 6px', fontSize: '9px' }}>Success</span>
                            <span style={{ color: 'var(--text-muted)' }}>completed printing successfully</span>
                          </>
                        )}
                        {isFailed && (
                          <>
                            <span className="badge badge-red" style={{ padding: '1px 6px', fontSize: '9px' }}>Failed</span>
                            <span style={{ color: 'var(--text-muted)' }}>logged as failed print</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Timeago */}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatTimeAgo(activity.date)}
                    </div>
                  </div>
                )
              })
            ) : (
              <div 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  padding: '40px 20px', 
                  color: 'var(--text-muted)',
                  fontSize: '13px'
                }}
                id="activity-list-empty"
              >
                <Layers style={{ width: '32px', height: '32px', color: 'var(--border-glass-bright)', marginBottom: '12px' }} />
                <span>No recent activity yet. Add models or log prints to get started!</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Quick Actions */}
        <div className="glass-card" id="dashboard-quick-actions">
          <h3 className="db-section-title">
            <PlusCircle className="db-section-title-icon" style={{ color: 'var(--accent-cyan)' }} />
            Quick Actions
          </h3>

          <div className="quick-actions-box">
            {/* CTA 1: Add New Model */}
            <button 
              className="quick-action-btn" 
              id="action-btn-add"
              onClick={() => setActiveTab('add_model')}
            >
              <Plus className="quick-action-icon" style={{ color: 'var(--accent-purple)' }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Import Local Files</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Scan folder for STL/3MF files</div>
              </div>
            </button>

            {/* CTA 2: Search Models Browser */}
            <button 
              className="quick-action-btn" 
              id="action-btn-browse"
              onClick={() => setActiveTab('browser')}
            >
              <Search className="quick-action-icon" style={{ color: 'var(--accent-cyan)' }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Find Models Online</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Browse model databases in app</div>
              </div>
            </button>

            {/* CTA 3: Application Settings */}
            <button 
              className="quick-action-btn" 
              id="action-btn-settings"
              onClick={() => setActiveTab('settings')}
            >
              <Settings className="quick-action-icon" style={{ color: 'var(--accent-yellow)' }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Configure App Settings</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Set default library path and slicer</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
