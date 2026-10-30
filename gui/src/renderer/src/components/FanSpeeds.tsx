import { Pencil } from 'lucide-react'
import { useState } from 'react'
import type { HubState } from '../api'

const KEY = 'umbra.fanNames'
const SCALE = 2000 // tr/min shown as a full bar; typical 120 mm case fans top out near this

function loadNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

/** Measured RPM from the motherboard sensors (hwmon). Names are local to this machine. */
export function FanSpeeds({ rpms }: { rpms: HubState['rpms'] }) {
  const [names, setNames] = useState(loadNames)
  const [editing, setEditing] = useState<string | null>(null)

  const rename = (id: string, name: string) => {
    const next = { ...names, [id]: name }
    setNames(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable: keep in memory */ }
  }

  return (
    <section className="card" aria-labelledby="rpm-title">
      <div className="card-head"><h2 id="rpm-title">Vitesses mesurées</h2>
        <span className="muted">Capteurs de la carte mère, chaque seconde</span></div>
      {!rpms.length && <p className="muted">Aucun capteur de ventilateur. Chargez le pilote (ex. <span className="mono">nct6775</span>).</p>}
      <div className="rpm-list">
        {rpms.map(({ id, rpm }) => {
          const name = names[id] || id.split('/')[1]
          return (
            <div className="rpm-row" key={id}>
              {editing === id
                ? <input className="rpm-name-input" autoFocus defaultValue={names[id] ?? ''} placeholder={id}
                    aria-label={`Nom de ${id}`} onBlur={e => { rename(id, e.target.value.trim()); setEditing(null) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }} />
                : <button className="rpm-name" onClick={() => setEditing(id)} aria-label={`Renommer ${name}`} title={id}>
                    {name}<Pencil size={13} aria-hidden="true" /></button>}
              <div className="rpm-bar" aria-hidden="true">
                <div style={{ width: `${Math.min(100, (rpm / SCALE) * 100)}%` }} />
              </div>
              <span className={`mono rpm-value ${rpm ? '' : 'muted'}`}>{rpm ? `${rpm} tr/min` : 'arrêté ou vide'}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
