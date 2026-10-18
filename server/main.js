import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createInitialDevices } from '../src/config/devices.js'
import { MODE_PATCHES } from '../src/automation/modes.js'

const PORT = Number(process.env.MCP_PORT || 8787)
const MCP_PATH = '/mcp'
const devices = createInitialDevices()
const events = [
  { at: new Date(Date.now() - 45 * 60_000).toISOString(), type: 'object_seen', item: 'keys', room: 'entry', detail: 'Keys seen near the entry table' },
  { at: new Date(Date.now() - 20 * 60_000).toISOString(), type: 'device_changed', item: 'kitchenLight', room: 'kitchen', detail: 'Kitchen light turned on' },
]
const pending = new Map()

const textResult = (value, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
})

const tools = [
  { name: 'get_home_snapshot', description: 'Get current simulated home devices and their states.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_recent_events', description: 'List recent simulated home events.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'find_object', description: 'Find the most recent stored sighting of an object.', inputSchema: { type: 'object', required: ['object'], properties: { object: { type: 'string' } } } },
  { name: 'control_device', description: 'Control a simulated device. Lock, unlock, open, close, and cooker actions require confirmation.', inputSchema: { type: 'object', required: ['deviceId', 'action'], properties: { deviceId: { type: 'string' }, action: { type: 'string' }, value: {} , confirmationId: { type: 'string' } } } },
  { name: 'run_routine', description: 'Prepare the simulated home for bedtime or leaving home. Requires confirmation before changes.', inputSchema: { type: 'object', required: ['routine'], properties: { routine: { type: 'string', enum: ['bedtime', 'leaving_home'] }, confirmationId: { type: 'string' } } } },
  { name: 'get_daily_briefing', description: 'Summarize home changes recorded today.', inputSchema: { type: 'object', properties: {} } },
]

function event(detail, item = 'home') {
  events.unshift({ at: new Date().toISOString(), type: 'device_changed', item, room: devices[item]?.room || 'home', detail })
}

function requireConfirmation(args, description) {
  if (args.confirmationId && pending.has(args.confirmationId)) {
    pending.delete(args.confirmationId)
    return null
  }
  const confirmationId = randomUUID()
  pending.set(confirmationId, true)
  return textResult({ requiresConfirmation: true, confirmationId, message: `Please confirm: ${description}` })
}

function callTool(name, args = {}) {
  if (name === 'get_home_snapshot') return textResult(Object.values(devices))
  if (name === 'get_recent_events') return textResult(events.slice(0, Math.max(1, Math.min(50, args.limit || 10))))
  if (name === 'find_object') {
    const match = events.find((item) => item.type === 'object_seen' && item.item.toLowerCase().includes(String(args.object || '').toLowerCase()))
    return textResult(match || `I have no recent sighting of ${args.object || 'that item'}.`)
  }
  if (name === 'get_daily_briefing') {
    const today = new Date().toISOString().slice(0, 10)
    const todays = events.filter((item) => item.at.slice(0, 10) === today)
    return textResult({ date: today, eventCount: todays.length, summary: todays.length ? todays.map((item) => item.detail) : ['No home activity has been recorded today.'] })
  }
  if (name === 'control_device') {
    const device = devices[args.deviceId]
    if (!device) return textResult(`Unknown device: ${args.deviceId}`, true)
    const action = String(args.action || '')
    const sensitive = /^(lock|unlock|open|close|setHeat|setOven)$/i.test(action) || device.type === 'cooker'
    if (sensitive) {
      const confirmation = requireConfirmation(args, `${action} ${device.name}`)
      if (confirmation) return confirmation
    }
    const fields = { turnOn: ['power', true], turnOff: ['power', false], lock: ['locked', true], unlock: ['locked', false], open: ['open', true], close: ['open', false], setTemperature: ['targetTemp', Number(args.value)], setBrightness: ['brightness', Number(args.value)] }
    const change = fields[action]
    if (!change) return textResult(`Unsupported action: ${action}`, true)
    device[change[0]] = change[1]
    event(`${device.name}: ${change[0]} set to ${change[1]}`, device.id)
    return textResult({ ok: true, device })
  }
  if (name === 'run_routine') {
    const key = args.routine === 'leaving_home' ? 'away' : args.routine
    const patches = MODE_PATCHES[key]
    if (!patches) return textResult('Unknown routine.', true)
    const confirmation = requireConfirmation(args, `run the ${args.routine} routine`)
    if (confirmation) return confirmation
    for (const [id, patch] of Object.entries(patches)) if (devices[id]) Object.assign(devices[id], patch)
    event(`Completed ${args.routine} routine`)
    return textResult({ ok: true, routine: args.routine, message: 'Routine completed.', devices: Object.values(devices) })
  }
  return textResult(`Unknown tool: ${name}`, true)
}

function rpc(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const { id, method, params = {} } = message
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null
  if (method === 'initialize') return { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'auraassist-home', version: '0.1.0' } }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools }
  if (method === 'tools/call') return callTool(params.name, params.arguments || {})
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.MCP_ALLOWED_ORIGIN || 'http://localhost:5173')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version, last-event-id')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, endpoint: MCP_PATH })); return }
  if (req.url !== MCP_PATH) { res.writeHead(404).end('Not found'); return }
  if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST, OPTIONS' }).end('Use POST for Streamable HTTP requests.'); return }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST, DELETE, OPTIONS' }).end(); return }
  let raw = ''
  for await (const chunk of req) raw += chunk
  let request
  try { request = JSON.parse(raw) } catch { res.writeHead(400).end('Invalid JSON'); return }
  const batch = Array.isArray(request)
  const messages = batch ? request : [request]
  const replies = []
  for (const message of messages) {
    try {
      const result = rpc(message)
      if (message.id !== undefined && result !== null) replies.push({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      replies.push({ jsonrpc: '2.0', id: message.id ?? null, error: { code: error.code || -32603, message: error.message } })
    }
  }
  if (!replies.length) { res.writeHead(202).end(); return }
  const body = batch ? replies : replies[0]
  res.writeHead(200, { 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' }).end(JSON.stringify(body))
})

server.listen(PORT, '0.0.0.0', () => console.log(`AuraAssist MCP server listening at http://localhost:${PORT}${MCP_PATH}`))
