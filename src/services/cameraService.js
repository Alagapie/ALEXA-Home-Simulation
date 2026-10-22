/**
 * The 3D simulator as the home's camera.
 *
 * AuraAssist's vision tool needs a real frame to analyse. The 3D scene *is* the
 * camera system, so this service grabs the current canvas image and posts it to
 * the server's /vision/describe endpoint. The server then runs the Nova VLM on
 * exactly what the user is looking at, and stores what it sees as sightings -
 * which is what makes "where are my keys?" work later.
 *
 * Frames are posted when the view settles (room change), not every animation
 * frame, so we spend one VLM call per look rather than one per rendered frame.
 */

import { apiUrl } from './auraConnection'

/** Grab the WebGL canvas as a JPEG data URL. Returns null if there is no frame. */
export function captureCanvas(quality = 0.85) {
  const canvas = document.querySelector('canvas')
  if (!canvas) return null
  try {
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return null
  }
}

/**
 * Post one frame for `cameraId`. Returns the vision result, or null on failure
 * (the server being offline must never break the 3D view).
 */
export async function describeView(cameraId, dataUrl, onStatus) {
  const image = dataUrl || captureCanvas()
  if (!image) {
    onStatus?.({ state: 'error', detail: 'No simulator canvas frame is available' })
    return null
  }
  const base64 = image.split(',')[1]
  if (!base64) {
    onStatus?.({ state: 'error', detail: 'Simulator canvas returned an invalid image' })
    return null
  }

  try {
    const res = await fetch(apiUrl('/vision/describe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: cameraId, image_base64: base64, mime: 'image/jpeg' }),
    })
    if (!res.ok) {
      onStatus?.({ state: 'error', detail: `Camera upload failed (HTTP ${res.status})` })
      return null
    }
    const body = await res.json()
    if (body.error) {
      onStatus?.({ state: 'error', detail: `Vision server: ${body.error}` })
      return null
    }
    onStatus?.({ state: 'online', detail: `Camera frame received for ${cameraId}` })
    return body
  } catch (error) {
    onStatus?.({ state: 'error', detail: `Camera upload could not reach ${apiUrl('/vision/describe')}: ${error.message}` })
    return null
  }
}

/**
 * Watch the store's room and post a frame whenever it changes.
 *
 * Returns a stop function. Callers (App) wire it up once; it no-ops safely when
 * the server is unreachable, so the simulator stays fully usable offline.
 */
export function watchCamera({ getRoom, onStatus, intervalMs = 1500, settleMs = 1400, retryMs = 5000, refreshMs = 30000 } = {}) {
  let stopped = false
  let lastRoom = null
  let nextAttemptAt = 0
  let sending = false

  const tick = async () => {
    if (stopped || sending) return
    const room = getRoom?.() || window.__roomStore?.getState?.().currentRoom
    const roomChanged = room && room !== lastRoom
    if (!room || (!roomChanged && Date.now() < nextAttemptAt)) return
    sending = true
    try {
      // Wait for the camera tween to land before grabbing the frame.
      if (roomChanged) await new Promise((r) => window.setTimeout(r, settleMs))
      if (stopped) return
      // Remember the attempted room so a failure obeys retryMs instead of
      // treating every interval tick as a new room change.
      lastRoom = room
      onStatus?.({ state: 'sending', detail: `Sending ${room} camera frame` })
      const result = await describeView(room, undefined, onStatus)
      // A failed first request must not permanently suppress this room. Also
      // refresh occasionally so later voice searches use a recent frame after
      // a server restart or reconnect while the user stays in the same room.
      if (result) {
        nextAttemptAt = Date.now() + refreshMs
      } else {
        nextAttemptAt = Date.now() + retryMs
      }
    } finally {
      sending = false
    }
  }

  const timer = window.setInterval(tick, intervalMs)
  tick()
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}
