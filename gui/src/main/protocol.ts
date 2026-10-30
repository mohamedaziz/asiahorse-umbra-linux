// Umbra hub wire protocol, pure functions (port of asiahorse.py, see README).
// Nothing here touches the device: hub.ts does the I/O.

export const VID = 0x1a86
export const PID = 0xfe05
// V2 (sold from 2026-10-09): 1a86:fe04 "ROBOBLOQ ARGB2", same HID report descriptor as V1.
export const PIDS = [0xfe05, 0xfe04]
export const PAYLOAD = 64
export const PORTS = 10
export const LEDS_PER_PACKET = 20
export const EFFECT_BLOCK = 52
// The vendor slider floors at 10 %; 0 % is allowed here on purpose (user choice). Untested on
// hardware: the hub may stop the fans or keep them at their minimum speed.
export const FAN_MIN = 0
export const FAN_MAX = 100

export type RGB = [number, number, number]

export const EFFECTS = [
  'static', 'rainbow', 'gradient-rainbow', 'breath', 'breath-rainbow',
  'runway', 'tile', 'fade-out', 'trail', 'scan', 'brick', 'disco',
  'pulse', 'flash', 'address',
] as const
export type EffectName = (typeof EFFECTS)[number]

export const ANIMATIONS = ['rainbow', 'wave', 'breathe'] as const
export type AnimationName = (typeof ANIMATIONS)[number]

export const DEFAULT_COLORS: RGB[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]

export function checksum(data: Uint8Array | number[]): number {
  let s = 0
  for (const b of data) s = (s + (b & 0xff)) & 0xff
  return s
}

function pad(bytes: number[]): Uint8Array {
  const out = new Uint8Array(PAYLOAD)
  out.set(bytes.slice(0, PAYLOAD))
  return out
}

/** Native command: 52 42 <len> 00 <body> <checksum>, len = body + 5. */
export function native(body: number[]): Uint8Array {
  const pkt = [0x52, 0x42, (body.length + 5) & 0xff, 0x00, ...body]
  return pad([...pkt, checksum(pkt)])
}

/** Direct RGB packet: 88 <count> <index> <20 x RGB> <checksum>. Index is 1-based. */
export function rgbPacket(count: number, index: number, colors: RGB[]): Uint8Array {
  if (index < 1) throw new Error('packet index is 1-based: index 0 crashes the hub firmware')
  const pkt = [0x88, count & 0xff, index & 0xff]
  for (const [r, g, b] of colors) pkt.push(r & 0xff, g & 0xff, b & 0xff)
  return pad([...pkt, checksum(pkt)])
}

/** All packets of one frame, LEDs in port order 0-9. */
export function framePackets(leds: RGB[]): Uint8Array[] {
  const count = Math.ceil(leds.length / LEDS_PER_PACKET)
  const out: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const chunk = leds.slice(i * LEDS_PER_PACKET, (i + 1) * LEDS_PER_PACKET)
    while (chunk.length < LEDS_PER_PACKET) chunk.push([0, 0, 0])
    out.push(rgbPacket(count, i + 1, chunk))
  }
  return out
}

export interface EffectOptions {
  speed?: number      // 0-5, 0 fastest, vendor default 3
  direction?: number  // 0 / 1
  brightness?: number // percent, vendor floor 10
  colors?: RGB[]      // up to 4
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 03 FF FF: same built-in effect on every port (vendor ARGB_ten_effect(255, 255)). */
export function effectPacket(effect: number, o: EffectOptions = {}): Uint8Array {
  const cols = [...(o.colors ?? []), ...DEFAULT_COLORS.slice((o.colors ?? []).length)].slice(0, 4)
  if (effect === 0) cols[1] = cols[0] // the vendor app mirrors color 1 into color 2 for Static
  const block = [
    effect, clamp(o.speed ?? 3, 0, 5), o.direction ?? 1 ? 1 : 0,
    Math.round(clamp(o.brightness ?? 60, 10, 100) * 2.55),
    ...cols.flat(), 0,
  ]
  while (block.length < EFFECT_BLOCK) block.push(0)
  return native([0x03, 0xff, 0xff, ...block])
}

// Settings commands named after the vendor app. (?) = inferred from its UI code.
export const CMD = {
  status: [0x00],
  topology: [0x01, 0xff],
  fanControlBoard: [0x08, 0x00],    // (?)
  fanControlSoftware: [0x08, 0x01], // (?)
  lightsHardware: [0xfd, 0x00],     // (?)
  lightsSoftware: [0xfd, 0x01],     // verified upstream, hub re-enumerates
  bootEffectMemory: [0x0b, 0xff],
  bootEffectFixed: [0x0b, 0x01],
  selfCheckOn: [0x0c, 0xff],
  selfCheckOff: [0x0c, 0x01],
} as const

export const fanPacket = (pct: number) => native([0xfb, clamp(Math.round(pct), FAN_MIN, FAN_MAX)])

/** Topology reply: ten 5-byte records from offset 6, [led_count, ?, ?, port, ?]. */
export function parseTopology(reply: Uint8Array): number[] {
  const ports = new Array(PORTS).fill(0)
  if (reply.length < 6 + PORTS * 5) return ports
  for (let i = 0; i < PORTS; i++) {
    const off = 6 + i * 5
    if (reply[off + 3] < PORTS) ports[reply[off + 3]] = reply[off]
  }
  return ports
}

/** Status reply: boot mode at 23, self-check at 24. */
export function parseStatus(reply: Uint8Array) {
  if (reply.length < 26 || reply[0] !== 0x52 || reply[1] !== 0x42) return null
  return { bootFixed: reply[23] === 0x01, selfCheck: reply[24] === 0xff }
}

/** Write-rate cap: the vendor app was measured sustaining ~378 HID writes/s (SignalRGB plugin
 *  notes); stay at 250. The V2 hub reports 120 LEDs per port before detection, i.e. 60 packets
 *  per frame: 30 fps would mean ~1800 writes/s. Frame interval grows with the packet count. */
export const MAX_WRITES_PER_SEC = 250
export const frameIntervalMs = (leds: number) =>
  Math.max(33, Math.ceil((1000 * Math.ceil(leds / LEDS_PER_PACKET)) / MAX_WRITES_PER_SEC))

export const ledTotal = (ports: number[]) => ports.reduce((a, b) => a + b, 0) || PORTS * 12
const layout = (ports: number[]) => (ports.some(Boolean) ? ports : new Array(PORTS).fill(12))

function hsv(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]
  return [m[0], m[1], m[2]]
}

/** Software animation frame (no gamma on the diodes: rainbow capped at 200). */
export function animationFrame(name: AnimationName, ports: number[], t: number,
                               colors: RGB[], speed = 1): RGB[] {
  const c1 = colors[0] ?? [0, 160, 255]
  const c2 = colors[1] ?? [160, 0, 255]
  const leds: RGB[] = []
  layout(ports).forEach((n, p) => {
    for (let i = 0; i < n; i++) {
      const x = i / n
      if (name === 'rainbow') {
        const [r, g, b] = hsv((((x + p / PORTS + t * 0.2 * speed) % 1) + 1) % 1, 1, 1)
        leds.push([Math.round(r * 200), Math.round(g * 200), Math.round(b * 200)])
      } else if (name === 'wave') {
        const k = (Math.sin(2 * Math.PI * (x - t * 0.5 * speed)) + 1) / 2
        leds.push([0, 1, 2].map(j => Math.round(c1[j] * k + c2[j] * (1 - k))) as RGB)
      } else {
        const k = 0.05 + 0.95 * (Math.sin(2 * Math.PI * t * 0.25 * speed) + 1) / 2
        leds.push(c1.map(v => Math.round(v * k)) as RGB)
      }
    }
  })
  return leds
}

export type Curve = [number, number][]
// Tuned for a 1950X (AMD max 68 C): calm at idle, full speed before the limit.
export const DEFAULT_CURVE: Curve = [[40, 20], [55, 45], [62, 70], [66, 100]]

/** Python's round(): halves go to the even neighbour, so CLI and app send the same speed. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  return x - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x)
}

export function curvePercent(curve: Curve, temp: number): number {
  if (temp <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [t1, p1] = curve[i - 1], [t2, p2] = curve[i]
    if (temp <= t2) return roundHalfEven(p1 + (p2 - p1) * (temp - t1) / (t2 - t1))
  }
  return curve[curve.length - 1][1]
}

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
