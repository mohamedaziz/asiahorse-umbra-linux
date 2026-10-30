// Minimal OpenRGB SDK client (TCP 127.0.0.1:6742). OpenRGB runs as root and does the
// SMBus/USB access; this app never touches the motherboard bus itself.
// Format from OpenRGB Documentation/OpenRGBSDK.md and release_1.1 sources: 16-byte
// header "ORGB" + dev u32 + id u32 + size u32, fields memcpy'd (little-endian on x86),
// RGBColor = r | g << 8 | b << 16.
import net from 'node:net'
import type { RGB } from './protocol'

const ID = {
  count: 0, data: 1, version: 40, clientName: 50, updateZoneLeds: 1051, customMode: 1100,
} as const
const CLIENT_PROTOCOL = 3 // brightness fields, no segments: enough here, servers accept older clients

export interface OrgbZone { index: number; name: string; leds: number }
export interface OrgbDevice { index: number; name: string; vendor: string; zones: OrgbZone[] }

class Reader {
  o = 0
  constructor(private b: Buffer) {}
  u8() { return this.b.readUInt8(this.o++) }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v }
  str() { const n = this.u16(); const s = this.b.toString('utf8', this.o, this.o + n).replace(/\0+$/, ''); this.o += n; return s }
  skip(n: number) { this.o += n }
}

export function parseController(b: Buffer, index: number, v: number): OrgbDevice {
  const r = new Reader(b)
  r.u32() // data_size
  r.i32() // type
  const name = r.str()
  const vendor = v >= 1 ? r.str() : ''
  r.str(); r.str(); r.str(); r.str() // description, version, serial, location
  const modes = r.u16()
  r.i32() // active mode
  for (let m = 0; m < modes; m++) {
    r.str(); r.i32(); r.u32(); r.u32(); r.u32()     // name, value, flags, speed min/max
    if (v >= 3) { r.u32(); r.u32() }                // brightness min/max
    r.u32(); r.u32(); r.u32()                       // colors min/max, speed
    if (v >= 3) r.u32()                             // brightness
    r.u32(); r.u32()                                // direction, color mode
    r.skip(r.u16() * 4)                             // mode colors
  }
  const zones: OrgbZone[] = []
  const nz = r.u16()
  for (let z = 0; z < nz; z++) {
    const zname = r.str()
    r.i32(); r.u32(); r.u32()                       // type, leds min/max
    const leds = r.u32()
    r.skip(r.u16())                                 // matrix map (whole block, 0 if none)
    if (v >= 4) for (let s = r.u16(); s > 0; s--) { r.str(); r.i32(); r.u32(); r.u32() }
    if (v >= 5) r.u32()                             // zone flags
    zones.push({ index: z, name: zname, leds })
  }
  return { index, name, vendor, zones }
}

export class OpenRGB {
  private sock: net.Socket | null = null
  private buf = Buffer.alloc(0)
  private waiters: { id: number; resolve: (b: Buffer | null) => void }[] = []
  version = 0

  async connect(host = '127.0.0.1', port = 6742): Promise<void> {
    this.close()
    await new Promise<void>((resolve, reject) => {
      const s = net.connect({ host, port })
      s.setTimeout(2000)
      s.once('connect', () => { s.setTimeout(0); resolve() })
      s.once('timeout', () => { s.destroy(); reject(new Error('OpenRGB: no answer on 127.0.0.1:6742')) })
      s.once('error', e => reject(new Error(`OpenRGB server not reachable (${(e as NodeJS.ErrnoException).code})`)))
      s.on('data', (d: Buffer) => this.onData(d))
      s.on('close', () => { this.sock = null; this.waiters.splice(0).forEach(w => w.resolve(null)) })
      this.sock = s
    })
    const u = Buffer.alloc(4); u.writeUInt32LE(CLIENT_PROTOCOL)
    this.send(0, ID.version, u)
    const reply = await this.wait(ID.version, 1000) // no reply = protocol 0 server
    this.version = reply ? Math.min(CLIENT_PROTOCOL, reply.readUInt32LE(0)) : 0
    this.send(0, ID.clientName, Buffer.from('Umbra Control\0'))
  }

  close() { this.sock?.destroy(); this.sock = null }
  get connected() { return this.sock !== null }

  private send(dev: number, id: number, data = Buffer.alloc(0)) {
    if (!this.sock) throw new Error('OpenRGB not connected')
    const h = Buffer.alloc(16)
    h.write('ORGB', 0, 'ascii'); h.writeUInt32LE(dev, 4); h.writeUInt32LE(id, 8); h.writeUInt32LE(data.length, 12)
    this.sock.write(Buffer.concat([h, data]))
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d])
    while (this.buf.length >= 16) {
      if (this.buf.toString('ascii', 0, 4) !== 'ORGB') { this.close(); return }
      const id = this.buf.readUInt32LE(8), size = this.buf.readUInt32LE(12)
      if (this.buf.length < 16 + size) return
      const body = this.buf.subarray(16, 16 + size)
      this.buf = this.buf.subarray(16 + size)
      const i = this.waiters.findIndex(w => w.id === id)
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(Buffer.from(body))
    }
  }

  private wait(id: number, ms = 3000): Promise<Buffer | null> {
    return new Promise(resolve => {
      const w = { id, resolve: (b: Buffer | null) => { clearTimeout(t); resolve(b) } }
      const t = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); resolve(null) }, ms)
      this.waiters.push(w)
    })
  }

  async devices(): Promise<OrgbDevice[]> {
    this.send(0, ID.count)
    const c = await this.wait(ID.count)
    if (!c) throw new Error('OpenRGB: no controller count')
    const out: OrgbDevice[] = []
    for (let i = 0; i < c.readUInt32LE(0); i++) {
      const u = Buffer.alloc(4); u.writeUInt32LE(this.version)
      this.send(i, ID.data, this.version ? u : Buffer.alloc(0))
      const d = await this.wait(ID.data)
      if (d) out.push(parseController(d, i, this.version))
    }
    return out
  }

  /** Direct mode on the device, then the zone colors. */
  setZone(dev: number, zone: number, colors: RGB[]) {
    this.send(dev, ID.customMode)
    const data = Buffer.alloc(4 + 4 + 2 + colors.length * 4)
    data.writeUInt32LE(data.length, 0)
    data.writeUInt32LE(zone, 4)
    data.writeUInt16LE(colors.length, 8)
    colors.forEach(([r, g, b], i) => data.writeUInt32LE((r | (g << 8) | (b << 16)) >>> 0, 10 + i * 4))
    this.send(dev, ID.updateZoneLeds, data)
  }
}
