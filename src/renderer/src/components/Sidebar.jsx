import React from 'react'
import logo from '../assets/logo.png'
import { 
  LayoutDashboard, 
  Library, 
  Printer, 
  Globe, 
  Settings, 
  Plus 
} from 'lucide-react'

export default function Sidebar({ activeTab, setActiveTab, activePrints }) {
  const navItems = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'library', name: 'Model Library', icon: Library },
    { id: 'queue', name: 'Printing Queue', icon: Printer, badge: activePrints > 0 ? activePrints : null },
    { id: 'browser', name: 'Find Models', icon: Globe },
  ]

  return (
    <aside className="app-sidebar" id="sidebar-container">
      {/* Sidebar Brand Header */}
      <div className="sidebar-brand">
        <img 
          src={logo} 
          alt="NozzleNest Logo" 
          className="brand-logo" 
          id="sidebar-brand-logo"
        />
        <span className="brand-name" id="sidebar-brand-name">
          NozzleNest
        </span>
      </div>

      {/* Navigation Items */}
      <nav className="sidebar-nav" id="sidebar-navigation">
        {/* Always visible Add New Model CTA button */}
        <button 
          className="nav-item nav-add-btn" 
          id="btn-sidebar-add-model"
          onClick={() => setActiveTab('add_model')}
        >
          <Plus className="nav-item-icon" />
          <span>Add New Model</span>
        </button>

        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id

          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              id={`nav-item-${item.id}`}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon className="nav-item-icon" />
              <span>{item.name}</span>
              {item.badge !== null && item.badge !== undefined && (
                <span className="badge badge-purple" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '10px' }}>
                  {item.badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Settings Footer */}
      <div className="sidebar-footer" id="sidebar-footer-settings">
        <button
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          id="nav-item-settings"
          onClick={() => setActiveTab('settings')}
          style={{ width: '100%' }}
        >
          <Settings className="nav-item-icon" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
