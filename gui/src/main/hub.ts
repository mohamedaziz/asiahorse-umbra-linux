// Device I/O on /dev/hidraw (Linux only, no native module): same approach as asiahorse.py.
import fs from 'node:fs'
import path from 'node:path'
import {
  CMD, framePackets, native, parseStatus, parseTopology, PAYLOAD, PIDS, type RGB, VID,
} from './protocol'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const hex8 = (n: number) => n.toString(16).padStart(8, '0').toUpperCase()
const IDS = PIDS.map(pid => `${hex8(VID)}:${hex8(pid)}`)

export function findNode(): string | null {
  const base = '/sys/class/hidraw'
  for (const n of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    try {
      const ue = fs.readFileSync(path.join(base, n, 'device/uevent'), 'utf8').toUpperCase()
      if (ue.includes('HID_ID') && IDS.some(id => ue.includes(id))) return `/dev/${n}`
    } catch { /* node vanished while scanning */ }
  }
  return null
}

export class Hub {
  fd: number | null = null
  node: string | null = null
  ports: number[] = []
  software = false

  open(): boolean {
    this.close()
    const node = findNode()
    if (!node) return false
    // O_NONBLOCK: reads poll with a deadline instead of blocking a libuv thread
    this.fd = fs.openSync(node, fs.constants.O_RDWR | fs.constants.O_NONBLOCK)
    this.node = node
    return true
  }

  close() {
    if (this.fd !== null) try { fs.closeSync(this.fd) } catch { /* already gone */ }
    this.fd = null
  }

  write(payload: Uint8Array) {
    if (this.fd === null) throw new Error('hub not open')
    const buf = Buffer.alloc(PAYLOAD + 1) // report ID 0x00 first
    buf.set(payload, 1)
    fs.writeSync(this.fd, buf)
  }

  async read(timeoutMs = 500): Promise<Uint8Array | null> {
    const buf = Buffer.alloc(PAYLOAD + 1)
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      try {
        const n = fs.readSync(this.fd!, buf)
        if (n > 0) return new Uint8Array(buf.subarray(0, n))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e
      }
      await sleep(5)
    }
    return null
  }

  async query(body: readonly number[]) {
    this.write(native([...body]))
    return this.read()
  }

  async status() { const r = await this.query(CMD.status); return r && parseStatus(r) }
  async topology() { const r = await this.query(CMD.topology); this.ports = r ? parseTopology(r) : this.ports; return this.ports }

  /** FD 01 makes the hub drop off USB and come back, maybe on another node: ping until it answers. */
  async enterSoftwareMode() {
    if (this.software) return
    this.write(native([...CMD.lightsSoftware]))
    this.close()
    await sleep(500)
    const end = Date.now() + 10_000
    while (Date.now() < end) {
      try {
        if (this.open() && await this.status()) { this.software = true; return }
      } catch { /* old node lingering */ }
      await sleep(400)
    }
    throw new Error('hub did not come back after the mode switch')
  }

  async hardwareMode() {
    this.write(native([...CMD.lightsHardware]))
    this.software = false
    await sleep(200)
  }

  sendFrame(leds: RGB[]) {
    for (const p of framePackets(leds)) this.write(p)
  }
}

export interface FanRpm { id: string; chip: string; rpm: number }

/** Measured fan speeds from every hwmon chip that exposes fanN_input (e.g. nct6779 on
 *  the motherboard). The hub itself reports no RPM over USB (none in the vendor app). */
export function fanRpms(): FanRpm[] {
  const base = '/sys/class/hwmon'
  const out: FanRpm[] = []
  for (const h of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const d = path.join(base, h)
    try {
      const chip = fs.readFileSync(path.join(d, 'name'), 'utf8').trim()
      for (const f of fs.readdirSync(d).filter(f => /^fan\d+_input$/.test(f)).sort())
        out.push({ id: `${chip}/${f.replace('_input', '')}`, chip, rpm: Number(fs.readFileSync(path.join(d, f), 'utf8')) })
    } catch { /* chip busy */ }
  }
  return out
}

/** k10temp: Tdie when exposed (1st gen Threadripper Tctl has a +27 C offset), else Tctl. */
export function cpuTemp(): number | null {
  const base = '/sys/class/hwmon'
  for (const h of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const d = path.join(base, h)
    try {
      if (fs.readFileSync(path.join(d, 'name'), 'utf8').trim() !== 'k10temp') continue
      const labels: Record<string, string> = {}
      for (const f of fs.readdirSync(d).filter(f => /^temp\d+_label$/.test(f)))
        labels[fs.readFileSync(path.join(d, f), 'utf8').trim()] = path.join(d, f.replace('_label', '_input'))
      const p = labels.Tdie ?? labels.Tctl
      if (p) return Number(fs.readFileSync(p, 'utf8')) / 1000
    } catch { /* sensor busy */ }
  }
  return null
}
