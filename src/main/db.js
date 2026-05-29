import Database from 'better-sqlite3'
import { app } from 'electron'
import { join, dirname } from 'path'
import fs from 'fs'

let db = null
import os from 'os'
let libraryPath = join(os.homedir(), 'Documents', 'NozzleNest')
let slicerPath = ''

// Load settings from Electron app userData directory
const settingsPath = join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      if (data.libraryPath) libraryPath = data.libraryPath
      if (data.slicerPath) slicerPath = data.slicerPath
    } else {
      saveSettings({ libraryPath, slicerPath })
    }
  } catch (error) {
    console.error('Error loading settings:', error)
  }
}

function saveSettings(settings) {
  try {
    if (settings.libraryPath) libraryPath = settings.libraryPath
    if (settings.slicerPath !== undefined) slicerPath = settings.slicerPath
    fs.writeFileSync(settingsPath, JSON.stringify({ libraryPath, slicerPath }, null, 2))
    
    // Re-initialize DB if path changed
    if (db) {
      db.close()
      db = null
    }
    initDatabase()
  } catch (error) {
    console.error('Error saving settings:', error)
  }
}

function initDatabase() {
  // Ensure library directories exist
  try {
    if (!fs.existsSync(libraryPath)) {
      fs.mkdirSync(libraryPath, { recursive: true })
    }
    const modelsDir = join(libraryPath, 'models')
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }
  } catch (error) {
    console.error('Failed to create library folders:', error)
  }

  // Open database if not already open
  if (!db) {
    const dbPath = join(libraryPath, 'nozzlenest.db')
    try {
      db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
    } catch (err) {
      console.error('CRITICAL DATABASE OPEN ERROR:', err)
      throw err
    }
  }

  // Always run schema creation so new tables/columns are added to existing DBs
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      source_url TEXT,
      source_site TEXT,
      local_path TEXT NOT NULL,
      preview_image_path TEXT,
      status TEXT DEFAULT 'not_printed', -- 'not_printed', 'queued', 'printed', 'failed'
      is_favorite INTEGER DEFAULT 0,     -- 0 or 1
      rating INTEGER DEFAULT 0,          -- 0 to 5
      material TEXT,
      notes TEXT,
      file_hash TEXT,
      date_added TEXT,
      date_printed TEXT,
      print_count INTEGER DEFAULT 0,
      queue_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_tags (
      model_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (model_id, tag_id),
      FOREIGN KEY (model_id) REFERENCES models (id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT DEFAULT '#7c3aed'
    );

    CREATE TABLE IF NOT EXISTS model_collections (
      model_id INTEGER,
      collection_id INTEGER,
      PRIMARY KEY (model_id, collection_id),
      FOREIGN KEY (model_id) REFERENCES models (id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS print_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER,
      status TEXT, -- 'success' or 'failed'
      notes TEXT,
      date TEXT,
      FOREIGN KEY (model_id) REFERENCES models (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_type TEXT, -- 'stl', '3mf', etc.
      is_primary INTEGER DEFAULT 0, -- 1 = primary file for slicer/viewer
      created_at TEXT,
      FOREIGN KEY (model_id) REFERENCES models (id) ON DELETE CASCADE
    );
  `)

  return db
}

// ----------------------------------------------------
// DATABASE API METHODS
// ----------------------------------------------------

export const dbApi = {
  // Settings API
  getSettings: () => {
    loadSettings()
    return { libraryPath, slicerPath }
  },
  
  saveSettings: (settings) => {
    saveSettings(settings)
    return { success: true, libraryPath, slicerPath }
  },

  // Models API
  getModels: (filters = {}) => {
    try {
      initDatabase()
      let query = `
        SELECT m.*, 
               GROUP_CONCAT(DISTINCT t.name) as tags, 
               GROUP_CONCAT(DISTINCT c.name) as collections,
               COUNT(DISTINCT mf.id) as file_count
        FROM models m
        LEFT JOIN model_tags mt ON m.id = mt.model_id
        LEFT JOIN tags t ON mt.tag_id = t.id
        LEFT JOIN model_collections mc ON m.id = mc.model_id
        LEFT JOIN collections c ON mc.collection_id = c.id
        LEFT JOIN model_files mf ON m.id = mf.model_id
      `
      const conditions = []
      const params = []

      if (filters.search) {
        conditions.push(`(m.name LIKE ? OR m.description LIKE ? OR t.name LIKE ? OR c.name LIKE ?)`)
        const searchWildcard = `%${filters.search}%`
        params.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard)
      }

      if (filters.status) {
        conditions.push(`m.status = ?`)
        params.push(filters.status)
      }

      if (filters.is_favorite !== undefined) {
        conditions.push(`m.is_favorite = ?`)
        params.push(filters.is_favorite ? 1 : 0)
      }

      if (filters.material) {
        conditions.push(`m.material = ?`)
        params.push(filters.material)
      }

      if (filters.collection_id) {
        conditions.push(`m.id IN (SELECT model_id FROM model_collections WHERE collection_id = ?)`)
        params.push(filters.collection_id)
      }

      if (filters.tag_id) {
        conditions.push(`m.id IN (SELECT model_id FROM model_tags WHERE tag_id = ?)`)
        params.push(filters.tag_id)
      }

      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ')
      }

      query += ` GROUP BY m.id `

      // Sorting
      if (filters.sortBy === 'queue') {
        query += ` ORDER BY m.queue_order ASC, m.date_added DESC `
      } else if (filters.sortBy === 'name') {
        query += ` ORDER BY m.name ASC `
      } else if (filters.sortBy === 'rating') {
        query += ` ORDER BY m.rating DESC, m.name ASC `
      } else {
        query += ` ORDER BY m.date_added DESC `
      }

      const stmt = db.prepare(query)
      const rows = stmt.all(...params)

      // Format output tags and collections to arrays
      return rows.map(row => ({
        ...row,
        tags: row.tags ? row.tags.split(',') : [],
        collections: row.collections ? row.collections.split(',') : []
      }))
    } catch (err) {
      console.error('getModels error:', err)
      throw err
    }
  },

  getModel: (id) => {
    initDatabase()
    const stmt = db.prepare(`
      SELECT m.*, 
             GROUP_CONCAT(DISTINCT t.name) as tags, 
             GROUP_CONCAT(DISTINCT c.name) as collections
      FROM models m
      LEFT JOIN model_tags mt ON m.id = mt.model_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      LEFT JOIN model_collections mc ON m.id = mc.model_id
      LEFT JOIN collections c ON mc.collection_id = c.id
      WHERE m.id = ?
      GROUP BY m.id
    `)
    const row = stmt.get(id)
    if (!row) return null

    // Fetch associated files
    const filesStmt = db.prepare(`
      SELECT id, file_path, file_name, file_type, is_primary, created_at
      FROM model_files
      WHERE model_id = ?
      ORDER BY is_primary DESC, file_name ASC
    `)
    const files = filesStmt.all(id)

    return {
      ...row,
      tags: row.tags ? row.tags.split(',') : [],
      collections: row.collections ? row.collections.split(',') : [],
      files: files || []
    }
  },

  checkDuplicate: (fileHash) => {
    initDatabase()
    const stmt = db.prepare(`SELECT id, name FROM models WHERE file_hash = ?`)
    return stmt.get(fileHash) || null
  },

  addModel: (model) => {
    initDatabase()
    const insertStmt = db.prepare(`
      INSERT INTO models (
        name, description, source_url, source_site, local_path, 
        preview_image_path, status, is_favorite, rating, material, 
        notes, file_hash, date_added, date_printed, print_count, queue_order
      ) VALUES (
        @name, @description, @source_url, @source_site, @local_path, 
        @preview_image_path, @status, @is_favorite, @rating, @material, 
        @notes, @file_hash, @date_added, @date_printed, @print_count, @queue_order
      )
    `)

    const payload = {
      name: model.name || 'Unnamed Model',
      description: model.description || '',
      source_url: model.source_url || '',
      source_site: model.source_site || '',
      local_path: model.local_path,
      preview_image_path: model.preview_image_path || '',
      status: model.status || 'not_printed',
      is_favorite: model.is_favorite ? 1 : 0,
      rating: model.rating || 0,
      material: model.material || '',
      notes: model.notes || '',
      file_hash: model.file_hash || '',
      date_added: model.date_added || new Date().toISOString(),
      date_printed: model.date_printed || null,
      print_count: model.print_count || 0,
      queue_order: model.queue_order || 0
    }

    const transaction = db.transaction(() => {
      const result = insertStmt.run(payload)
      const modelId = result.lastInsertRowid

      // Handle tags
      if (model.tags && model.tags.length > 0) {
        const tagGet = db.prepare(`SELECT id FROM tags WHERE name = ?`)
        const tagInsert = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`)
        const modelTagInsert = db.prepare(`INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)`)

        for (const tagName of model.tags) {
          const cleanedTag = tagName.trim().toLowerCase()
          if (!cleanedTag) continue
          tagInsert.run(cleanedTag)
          let tag = tagGet.get(cleanedTag)
          if (tag) {
            modelTagInsert.run(modelId, tag.id)
          }
        }
      }

      // Handle collections
      if (model.collections && model.collections.length > 0) {
        const colGet = db.prepare(`SELECT id FROM collections WHERE name = ?`)
        const colInsert = db.prepare(`INSERT OR IGNORE INTO collections (name) VALUES (?)`)
        const modelColInsert = db.prepare(`INSERT OR IGNORE INTO model_collections (model_id, collection_id) VALUES (?, ?)`)

        for (const colName of model.collections) {
          const cleanedCol = colName.trim()
          if (!cleanedCol) continue
          colInsert.run(cleanedCol)
          let col = colGet.get(cleanedCol)
          if (col) {
            modelColInsert.run(modelId, col.id)
          }
        }
      }

      return modelId
    })

    return transaction()
  },

  updateModel: (id, updates) => {
    initDatabase()
    const fields = []
    const values = []

    const allowedUpdates = [
      'name', 'description', 'source_url', 'source_site', 'local_path',
      'preview_image_path', 'status', 'is_favorite', 'rating', 'material',
      'notes', 'file_hash', 'date_printed', 'print_count', 'queue_order'
    ]

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`)
        if (key === 'is_favorite') {
          values.push(updates[key] ? 1 : 0)
        } else {
          values.push(updates[key])
        }
      }
    }

    if (fields.length === 0 && !updates.tags && !updates.collections) return false

    const transaction = db.transaction(() => {
      if (fields.length > 0) {
        values.push(id)
        db.prepare(`UPDATE models SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      }

      // Update tags if provided
      if (updates.tags !== undefined) {
        // Clear existing associations
        db.prepare(`DELETE FROM model_tags WHERE model_id = ?`).run(id)

        if (updates.tags.length > 0) {
          const tagGet = db.prepare(`SELECT id FROM tags WHERE name = ?`)
          const tagInsert = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`)
          const modelTagInsert = db.prepare(`INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)`)

          for (const tagName of updates.tags) {
            const cleanedTag = tagName.trim().toLowerCase()
            if (!cleanedTag) continue
            tagInsert.run(cleanedTag)
            let tag = tagGet.get(cleanedTag)
            if (tag) {
              modelTagInsert.run(id, tag.id)
            }
          }
        }
      }

      // Update collections if provided
      if (updates.collections !== undefined) {
        db.prepare(`DELETE FROM model_collections WHERE model_id = ?`).run(id)

        if (updates.collections.length > 0) {
          const colGet = db.prepare(`SELECT id FROM collections WHERE name = ?`)
          const colInsert = db.prepare(`INSERT OR IGNORE INTO collections (name) VALUES (?)`)
          const modelColInsert = db.prepare(`INSERT OR IGNORE INTO model_collections (model_id, collection_id) VALUES (?, ?)`)

          for (const colName of updates.collections) {
            const cleanedCol = colName.trim()
            if (!cleanedCol) continue
            colInsert.run(cleanedCol)
            let col = colGet.get(cleanedCol)
            if (col) {
              modelColInsert.run(id, col.id)
            }
          }
        }
      }

      return true
    })

    return transaction()
  },

  addModelFiles: (modelId, files) => {
    initDatabase()
    const insertStmt = db.prepare(`
      INSERT INTO model_files (model_id, file_path, file_name, file_type, is_primary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const transaction = db.transaction(() => {
      for (const file of files) {
        const ext = (file.file_type || file.fileName || file.file_path || '').split('.').pop().toLowerCase()
        insertStmt.run(
          modelId,
          file.file_path || file.path || '',
          file.file_name || file.name || file.fileName || '',
          ext,
          file.is_primary ? 1 : 0,
          new Date().toISOString()
        )
      }
    })

    transaction()
    return true
  },

  getModelFiles: (modelId) => {
    initDatabase()
    const stmt = db.prepare(`
      SELECT id, file_path, file_name, file_type, is_primary, created_at
      FROM model_files
      WHERE model_id = ?
      ORDER BY is_primary DESC, file_name ASC
    `)
    return stmt.all(modelId) || []
  },

  deleteModelFiles: (modelId) => {
    initDatabase()
    const stmt = db.prepare(`DELETE FROM model_files WHERE model_id = ?`)
    stmt.run(modelId)
    return true
  },

  deleteModel: (id) => {
    initDatabase()
    // model_files, model_tags, model_collections, print_history are deleted via CASCADE
    const stmt = db.prepare(`DELETE FROM models WHERE id = ?`)
    const result = stmt.run(id)
    return result.changes > 0
  },

  // Print Queue API
  addToQueue: (modelId) => {
    initDatabase()
    // Find max queue_order
    const maxRow = db.prepare(`SELECT MAX(queue_order) as maxOrder FROM models WHERE status = 'queued'`).get()
    const nextOrder = (maxRow.maxOrder || 0) + 1

    const stmt = db.prepare(`UPDATE models SET status = 'queued', queue_order = ? WHERE id = ?`)
    const result = stmt.run(nextOrder, modelId)
    return result.changes > 0
  },

  removeFromQueue: (modelId) => {
    initDatabase()
    const stmt = db.prepare(`UPDATE models SET status = 'not_printed', queue_order = 0 WHERE id = ?`)
    const result = stmt.run(modelId)
    return result.changes > 0
  },

  updateQueueOrder: (orderedIds) => {
    initDatabase()
    const stmt = db.prepare(`UPDATE models SET queue_order = ? WHERE id = ?`)
    const transaction = db.transaction(() => {
      orderedIds.forEach((id, index) => {
        stmt.run(index + 1, id)
      })
      return true
    })
    return transaction()
  },

  // Print History API
  logPrint: (modelId, status, notes = '') => {
    initDatabase()
    const dateStr = new Date().toISOString()
    
    const transaction = db.transaction(() => {
      // Add entry to print history
      db.prepare(`
        INSERT INTO print_history (model_id, status, notes, date)
        VALUES (?, ?, ?, ?)
      `).run(modelId, status, notes, dateStr)

      // Update model status and print stats
      if (status === 'success') {
        db.prepare(`
          UPDATE models 
          SET status = 'printed', 
              print_count = print_count + 1,
              date_printed = ?,
              queue_order = 0
          WHERE id = ?
        `).run(dateStr, modelId)
      } else if (status === 'failed') {
        db.prepare(`
          UPDATE models 
          SET status = 'failed', 
              date_printed = ?,
              queue_order = 0
          WHERE id = ?
        `).run(dateStr, modelId)
      }
      return true
    })

    return transaction()
  },

  getPrintHistory: (modelId) => {
    initDatabase()
    const stmt = db.prepare(`SELECT * FROM print_history WHERE model_id = ? ORDER BY date DESC`)
    return stmt.all(modelId)
  },

  // Tags API
  getTags: () => {
    initDatabase()
    return db.prepare(`
      SELECT t.id, t.name, COUNT(mt.model_id) as count 
      FROM tags t
      LEFT JOIN model_tags mt ON t.id = mt.tag_id
      GROUP BY t.id
      ORDER BY count DESC, t.name ASC
    `).all()
  },

  // Collections API
  getCollections: () => {
    initDatabase()
    return db.prepare(`
      SELECT c.*, COUNT(mc.model_id) as count 
      FROM collections c
      LEFT JOIN model_collections mc ON c.id = mc.collection_id
      GROUP BY c.id
      ORDER BY c.name ASC
    `).all()
  },

  addCollection: (name, description = '', color = '#7c3aed') => {
    initDatabase()
    const stmt = db.prepare(`
      INSERT INTO collections (name, description, color)
      VALUES (?, ?, ?)
    `)
    const result = stmt.run(name, description, color)
    return result.lastInsertRowid
  },

  updateCollection: (id, name, description, color) => {
    initDatabase()
    const stmt = db.prepare(`
      UPDATE collections 
      SET name = ?, description = ?, color = ?
      WHERE id = ?
    `)
    const result = stmt.run(name, description, color, id)
    return result.changes > 0
  },

  deleteCollection: (id) => {
    initDatabase()
    const transaction = db.transaction(() => {
      db.prepare(`DELETE FROM model_collections WHERE collection_id = ?`).run(id)
      const result = db.prepare(`DELETE FROM collections WHERE id = ?`).run(id)
      return result.changes > 0
    })
    return transaction()
  },

  // General Database Stats
  getDashboardStats: () => {
    initDatabase()
    const totalModels = db.prepare(`SELECT COUNT(*) as count FROM models`).get().count
    const activePrints = db.prepare(`SELECT COUNT(*) as count FROM models WHERE status = 'queued'`).get().count
    const printedModels = db.prepare(`SELECT COUNT(*) as count FROM models WHERE status = 'printed'`).get().count
    const failedPrints = db.prepare(`SELECT COUNT(*) as count FROM print_history WHERE status = 'failed'`).get().count
    
    // Calculate storage used
    let storageBytes = 0
    try {
      if (fs.existsSync(libraryPath)) {
        const calculateDirSize = (dir) => {
          let size = 0
          const files = fs.readdirSync(dir)
          for (const file of files) {
            const filePath = join(dir, file)
            const stat = fs.statSync(filePath)
            if (stat.isDirectory()) {
              size += calculateDirSize(filePath)
            } else {
              size += stat.size
            }
          }
          return size
        }
        storageBytes = calculateDirSize(libraryPath)
      }
    } catch (e) {
      console.error('Error calculating storage size:', e)
    }

    // Get recent activity
    const recentActivity = []
    
    // 1. Recently added models
    const addedModels = db.prepare(`
      SELECT 'added' as type, id, name, date_added as date, preview_image_path 
      FROM models 
      ORDER BY date_added DESC LIMIT 5
    `).all()
    
    // 2. Recent print history
    const prints = db.prepare(`
      SELECT 'print' as type, ph.model_id as id, m.name, ph.date, ph.status, m.preview_image_path
      FROM print_history ph
      JOIN models m ON ph.model_id = m.id
      ORDER BY ph.date DESC LIMIT 5
    `).all()

    recentActivity.push(...addedModels.map(m => ({
      type: 'added',
      id: m.id,
      name: m.name,
      date: m.date,
      preview: m.preview_image_path
    })))

    recentActivity.push(...prints.map(p => ({
      type: p.status === 'success' ? 'printed' : 'failed',
      id: p.id,
      name: p.name,
      date: p.date,
      preview: p.preview_image_path
    })))

    // Sort combined by date descending and take top 5
    recentActivity.sort((a, b) => new Date(b.date) - new Date(a.date))
    const topRecent = recentActivity.slice(0, 5)

    return {
      totalModels,
      activePrints,
      printedModels,
      failedPrints,
      storageBytes,
      recentActivity: topRecent
    }
  }
}
