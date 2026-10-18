import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { Clickable } from '../helpers/Clickable'
import { useDevice, useRoomStore } from '../../store/useRoomStore'

/**
 * Small everyday objects that live on the tables and worktops.
 *
 * They are not "smart" in any way — they simply reuse the same Clickable +
 * store plumbing as the appliances, so they can be picked up, woken or pressed
 * exactly like a real prop and their state stays in the device list. Keeping
 * them as data (config/devices.js, type 'prop') means the list, the panel and
 * the AI facade all see them without any special casing.
 */

const METAL = { color: '#8f959c', roughness: 0.3, metalness: 0.85 }

/* ---------------------------------------------------------------- phone ----- */

export function Phone({ id = 'phone', position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const device = useDevice(id)
  if (!device) return null
  const lit = device.screen
  return (
    <Clickable id={id} position={position} rotation={rotation} labelOffset={[0, 0.14, 0]}>
      {/* body */}
      <RoundedBox args={[0.078, 0.01, 0.156]} radius={0.008} smoothness={3} castShadow>
        <meshStandardMaterial color="#14171b" roughness={0.32} metalness={0.42} />
      </RoundedBox>
      {/* screen (faces up) */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.068, 0.142]} />
        <meshStandardMaterial
          color="#0b0f16"
          emissive={lit ? '#8fd6ff' : '#0b0f16'}
          emissiveIntensity={lit ? 1.35 : 0.06}
          roughness={0.25}
          toneMapped={false}
        />
      </mesh>
      {/* charging indicator */}
      <mesh position={[0.028, 0.011, -0.062]}>
        <circleGeometry args={[0.004, 10]} />
        <meshStandardMaterial
          color="#101418"
          emissive={device.charging ? '#6ee7a8' : '#101418'}
          emissiveIntensity={device.charging ? 1.6 : 0}
          toneMapped={false}
        />
      </mesh>
    </Clickable>
  )
}

/* --------------------------------------------------------------- remote ----- */

export function Remote({ id = 'tvRemote', position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const device = useDevice(id)
  const target = useRoomStore((s) => (device?.targets ? s.devices[device.targets] : null))
  if (!device) return null
  const on = !!target?.power
  return (
    <Clickable id={id} position={position} rotation={rotation} labelOffset={[0, 0.12, 0]}>
      <RoundedBox args={[0.052, 0.014, 0.172]} radius={0.006} smoothness={3} castShadow>
        <meshStandardMaterial color="#26292d" roughness={0.4} metalness={0.3} />
      </RoundedBox>
      {/* buttons */}
      {[[-0.011, -0.03], [0.011, -0.03], [-0.011, 0.0], [0.011, 0.0], [0, 0.032]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.009, z]}>
          <boxGeometry args={[0.013, 0.004, 0.013]} />
          <meshStandardMaterial color="#3c4046" roughness={0.5} />
        </mesh>
      ))}
      {/* status LED mirrors the paired appliance */}
      <mesh position={[0, 0.009, 0.06]}>
        <circleGeometry args={[0.0038, 10]} />
        <meshStandardMaterial
          color="#101418"
          emissive={on ? '#ff8f52' : '#101418'}
          emissiveIntensity={on ? 1.8 : 0}
          toneMapped={false}
        />
      </mesh>
    </Clickable>
  )
}

/* ---------------------------------------------------------- pepper mill ----- */

export function PepperMill({ id = 'pepperMill', position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const device = useDevice(id)
  const knobRef = useRef()
  useFrame((state, delta) => {
    if (!knobRef.current) return
    const spinning = device?.grind
    knobRef.current.rotation.y += (spinning ? 9 : 0) * delta
    void state
  })
  if (!device) return null
  const full = device.level ?? 1
  return (
    <Clickable id={id} position={position} rotation={rotation} labelOffset={[0, 0.22, 0]}>
      {/* body */}
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.036, 0.044, 0.18, 20]} />
        <meshStandardMaterial color="#4a3527" roughness={0.55} metalness={0.05} />
      </mesh>
      {/* transparent hopper showing how full it is */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.05, 18]} />
        <meshStandardMaterial color="#2b2620" roughness={0.35} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.021, 0.021, 0.05 * Math.max(0.15, full), 14]} />
        <meshStandardMaterial color="#1c1712" roughness={0.9} />
      </mesh>
      {/* turning knob */}
      <group ref={knobRef} position={[0, 0.245, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.03, 12]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
      </group>
    </Clickable>
  )
}

/* -------------------------------------------------------- utensil crock ----- */

export function UtensilCrock({ id = 'utensilCrock', position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const device = useDevice(id)
  const groupRef = useRef()
  useFrame((_, delta) => {
    if (!groupRef.current) return
    const lift = device?.inUse ? 0.05 : 0
    groupRef.current.position.y += (lift - groupRef.current.position.y) * Math.min(1, delta * 6)
  })
  if (!device) return null
  const tools = [
    { x: -0.02, z: 0.01, tilt: 0.12, color: '#c9ccd1' },
    { x: 0.022, z: -0.01, tilt: -0.16, color: '#8a6446' },
    { x: 0.0, z: -0.026, tilt: 0.05, color: '#b8bcc2' },
    { x: -0.026, z: -0.016, tilt: -0.1, color: '#d8b26a' },
  ]
  return (
    <Clickable id={id} position={position} rotation={rotation} labelOffset={[0, 0.26, 0]}>
      {/* crock */}
      <mesh position={[0, 0.075, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.052, 0.045, 0.15, 20, 1, true]} />
        <meshStandardMaterial color="#b7ada0" roughness={0.75} metalness={0.03} side={2} />
      </mesh>
      <mesh position={[0, 0.005, 0]} receiveShadow>
        <cylinderGeometry args={[0.046, 0.046, 0.012, 20]} />
        <meshStandardMaterial color="#8f867a" roughness={0.8} />
      </mesh>
      {/* utensils poking out */}
      <group ref={groupRef} position={[0, 0.05, 0]}>
        {tools.map((t, i) => (
          <group key={i} position={[t.x, 0.12, t.z]} rotation={[t.tilt, i * 0.7, t.tilt * 0.5]}>
            <mesh position={[0, 0.09, 0]} castShadow>
              <cylinderGeometry args={[0.006, 0.007, 0.2, 8]} />
              <meshStandardMaterial color={t.color} roughness={0.35} metalness={0.55} />
            </mesh>
          </group>
        ))}
      </group>
    </Clickable>
  )
}
