import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader'

let sharedRenderer = null

const getRenderer = (width, height) => {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  }
  sharedRenderer.setSize(width, height)
  sharedRenderer.setPixelRatio(1)
  return sharedRenderer
}

export const generateSTLThumbnail = async (filePath, width = 500, height = 350) => {
  return new Promise((resolve) => {
    try {
      const scene = new THREE.Scene()
      // Use a dark color that matches the app's aesthetic
      scene.background = new THREE.Color('#0b0f19') 

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
      
      const renderer = getRenderer(width, height)
      
      // Lighting
      const ambientLight = new THREE.AmbientLight('#1d1d2b', 1.5)
      scene.add(ambientLight)

      const dirLight1 = new THREE.DirectionalLight('#ffffff', 2.0)
      dirLight1.position.set(100, 100, 100)
      scene.add(dirLight1)

      const dirLight2 = new THREE.DirectionalLight('#7c3aed', 3.0)
      dirLight2.position.set(-100, -50, -100)
      scene.add(dirLight2)

      const fileExt = filePath.split('.').pop().toLowerCase()
      const loader = fileExt === '3mf' ? new ThreeMFLoader() : new STLLoader()
      const mediaUrl = `media://get-file?path=${encodeURIComponent(filePath)}`

      loader.load(
        mediaUrl,
        (loadedData) => {
          const material = new THREE.MeshStandardMaterial({
            color: '#a78bfa',
            roughness: 0.25,
            metalness: 0.8,
            flatShading: true,
            side: THREE.DoubleSide
          })

          let object3D
          
          if (fileExt === '3mf') {
            object3D = loadedData
            // Override materials for all meshes in the 3MF group to match our aesthetic
            object3D.traverse((child) => {
              if (child.isMesh) {
                child.material = material
              }
            })
          } else {
            // loadedData is Geometry for STLLoader
            object3D = new THREE.Mesh(loadedData, material)
            loadedData.computeVertexNormals()
          }

          // Center the object using Box3 (works for both Mesh and Group)
          const boundingBox = new THREE.Box3().setFromObject(object3D)
          const center = new THREE.Vector3()
          boundingBox.getCenter(center)
          object3D.position.sub(center) 
          
          // Recompute bounding box after centering
          const newBoundingBox = new THREE.Box3().setFromObject(object3D)
          const size = new THREE.Vector3()
          newBoundingBox.getSize(size)
          
          scene.add(object3D)

          const maxDim = Math.max(size.x, size.y, size.z)
          const fov = camera.fov * (Math.PI / 180)
          let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))
          cameraZ *= 1.8 
          
          camera.position.set(cameraZ * 0.5, cameraZ * 0.5, cameraZ)
          camera.lookAt(0, 0, 0)

          renderer.render(scene, camera)
          
          const base64 = renderer.domElement.toDataURL('image/jpeg', 0.9)
          
          // Cleanup memory
          renderer.clear()
          if (fileExt === '3mf') {
            object3D.traverse((child) => {
              if (child.isMesh) {
                if (child.geometry) child.geometry.dispose()
                if (child.material) child.material.dispose()
              }
            })
          } else {
            loadedData.dispose()
          }
          material.dispose()
          
          resolve(base64)
        },
        undefined,
        (err) => {
          console.error('[thumbnailGenerator] Loader error:', err)
          renderer.clear()
          resolve(null)
        }
      )
    } catch (error) {
      console.error('[thumbnailGenerator] Setup error:', error)
      resolve(null)
    }
  })
}
