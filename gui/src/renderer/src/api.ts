import type { UmbraApi } from '../../preload'
import type { AnimationName, Curve, EffectName, EffectOptions, RGB } from '../../main/protocol'

export type { AnimationName, Curve, EffectName, EffectOptions, RGB }
export {
  ANIMATIONS, DEFAULT_COLORS, DEFAULT_CURVE, EFFECTS, FAN_MAX, FAN_MIN, animationFrame, curvePercent,
  hexToRgb, ledTotal, rgbToHex,
} from '../../main/protocol'

export interface HubState {
  connected: boolean
  node: string | null
  ports: number[]
  lights: 'unknown' | 'effect' | 'animation' | 'canvas' | 'color'
  effect: null | ({ name: EffectName } & EffectOptions)
  animation: null | { name: AnimationName; colors: RGB[]; speed: number }
  fan: number | null
  curve: Curve | null
  cpu: number | null
  error: string | null
  preview: RGB[]
  rpms: { id: string; chip: string; rpm: number }[]
  ledsOn: boolean
  portInfo: PortInfo[]
  orgb: {
    connected: boolean; error: string | null
    devices: { index: number; name: string; vendor: string; zones: { index: number; name: string; leds: number }[] }[]
  }
}

export interface PortInfo { name: string; used: boolean }

/** Ports to show: those marked used (all of them before any configuration). */
export const shownPorts = (s: Pick<HubState, 'ports' | 'portInfo'>) =>
  s.ports.map((n, i) => ({ index: i, leds: n, name: s.portInfo[i]?.name ?? `Port ${i + 1}`, used: s.portInfo[i]?.used ?? true }))

declare global { interface Window { umbra: UmbraApi } }
export const umbra = () => window.umbra
