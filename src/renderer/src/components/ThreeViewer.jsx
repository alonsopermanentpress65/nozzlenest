import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { Loader2, AlertCircle } from 'lucide-react'

export default function ThreeViewer({ filePath, fileExt }) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!filePath) return
    const ext = (fileExt || '').toLowerCase()
    if (ext !== 'stl' && ext !== '3mf') {
      setLoading(false)
      setError('3D Interactive preview is currently supported for STL and 3MF files. Other formats can be opened in your slicer.')
      return
    }

    setLoading(true)
    setError(null)

    let scene, camera, renderer, controls, animationFrameId
    let object3D, material

    try {
      // 1. Create Scene
      scene = new THREE.Scene()
      scene.background = new THREE.Color('#0b0f19') // Match theme dark bg

      // 2. Setup Camera
      const width = containerRef.current.clientWidth || 550
      const height = containerRef.current.clientHeight || 250
      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
      camera.position.set(0, 0, 100)

      // 3. Setup WebGL Renderer
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      
      // Clear previous canvas
      containerRef.current.innerHTML = ''
      containerRef.current.appendChild(renderer.domElement)

      // 4. Setup Controls
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.05
      controls.maxPolarAngle = Math.PI / 2 + 0.1 // don't go too far below ground

      // 5. Setup Premium Lighting
      const ambientLight = new THREE.AmbientLight('#1d1d2b', 1.5)
      scene.add(ambientLight)

      // Main directional light (white)
      const dirLight1 = new THREE.DirectionalLight('#ffffff', 2.0)
      dirLight1.position.set(100, 100, 100)
      scene.add(dirLight1)

      // Accent directional light (purple glow)
      const dirLight2 = new THREE.DirectionalLight('#7c3aed', 3.0)
      dirLight2.position.set(-100, -50, -100)
      scene.add(dirLight2)

      // 6. Load Model
      const loader = ext === '3mf' ? new ThreeMFLoader() : new STLLoader()
      const mediaUrl = `media://get-file?path=${encodeURIComponent(filePath)}`

      // Give React a tick to paint the loading spinner before the heavy, synchronous Three.js parser blocks the main thread
      setTimeout(async () => {
        // Prevent massive slicer-generated 3MF files from freezing the web renderer
        if (ext === '3mf') {
          try {
            const headRes = await fetch(mediaUrl, { method: 'HEAD' })
            const size = headRes.headers.get('content-length')
            if (size && parseInt(size, 10) > 30 * 1024 * 1024) { // 30 MB limit
              const mb = (parseInt(size, 10) / (1024 * 1024)).toFixed(1)
              setError(`This 3MF file is too massive (${mb} MB) for the web preview. It likely contains embedded g-code or heavy Bambu Studio metadata. Please open it directly in your slicer.`)
              setLoading(false)
              return
            }
          } catch (e) {
            console.warn('[ThreeViewer] Failed to check file size:', e)
          }
        }

        loader.load(
          mediaUrl,
          (loadedData) => {
            material = new THREE.MeshStandardMaterial({
              color: '#a78bfa',
              roughness: 0.25,
              metalness: 0.8,
              flatShading: true,
              side: THREE.DoubleSide
            })

            if (ext === '3mf') {
              object3D = loadedData
              object3D.traverse((child) => {
                if (child.isMesh) child.material = material
              })
            } else {
              object3D = new THREE.Mesh(loadedData, material)
              loadedData.computeVertexNormals()
            }
            
            object3D.castShadow = true
            object3D.receiveShadow = true

            // Center geometry & fit camera view
            const boundingBox = new THREE.Box3().setFromObject(object3D)
            const center = new THREE.Vector3()
            boundingBox.getCenter(center)
            object3D.position.sub(center) 
            
            scene.add(object3D)

            // Auto-adjust camera target to fit object bounding box size
            const newBoundingBox = new THREE.Box3().setFromObject(object3D)
            const size = new THREE.Vector3()
            newBoundingBox.getSize(size)
            
            const maxDim = Math.max(size.x, size.y, size.z)
            const fov = camera.fov * (Math.PI / 180)
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))
            cameraZ *= 1.8 
            
            camera.position.set(cameraZ * 0.5, cameraZ * 0.5, cameraZ)
            camera.lookAt(0, 0, 0)
            controls.target.set(0, 0, 0)
            controls.update()

            setLoading(false)
          },
          (xhr) => {
            // Progress callback could be added here
          },
          (err) => {
            console.error('[ThreeViewer] Loader error:', err)
            setError('Failed to load the 3D model. The file might be corrupted or too complex.')
            setLoading(false)
          }
        )
      }, 50)

      // 7. Animation Loop
      const animate = () => {
        animationFrameId = requestAnimationFrame(animate)

        // Slow spin if user isn't interacting
        if (object3D && controls && controls.getAzimuthalAngle) {
          object3D.rotation.y += 0.003
        }

        if (controls) controls.update()
        if (renderer && scene && camera) renderer.render(scene, camera)
      }
      animate()

      // Handle Resize
      const handleResize = () => {
        if (!containerRef.current || !renderer || !camera) return
        const w = containerRef.current.clientWidth
        const h = containerRef.current.clientHeight
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
      window.addEventListener('resize', handleResize)

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize)
        cancelAnimationFrame(animationFrameId)
        
        if (controls) controls.dispose()
        if (object3D) {
          object3D.traverse((child) => {
            if (child.isMesh) {
              if (child.geometry) child.geometry.dispose()
              if (child.material) child.material.dispose()
            }
          })
        }
        if (material) material.dispose()
        if (renderer) {
          renderer.dispose()
          renderer.forceContextLoss()
        }
        if (containerRef.current) containerRef.current.innerHTML = ''
      }

    } catch (e) {
      console.error('Three.js setup error:', e)
      setError('Failed to initialize 3D canvas context.')
      setLoading(false)
    }
  }, [filePath, fileExt])

  return (
    <div className="details-canvas-container" style={{ minHeight: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f19', position: 'relative' }} id="three-viewer-container">
      {/* Loading Overlay */}
      {loading && (
        <div className="canvas-loading-overlay" id="three-viewer-loading">
          <Loader2 className="animate-spin" style={{ color: 'var(--accent-purple)', marginRight: '8px' }} />
          <span>Processing 3D mesh...</span>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }} id="three-viewer-error">
          <AlertCircle style={{ color: 'var(--accent-yellow)', width: '28px', height: '28px' }} />
          <span>{error}</span>
        </div>
      )}

      {/* Canvas Mount */}
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} 
        id="three-canvas-viewport"
      />
    </div>
  )
}
