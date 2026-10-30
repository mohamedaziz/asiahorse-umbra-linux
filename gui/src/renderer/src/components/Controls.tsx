import { useId } from 'react'
import { hexToRgb, type RGB, rgbToHex } from '../api'

export function Slider({ label, value, min, max, step = 1, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; format?: (v: number) => string
}) {
  const id = useId()
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <span className="mono">{format ? format(value) : value}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  )
}

export function Colors({ label, colors, count, onChange }: {
  label: string; colors: RGB[]; count: number; onChange: (c: RGB[]) => void
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="colors">
        {colors.slice(0, count).map((c, i) => (
          <input key={i} className="color-input" type="color" aria-label={`${label} ${i + 1}`}
            value={rgbToHex(c)}
            onChange={e => { const next = [...colors]; next[i] = hexToRgb(e.target.value); onChange(next) }} />
        ))}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="seg" role="group" aria-label={label}>
        {options.map(o => (
          <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}
