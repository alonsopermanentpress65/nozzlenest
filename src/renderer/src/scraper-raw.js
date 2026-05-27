(async () => {
  try {
    // ─── TITLE ───────────────────────────────────────────────────────────────
    const ogTitle = document.querySelector('meta[property="og:title"]')
    let title = (ogTitle?.getAttribute('content') || '').trim()
    if (!title) title = (document.querySelector('h1')?.textContent || document.title || '').trim()

    // ─── DESCRIPTION ─────────────────────────────────────────────────────────
    const ogDesc =
      document.querySelector('meta[property="og:description"]') ||
      document.querySelector('meta[name="description"]')
    const description = (ogDesc?.getAttribute('content') || '').trim()

    // ─── IMAGE ───────────────────────────────────────────────────────────────
    let imageUrl = ''

    // Helper: pick highest-res URL from srcset-like string
    const bestFromSrcset = (ss) => {
      if (!ss) return ''
      const candidates = ss.split(',').map(s => {
        const [url, w] = s.trim().split(/\s+/)
        const width = parseInt((w || '').replace(/\D/g, ''), 10) || 0
        return { url: (url || '').trim(), width }
      }).filter(c => c.url && c.url.startsWith('http'))
      candidates.sort((a, b) => b.width - a.width)
      return candidates[0]?.url || ''
    }

    // Helper: resolve a true image URL from an <img> element
    const resolveImgSrc = (img) => {
      if (!img) return ''
      const candidates = [
        img.getAttribute('data-full'),
        img.getAttribute('data-image'),
        img.getAttribute('data-original'),
        bestFromSrcset(img.getAttribute('srcset')),
        bestFromSrcset(img.getAttribute('data-srcset')),
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-lazy-srcset') ? bestFromSrcset(img.getAttribute('data-lazy-srcset')) : '',
        img.src
      ]
      for (const c of candidates) {
        if (c && typeof c === 'string' && c.startsWith('http')) return c
      }
      return ''
    }

    // Priority 1: JSON-LD structured data image
    try {
      document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
        try {
          const data = JSON.parse(script.textContent)
          const nodes = Array.isArray(data) ? data : [data]
          nodes.forEach((node) => {
            const items = node['@graph'] ? [node, ...node['@graph']] : [node]
            items.forEach((item) => {
              const type = (item['@type'] || '').toString().toLowerCase()
              if (/3dmodel|product|imageobject|creativework/.test(type)) {
                const img = item.image || item.thumbnailUrl || item.thumbnail || ''
                if (typeof img === 'string' && img.startsWith('http') && !imageUrl) imageUrl = img
                if (Array.isArray(img) && img.length && typeof img[0] === 'string' && !imageUrl) imageUrl = img[0]
              }
            })
          })
        } catch (e) {}
      })
    } catch (e) {}

    // Priority 2: Open Graph / Twitter meta tags
    if (!imageUrl) {
      imageUrl =
        (document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content') || '').trim() ||
        (document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '').trim() ||
        (document.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content') || '').trim() ||
        (document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || '').trim() ||
        (document.querySelector('meta[property="twitter:image"]')?.getAttribute('content') || '').trim()
    }

    // Priority 3: Site-specific gallery / model selectors
    if (!imageUrl) {
      const selectors = [
        // Printables
        '[data-testid="detail-preview"] img',
        '[data-testid="model-detail"] img',
        '.detail-preview img',
        // Thingiverse
        'img[src*="cdn.thingiverse.com/renders"]',
        'img[src*="cdn.thingiverse.com/assets"]',
        'img[alt*="featured image" i]',
        'img[alt*="thing image" i]',
        '.thing-page-image img',
        '.ThingImage__image--3z9gv',
        // MakerWorld — cover/hero images
        '.cover img',
        '[class*="cover"] img',
        '[class*="model-image"] img',
        '[class*="modelImage"] img',
        '[class*="hero"] img',
        '[class*="gallery"] img',
        '[class*="preview"] img',
        // Thangs
        '[class*="model-image"] img',
        '[class*="thumbnail"] img',
        'img[src*="thangs.com"]',
        'img[src*="cdn.thangs.com"]',
        // MakerOnline / Cults / generic
        '.model-slider img',
        '.product-image img',
        '.gallery-image img',
        '.swiper-slide img',
        '.swiper-slide-active img',
        'figure img',
        'article img',
        // Generic OG-image fallback rendered in DOM
        'img[src*="/images/"]',
        'img[src*="preview"]',
        'img[src*="thumbnail"]'
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        const src = resolveImgSrc(el)
        if (src) { imageUrl = src; break }
      }
    }

    // Priority 4: Smart DOM image scan — rank by size, filter noise
    // Note: naturalWidth/naturalHeight may be 0 on lazy-loaded images,
    // so we fall back to layout rect dimensions to still rank them.
    if (!imageUrl) {
      const BAD_KEYWORDS = /avatar|profile|logo|spinner|loading|placeholder|icon|banner|advert|ads|footer|header|nav/i
      const imgs = Array.from(document.querySelectorAll('main img, article img, [role="main"] img, body img'))
      const scored = imgs
        .map((img) => {
          const rect = img.getBoundingClientRect()
          const w = img.naturalWidth || rect.width || 0
          const h = img.naturalHeight || rect.height || 0
          const src = resolveImgSrc(img)
          if (!src) return null
          if (src.includes('.svg')) return null
          if (BAD_KEYWORDS.test(img.alt || '') || BAD_KEYWORDS.test(img.className || '') || BAD_KEYWORDS.test(src)) return null
          const area = w * h
          // Accept lazy-loaded images if their layout box is big enough (≥100x100)
          const layoutArea = rect.width * rect.height
          if (area < 150 * 150 && layoutArea < 100 * 100) return null
          return { src, area: Math.max(area, layoutArea), w, h }
        })
        .filter(Boolean)
      scored.sort((a, b) => b.area - a.area)
      if (scored.length) imageUrl = scored[0].src
    }

    // Priority 5: absolute last resort — first <img> with http src
    if (!imageUrl) {
      const firstImg = document.querySelector('img[src^="http"]')
      if (firstImg) imageUrl = resolveImgSrc(firstImg) || ''
    }

    // ─── TAG EXTRACTION ──────────────────────────────────────────────────────
    const UI_WORD_BLACKLIST = new Set([
      'home','search','login','register','upload','explore','popular','newest',
      'featured','trending','all','more','back','next','share','like','follow',
      'download','files','makes','remixes','collections','comments','details',
      'profile','settings','notifications','dashboard','library','queue'
    ])

    const cleanTag = (raw) => {
      const t = (raw || '').trim().toLowerCase().replace(/^[#\s]+/, '').replace(/[,;]+$/, '').trim()
      if (!t || t.length < 2 || t.length > 30) return null
      if (t.indexOf('\n') !== -1) return null
      if (UI_WORD_BLACKLIST.has(t)) return null
      return t
    }

    const mergeUnique = (...arrays) => {
      const seen = new Set()
      const result = []
      for (const arr of arrays) {
        for (const item of (arr || [])) {
          const t = cleanTag(item)
          if (t && !seen.has(t)) {
            seen.add(t)
            result.push(t)
          }
        }
      }
      return result
    }

    // Priority 1: JSON-LD structured data (works on ALL tabs — lives in <head>)
    let jsonLdTags = []
    try {
      document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
        try {
          const data = JSON.parse(script.textContent)
          const nodes = Array.isArray(data) ? data : [data]
          nodes.forEach((node) => {
            // Some sites wrap in @graph
            const items = node['@graph'] ? [node, ...node['@graph']] : [node]
            items.forEach((item) => {
              const kwRaw = item.keywords || item.tags || item.genre || ''
              if (typeof kwRaw === 'string' && kwRaw.trim()) {
                kwRaw.split(/[,;|]+/).forEach((k) => {
                  const t = cleanTag(k)
                  if (t) jsonLdTags.push(t)
                })
              } else if (Array.isArray(kwRaw)) {
                kwRaw.forEach((k) => {
                  const t = cleanTag(typeof k === 'string' ? k : (k.name || ''))
                  if (t) jsonLdTags.push(t)
                })
              }
            })
          })
        } catch (e) {}
      })
    } catch (e) {}

    // Priority 2: <meta name="keywords">
    let metaKeywordTags = []
    try {
      const metaKw = document.querySelector('meta[name="keywords"]')
      if (metaKw) {
        metaKw.getAttribute('content').split(/[,;]+/).forEach((k) => {
          const t = cleanTag(k)
          if (t) metaKeywordTags.push(t)
        })
      }
    } catch (e) {}

    // Priority 3: Anchor links to /tag/ pages (great for Details tab)
    let domLinkTags = []
    try {
      document.querySelectorAll('a[href*="/tag/"]').forEach((el) => {
        const t = cleanTag(el.innerText || el.textContent || '')
        if (t) domLinkTags.push(t)
      })
    } catch (e) {}

    // Priority 4: Site-specific selectors
    let siteSpecificTags = []
    try {
      // Printables specific tag chips
      document.querySelectorAll('[data-testid*="tag"], .tag-chip, .model-tag, .tag-list a, .tags-section a').forEach((el) => {
        const t = cleanTag(el.innerText || el.textContent || '')
        if (t) siteSpecificTags.push(t)
      })
    } catch (e) {}

    // Priority 5: Generic class-based fallback
    let classTags = []
    try {
      if (jsonLdTags.length === 0 && domLinkTags.length === 0) {
        document.querySelectorAll('[class*="tag" i]').forEach((el) => {
          // Skip container elements (only pick leaf-level tag nodes)
          if (el.querySelector('[class*="tag" i]')) return
          const t = cleanTag(el.innerText || el.textContent || '')
          if (t) classTags.push(t)
        })
      }
    } catch (e) {}

    // Merge all sources, deduplicated, in priority order
    const tags = mergeUnique(jsonLdTags, metaKeywordTags, domLinkTags, siteSpecificTags, classTags)

    const currentUrl = window.location.href

    return { title, description, imageUrl, tags, currentUrl }
  } catch (err) {
    return { title: '', description: '', imageUrl: '', tags: [], currentUrl: window.location.href, _error: err.message }
  }
})()
