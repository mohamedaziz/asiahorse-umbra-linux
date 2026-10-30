import { Paintbrush, PlugZap, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type HubState, hexToRgb, type RGB, rgbToHex, umbra } from '../api'

const SWAP_KEY = 'umbra.orgbSwapRG'
const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(SWAP_KEY) ?? '{}') } catch { return {} } }

/** Motherboard LEDs through OpenRGB's SDK server. Some headers wire red and green the other
 *  way round (measured on the X399 Phantom Gaming 6 ARGB header): per-zone swap, kept locally. */
export function Motherboard({ s }: { s: HubState }) {
  const [colors, setColors] = useState<Record<string, RGB>>({})
  const [swap, setSwap] = useState(load)
  const [all, setAll] = useState<RGB>([0, 160, 255])
  const [busy, setBusy] = useState(false)
  const scan = async () => { setBusy(true); await umbra().orgbScan(); setBusy(false) }
  useEffect(() => { if (!s.orgb.connected) scan() }, [])

  const key = (d: number, z: number) => `${s.orgb.devices[d]?.name}/${z}`
  const send = (dev: number, zone: number, leds: number, c: RGB) => {
    const out: RGB = swap[key(dev, zone)] ? [c[1], c[0], c[2]] : c
    umbra().orgbZone(dev, zone, new Array(leds).fill(out))
  }
  const toggleSwap = (k: string) => {
    const next = { ...swap, [k]: !swap[k] }
    setSwap(next)
    try { localStorage.setItem(SWAP_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  }
  const applyAll = () => {
    const next: Record<string, RGB> = {}
    s.orgb.devices.forEach(d => d.zones.forEach(z => { next[key(d.index, z.index)] = all; send(d.index, z.index, z.leds, all) }))
    setColors(next)
  }

  if (!s.orgb.connected) return (
    <section className="card" aria-labelledby="mb-off">
      <div className="card-head"><h2 id="mb-off">Serveur OpenRGB absent</h2><PlugZap size={20} className="muted" aria-hidden="true" /></div>
      <div className="banner">{s.orgb.error ?? 'Connexion en cours…'}</div>
      <p className="muted">Les LED de la carte mère passent par OpenRGB, qui seul accède au bus SMBus.
        Lancez son serveur local (service <span className="mono">openrgb-server</span>, écoute sur 127.0.0.1:6742), puis :</p>
      <button className="btn btn-primary" onClick={scan} disabled={busy}><Search size={16} aria-hidden="true" />Rechercher</button>
    </section>
  )

  return (<>
    <section className="card" aria-labelledby="mb-all">
      <div className="card-head"><h2 id="mb-all">Toutes les zones</h2>
        <button className="btn btn-ghost" onClick={scan} disabled={busy}><Search size={16} aria-hidden="true" />Actualiser</button></div>
      <div className="actions">
        <input className="color-input" type="color" aria-label="Couleur pour toutes les zones" value={rgbToHex(all)}
          onChange={e => setAll(hexToRgb(e.target.value))} />
        <button className="btn btn-primary" onClick={applyAll}><Paintbrush size={16} aria-hidden="true" />Tout appliquer</button>
      </div>
    </section>
    {s.orgb.devices.map(d => (
      <section className="card" key={d.index} aria-labelledby={`dev-${d.index}`}>
        <div className="card-head"><h2 id={`dev-${d.index}`}>{d.name}</h2><span className="muted">{d.vendor}</span></div>
        <div className="rpm-list">
          {d.zones.map(z => {
            const k = key(d.index, z.index)
            const c = colors[k] ?? [0, 0, 0]
            return (
              <div className="zone-row" key={z.index}>
                <span>{z.name} <span className="muted mono">· {z.leds} LED</span></span>
                <label className="check">
                  <input type="checkbox" checked={!!swap[k]} onChange={() => toggleSwap(k)} />Inverser rouge/vert
                </label>
                <input className="color-input" type="color" aria-label={`Couleur de ${z.name}`} value={rgbToHex(c)}
                  onChange={e => {
                    const v = hexToRgb(e.target.value)
                    setColors({ ...colors, [k]: v })
                    send(d.index, z.index, z.leds, v)
                  }} />
              </div>
            )
          })}
        </div>
      </section>
    ))}
  </>)
}
