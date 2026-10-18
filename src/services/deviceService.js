/**
 * Device-control abstraction layer.
 *
 * Every command sent from the UI or from automation goes through the
 * `deviceService` singleton. The default adapter is fully simulated, so the
 * project runs with no hardware and no credentials.
 *
 * To connect real hardware, swap the adapter (environment variable
 * VITE_DEVICE_BACKEND) for one of the network adapters below. The network
 * adapters are intentionally strict: they throw when the backend is not
 * reachable, which lets the store roll an optimistically applied state back
 * to the last confirmed value.
 *
 *   VITE_DEVICE_BACKEND=simulated   (default)
 *   VITE_DEVICE_BACKEND=fastapi     VITE_API_BASE=http://localhost:8000
 *   VITE_DEVICE_BACKEND=homeassistant
 *   VITE_DEVICE_BACKEND=mqtt
 */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Local, in-browser device simulation. No network, no credentials. */
export class SimulatedDeviceAdapter {
  constructor() {
    this.kind = 'simulated'
    this.label = 'Simulated devices'
    this.connected = false
  }

  async connect() {
    await delay(150)
    this.connected = true
    return true
  }

  /** Resolve an acknowledgement after a short, human-imperceptible delay. */
  async send(deviceId, command, payload = {}) {
    if (!this.connected) await this.connect()
    await delay(50 + Math.random() * 90)
    return { ok: true, deviceId, command, payload, at: Date.now() }
  }
}

/** POST /devices/{id}/commands against a Python FastAPI backend. */
export class FastApiDeviceAdapter {
  constructor(baseUrl = 'http://localhost:8000') {
    this.kind = 'fastapi'
    this.label = `FastAPI (${baseUrl})`
    this.baseUrl = baseUrl
    this.connected = false
  }

  async connect() {
    const res = await fetch(`${this.baseUrl}/health`)
    if (!res.ok) throw new Error(`FastAPI backend unavailable (${res.status})`)
    this.connected = true
    return true
  }

  async send(deviceId, command, payload = {}) {
    const res = await fetch(`${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, payload }),
    })
    if (!res.ok) throw new Error(`Command rejected (${res.status})`)
    return res.json()
  }
}

/** Home Assistant REST example - point at a long-lived access token. */
export class HomeAssistantAdapter {
  constructor(baseUrl = 'http://homeassistant.local:8123', token = '') {
    this.kind = 'homeassistant'
    this.label = 'Home Assistant'
    this.baseUrl = baseUrl
    this.token = token
    this.connected = false
  }

  async connect() {
    if (!this.token) throw new Error('Home Assistant token not configured')
    const res = await fetch(`${this.baseUrl}/api/`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) throw new Error('Home Assistant unreachable')
    this.connected = true
    return true
  }

  async send(deviceId, command, payload = {}) {
    if (!this.token) throw new Error('Home Assistant token not configured')
    const res = await fetch(`${this.baseUrl}/api/services/${payload.domain}/turn_${payload.state}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entity_id: payload.entityId }),
    })
    if (!res.ok) throw new Error(`Home Assistant call failed (${res.status})`)
    return res.json()
  }
}

/** MQTT example - requires an MQTT client bundle (mqtt.js) to be installed. */
export class MqttDeviceAdapter {
  constructor(brokerUrl = 'mqtt://localhost:1883') {
    this.kind = 'mqtt'
    this.label = `MQTT (${brokerUrl})`
    this.brokerUrl = brokerUrl
    this.connected = false
  }

  async connect() {
    throw new Error('MQTT adapter requires the "mqtt" client package - see README.md')
  }

  async send() {
    throw new Error('MQTT adapter not configured - see README.md')
  }
}

export function createDeviceService(kind = 'simulated', options = {}) {
  switch (kind) {
    case 'fastapi':
      return new FastApiDeviceAdapter(options.baseUrl || import.meta.env.VITE_API_BASE)
    case 'homeassistant':
      return new HomeAssistantAdapter(options.baseUrl, options.token)
    case 'mqtt':
      return new MqttDeviceAdapter(options.brokerUrl)
    case 'simulated':
    default:
      return new SimulatedDeviceAdapter()
  }
}

export const deviceService = createDeviceService(import.meta.env.VITE_DEVICE_BACKEND || 'simulated')
