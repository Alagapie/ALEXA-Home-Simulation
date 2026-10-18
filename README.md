# Interactive 3D Smart Room Simulator

An interactive 3D smart home simulator built with React, Three.js, React Three Fiber, and React Three Drei. Click devices in the 3D scene or use the control panel to toggle lights, TV, AC, fan, curtains, and doors. Run automation modes (Movie, Sleep, Away, Bright) that mutate the same device state shared by 3D and UI.

## Tech Stack

- [Vite](https://vitejs.dev/) 6.4.4 - build/dev tooling
- [React](https://react.dev/) 18.3.1 + [React DOM](https://react.dev/) 18.3.1
- [Three.js](https://threejs.org/) 0.171.0
- [@react-three/fiber](https://r3f.docs.pmnd.rs/) 8.18.0
- [@react-three/drei](https://github.com/pmndrs/drei) 9.122.0
- [Zustand](https://zustand-demo.pmnd.rs/) 5.0.15 - state management
- [lucide-react](https://lucide.dev/) 0.468.0 - icons

All dependencies are pinned to versions available in `node_modules` (no network install required).

## Getting Started

### Prerequisites

- Node.js >= 18 (tested with v22.19.0)
- npm >= 10 (tested with 10.9.3)

### Install

Dependencies are pre-installed in `node_modules`. No `npm install` needed.

### Development

```bash
npm run dev
```

The dev server runs at http://localhost:5175 (fresh server; port 5173 was an old/stale instance). 

The app uses HMR. For headless/automated verification in dev, the app exposes:
- `window.__roomStore` - Zustand store instance (dev only)
- `window.__deviceService` - Device service instance (dev only)  
- `window.__three = { gl, scene, camera, controls, advance }` - R3F renderer state bridge (dev only)

Note: In dev, `preserveDrawingBuffer` is enabled to allow canvas pixel readback for QA.

### AuraAssist MCP server (initial simulator integration)

The repository includes a self-hosted Streamable HTTP MCP endpoint at `http://localhost:8787/mcp`. Start it in a second terminal:

```bash
npm run mcp
```

The server advertises protocol version `2025-11-25` and currently provides six tools: `get_home_snapshot`, `get_recent_events`, `find_object`, `control_device`, `run_routine`, and `get_daily_briefing`. Run `bedtime` or `leaving_home` with `run_routine`; the tool first returns a confirmation ID, which must be sent back in the follow-up call to execute the routine. Device and routine state are held in the MCP server process and reset when it restarts. This first integration is a standalone simulated home model; it does not yet share live state with the 3D browser store.

The HTTP endpoint accepts JSON-RPC POST requests at `/mcp`. A quick protocol check can be made with any MCP client that supports Streamable HTTP and the URL above. The `/health` endpoint reports whether the server is running. Set `MCP_PORT` to change the port and `MCP_ALLOWED_ORIGIN` to change the browser origin allowed by CORS.

The initial server does not yet include camera/VLM scene descriptions, Bedrock integration, or durable event storage. Those are the next backend milestones.

### Build

```bash
npm run build
```

Build output goes to `dist/`. The build has been verified to pass (1.1MB JS, 13.31KB CSS).

### Preview

```bash
npm run preview
```

Serves the built `dist/` locally.

## Project Structure

```
src/
├── automation/modes.js      # Automation scene definitions (Movie/Sleep/Away/Bright)
├── config/devices.js        # Initial device state and device metadata
├── services/deviceService.js # Device abstraction layer (adapters)
├── store/useRoomStore.js     # Zustand store (single source of truth)
├── styles/global.css        # Global styles
├── three/
│   ├── SmartRoom.jsx        # Main 3D scene composition
│   ├── Lighting.jsx         # Global lighting setup
│   ├── RoomShell.jsx        # Walls/floor/ceiling/room geometry
│   ├── WalkMode.jsx         # First-person walkthrough with PointerLockControls
│   ├── appliances/          # TV, lights, AC, fan, curtains, doors, switches
│   ├── furniture/           # Sofa, tables, decor
│   └── helpers/             # Clickable, textures, geometry helpers
└── ui/                      # HUD, device panel, automation controls, status bar
```

## Architecture

### State Management

All app state lives in a single Zustand store (`useRoomStore`). 
- 3D scene reads device state via hooks (`useDevice`) and Clickable components
- UI components read same state
- Changes go through `commit(id, patch, command, options)` which:
  1. Optimistically updates local state
  2. Sends command via `deviceService.send()`
  3. Rolls back on error
- `activeMode` tracks current automation mode; manual commands set it to "Manual"

### Device Abstraction

`src/services/deviceService.js` provides swappable adapters:
- **SimulatedDeviceAdapter** (default) - local simulation with ~50-140ms latency, no external deps
- **FastApiDeviceAdapter** (stub) - ready for FastAPI backend
- **HomeAssistantAdapter** (stub) - ready for Home Assistant
- **MqttDeviceAdapter** (stub) - ready for MQTT

Select backend via `VITE_DEVICE_BACKEND` env var:
```bash
VITE_DEVICE_BACKEND=fastapi npm run dev
VITE_DEVICE_BACKEND=hass npm run dev  
VITE_DEVICE_BACKEND=mqtt npm run dev
# defaults to simulated
```

Stubs log intent and return success; replace send/subscribe with real implementations.

### Automation

Automation scenes are defined in `src/automation/modes.js` as `MODE_PATCHES`. `applyMode()` applies patches via the same `commit()` path with `keepMode: true`, ensuring 3D and UI stay in sync. Scene execution is serialized (last request wins, manual commands cancel pending scenes).

### Interaction

- **Orbit mode** (default): Click objects to toggle primary action (lights/TV/AC/fan on/off, curtains/doors open/close). Drag to orbit, right-drag to pan, scroll to zoom. Contextual panel shows for selected device.
  - Scrolling is damped and continuous: the wheel eases the camera toward its target instead of snapping, zoom-out runs all the way from a room close-up to the whole-house view, and the room switcher follows the zoom level (a room up close, "Overview" when pulled back).
  - The orbit target is clamped to the house envelope, so panning/zooming can never drift the view off into the void behind the single-sided walls.
  - The wheel and mouse always interrupt an in-flight room fly-in rather than being swallowed.
- **Walkthrough mode**: WASD to move, Shift to run, click to lock pointer, Esc to release. Click objects while locked to control them. 
- **Hover/selection**: Visual feedback via scale highlight and floating labels.

## Features

### Appliances
- **TV** (simulated screen with 4 channels, volume/mute/overlay)
- **Smart Lights** (ceiling/wall/table/floor) - power, brightness, color with real illumination
- **Air Conditioner** - power, mode, target temperature
- **Standing Fan** - power, speed, oscillate with animated blades
- **Curtains** - smooth open/close animation
- **Doors** (entry/interior) - smooth open/close animation  
- **Wall Switches/Smart Panel** - wired to control lights

### UI
- Fullscreen 3D view with orbit controls
- First-person/walkthrough mode
- Smart home control panel with device list and states
- Contextual device panel on selection
- Master controls (All Lights Off, All Off)
- Automation modes (Movie/Sleep/Away/Bright)
- Status bar (active devices, room temp/humidity, backend, time)
- Activity log

## Important Notes

- **Simulated devices only** - This is a simulation for learning/demo purposes. No claims of physical hardware control. The adapter stubs show integration path but require real backend implementation.
- **Dev-only inspection hooks** - `window.__roomStore`, `window.__deviceService`, `window.__three` are exposed only in dev (`import.meta.env.DEV`) for debugging/QA. These can be removed if desired, but are documented here.
- **Canvas rendering** - In dev, `preserveDrawingBuffer: true` is set. Hidden tabs block `requestAnimationFrame`; if running headless checks, trigger resize or call `gl.render(scene,camera)` + `advance(t)`.
- **Procedural assets** - Uses canvas-generated textures only; no external images/CDN assets.

## Scripts

- `npm run dev` - Start dev server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Real Device Integration Path

1. Set `VITE_DEVICE_BACKEND` to `fastapi`, `hass`, or `mqtt` in your environment
2. Implement actual API calls in the corresponding adapter in `src/services/deviceService.js`:
   - `FastApiDeviceAdapter.send(id, command, payload)` - call your FastAPI endpoint
   - `HomeAssistantAdapter.send()` - use HA REST API or WebSocket
   - `MqttDeviceAdapter.send()` - publish to MQTT topics
3. Add authentication, error handling, retries as needed
4. Optionally implement `subscribe()` for real-time state updates from backend

The optimistic update + rollback pattern in `commit()` works well with real backends.
