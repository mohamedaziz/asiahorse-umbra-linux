import { CircuitBoard, Cpu, Fan, Lightbulb, LightbulbOff, Grid3x3, Palette, RefreshCw, Settings as SettingsIcon, Sparkles, Usb } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type HubState, umbra } from './api'
import { LedRings } from './components/LedRings'
import { Animations } from './pages/Animations'
import { Canvas } from './pages/Canvas'
import { Effects } from './pages/Effects'
import { Fans } from './pages/Fans'
import { Motherboard } from './pages/Motherboard'
import { Settings } from './pages/Settings'

const PAGES = [
  { id: 'effects', label: 'Effets du hub', icon: Palette },
  { id: 'animations', label: 'Animations', icon: Sparkles },
  { id: 'fans', label: 'Ventilateurs', icon: Fan },
  { id: 'canvas', label: 'Canvas', icon: Grid3x3 },
  { id: 'motherboard', label: 'Carte mère', icon: CircuitBoard },
  { id: 'settings', label: 'Réglages', icon: SettingsIcon },
] as const
type PageId = (typeof PAGES)[number]['id']

const EMPTY: HubState = {
  connected: false, node: null, ports: [], lights: 'unknown', effect: null, animation: null,
  fan: null, curve: null, cpu: null, error: null, preview: [], rpms: [], ledsOn: true,
  orgb: { connected: false, error: null, devices: [] },
}

export default function App() {
  const [page, setPage] = useState<PageId>('effects')
  const [s, setS] = useState<HubState>(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => umbra().onState(x => setS(x as HubState)), [])
  const refresh = async () => { setBusy(true); await umbra().refresh(); setBusy(false) }
  const [ledBusy, setLedBusy] = useState(false)
  const toggleLeds = async () => { setLedBusy(true); await umbra().leds(!s.ledsOn); setLedBusy(false) }
  useEffect(() => { refresh() }, [])

  const title = PAGES.find(p => p.id === page)!.label
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="brand"><div className="brand-mark" aria-hidden="true" /><b>UMBRA</b></div>
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button key={id} className="nav-item" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
            <Icon size={20} aria-hidden="true" />{label}
          </button>
        ))}
        <div className="sidebar-foot muted">Contrôle local, aucun accès réseau.</div>
      </nav>

      <main className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="grow" />
          <span className="chip" title={s.node ?? undefined}>
            <span className={`dot ${s.connected ? 'ok' : 'bad'}`} aria-hidden="true" />
            <Usb size={15} aria-hidden="true" />{s.connected ? `Hub ${s.node}` : 'Hub absent'}
          </span>
          <span className="chip mono"><Cpu size={15} aria-hidden="true" />{s.cpu === null ? '—' : `${s.cpu.toFixed(1)} °C`}</span>
          <span className="chip mono"><Fan size={15} aria-hidden="true" />{s.fan === null ? '—' : `${s.fan} %`}{s.curve ? ' auto' : ''}</span>
          <button className={`switch ${s.ledsOn ? 'on' : ''}`} role="switch" aria-checked={s.ledsOn}
            disabled={!s.connected || ledBusy} onClick={toggleLeds}>
            {s.ledsOn ? <Lightbulb size={16} aria-hidden="true" /> : <LightbulbOff size={16} aria-hidden="true" />}
            LED {s.ledsOn ? 'on' : 'off'}<span className="knob" aria-hidden="true" />
          </button>
          <button className="btn btn-ghost" onClick={refresh} disabled={busy} aria-label="Actualiser l'état du hub">
            <RefreshCw size={16} aria-hidden="true" />Actualiser
          </button>
        </header>

        <div className="content">
          {s.error && <div className="banner error" role="alert">{s.error}</div>}
          <section className="card" aria-labelledby="preview-title">
            <div className="card-head"><h3 id="preview-title">Aperçu</h3>
              <span className="muted">{s.lights === 'effect' ? 'Effet calculé par le hub, aperçu des couleurs seulement' : ''}</span></div>
            <LedRings ports={s.ports} leds={s.preview} />
          </section>
          {page === 'effects' && <Effects s={s} />}
          {page === 'animations' && <Animations s={s} />}
          {page === 'fans' && <Fans s={s} />}
          {page === 'canvas' && <Canvas s={s} />}
          {page === 'motherboard' && <Motherboard s={s} />}
          {page === 'settings' && <Settings s={s} />}
        </div>
      </main>
    </div>
  )
}
