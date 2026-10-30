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
}

declare global { interface Window { umbra: UmbraApi } }
export const umbra = () => window.umbra
