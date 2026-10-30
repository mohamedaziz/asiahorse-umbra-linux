import type { RGB } from '../api'

/** One ring per populated port, LEDs drawn as glowing dots. */
export function LedRings({ ports, leds, size = 76 }: { ports: number[]; leds: RGB[]; size?: number }) {
  let offset = 0
  const rings = ports.map((n, p) => {
    const start = offset
    offset += n
    return { p, n, start }
  }).filter(r => r.n > 0)

  if (!rings.length) return <p className="muted">Aucun port détecté. Branchez le hub puis actualisez.</p>

  const r = size / 2 - 8
  return (
    <div className="rings" role="img" aria-label={`Aperçu des LED de ${rings.length} ports`}>
      {rings.map(({ p, n, start }) => (
        <div className="ring-wrap" key={p}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
            {Array.from({ length: n }, (_, i) => {
              const a = (i / n) * 2 * Math.PI - Math.PI / 2
              const [cr, cg, cb] = leds[start + i] ?? [0, 0, 0]
              const off = cr + cg + cb < 24
              const fill = off ? 'rgba(148,163,184,0.22)' : `rgb(${cr},${cg},${cb})`
              return (
                <circle key={i} cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={3.6}
                  fill={fill} style={off ? undefined : { filter: `drop-shadow(0 0 4px ${fill})` }} />
              )
            })}
          </svg>
          <span className="muted mono">P{p} · {n}</span>
        </div>
      ))}
    </div>
  )
}
