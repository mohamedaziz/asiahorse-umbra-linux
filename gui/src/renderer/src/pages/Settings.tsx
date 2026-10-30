import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { type HubState, umbra } from '../api'
import { Segmented } from '../components/Controls'

type FanCtl = '' | 'fanControlBoard' | 'fanControlSoftware'
type Boot = '' | 'bootEffectMemory' | 'bootEffectFixed'
type Check = '' | 'selfCheckOn' | 'selfCheckOff'

/** Settings decoded from the vendor app. Unknown hub state: nothing is pre-selected until you choose. */
export function Settings({ s }: { s: HubState }) {
  const [fanCtl, setFanCtl] = useState<FanCtl>('')
  const [boot, setBoot] = useState<Boot>('')
  const [check, setCheck] = useState<Check>('')

  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="set-title">
        <div className="card-head"><h2 id="set-title">Hub</h2></div>
        <Segmented<FanCtl> label="Vitesse des ventilateurs pilotée par" value={fanCtl}
          onChange={v => { setFanCtl(v); umbra().setting(v) }}
          options={[{ value: 'fanControlBoard', label: 'Carte mère' }, { value: 'fanControlSoftware', label: 'Logiciel' }]} />
        <Segmented<Boot> label="Éclairage au démarrage" value={boot}
          onChange={v => { setBoot(v); umbra().setting(v) }}
          options={[{ value: 'bootEffectMemory', label: 'Dernier effet' }, { value: 'bootEffectFixed', label: 'Effet fixe' }]} />
        <Segmented<Check> label="Autotest des LED au démarrage" value={check}
          onChange={v => { setCheck(v); umbra().setting(v) }}
          options={[{ value: 'selfCheckOn', label: 'Activé' }, { value: 'selfCheckOff', label: 'Désactivé' }]} />
        {!s.connected && <p className="muted">Hub absent : les réglages ne sont pas envoyés.</p>}
      </section>
      <section className="card" aria-labelledby="safety-title">
        <div className="card-head"><h2 id="safety-title">Sécurité</h2><ShieldAlert size={20} className="muted" aria-hidden="true" /></div>
        <div className="banner">Le sens « carte mère / logiciel » est déduit de l'app Windows, pas encore vérifié sur le hub.
          Après un changement, vérifiez que la vitesse réagit.</div>
        <p className="muted">Les commandes de firmware (bootloader, mise à jour, sauvegarde en mémoire, réinitialisation)
          ne sont jamais envoyées par cette app.</p>
        <p className="muted mono">{s.node ?? 'aucun périphérique'} · ports {s.ports.join(' ') || '—'}</p>
      </section>
    </div>
  )
}
