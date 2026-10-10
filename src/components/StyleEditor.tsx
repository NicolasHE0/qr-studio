import { useId, useRef, useState } from 'react'
import { DEFAULT_STYLE, type EyeBallShape, type EyeFrameShape, type ModuleShape, type QrStyle } from '../lib/qr'
import { ECC_LABELS } from '../lib/quality'
import { PALETTES, applyPalette } from '../lib/palettes'
import { useToast } from './ui'

const MODULES: { v: ModuleShape; l: string; d: string }[] = [
  { v: 'square', l: 'Cuadrado', d: 'M4 4h12v12H4zM20 4h12v12H20zM4 20h12v12H4zM20 20h12v12H20z' },
  { v: 'rounded', l: 'Redondeado', d: 'M8 4h4a4 4 0 014 4v4a4 4 0 01-4 4H8a4 4 0 01-4-4V8a4 4 0 014-4zM24 4h4a4 4 0 014 4v4a4 4 0 01-4 4h-4a4 4 0 01-4-4V8a4 4 0 014-4zM8 20h4a4 4 0 014 4v4a4 4 0 01-4 4H8a4 4 0 01-4-4v-4a4 4 0 014-4zM24 20h4a4 4 0 014 4v4a4 4 0 01-4 4h-4a4 4 0 01-4-4v-4a4 4 0 014-4z' },
  { v: 'dots', l: 'Puntos', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zM26 4a6 6 0 100 12 6 6 0 000-12zM10 20a6 6 0 100 12 6 6 0 000-12zM26 20a6 6 0 100 12 6 6 0 000-12z' },
  { v: 'diamond', l: 'Rombo', d: 'M10 3l7 7-7 7-7-7zM26 3l7 7-7 7-7-7zM10 19l7 7-7 7-7-7zM26 19l7 7-7 7-7-7z' },
  { v: 'vertical', l: 'Barras V', d: 'M5 4h10v28H5zM21 4h10v14H21z' },
  { v: 'horizontal', l: 'Barras H', d: 'M4 5h28v10H4zM4 21h14v10H4z' },
]
const FRAMES: { v: EyeFrameShape; l: string }[] = [
  { v: 'square', l: 'Cuadrado' }, { v: 'rounded', l: 'Redondeado' }, { v: 'circle', l: 'Círculo' }, { v: 'leaf', l: 'Hoja' },
]
const BALLS: { v: EyeBallShape; l: string }[] = [
  { v: 'square', l: 'Cuadrado' }, { v: 'rounded', l: 'Redondeado' }, { v: 'circle', l: 'Círculo' }, { v: 'diamond', l: 'Rombo' },
]

function Shape({ d, ...rest }: { d: string }) { return <svg viewBox="0 0 36 36" aria-hidden="true" {...rest}><path d={d} fill="currentColor" /></svg> }
const frameD: Record<EyeFrameShape, string> = {
  square: 'M3 3h30v30H3zM9 9v18h18V9z',
  rounded: 'M11 3h14a8 8 0 018 8v14a8 8 0 01-8 8H11a8 8 0 01-8-8V11a8 8 0 018-8zM13 9a4 4 0 00-4 4v10a4 4 0 004 4h10a4 4 0 004-4V13a4 4 0 00-4-4z',
  circle: 'M18 3a15 15 0 100 30 15 15 0 000-30zM18 9a9 9 0 110 18 9 9 0 010-18z',
  leaf: 'M15 3h18v18a12 12 0 01-12 12H3V15A12 12 0 0115 3zM15 9a6 6 0 00-6 6v12h12a6 6 0 006-6V9z',
}
const ballD: Record<EyeBallShape, string> = {
  square: 'M8 8h20v20H8z', rounded: 'M14 8h8a6 6 0 016 6v8a6 6 0 01-6 6h-8a6 6 0 01-6-6v-8a6 6 0 016-6z',
  circle: 'M18 6a12 12 0 100 24 12 12 0 000-24z', diamond: 'M18 4l14 14-14 14L4 18z',
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row"><input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} /><span className="mono muted">{value}</span></div>
    </div>
  )
}

function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}: <b>{fmt ? fmt(value) : value}</b></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

/** Reduce el logo a 256 px y lo convierte en PNG: quita metadatos y limita el peso. */
async function prepareLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Usá una imagen PNG, JPG, WebP o GIF.')
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen pesa más de 5 MB.')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('No se pudo leer la imagen.')); img.src = url })
    const max = 256
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } finally { URL.revokeObjectURL(url) }
}

export function StyleEditor({ style, onChange, onSaveTemplate }: { style: QrStyle; onChange: (s: QrStyle) => void; onSaveTemplate: () => void }) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<QrStyle>) => onChange({ ...style, ...p })

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const dataUrl = await prepareLogo(f)
      set({ ecc: style.ecc === 'L' || style.ecc === 'M' ? 'H' : style.ecc, logo: { dataUrl, size: 0.2, padding: 1, background: '#ffffff', shape: 'square' } })
      toast('Logo agregado. Subimos la corrección de errores para compensar.')
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <section className="card" aria-labelledby="ed-t">
      <header>
        <h2 id="ed-t">Personalización</h2>
        <div className="row">
          <button type="button" className="btn sm" onClick={onSaveTemplate}>Guardar como plantilla</button>
          <button type="button" className="btn sm" onClick={() => onChange({ ...DEFAULT_STYLE })}>Restablecer</button>
        </div>
      </header>

      <div className="col">
        <div>
          <div className="lbl" id="pal">Paletas</div>
          <div className="swatches" role="group" aria-labelledby="pal">
            {PALETTES.map((p) => (
              <button key={p.id} type="button" className="swatch" title={p.name} aria-label={p.name} aria-pressed={style.fg === p.fg && style.bg === p.bg} onClick={() => set(applyPalette(p))}>
                <i style={{ background: p.fg2 ? `linear-gradient(135deg, ${p.fg}, ${p.fg2})` : p.fg }} /><i style={{ background: p.bg }} />
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid">
          <ColorField label="Color del QR" value={style.fg} onChange={(v) => set({ fg: v })} />
          <ColorField label="Color de fondo" value={style.bg} onChange={(v) => set({ bg: v })} />
          <div className="field">
            <label htmlFor="grad">Relleno</label>
            <select id="grad" value={style.gradient} onChange={(e) => set({ gradient: e.target.value as QrStyle['gradient'] })}>
              <option value="none">Color sólido</option><option value="linear">Degradado lineal</option><option value="radial">Degradado radial</option>
            </select>
          </div>
          {style.gradient !== 'none' && <ColorField label="Segundo color" value={style.fg2} onChange={(v) => set({ fg2: v })} />}
          {style.gradient === 'linear' && <Range label="Ángulo" value={style.gradientAngle} min={0} max={360} step={15} onChange={(v) => set({ gradientAngle: v })} fmt={(v) => `${v}°`} />}
        </div>
        <label className="check"><input type="checkbox" checked={style.transparent} onChange={(e) => set({ transparent: e.target.checked })} /><span>Fondo transparente (PNG y SVG)</span></label>

        <div>
          <div className="lbl" id="mods">Estilo de los módulos</div>
          <div className="shape-grid" role="group" aria-labelledby="mods">
            {MODULES.map((m) => <button key={m.v} type="button" className="shape-btn" aria-pressed={style.moduleShape === m.v} onClick={() => set({ moduleShape: m.v })}><Shape d={m.d} />{m.l}</button>)}
          </div>
        </div>
        <div>
          <div className="lbl" id="efr">Marco de las esquinas</div>
          <div className="shape-grid" role="group" aria-labelledby="efr">
            {FRAMES.map((m) => <button key={m.v} type="button" className="shape-btn" aria-pressed={style.eyeFrame === m.v} onClick={() => set({ eyeFrame: m.v })}><Shape d={frameD[m.v]} />{m.l}</button>)}
          </div>
        </div>
        <div>
          <div className="lbl" id="eba">Centro de las esquinas</div>
          <div className="shape-grid" role="group" aria-labelledby="eba">
            {BALLS.map((m) => <button key={m.v} type="button" className="shape-btn" aria-pressed={style.eyeBall === m.v} onClick={() => set({ eyeBall: m.v })}><Shape d={ballD[m.v]} />{m.l}</button>)}
          </div>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={style.eyeColor !== ''} onChange={(e) => set({ eyeColor: e.target.checked ? style.fg : '' })} /><span>Color propio para las esquinas</span></label>
          {style.eyeColor !== '' && <input type="color" aria-label="Color de las esquinas" value={style.eyeColor} onChange={(e) => set({ eyeColor: e.target.value })} />}
        </div>

        <details className="adv" open={!!style.logo}>
          <summary>Logotipo</summary>
          <div className="col" style={{ marginTop: 8 }}>
            <div className="row">
              <input ref={fileRef} id="logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              <label htmlFor="logo-file" className="btn" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}>{busy ? 'Procesando…' : style.logo ? 'Cambiar imagen' : 'Subir imagen'}</label>
              {style.logo && <button type="button" className="btn danger" onClick={() => set({ logo: null })}>Quitar logo</button>}
            </div>
            <p className="help muted small" style={{ margin: 0 }}>La imagen se procesa en tu dispositivo y no se envía a ningún servidor.</p>
            {style.logo && (
              <div className="form-grid">
                <Range label="Tamaño" value={Math.round(style.logo.size * 100)} min={10} max={35} step={1} onChange={(v) => set({ logo: { ...style.logo!, size: v / 100 } })} fmt={(v) => `${v} %`} />
                <Range label="Margen" value={style.logo.padding} min={0} max={3} step={0.5} onChange={(v) => set({ logo: { ...style.logo!, padding: v } })} fmt={(v) => `${v} módulos`} />
                <div className="field"><label htmlFor="lshape">Forma</label>
                  <select id="lshape" value={style.logo.shape} onChange={(e) => set({ logo: { ...style.logo!, shape: e.target.value as 'square' | 'circle' } })}><option value="square">Cuadrada</option><option value="circle">Circular</option></select></div>
                <div className="field"><label htmlFor="lbg">Fondo del logo</label>
                  <div className="row"><input id="lbg" type="color" value={style.logo.background === 'transparent' ? '#ffffff' : style.logo.background} disabled={style.logo.background === 'transparent'} onChange={(e) => set({ logo: { ...style.logo!, background: e.target.value } })} />
                    <label className="check"><input type="checkbox" checked={style.logo.background === 'transparent'} onChange={(e) => set({ logo: { ...style.logo!, background: e.target.checked ? 'transparent' : '#ffffff' } })} /><span>Sin fondo</span></label></div></div>
              </div>
            )}
          </div>
        </details>

        <details className="adv">
          <summary>Composición y corrección de errores</summary>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <Range label="Margen libre" value={style.margin} min={0} max={10} step={1} onChange={(v) => set({ margin: v })} fmt={(v) => `${v} módulos`} />
            <div className="field"><label htmlFor="ecc">Corrección de errores</label>
              <select id="ecc" value={style.ecc} onChange={(e) => set({ ecc: e.target.value as QrStyle['ecc'] })}>{(Object.keys(ECC_LABELS) as (keyof typeof ECC_LABELS)[]).map((k) => <option key={k} value={k}>{ECC_LABELS[k]}</option>)}</select>
              <span className="help">Más corrección tolera más daño o logo, pero el código es más denso.</span></div>
            <div className="field"><label htmlFor="frame">Marco exterior</label>
              <select id="frame" value={style.frame} onChange={(e) => set({ frame: e.target.value as QrStyle['frame'] })}><option value="none">Sin marco</option><option value="simple">Marco simple</option><option value="rounded">Marco redondeado</option></select></div>
            {style.frame !== 'none' && <ColorField label="Color del marco" value={style.frameColor} onChange={(v) => set({ frameColor: v })} />}
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ttl">Título o instrucción (opcional)</label>
              <input id="ttl" type="text" maxLength={48} value={style.title} placeholder="Escaneame" onChange={(e) => set({ title: e.target.value })} /></div>
            {style.title.trim() && <>
              <div className="field"><label htmlFor="tpos">Posición del título</label><select id="tpos" value={style.titlePosition} onChange={(e) => set({ titlePosition: e.target.value as 'top' | 'bottom' })}><option value="bottom">Abajo</option><option value="top">Arriba</option></select></div>
              {(style.frame === 'none' || style.transparent) && <ColorField label="Color del título" value={style.titleColor} onChange={(v) => set({ titleColor: v })} />}
            </>}
          </div>
        </details>
      </div>
    </section>
  )
}
