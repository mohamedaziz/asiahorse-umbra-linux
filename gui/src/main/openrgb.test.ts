import { describe, expect, it } from 'vitest'
import { parseController } from './openrgb'

// Builds a protocol-3 controller blob the way OpenRGB serializes it (little-endian, u16-prefixed strings).
function blob(): Buffer {
  const parts: Buffer[] = []
  const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); parts.push(b) }
  const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b) }
  const str = (s: string) => { u16(s.length + 1); parts.push(Buffer.from(s + '\0')) }
  u32(0); u32(0)                                   // data_size, type
  str('ASRock X399 Phantom Gaming 6'); str('ASRock')
  str('desc'); str('1.0'); str(''); str('i2c')
  u16(1); u32(0)                                   // 1 mode, active 0
  str('Direct'); for (let i = 0; i < 12; i++) u32(0); u16(1); u32(0x00ff00ff) // mode fields + 1 color
  u16(2)                                           // 2 zones
  str('PCH'); u32(0); u32(1); u32(1); u32(1); u16(0)
  str('Addressable header'); u32(1); u32(0); u32(80); u32(24)
  u16(12); u32(1); u32(1); u32(7)                  // a 1x1 matrix block of 12 bytes, skipped
  return Buffer.concat(parts)
}

describe('OpenRGB controller parsing (protocol 3)', () => {
  it('reads name, vendor and zones, skipping modes and matrix maps', () => {
    const d = parseController(blob(), 0, 3)
    expect(d.name).toBe('ASRock X399 Phantom Gaming 6')
    expect(d.vendor).toBe('ASRock')
    expect(d.zones).toEqual([
      { index: 0, name: 'PCH', leds: 1 },
      { index: 1, name: 'Addressable header', leds: 24 },
    ])
  })
})
