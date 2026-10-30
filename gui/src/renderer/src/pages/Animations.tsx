import { Play, Square } from 'lucide-react'
import { useState } from 'react'
import { type AnimationName, ANIMATIONS, type HubState, type RGB, umbra } from '../api'
import { Colors, Slider } from '../components/Controls'

const INFO: Record<AnimationName, { label: string; text: string; colors: number }> = {
  rainbow: { label: 'Arc-en-ciel', text: 'Teintes qui tournent sur chaque anneau.', colors: 0 },
  wave: { label: 'Vague', text: 'Deux couleurs qui ondulent autour des anneaux.', colors: 2 },
  breathe: { label: 'Respiration', text: 'Une couleur qui s\'allume et s\'éteint lentement.', colors: 1 },
  galaxy: { label: 'Galaxie', text: 'Nébuleuse violette qui tourne d\'un ventilateur à l\'autre, étoiles qui scintillent.', colors: 0 },
}

export function Animations({ s }: { s: HubState }) {
  const [name, setName] = useState<AnimationName>(s.animation?.name ?? 'wave')
  const [colors, setColors] = useState<RGB[]>([[0, 160, 255], [160, 0, 255]])
  const [speed, setSpeed] = useState(1)
  const running = s.lights === 'animation' && s.animation

  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="anim-title">
        <div className="card-head"><h2 id="anim-title">Animations logicielles</h2>
          <span className="muted">Calculées ici, envoyées à 30 images/s</span></div>
        <div className="tiles">
          {ANIMATIONS.map(a => (
            <button key={a} className="tile" aria-pressed={name === a} onClick={() => setName(a)}>
              <span>{INFO[a].label}</span><small className="muted">{INFO[a].text}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="card" aria-labelledby="anim-settings">
        <div className="card-head"><h2 id="anim-settings">{INFO[name].label}</h2>
          {running && <span className="chip"><span className="dot ok" aria-hidden="true" />En cours</span>}</div>
        <Slider label="Vitesse" value={speed} min={0.25} max={3} step={0.25} onChange={setSpeed} format={v => `×${v}`} />
        {INFO[name].colors > 0 && <Colors label="Couleurs" colors={colors} count={INFO[name].colors} onChange={setColors} />}
        <div className="actions">
          <button className="btn btn-primary" disabled={!s.connected} onClick={() => umbra().animate(name, colors, speed)}>
            <Play size={16} aria-hidden="true" />{running ? 'Relancer' : 'Lancer'}
          </button>
          <button className="btn btn-ghost" disabled={!running} onClick={() => umbra().stopAnimation()}>
            <Square size={16} aria-hidden="true" />Arrêter
          </button>
        </div>
        <p className="muted">L'animation tourne tant que l'app est ouverte. À l'arrêt, le hub garde la dernière image.</p>
      </section>
    </div>
  )
}
