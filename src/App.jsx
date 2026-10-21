import { Suspense, useEffect, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { House } from './three/House'
import { ROOMS } from './config/house'
import { Hud } from './ui/Hud'
import { deviceService } from './services/deviceService'
import { connectAuraStream } from './services/auraStream'
import { useRoomStore } from './store/useRoomStore'

/**
 * Application shell: a full-screen React Three Fiber canvas plus the HUD.
 * The store owns all device state; the canvas and the HUD are two views of it.
 */

/**
 * Dev-only bridge (kept outside <Suspense> so it always mounts): exposes the
 * live renderer, scene and camera on `window.__three` so automated checks can
 * force one synchronous render and read the pixels back — handy because the
 * tab may be hidden, which blocks requestAnimationFrame. Never runs in builds.
 */
function DevRendererBridge() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const advance = useThree((s) => s.advance)

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    // Publish on a timer rather than requestAnimationFrame: rAF is paused while
    // the tab is hidden, but automated checks still need the bridge. Re-publish
    // continuously so a re-run of this effect, or a canvas remount through HMR,
    // can never leave window.__three stale or missing. Never delete on cleanup.
    const publish = () => {
      window.__three = { gl, scene, camera, controls, advance, THREE }
    }
    publish()
    const id = setInterval(publish, 200)
    return () => clearInterval(id)
  }, [gl, scene, camera, controls, advance])

  return null
}

const START_CAMERA = ROOMS.living.camera

export default function App() {
  const [ready, setReady] = useState(false)

  // connect the (simulated) device backend and start the climate simulation
  useEffect(() => {
    const store = useRoomStore.getState()
    let cancelled = false
    store.pushLog({ level: 'info', text: `Connecting to ${deviceService.label}…` })

    deviceService
      .connect?.()
      .then(() => {
        if (cancelled) return
        useRoomStore.getState().pushLog({ level: 'ok', text: `${deviceService.label} online` })
        useRoomStore.setState({ backendLabel: deviceService.label })
      })
      .catch((error) => {
        useRoomStore.getState().pushLog({ level: 'error', text: `${deviceService.label}: ${error.message}` })
      })

    // Live bridge: every change made on the server (agent, routine, MCP tool)
    // lands in the same store the 3D scene renders from.
    const disconnect = connectAuraStream({
      onSnapshot: (snapshot) => useRoomStore.getState().applyAuraSnapshot(snapshot),
      onStatus: ({ state }) => {
        useRoomStore.getState().setBridgeStatus(state)
        if (state === 'online') {
          useRoomStore.getState().pushLog({
            level: 'ok',
            text: 'AuraAssist link live · the house follows the server',
          })
        } else if (state === 'reconnecting') {
          useRoomStore.getState().pushLog({
            level: 'error',
            text: 'AuraAssist link lost · retrying (is the server running on :8000?)',
          })
        }
      },
    })

    const interval = setInterval(() => useRoomStore.getState().tick(), 2000)
    const timer = setTimeout(() => setReady(true), 700)
    return () => {
      cancelled = true
      disconnect()
      clearInterval(interval)
      clearTimeout(timer)
    }
  }, [])

  return (
    <div className="app">
      <div className="canvas-wrap">
        <Canvas
          shadows
          dpr={[1, 1.8]}
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            // lets dev tooling read back the canvas for automated checks
            preserveDrawingBuffer: import.meta.env.DEV,
          }}
          camera={{ position: START_CAMERA.position, fov: 46, near: 0.1, far: 140 }}
          onPointerMissed={() => useRoomStore.getState().clearSelection()}
        >
          {import.meta.env.DEV && <DevRendererBridge />}
          <Suspense fallback={null}>
            <House />
          </Suspense>
        </Canvas>
      </div>

      <Hud />

      {!ready && (
        <div className="boot">
          <div className="boot__inner">
            <div className="boot__title">Smart Home</div>
            <div className="boot__sub">Waking up the house…</div>
            <div className="boot__bar"><span /></div>
          </div>
        </div>
      )}
    </div>
  )
}
