import React, { useState, useEffect, useRef } from 'react'
import scraperCode from '../scraper-raw.js?raw'
import { 
  Globe, 
  ChevronLeft, 
  ChevronRight, 
  RotateCw, 
  Search, 
  Download, 
  Tag, 
  X, 
  FolderPlus, 
  Check, 
  AlertCircle 
} from 'lucide-react'

export default function BrowserView({ onDownloadStarted }) {
  const [activeSite, setActiveSite] = useState('printables')
  
  // Independent browser states for each site
  const [siteStates, setSiteStates] = useState({
    printables: { url: 'https://www.printables.com', inputValue: 'https://www.printables.com', isLoading: false, canGoBack: false, canGoForward: false },
    thingiverse: { url: 'https://www.thingiverse.com', inputValue: 'https://www.thingiverse.com', isLoading: false, canGoBack: false, canGoForward: false },
    makerworld: { url: 'https://makerworld.com', inputValue: 'https://makerworld.com', isLoading: false, canGoBack: false, canGoForward: false },
    makeronline: { url: 'https://makeronline.com', inputValue: 'https://makeronline.com', isLoading: false, canGoBack: false, canGoForward: false },
    thangs: { url: 'https://thangs.com', inputValue: 'https://thangs.com', isLoading: false, canGoBack: false, canGoForward: false }
  })

  // Five distinct refs to concurrently mounted webviews
  const webviewRefs = {
    printables: useRef(null),
    thingiverse: useRef(null),
    makerworld: useRef(null),
    makeronline: useRef(null),
    thangs: useRef(null)
  }

  // Ref to active site key to avoid stale state in asynchronous closures
  const activeSiteRef = useRef(activeSite)
  useEffect(() => {
    activeSiteRef.current = activeSite
  }, [activeSite])

  // Cache scraped tags AND image URL per model base URL so when user navigates from Details -> Files,
  // we still have the metadata from the Details page.
  const tagCacheRef = useRef(new Map())
  const imageCacheRef = useRef(new Map())

  // Download Import Dialog State
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [pendingDownload, setPendingDownload] = useState(null)
  
  // Scraped metadata fields (editable by user)
  const [modelName, setModelName] = useState('')
  const [description, setDescription] = useState('')
  const [scrapedTags, setScrapedTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [selectedCollections, setSelectedCollections] = useState([])
  const [previewImageUrl, setPreviewImageUrl] = useState('')
  const [collectionsList, setCollectionsList] = useState([])
  const [tagsLoading, setTagsLoading] = useState(false)

  const sites = {
    printables: { name: 'Printables', url: 'https://www.printables.com' },
    thingiverse: { name: 'Thingiverse', url: 'https://www.thingiverse.com' },
    makerworld: { name: 'MakerWorld', url: 'https://makerworld.com' },
    makeronline: { name: 'MakerOnline', url: 'https://makeronline.com' },
    thangs: { name: 'Thangs', url: 'https://thangs.com' }
  }

  // Load collections from database
  useEffect(() => {
    async function loadCollections() {
      try {
        const list = await window.api.db.getCollections()
        setCollectionsList(list || [])
      } catch (err) {
        console.error('Failed to load collections:', err)
      }
    }
    loadCollections()
  }, [showImportDialog])

  // Detect when Webviews are mounted into the DOM to register their event listeners
  const [mountedKeys, setMountedKeys] = useState([])
  useEffect(() => {
    const keys = Object.keys(webviewRefs)
    const readyKeys = keys.filter(k => webviewRefs[k].current !== null)
    if (readyKeys.length !== mountedKeys.length) {
      setMountedKeys(readyKeys)
    }
  })

  // Register load stop & start listeners to update independent site states
  useEffect(() => {
    if (mountedKeys.length === 0) return

    const cleanups = []

    mountedKeys.forEach((key) => {
      const webview = webviewRefs[key].current
      if (!webview) return

      const handleLoadStart = () => {
        setSiteStates(prev => ({
          ...prev,
          [key]: { ...prev[key], isLoading: true }
        }))
      }

      const handleLoadStop = () => {
        if (!webview) return
        try {
          const currentUrl = webview.getURL()
          setSiteStates(prev => ({
            ...prev,
            [key]: {
              ...prev[key],
              isLoading: false,
              url: currentUrl,
              inputValue: currentUrl,
              canGoBack: webview.canGoBack(),
              canGoForward: webview.canGoForward()
            }
          }))

          // Silently scrape page metadata after load and cache tags + image
          // so they're available when user downloads from /files tab
          setTimeout(async () => {
            try {
              const result = await webview.executeJavaScript(scraperCode)
              const pageUrl = result.currentUrl || currentUrl
              const baseUrl = pageUrl.replace(/\/(files|makes|remixes|collections|comments|related|user-print-files)(\/.*)?$/, '')
              const normalized = baseUrl.replace(/\/+$/, '')

              if (result && result.tags && result.tags.length > 0) {
                // Cache by multiple URL variants for maximum cache hit rate:
                tagCacheRef.current.set(pageUrl, result.tags)
                if (baseUrl !== pageUrl) tagCacheRef.current.set(baseUrl, result.tags)
                tagCacheRef.current.set(normalized, result.tags)
                console.log(`[TagCache] Cached ${result.tags.length} tags for`, pageUrl, '→ base:', baseUrl)
              }

              if (result && result.imageUrl) {
                imageCacheRef.current.set(pageUrl, result.imageUrl)
                if (baseUrl !== pageUrl) imageCacheRef.current.set(baseUrl, result.imageUrl)
                imageCacheRef.current.set(normalized, result.imageUrl)
                console.log(`[ImageCache] Cached image for`, pageUrl)
              }
            } catch (e) {
              // Silent fail — caching is best-effort
            }
          }, 1500)
        } catch (e) {
          console.error(`Error reading URL/navigation states for site ${key}:`, e)
        }
      }

      const handleConsole = (e) => {
        console.log(`[Webview ${key}]`, e.message)
      }

      const handleNewWindow = (e) => {
        // Handle Google OAuth and other login popup windows.
        // Electron blocks webview popups by default; we route them to a
        // dedicated BrowserWindow in the main process that shares the same
        // persistent session so cookies are saved after login.
        const popupUrl = e.url
        if (popupUrl && popupUrl !== 'about:blank') {
          window.api.browser.openPopup(popupUrl)
        }
      }

      webview.addEventListener('did-start-loading', handleLoadStart)
      webview.addEventListener('did-stop-loading', handleLoadStop)
      webview.addEventListener('console-message', handleConsole)
      webview.addEventListener('new-window', handleNewWindow)

      cleanups.push(() => {
        if (webview) {
          webview.removeEventListener('did-start-loading', handleLoadStart)
          webview.removeEventListener('did-stop-loading', handleLoadStop)
          webview.removeEventListener('console-message', handleConsole)
          webview.removeEventListener('new-window', handleNewWindow)
        }
      })
    })

    return () => {
      cleanups.forEach(cleanup => cleanup())
    }
  }, [mountedKeys])

  // Register Electron download listener inside the view
  useEffect(() => {
    const unsub = window.api.downloads.onDetected(async (data) => {
      console.log('Download detected in renderer:', data)
      
      let scraped = { title: '', description: '', imageUrl: '', tags: [], currentUrl: '' }
      
      // Run the scraper inside the active webview to pull active metadata
      const currentActive = activeSiteRef.current
      const activeWebview = webviewRefs[currentActive]?.current
      if (activeWebview) {
        try {
          scraped = await activeWebview.executeJavaScript(scraperCode)
          console.log('Scraper result — title:', scraped.title, 'tags:', scraped.tags, 'url:', scraped.currentUrl)
        } catch (scrapeErr) {
          console.warn('Scraping page metadata failed:', scrapeErr)
        }
      }

      let finalTags = scraped.tags || []
      let finalImageUrl = scraped.imageUrl || ''
      const currentUrl = scraped.currentUrl || data.referer || ''

      // Strip all known tab sub-paths to get the base model URL
      const TAB_PATTERN = /\/(files|makes|remixes|collections|comments|related|user-print-files)(\/.*)?$/
      const isOnSubTab = TAB_PATTERN.test(currentUrl)
      const baseUrl = currentUrl.replace(TAB_PATTERN, '').replace(/\/+$/, '')

      // ── PRINTABLES GRAPHQL API (most reliable — bypasses SPA rendering) ──────
      // Printables is a Svelte SPA: tags are rendered by JS long after page load.
      // We skip DOM scraping entirely and query their GraphQL API from the main
      // process (no CORS, no CSP, no hydration timing). Works on any tab.
      // Always call for Printables model pages — so we get tags AND the image reliably.
      const isPrintables = currentUrl.includes('printables.com/model/')
      if (isPrintables) {
        try {
          const apiResult = await window.api.browser.printablesGetTags(currentUrl)
          if (apiResult.success) {
            console.log(`[Printables API] Got ${apiResult.tags.length} tags, image: ${apiResult.imageUrl ? 'yes' : 'none'}`)
            // Prefer API tags over scraped ones (more reliable)
            if (apiResult.tags.length > 0) {
              finalTags = apiResult.tags
              tagCacheRef.current.set(baseUrl, finalTags)
              tagCacheRef.current.set(baseUrl + '/', finalTags)
            }
            // Backfill name/description/image if the scraper missed them
            if (!scraped.title && apiResult.name) scraped.title = apiResult.name
            if (!scraped.description && apiResult.summary) scraped.description = apiResult.summary
            // Always prefer API image (authoritative first image from model page)
            if (apiResult.imageUrl) {
              finalImageUrl = apiResult.imageUrl
              imageCacheRef.current.set(baseUrl, finalImageUrl)
              imageCacheRef.current.set(baseUrl + '/', finalImageUrl)
            }
          } else {
            console.warn('[Printables API] API call unsuccessful:', apiResult.error)
          }
        } catch (apiErr) {
          console.warn('[Printables API] Call failed:', apiErr)
        }
      }

      // ── CACHE LOOKUP (for non-Printables sites or if API missed) ─────────────
      if (isOnSubTab) {
        if (finalTags.length === 0) {
          const tagCacheHit =
            tagCacheRef.current.get(currentUrl) ||
            tagCacheRef.current.get(baseUrl) ||
            tagCacheRef.current.get(baseUrl + '/')
          if (tagCacheHit && tagCacheHit.length > 0) {
            console.log(`[TagCache] Cache hit: ${tagCacheHit.length} tags for ${baseUrl}`)
            finalTags = tagCacheHit
          } else {
            console.log(`[TagCache] No cached tags — will async-scrape details page: ${baseUrl}`)
          }
        }
        if (!finalImageUrl) {
          const imgCacheHit =
            imageCacheRef.current.get(currentUrl) ||
            imageCacheRef.current.get(baseUrl) ||
            imageCacheRef.current.get(baseUrl + '/')
          if (imgCacheHit) {
            console.log(`[ImageCache] Cache hit for ${baseUrl}`)
            finalImageUrl = imgCacheHit
          }
        }
      }

      // Populate dialog states immediately with what we have
      setPendingDownload(data)
      setModelName(scraped.title || data.fileName.replace(/\.[^/.]+$/, ""))
      setDescription(scraped.description || '')
      setScrapedTags(finalTags)
      let imgUrl = finalImageUrl || ''
      if (imgUrl.startsWith('//')) {
        imgUrl = 'https:' + imgUrl
      }
      setPreviewImageUrl(imgUrl)
      setSelectedCollections([])
      setShowImportDialog(true)

      // ── ASYNC BACKFILL (non-Printables sites only) ────────────────────────────
      // For non-Printables SPA sites where tags are still empty, silently
      // load the details page in the webview, wait longer for JS to render,
      // scrape tags, update the dialog, then navigate back.
      if (finalTags.length === 0 && isOnSubTab && !isPrintables && activeWebview && baseUrl) {
        setTagsLoading(true)
        const filesUrl = currentUrl
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('load timeout')), 15000)
            const onStop = async () => {
              clearTimeout(timeout)
              activeWebview.removeEventListener('did-stop-loading', onStop)
              try {
                // Longer grace period for SPA hydration
                await new Promise((r) => setTimeout(r, 2500))
                const backfillResult = await activeWebview.executeJavaScript(scraperCode)
                const backfillTags = backfillResult?.tags || []
                const backfillImage = backfillResult?.imageUrl || ''
                console.log(`[TagBackfill] Got ${backfillTags.length} tags, image: ${backfillImage ? 'yes' : 'no'} from details page`)
                if (backfillTags.length > 0) {
                  tagCacheRef.current.set(baseUrl, backfillTags)
                  tagCacheRef.current.set(baseUrl + '/', backfillTags)
                  setScrapedTags(backfillTags)
                }
                if (backfillImage) {
                  let fixed = backfillImage
                  if (fixed.startsWith('//')) fixed = 'https:' + fixed
                  imageCacheRef.current.set(baseUrl, fixed)
                  imageCacheRef.current.set(baseUrl + '/', fixed)
                  setPreviewImageUrl(fixed)
                }
              } catch (scrapeErr) {
                console.warn('[TagBackfill] Scrape after navigation failed:', scrapeErr)
              }
              resolve()
            }
            activeWebview.addEventListener('did-stop-loading', onStop)
            activeWebview.loadURL(baseUrl)
          })
        } catch (backfillErr) {
          console.warn('[TagBackfill] Navigation/scrape failed:', backfillErr.message)
        } finally {
          try {
            await new Promise((resolve) => {
              const onReturn = () => {
                activeWebview.removeEventListener('did-stop-loading', onReturn)
                resolve()
              }
              activeWebview.addEventListener('did-stop-loading', onReturn)
              activeWebview.loadURL(filesUrl)
            })
          } catch (navBackErr) {
            // Best-effort; ignore
          }
          setTagsLoading(false)
        }
      } else {
        // Printables used the API — no async nav needed, clear loading state
        setTagsLoading(false)
      }
    })

    return () => unsub()
  }, [])

  // Handle mouse back/forward navigation inside the browser view
  useEffect(() => {
    const unsubBack = window.api.app.onMouseBack(() => {
      const activeWebview = webviewRefs[activeSiteRef.current]?.current
      if (activeWebview && activeWebview.canGoBack()) {
        activeWebview.goBack()
      }
    })

    const unsubForward = window.api.app.onMouseForward(() => {
      const activeWebview = webviewRefs[activeSiteRef.current]?.current
      if (activeWebview && activeWebview.canGoForward()) {
        activeWebview.goForward()
      }
    })

    return () => {
      unsubBack()
      unsubForward()
    }
  }, [])

  // Shorthand active states helper
  const activeState = siteStates[activeSite] || {
    url: sites[activeSite].url,
    inputValue: sites[activeSite].url,
    isLoading: false,
    canGoBack: false,
    canGoForward: false
  }

  const handleSiteChange = (siteKey) => {
    setActiveSite(siteKey)
  }

  const handleInputChange = (e) => {
    const val = e.target.value
    setSiteStates(prev => ({
      ...prev,
      [activeSite]: {
        ...prev[activeSite],
        inputValue: val
      }
    }))
  }

  const handleNavigate = (e) => {
    if (e.key === 'Enter') {
      let target = activeState.inputValue.trim()
      if (!/^https?:\/\//i.test(target)) {
        if (target.includes('.') && !target.includes(' ')) {
          target = 'https://' + target
        } else {
          target = 'https://www.google.com/search?q=' + encodeURIComponent(target)
        }
      }
      
      const activeWebview = webviewRefs[activeSite].current
      if (activeWebview) {
        activeWebview.loadURL(target)
      }
    }
  }

  const goBack = () => {
    const activeWebview = webviewRefs[activeSite].current
    if (activeWebview && activeWebview.canGoBack()) {
      activeWebview.goBack()
    }
  }

  const goForward = () => {
    const activeWebview = webviewRefs[activeSite].current
    if (activeWebview && activeWebview.canGoForward()) {
      activeWebview.goForward()
    }
  }

  const reload = () => {
    const activeWebview = webviewRefs[activeSite].current
    if (activeWebview) {
      activeWebview.reload()
    }
  }

  // Tags management
  const handleAddTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      const newTag = tagInput.trim().toLowerCase()
      if (!scrapedTags.includes(newTag)) {
        setScrapedTags([...scrapedTags, newTag])
      }
      setTagInput('')
    }
  }

  const handleRemoveTag = (indexToRemove) => {
    setScrapedTags(scrapedTags.filter((_, index) => index !== indexToRemove))
  }

  // Collections selection toggle
  const toggleCollection = (colName) => {
    if (selectedCollections.includes(colName)) {
      setSelectedCollections(selectedCollections.filter(c => c !== colName))
    } else {
      setSelectedCollections([...selectedCollections, colName])
    }
  }

  // Confirm download and import into database
  const handleConfirmImport = async () => {
    if (!pendingDownload) return

    const siteConfig = Object.values(sites).find(s => pendingDownload.referer?.includes(s.url.replace('https://www.', '').replace('https://', '')))
    const siteName = siteConfig ? siteConfig.name : 'Web Browser'

    const metadata = {
      name: modelName || pendingDownload.fileName.replace(/\\.[^/.]+$/, ""),
      description: description,
      source_url: pendingDownload.referer || '',
      source_site: siteName,
      status: 'not_printed',
      tags: scrapedTags,
      collections: selectedCollections,
      preview_image_url: previewImageUrl || null
    }

    console.log('[Import] Confirming download. preview_image_url:', previewImageUrl || '(empty)', '| source_url:', metadata.source_url)

    try {
      const res = await window.api.downloads.confirmDownload(pendingDownload.id, true, metadata)
      if (res.success) {
        // Trigger the active download tracking in parent App shell
        if (onDownloadStarted) {
          onDownloadStarted({
            id: pendingDownload.id,
            fileName: pendingDownload.fileName,
            modelName: metadata.name,
            status: res.status
          })
        }
      }
    } catch (err) {
      console.error('Failed to confirm download:', err)
    } finally {
      setShowImportDialog(false)
      setPendingDownload(null)
    }
  }

  // Cancel download
  const handleCancelImport = async () => {
    if (!pendingDownload) return
    try {
      await window.api.downloads.confirmDownload(pendingDownload.id, false)
    } catch (err) {
      console.error('Failed to cancel download:', err)
    } finally {
      setShowImportDialog(false)
      setPendingDownload(null)
    }
  }

  return (
    <div className="browser-layout" id="browser-layout-container">
      {/* Site Tabs Header */}
      <div className="browser-tabs" id="browser-tabs-header">
        {Object.keys(sites).map((key) => (
          <button
            key={key}
            className={`browser-tab-select ${activeSite === key ? 'active' : ''}`}
            id={`browser-site-tab-${key}`}
            onClick={() => handleSiteChange(key)}
          >
            {sites[key].name}
          </button>
        ))}
      </div>

      {/* Browser Controls / Address bar */}
      <div className="view-header" style={{ padding: '0 20px', gap: '12px' }} id="browser-controls-header">
        <div style={{ display: 'flex', gap: '6px' }}>
          <button 
            className="btn-secondary" 
            style={{ padding: '8px', minWidth: 'auto' }} 
            onClick={goBack} 
            disabled={!activeState.canGoBack}
            title="Go Back"
          >
            <ChevronLeft style={{ width: '16px', height: '16px' }} />
          </button>
          <button 
            className="btn-secondary" 
            style={{ padding: '8px', minWidth: 'auto' }} 
            onClick={goForward} 
            disabled={!activeState.canGoForward}
            title="Go Forward"
          >
            <ChevronRight style={{ width: '16px', height: '16px' }} />
          </button>
          <button 
            className="btn-secondary" 
            style={{ padding: '8px', minWidth: 'auto' }} 
            onClick={reload}
            title="Reload Page"
          >
            <RotateCw className={activeState.isLoading ? 'spin' : ''} style={{ width: '16px', height: '16px' }} />
          </button>
        </div>

        {/* Address Input Field */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Globe style={{ position: 'absolute', left: '12px', width: '14px', height: '14px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="input-field"
            style={{ paddingLeft: '36px', width: '100%', height: '36px', fontSize: '13px' }}
            id="browser-address-input"
            value={activeState.inputValue}
            onChange={handleInputChange}
            onKeyDown={handleNavigate}
            placeholder="Search on Google or enter web address..."
          />
          {activeState.isLoading && (
            <div style={{ position: 'absolute', right: '12px', display: 'flex', alignItems: 'center' }}>
              <span className="badge badge-purple" style={{ fontSize: '9px', padding: '2px 6px' }}>Loading...</span>
            </div>
          )}
        </div>
      </div>

      {/* Webview Container */}
      <div className="browser-frame-container" id="browser-webview-container">
        {Object.keys(sites).map((key) => (
          <webview
            key={key}
            ref={webviewRefs[key]}
            src={sites[key].url}
            id={`browser-webview-instance-${key}`}
            partition="persist:nozzlenest-browser"
            allowpopups="true"
            webpreferences="contextIsolation=yes"
            style={{
              display: activeSite === key ? 'flex' : 'none',
              position: activeSite === key ? 'relative' : 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%'
            }}
          />
        ))}
      </div>

      {/* BREATHTAKING IMPORT POPUP MODAL DIALOG */}
      {showImportDialog && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} id="import-dialog-overlay">
          <div className="modal-content glass-card" style={{ width: '600px', maxWidth: '90%', padding: '28px', border: '1px solid var(--accent-purple)', boxShadow: 'var(--glow-purple)' }} id="import-dialog-card">
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Download style={{ color: 'var(--accent-purple)' }} />
                Import Model to NozzleNest
              </h2>
              <button className="btn-secondary" style={{ padding: '6px', minWidth: 'auto' }} onClick={handleCancelImport}>
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: previewImageUrl ? '160px 1fr' : '1fr', gap: '20px', marginBottom: '20px' }}>
              {/* Image Preview Panel */}
              {previewImageUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Model Preview</span>
                  <div style={{ width: '160px', height: '160px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', background: 'var(--bg-tertiary)', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <img 
                      src={previewImageUrl} 
                      alt="Scraped Preview" 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={() => setPreviewImageUrl('')} // Hide if load fails
                    />
                  </div>
                </div>
              )}

              {/* Text Fields Panel */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label htmlFor="import-model-name" style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Model Name</label>
                  <input
                    type="text"
                    id="import-model-name"
                    className="input-field"
                    style={{ width: '100%' }}
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="Enter model name..."
                  />
                </div>

                <div>
                  <label htmlFor="import-model-description" style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Description</label>
                  <textarea
                    id="import-model-description"
                    className="input-field"
                    style={{ width: '100%', height: '70px', resize: 'none', fontSize: '12px' }}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Enter short description..."
                  />
                </div>
              </div>
            </div>

            {/* Tags and Collections Selectors */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
              {/* Tags Section */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Tags (Press Enter to Add)
                  {tagsLoading && (
                    <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--accent-purple)', fontWeight: 500, textTransform: 'none', opacity: 0.85 }}>
                      ⟳ Fetching tags from model page...
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', background: 'rgba(0,0,0,0.15)', border: `1px solid ${tagsLoading ? 'var(--accent-purple)' : 'var(--border-glass)'}`, borderRadius: 'var(--radius-md)', minHeight: '44px', transition: 'border-color 0.3s ease' }}>
                  {scrapedTags.map((tag, idx) => (
                    <span key={idx} className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Tag style={{ width: '10px', height: '10px' }} />
                      {tag}
                      <X style={{ width: '10px', height: '10px', cursor: 'pointer' }} onClick={() => handleRemoveTag(idx)} />
                    </span>
                  ))}
                  {tagsLoading && scrapedTags.length === 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'center', fontStyle: 'italic' }}>
                      Scanning model page for tags...
                    </span>
                  )}
                  <input
                    type="text"
                    className="input-field"
                    style={{ border: 'none', background: 'none', padding: '0 4px', height: '22px', fontSize: '12px', flex: 1, minWidth: '80px' }}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder="+ add tag..."
                  />
                </div>
              </div>

              {/* Collections Selection Section */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Add to Collections</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {collectionsList.length === 0 ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No collections created yet. You can create them in the Model Library.</span>
                  ) : (
                    collectionsList.map((col) => {
                      const isSelected = selectedCollections.includes(col.name)
                      return (
                        <button
                          key={col.id}
                          className={`btn-secondary ${isSelected ? 'active' : ''}`}
                          style={{ 
                            padding: '6px 12px', 
                            fontSize: '12px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            borderColor: isSelected ? col.color : 'var(--border-glass)',
                            background: isSelected ? `${col.color}20` : 'rgba(255,255,255,0.02)'
                          }}
                          onClick={() => toggleCollection(col.name)}
                        >
                          <FolderPlus style={{ width: '12px', height: '12px', color: col.color }} />
                          {col.name}
                          {isSelected && <Check style={{ width: '12px', height: '12px', color: 'var(--accent-green)' }} />}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Dialog Action Buttons */}
            <div className="dialog-actions">
              <button className="btn-secondary" onClick={handleCancelImport}>
                Cancel Download
              </button>
              <button className="btn-primary" onClick={handleConfirmImport} style={{ background: 'var(--accent-purple)', color: '#fff' }}>
                <Download style={{ width: '16px', height: '16px' }} />
                Import & Download
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

