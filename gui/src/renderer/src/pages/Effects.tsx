import { Play } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_COLORS, type EffectName, EFFECTS, type HubState, type RGB, umbra } from '../api'
import { Colors, Segmented, Slider } from '../components/Controls'

// Labels from the vendor app's English UI, translated.
const LABELS: Record<EffectName, string> = {
  static: 'Statique', rainbow: 'Arc-en-ciel', 'gradient-rainbow': 'Arc-en-ciel dégradé', breath: 'Respiration',
  'breath-rainbow': 'Respiration arc-en-ciel', runway: 'Piste', tile: 'Mosaïque', 'fade-out': 'Fondu',
  trail: 'Traînée', scan: 'Balayage', brick: 'Briques', disco: 'Disco', pulse: 'Pulsation', flash: 'Éclair',
  address: 'Adressage',
}
// How many of the 4 colors each effect uses is not documented: show 4 except where it is obvious.
const COLOR_COUNT: Partial<Record<EffectName, number>> = { static: 1, rainbow: 0, 'gradient-rainbow': 0, 'breath-rainbow': 0 }
const SWATCH = 'linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #22d3ee, #7c3aed)'

export function Effects({ s }: { s: HubState }) {
  const [name, setName] = useState<EffectName>(s.effect?.name ?? 'rainbow')
  const [speed, setSpeed] = useState(3)
  const [direction, setDirection] = useState<'0' | '1'>('1')
  const [brightness, setBrightness] = useState(60)
  const [colors, setColors] = useState<RGB[]>([[0, 160, 255], [160, 0, 255], ...DEFAULT_COLORS.slice(2)])
  const [busy, setBusy] = useState(false)
  const nColors = COLOR_COUNT[name] ?? 4

  const apply = async () => {
    setBusy(true)
    await umbra().effect(name, { speed, direction: Number(direction), brightness, colors })
    setBusy(false)
  }

  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="fx-title">
        <div className="card-head"><h2 id="fx-title">15 effets intégrés</h2>
          <span className="muted">Calculés par le hub, aucun flux depuis le PC</span></div>
        <div className="tiles">
          {EFFECTS.map(e => (
            <button key={e} className="tile" aria-pressed={name === e} onClick={() => setName(e)}>
              <div className="swatch" style={{ background: COLOR_COUNT[e] === 0 ? SWATCH :
                `linear-gradient(90deg, rgb(${colors[0]}), rgb(${colors[(COLOR_COUNT[e] ?? 4) > 1 ? 1 : 0]}))` }} />
              <span>{LABELS[e]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="fx-settings">
        <div className="card-head"><h2 id="fx-settings">{LABELS[name]}</h2></div>
        {/* speed byte: 0 = fastest (vendor UI slider runs the other way) */}
        <Slider label="Vitesse" value={5 - speed} min={0} max={5} onChange={v => setSpeed(5 - v)}
          format={v => ['Très lente', 'Lente', 'Modérée', 'Normale', 'Rapide', 'Très rapide'][v]} />
        <Slider label="Luminosité" value={brightness} min={10} max={100} step={5} onChange={setBrightness} format={v => `${v} %`} />
        <Segmented label="Sens" value={direction} onChange={setDirection}
          options={[{ value: '1', label: 'Avant' }, { value: '0', label: 'Arrière' }]} />
        {nColors > 0 && <Colors label="Couleurs" colors={colors} count={nColors} onChange={setColors} />}
        <div className="actions">
          <button className="btn btn-primary" onClick={apply} disabled={busy || !s.connected}>
            <Play size={16} aria-hidden="true" />Appliquer
          </button>
        </div>
        {!s.connected && <p className="muted">Hub absent : branchez-le ou lancez l'émulateur.</p>}
      </section>
    </div>
  )
}
