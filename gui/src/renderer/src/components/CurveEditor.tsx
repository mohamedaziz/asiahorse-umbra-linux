import { useRef, useState } from 'react'
import { type Curve, curvePercent } from '../api'

const W = 560, H = 260, PAD = { l: 44, r: 16, t: 16, b: 34 }
const T_MIN = 25, T_MAX = 85
const x = (t: number) => PAD.l + ((t - T_MIN) / (T_MAX - T_MIN)) * (W - PAD.l - PAD.r)
const y = (p: number) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b)

/** Drag points with the mouse, or focus one and use the arrow keys (accessibility). */
export function CurveEditor({ curve, onChange, cpu }: { curve: Curve; onChange: (c: Curve) => void; cpu: number | null }) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)

  const move = (i: number, t: number, p: number) => {
    const lo = i > 0 ? curve[i - 1][0] + 1 : T_MIN
    const hi = i < curve.length - 1 ? curve[i + 1][0] - 1 : T_MAX
    const next = curve.map(pt => [...pt]) as Curve
    next[i] = [Math.round(Math.max(lo, Math.min(hi, t))), Math.round(Math.max(10, Math.min(100, p)))]
    onChange(next)
  }

  const onPointer = (e: React.PointerEvent) => {
    if (drag === null || !svg.current) return
    const r = svg.current.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H
    move(drag, T_MIN + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (T_MAX - T_MIN), (1 - (py - PAD.t) / (H - PAD.t - PAD.b)) * 100)
  }

  const path = curve.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t)},${y(p)}`).join(' ')
  const area = `${path} L${x(curve[curve.length - 1][0])},${y(0)} L${x(curve[0][0])},${y(0)} Z`

  return (
    <svg ref={svg} className="curve" viewBox={`0 0 ${W} ${H}`} onPointerMove={onPointer}
      onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}
      role="group" aria-label="Courbe de vitesse selon la température du CPU">
      <defs>
        <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7c3aed" stopOpacity="0.35" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map(p => (
        <g key={p}><line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="rgba(255,255,255,0.07)" />
          <text x={PAD.l - 8} y={y(p) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{p}%</text></g>
      ))}
      {[30, 40, 50, 60, 70, 80].map(t => (
        <text key={t} x={x(t)} y={H - 12} textAnchor="middle" fontSize="11" fill="#94a3b8">{t}°C</text>
      ))}
      {/* AMD max temperature of the 1950X */}
      <line x1={x(68)} x2={x(68)} y1={PAD.t} y2={y(0)} stroke="#f87171" strokeDasharray="4 4" opacity="0.7" />
      <text x={x(68) + 4} y={PAD.t + 10} fontSize="11" fill="#f87171">68 °C max</text>
      <path d={area} fill="url(#fill)" />
      <path d={path} fill="none" stroke="#a78bfa" strokeWidth="2.5" />
      {cpu !== null && cpu >= T_MIN && cpu <= T_MAX && (
        <g>
          <line x1={x(cpu)} x2={x(cpu)} y1={PAD.t} y2={y(0)} stroke="#22d3ee" strokeWidth="1.5" />
          <circle cx={x(cpu)} cy={y(curvePercent(curve, cpu))} r="5" fill="#22d3ee" />
        </g>
      )}
      {curve.map(([t, p], i) => (
        <circle key={i} cx={x(t)} cy={y(p)} r={drag === i ? 10 : 8} fill="#0b1120" stroke="#a78bfa" strokeWidth="2.5"
          tabIndex={0} role="slider" aria-label={`Point ${i + 1}`} aria-valuetext={`${t} °C, ${p} %`}
          aria-valuenow={p} aria-valuemin={10} aria-valuemax={100} style={{ cursor: 'grab' }}
          onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i) }}
          onKeyDown={e => {
            const d = { ArrowUp: [0, 5], ArrowDown: [0, -5], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]
            if (d) { e.preventDefault(); move(i, t + d[0], p + d[1]) }
          }} />
      ))}
    </svg>
  )
}
