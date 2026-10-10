import { useId } from 'react'
import { type PayloadType, type Values, visibleFields } from '../lib/payloads'

export function ContentForm({ type, values, errors, showErrors, onChange }: {
  type: PayloadType
  values: Values
  errors: Record<string, string>
  showErrors: boolean
  onChange: (v: Values) => void
}) {
  const uid = useId()
  const set = (k: string, v: string) => onChange({ ...values, [k]: v })
  const fields = visibleFields(type, values)
  return (
    <div className="form-grid">
      {fields.map((f, i) => {
        const id = `${uid}-${f.key}-${i}`
        const err = showErrors ? errors[f.key] : undefined
        const val = values[f.key] ?? ''
        const common = { id, 'aria-invalid': err ? true : undefined, 'aria-describedby': `${id}-d` } as const
        const wide = f.type === 'textarea' || f.type === 'url'
        let control
        if (f.type === 'textarea') control = <textarea {...common} value={val} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
        else if (f.type === 'select') control = (
          <select {...common} value={val} onChange={(e) => set(f.key, e.target.value)}>
            {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )
        else if (f.type === 'checkbox') control = (
          <label className="check" htmlFor={id}>
            <input id={id} type="checkbox" checked={val === 'true'} onChange={(e) => set(f.key, e.target.checked ? 'true' : '')} />
            <span>{f.label}</span>
          </label>
        )
        else control = <input {...common} type={f.type === 'url' ? 'text' : f.type} inputMode={f.type === 'url' ? 'url' : f.type === 'tel' ? 'tel' : undefined} autoComplete="off" value={val} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
        return (
          <div className="field" key={`${f.key}-${i}`} style={wide ? { gridColumn: '1 / -1' } : undefined}>
            {f.type !== 'checkbox' && <label htmlFor={id}>{f.label}{f.required && <span className="req" aria-hidden="true"> *</span>}</label>}
            {control}
            <div id={`${id}-d`}>
              {err ? <div className="err" role="alert">{err}</div> : f.help ? <div className="help">{f.help}</div> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
