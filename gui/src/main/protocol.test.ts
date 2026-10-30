// Same expectations as test_protocol.py: both implementations must emit identical bytes.
import { describe, expect, it } from 'vitest'
import {
  animationFrame, ANIMATIONS, checksum, curvePercent, DEFAULT_CURVE, effectPacket, EFFECTS,
  fanPacket, framePackets, native, parseStatus, parseTopology, rgbPacket,
} from './protocol'

describe('protocol', () => {
  it('checksum is an 8-bit sum', () => {
    expect(checksum([0xff, 0x02])).toBe(0x01)
  })

  it('native frame matches the vendor layout', () => {
    const p = native([0x0c, 0x01])
    expect([...p.slice(0, 7)]).toEqual([0x52, 0x42, 7, 0, 0x0c, 0x01, checksum([0x52, 0x42, 7, 0, 0x0c, 0x01])])
    expect(p.length).toBe(64)
  })

  it('refuses packet index 0 (crashes the firmware)', () => {
    expect(() => rgbPacket(1, 0, [])).toThrow()
  })

  it('splits a frame in 1-based packets of 20 LEDs', () => {
    const pk = framePackets(new Array(72).fill([1, 2, 3]))
    expect(pk.map(p => p[2])).toEqual([1, 2, 3, 4])
    expect(pk.every(p => p[1] === 4 && p[63] === checksum(p.slice(0, 63)))).toBe(true)
  })

  it('builds the static effect block like the vendor app', () => {
    const p = effectPacket(EFFECTS.indexOf('static'), { speed: 1, brightness: 40, colors: [[0, 255, 255]] })
    expect(p[2]).toBe(60)
    expect([...p.slice(4, 7)]).toEqual([0x03, 0xff, 0xff])
    expect([...p.slice(7, 11)]).toEqual([0, 1, 1, 102])
    expect([...p.slice(11, 17)]).toEqual([0, 255, 255, 0, 255, 255])
    expect(p[59]).toBe(checksum(p.slice(0, 59)))
  })

  it('clamps fan speed to 10-100 %', () => {
    expect(fanPacket(3)[5]).toBe(10)
    expect(fanPacket(250)[5]).toBe(100)
  })

  it('parses topology and status replies', () => {
    const r = new Uint8Array(64)
    r.set([0x52, 0x42, 0, 0, 0x01, 0xff])
    for (let i = 0; i < 10; i++) r.set([i < 6 ? 12 : 0, 0, 0, i, 0], 6 + i * 5)
    expect(parseTopology(r)).toEqual([12, 12, 12, 12, 12, 12, 0, 0, 0, 0])
    const s = new Uint8Array(64)
    s.set([0x52, 0x42])
    s[23] = 0xff; s[24] = 0x01
    expect(parseStatus(s)).toEqual({ bootFixed: false, selfCheck: false })
  })

  it('interpolates the fan curve', () => {
    expect(curvePercent(DEFAULT_CURVE, 30)).toBe(20)
    expect(curvePercent(DEFAULT_CURVE, 47.5)).toBe(32)
    expect(curvePercent(DEFAULT_CURVE, 64)).toBe(85)
    expect(curvePercent(DEFAULT_CURVE, 99)).toBe(100)
  })

  it('animation frames cover every LED with valid bytes', () => {
    const ports = [12, 12, 12, 0, 0, 0, 24, 0, 0, 0]
    for (const a of ANIMATIONS) {
      const f = animationFrame(a, ports, 1.3, [[0, 160, 255]])
      expect(f.length).toBe(60)
      expect(f.flat().every(v => v >= 0 && v <= 255)).toBe(true)
    }
  })
})
