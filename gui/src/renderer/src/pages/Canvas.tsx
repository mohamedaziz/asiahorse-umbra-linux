import { Eraser, PaintBucket, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type HubState, hexToRgb, type RGB, rgbToHex, shownPorts, umbra } from '../api'

const MAX_CELLS = 24 // first LEDs of each port, 1:1 (V2 reports 120 per port before detection)

/** Paint the LEDs of the used ports, then send one frame: the hub latches it. */
export function Canvas({ s }: { s: HubState }) {
  const info = shownPorts(s)
  const ports = s.ports.some(Boolean) ? s.ports : new Array(10).fill(0).map((_, i) => (i < 6 ? 12 : 0))
  const total = ports.reduce((a, b) => a + b, 0)
  const [leds, setLeds] = useState<RGB[]>(() => new Array(total).fill([0, 0, 0]))
  const [brush, setBrush] = useState<RGB>([0, 160, 255])
  const [painting, setPainting] = useState(false)
  useEffect(() => { if (leds.length !== total) setLeds(new Array(total).fill([0, 0, 0])) }, [total])

  const paint = (i: number) => setLeds(l => { const n = [...l]; n[i] = brush; return n })
  const fillPort = (start: number, n: number) =>
    setLeds(l => l.map((c, i) => (i >= start && i < start + n ? brush : c)))

  let offset = 0
  return (
    <section className="card" aria-labelledby="canvas-title" onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
      <div className="card-head">
        <h2 id="canvas-title">Canvas</h2>
        <div className="actions">
          <input className="color-input" type="color" aria-label="Couleur du pinceau" value={rgbToHex(brush)}
            onChange={e => setBrush(hexToRgb(e.target.value))} />
          <button className="btn btn-ghost" onClick={() => setLeds(leds.map(() => brush))}>
            <PaintBucket size={16} aria-hidden="true" />Tout remplir</button>
          <button className="btn btn-ghost" onClick={() => setLeds(leds.map(() => [0, 0, 0] as RGB))}>
            <Eraser size={16} aria-hidden="true" />Effacer</button>
          <button className="btn btn-primary" disabled={!s.connected} onClick={() => umbra().frame(leds, 'canvas')}>
            <Send size={16} aria-hidden="true" />Envoyer au hub</button>
        </div>
      </div>
      <p className="muted">Cliquez ou glissez pour peindre. Le nom du port remplit tout l'anneau.</p>
      <div className="canvas-grid">
        {ports.map((n, p) => {
          const start = offset
          offset += n
          const port = info[p]
          if (!n || port?.used === false) return null
          const name = port?.name ?? `Port ${p + 1}`
          return (
            <div className="canvas-row" key={p}>
              <button className="btn btn-ghost port" style={{ minHeight: 32, padding: '0 8px', width: 150 }} onClick={() => fillPort(start, n)}
                aria-label={`Remplir ${name}`} title="Remplir tout le port">{name}</button>
              {Array.from({ length: Math.min(n, MAX_CELLS) }, (_, i) => {
                const idx = start + i
                const [r, g, b] = leds[idx] ?? [0, 0, 0]
                return (
                  <button key={i} className="cell" style={{ background: `rgb(${r},${g},${b})` }}
                    aria-label={`${name}, LED ${i + 1}`}
                    onPointerDown={() => { setPainting(true); paint(idx) }}
                    onPointerEnter={() => painting && paint(idx)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint(idx) } }} />
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
