import { Gauge, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Curve, curvePercent, DEFAULT_CURVE, FAN_MAX, FAN_MIN, type HubState, umbra } from '../api'
import { Segmented, Slider } from '../components/Controls'
import { CurveEditor } from '../components/CurveEditor'
import { FanSpeeds } from '../components/FanSpeeds'

// Presets of the vendor app's manual speed page.
const PRESETS = [{ label: 'Silencieux', pct: 20 }, { label: 'Bas', pct: 60 }, { label: 'Haut', pct: 80 }, { label: 'Max', pct: 100 }]

export function Fans({ s }: { s: HubState }) {
  const [mode, setMode] = useState<'manual' | 'auto'>(s.curve ? 'auto' : 'manual')
  const [pct, setPctRaw] = useState(s.fan ?? 40)
  const [touched, setTouched] = useState(false) // opening the page must never change the fans
  const setPct = (v: number) => { setTouched(true); setPctRaw(v) }
  const [curve, setCurve] = useState<Curve>(s.curve ?? DEFAULT_CURVE)
  useEffect(() => { if (s.curve) setMode('auto') }, [s.curve])

  // debounce: the slider fires on every pixel, the hub does not need that
  useEffect(() => {
    if (!touched || mode !== 'manual' || !s.connected) return
    const t = setTimeout(() => umbra().fan(pct), 150)
    return () => clearTimeout(t)
  }, [pct, mode])

  const switchMode = (m: 'manual' | 'auto') => {
    setMode(m)
    if (m === 'auto') umbra().curve(curve)
    else umbra().curve(null) // stopping the curve sets 100 % first, then the manual value applies
  }

  return (<>
    <div className="grid-2">
      <section className="card" aria-labelledby="curve-title">
        <div className="card-head"><h2 id="curve-title">Courbe automatique</h2>
          <span className="muted">Tdie du CPU, toutes les 2 s</span></div>
        <CurveEditor curve={curve} cpu={s.cpu} onChange={setCurve} />
        <div className="actions">
          <button className="btn btn-primary" disabled={!s.connected} onClick={() => { setMode('auto'); umbra().curve(curve) }}>
            <Zap size={16} aria-hidden="true" />Appliquer la courbe
          </button>
          <button className="btn btn-ghost" onClick={() => setCurve(DEFAULT_CURVE)}>
            <RotateCcw size={16} aria-hidden="true" />Courbe par défaut
          </button>
        </div>
        <p className="muted">Sécurité : température illisible ou arrêt de la courbe, les ventilateurs passent à 100 %.</p>
      </section>

      <section className="card" aria-labelledby="fan-title">
        <div className="card-head"><h2 id="fan-title">Vitesse</h2><Gauge size={20} className="muted" aria-hidden="true" /></div>
        <p className="big-value mono" aria-live="polite">{s.fan ?? '—'}<small>%</small></p>
        <p className="muted">{s.cpu !== null && `CPU ${s.cpu.toFixed(1)} °C · la courbe donne ${curvePercent(curve, s.cpu)} %`}</p>
        <Segmented label="Mode" value={mode} onChange={switchMode}
          options={[{ value: 'manual', label: 'Manuel' }, { value: 'auto', label: 'Auto' }]} />
        {mode === 'manual' && <>
          <Slider label="Vitesse manuelle" value={pct} min={FAN_MIN} max={FAN_MAX} onChange={setPct} format={v => `${v} %`} />
          {pct < 10 && <div className="banner" role="status">Sous 10 % (plancher de l'app officielle) : les ventilateurs du hub
            peuvent s'arrêter. Le ventirad du CPU, branché sur la carte mère, n'est pas concerné.</div>}
          <div className="actions">
            {PRESETS.map(p => <button key={p.pct} className="btn btn-ghost" onClick={() => setPct(p.pct)}>{p.label}</button>)}
          </div>
        </>}
      </section>
    </div>
    <FanSpeeds rpms={s.rpms} />
  </>)
}
