import { type HubState, shownPorts } from '../api'

const MAX_DOTS = 24 // the V2 hub reports 120 LEDs per port before detection: sample for legibility

/** One ring per used port, named, LEDs drawn as glowing dots. */
export function LedRings({ s, size = 84 }: { s: HubState; size?: number }) {
  let offset = 0
  const rings = shownPorts(s).map(p => {
    const start = offset
    offset += p.leds
    return { ...p, start }
  }).filter(r => r.used && r.leds > 0)

  if (!rings.length) return <p className="muted">Aucun port détecté. Branchez le hub puis actualisez.</p>

  const r = size / 2 - 8
  return (
    <div className="rings" role="img" aria-label={`Aperçu des LED de ${rings.length} ventilateurs`}>
      {rings.map(({ index, name, leds, start }) => {
        const dots = Math.min(leds, MAX_DOTS)
        return (
          <div className="ring-wrap" key={index}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              {Array.from({ length: dots }, (_, i) => {
                const a = (i / dots) * 2 * Math.PI - Math.PI / 2
                const [cr, cg, cb] = s.preview[start + Math.floor((i * leds) / dots)] ?? [0, 0, 0]
                const off = cr + cg + cb < 24
                const fill = off ? 'rgba(148,163,184,0.22)' : `rgb(${cr},${cg},${cb})`
                return (
                  <circle key={i} cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={3.6}
                    fill={fill} style={off ? undefined : { filter: `drop-shadow(0 0 4px ${fill})` }} />
                )
              })}
            </svg>
            <span>{name}</span>
            <span className="muted mono">port {index + 1}</span>
          </div>
        )
      })}
    </div>
  )
}
