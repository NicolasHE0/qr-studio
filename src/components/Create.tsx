import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { PAYLOAD_BY_ID, PAYLOAD_TYPES, type PayloadId, type Values, suggestName, toFileName } from '../lib/payloads'
import { QrCapacityError, buildMatrix, renderSvg, type QrMatrix, type QrStyle } from '../lib/qr'
import { USAGE_PRESETS, analyze, type QualityIssue } from '../lib/quality'
import { scanTestSvg, type ScanTest } from '../lib/verify'
import { DEFAULT_EXPORT, PAPER_MM, downloadBlob, exportInfo, exportQr, extensionOf, type ExportFormat, type ExportOptions } from '../lib/export'
import { dynamicConfigured, createLink, updateLink, redirectUrl, friendly, CATEGORIES, validateDestination, type DynLink } from '../lib/dynamic'
import { ContentForm } from './ContentForm'
import { StyleEditor } from './StyleEditor'
import { CopyButton, Spinner, useToast } from './ui'

export interface Draft {
  type: PayloadId
  values: Values
  style: QrStyle
  title: string
  description: string
  projectId: string | null
  mode: 'static' | 'dynamic'
  dynamic: DynLink | null
}

const DYNAMIC_TYPES: PayloadId[] = ['url', 'social', 'whatsapp', 'location']

export function Create({ draft, setDraft, session, onSave, onSaveTemplate, onGoDynamic, onOpenAccount }: {
  draft: Draft
  setDraft: (d: Draft | ((p: Draft) => Draft)) => void
  session: Session | null
  onSave: (d: Draft, content: string) => Promise<void>
  onSaveTemplate: () => void
  onGoDynamic: () => void
  onOpenAccount: () => void
}) {
  const toast = useToast()
  const type = PAYLOAD_BY_ID[draft.type]
  const [showErrors, setShowErrors] = useState(false)
  const [quick, setQuick] = useState(false)
  const [stage, setStage] = useState<'light' | 'dark' | 'checker'>('light')
  const [exp, setExp] = useState<ExportOptions>(DEFAULT_EXPORT)
  const [busy, setBusy] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanTest | 'running' | null>(null)
  const [usage, setUsage] = useState<string>('')
  const [dynMeta, setDynMeta] = useState({ category: 'Web', stats: false })

  const built = useMemo(() => type.build({ ...type.defaults, ...draft.values }), [type, draft.values])
  const errors = built.ok ? {} : built.errors
  const staticContent = built.ok ? built.content : ''
  const isDynamic = draft.mode === 'dynamic'
  const destValid = built.ok && /^https:\/\//i.test(built.content) ? validateDestination(built.content) : null
  const content = isDynamic ? (draft.dynamic ? redirectUrl(draft.dynamic.code) : '') : staticContent

  const style = useDeferredValue(draft.style)
  const { matrix, capacityError } = useMemo((): { matrix: QrMatrix | null; capacityError: boolean } => {
    if (!content) return { matrix: null, capacityError: false }
    try { return { matrix: buildMatrix(content, style.ecc), capacityError: false } } catch (e) { return { matrix: null, capacityError: e instanceof QrCapacityError } }
  }, [content, style.ecc])
  const svg = useMemo(() => (matrix ? renderSvg(matrix, style, 512) : ''), [matrix, style])
  const issues: QualityIssue[] = useMemo(() => analyze({ content, matrix, style, printMm: exp.printMm, capacityError }), [content, matrix, style, exp.printMm, capacityError])
  const hasError = issues.some((i) => i.severity === 'error')
  const baseName = draft.title.trim() || suggestName(type, draft.values)

  useEffect(() => { setScan(null) }, [svg])

  const setStyle = (s: QrStyle) => setDraft((d) => ({ ...d, style: s }))
  const applyFix = (i: QualityIssue) => {
    if (i.fix?.style) setDraft((d) => ({ ...d, style: { ...d.style, ...i.fix!.style } }))
    if (i.fix?.printMm) setExp((e) => ({ ...e, printMm: i.fix!.printMm! }))
  }

  const changeType = (id: PayloadId) => {
    const t = PAYLOAD_BY_ID[id]
    setShowErrors(false)
    setDraft((d) => ({ ...d, type: id, values: { ...t.defaults }, dynamic: null, projectId: null, mode: d.mode === 'dynamic' && !DYNAMIC_TYPES.includes(id) ? 'static' : d.mode }))
  }
  const setMode = (m: 'static' | 'dynamic') => {
    setDraft((d) => ({ ...d, mode: m, type: m === 'dynamic' && !DYNAMIC_TYPES.includes(d.type) ? 'url' : d.type, values: m === 'dynamic' && !DYNAMIC_TYPES.includes(d.type) ? { ...PAYLOAD_BY_ID.url.defaults } : d.values, dynamic: null, projectId: null }))
  }

  const fillExample = () => setDraft((d) => ({ ...d, values: { ...type.defaults, ...type.example } }))

  const doExport = async (format: ExportFormat) => {
    if (!matrix || hasError) { setShowErrors(true); toast('Corregí los problemas marcados antes de descargar.', 'err'); return }
    setBusy(format)
    try {
      const blob = await exportQr(matrix, draft.style, { ...exp, format })
      downloadBlob(blob, `${toFileName(baseName)}.${extensionOf(format)}`)
      toast(`Descargaste ${format.toUpperCase()}`)
    } catch (e) { toast((e as Error).message || 'No se pudo generar el archivo.', 'err') } finally { setBusy(null) }
  }

  const runScan = async () => {
    if (!svg || !content) return
    setScan('running')
    try { setScan(await scanTestSvg(renderSvg(matrix!, draft.style, 640), content)) } catch { setScan({ status: 'fail' }) }
  }

  const save = async () => {
    if (!content) { setShowErrors(true); toast('Primero completá el contenido.', 'err'); return }
    await onSave({ ...draft, title: baseName }, content)
  }

  // --- QR dinámico
  const createDynamic = async () => {
    setShowErrors(true)
    if (!destValid) { toast('El destino debe ser un enlace https:// válido.', 'err'); return }
    if (!destValid.ok) { toast(destValid.error, 'err'); return }
    setBusy('dyn')
    try {
      const link = await createLink({ name: baseName, category: dynMeta.category, destination: destValid.url, stats_enabled: dynMeta.stats, style: draft.style })
      setDraft((d) => ({ ...d, dynamic: link, title: d.title || link.name }))
      toast('QR dinámico creado. El código apunta a una dirección estable.')
    } catch (e) { toast(friendly(e), 'err') } finally { setBusy(null) }
  }
  const updateDynamicDestination = async () => {
    if (!draft.dynamic || !destValid || !destValid.ok) { toast('El destino debe ser un enlace https:// válido.', 'err'); return }
    setBusy('dyn')
    try { const l = await updateLink(draft.dynamic.id, { destination: destValid.url }); setDraft((d) => ({ ...d, dynamic: l })); toast('Destino actualizado. El QR no cambió.') }
    catch (e) { toast(friendly(e), 'err') } finally { setBusy(null) }
  }

  const info = matrix ? exportInfo(matrix, draft.style, exp.widthPx) : null
  const preset = USAGE_PRESETS.find((p) => p.id === usage)

  return (
    <div className="workspace">
      <div className="col">
        <section className="card" aria-labelledby="mode-t">
          <header>
            <h2 id="mode-t">1. Tipo de código</h2>
            <div className="seg" role="group" aria-label="Modo">
              <button type="button" aria-pressed={!quick} onClick={() => setQuick(false)}>Avanzado</button>
              <button type="button" aria-pressed={quick} onClick={() => { setQuick(true); setMode('static'); changeType('url') }}>Rápido</button>
            </div>
          </header>
          {!quick && (
            <>
              <div className="seg" role="group" aria-label="Estático o dinámico" style={{ marginBottom: 12 }}>
                <button type="button" aria-pressed={!isDynamic} onClick={() => setMode('static')}>QR estático</button>
                <button type="button" aria-pressed={isDynamic} onClick={() => setMode('dynamic')}>QR dinámico</button>
              </div>
              <div className="grid-compare" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 14 }}>
                <div className="issue info"><b>Estático</b><span>Guarda el contenido directamente en el código. Funciona sin internet y para siempre, gratis y privado. Si el contenido cambia, hay que generar y reimprimir otro QR.</span></div>
                <div className="issue info"><b>Dinámico</b><span>Guarda una dirección corta de redirección; podés cambiar el destino sin reimprimir. Requiere cuenta, un servicio en línea configurado y que ese servicio siga funcionando. Solo para destinos https://.</span></div>
              </div>
              <div className="type-grid">
                {PAYLOAD_TYPES.filter((t) => !isDynamic || DYNAMIC_TYPES.includes(t.id)).map((t) => (
                  <button key={t.id} type="button" className="type-btn" aria-pressed={draft.type === t.id} onClick={() => changeType(t.id)}>
                    <b>{t.label}</b><span>{t.description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="form-t">
          <header>
            <h2 id="form-t">2. Contenido</h2>
            <button type="button" className="link" onClick={fillExample}>Completar con un ejemplo</button>
          </header>
          <ContentForm type={type} values={draft.values} errors={errors} showErrors={showErrors} onChange={(v) => setDraft((d) => ({ ...d, values: v }))} />
          {!quick && (
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field"><label htmlFor="qname">Nombre (para tu biblioteca y los archivos)</label><input id="qname" type="text" maxLength={120} value={draft.title} placeholder={suggestName(type, draft.values)} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></div>
              <div className="field"><label htmlFor="qdesc">Descripción (opcional)</label><input id="qdesc" type="text" maxLength={500} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></div>
            </div>
          )}
          {isDynamic && (
            <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)', boxShadow: 'none' }}>
              {!dynamicConfigured ? (
                <div className="issue warn"><b>Los QR dinámicos todavía no están conectados.</b><span>Hace falta configurar el servicio (Supabase) y las variables de entorno. Mientras tanto no se puede crear ninguno y no se muestra ningún QR de prueba. Los pasos están en el README.</span></div>
              ) : !session ? (
                <div className="issue info"><b>Iniciá sesión para crear QR dinámicos.</b><button type="button" className="btn primary" onClick={onOpenAccount}>Iniciar sesión</button></div>
              ) : draft.dynamic ? (
                <div className="col">
                  <div className="issue ok"><b>QR dinámico creado</b><span className="url-box mono">{redirectUrl(draft.dynamic.code)}</span><span>Esta dirección no cambia. Si modificás el destino de arriba, tocá "Actualizar destino": el QR impreso sigue sirviendo.</span></div>
                  <div className="row"><button type="button" className="btn primary" disabled={busy === 'dyn'} onClick={updateDynamicDestination}>{busy === 'dyn' ? <Spinner /> : null} Actualizar destino</button><button type="button" className="btn" onClick={onGoDynamic}>Ir a Mis QR dinámicos</button></div>
                </div>
              ) : (
                <div className="col">
                  <div className="form-grid">
                    <div className="field"><label htmlFor="dcat">Categoría</label><select id="dcat" value={dynMeta.category} onChange={(e) => setDynMeta({ ...dynMeta, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                    <label className="check"><input type="checkbox" checked={dynMeta.stats} onChange={(e) => setDynMeta({ ...dynMeta, stats: e.target.checked })} /><span>Registrar estadísticas de visitas (opcional)</span></label>
                  </div>
                  {dynMeta.stats && <p className="small muted" style={{ margin: 0 }}>Se guarda fecha, tipo de dispositivo y si parece un robot. No se guarda la IP ni se identifica a las personas. Podés desactivarlo y borrar los datos cuando quieras.</p>}
                  <button type="button" className="btn primary" disabled={busy === 'dyn'} onClick={createDynamic}>{busy === 'dyn' ? <Spinner /> : null} Crear QR dinámico</button>
                  {!destValid && staticContent && <div className="issue warn">El destino debe empezar con https://</div>}
                </div>
              )}
            </div>
          )}
        </section>

        {!quick && <StyleEditor style={draft.style} onChange={setStyle} onSaveTemplate={onSaveTemplate} />}
      </div>

      <aside className="sticky" aria-label="Vista previa y descargas">
        <section className="card" aria-labelledby="pv-t">
          <header>
            <h2 id="pv-t">Vista previa</h2>
            <div className="seg" role="group" aria-label="Fondo de la vista previa">
              <button type="button" aria-pressed={stage === 'light'} onClick={() => setStage('light')}>Claro</button>
              <button type="button" aria-pressed={stage === 'dark'} onClick={() => setStage('dark')}>Oscuro</button>
              <button type="button" aria-pressed={stage === 'checker'} onClick={() => setStage('checker')}>Transp.</button>
            </div>
          </header>
          <div className={`preview-stage ${stage}`} role="img" aria-label={svg ? 'Vista previa del código QR' : 'Todavía no hay código para mostrar'}>
            {svg ? <div style={{ width: '100%', maxWidth: 340 }} dangerouslySetInnerHTML={{ __html: svg }} /> : (
              <div className="preview-empty">
                {isDynamic && !draft.dynamic ? 'Creá el QR dinámico para ver el código.' : capacityError ? 'El contenido no entra en un QR.' : 'Completá el contenido y el código aparece acá, en tiempo real.'}
              </div>
            )}
          </div>
          {matrix && <div className="preview-meta"><span className="pill">Versión {matrix.version}</span><span className="pill">{matrix.n}×{matrix.n} módulos</span><span className="pill">Corrección {draft.style.ecc}</span><span className="pill">{isDynamic ? 'Dinámico' : 'Estático'}</span></div>}
          <div className="row" style={{ marginTop: 12 }}>
            <CopyButton text={content} label="Copiar contenido" />
            <button type="button" className="btn sm" disabled={!matrix || scan === 'running'} onClick={runScan}>{scan === 'running' ? <Spinner /> : null} Probar escaneo</button>
          </div>
          {scan && scan !== 'running' && (
            <div className={`issue ${scan.status === 'ok' ? 'ok' : 'error'}`} style={{ marginTop: 10 }} role="status">
              {scan.status === 'ok' && <span><b>Prueba automática superada.</b> Un decodificador de software leyó este diseño y obtuvo el contenido correcto. No reemplaza probarlo con tu celular, sobre todo si lo vas a imprimir.</span>}
              {scan.status === 'mismatch' && <span><b>El decodificador leyó otro contenido.</b> No uses este diseño.</span>}
              {scan.status === 'fail' && <span><b>El decodificador no pudo leerlo.</b> Eso no prueba que falle en un celular, pero es una señal de alerta: simplificá el diseño o aumentá contraste y corrección.</span>}
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="q-t">
          <header><h2 id="q-t">Control de calidad</h2></header>
          {issues.length === 0 ? <div className="issue ok">Todo en orden: contraste, margen y densidad son adecuados.</div> : (
            <ul className="issues">
              {issues.map((i) => (
                <li key={i.id} className={`issue ${i.severity}`}>
                  <span>{i.severity === 'error' ? '⛔ ' : i.severity === 'warn' ? '⚠️ ' : 'ℹ️ '}{i.message}</span>
                  {i.fix && <button type="button" className="btn sm" onClick={() => applyFix(i)}>{i.fix.label}</button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="dl-t">
          <header><h2 id="dl-t">Descargar</h2></header>
          <div className="form-grid">
            <div className="field"><label htmlFor="res">Resolución (PNG/JPG)</label>
              <select id="res" value={exp.widthPx} onChange={(e) => setExp({ ...exp, widthPx: Number(e.target.value) })}>{[512, 1024, 2048, 4096].map((v) => <option key={v} value={v}>{v} px</option>)}</select>
              {info && <span className="help">{info.heightPx} px de alto · {info.modulepx.toFixed(1)} px por módulo</span>}</div>
            <div className="field"><label htmlFor="mm">Tamaño impreso (mm)</label><input id="mm" type="number" min={10} max={400} value={exp.printMm} onChange={(e) => setExp({ ...exp, printMm: Math.min(400, Math.max(10, Number(e.target.value) || 10)) })} /></div>
          </div>
          <details className="adv"><summary>Opciones de PDF y JPG</summary>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div className="field"><label htmlFor="paper">Papel</label><select id="paper" value={exp.paper} onChange={(e) => setExp({ ...exp, paper: e.target.value })}>{Object.keys(PAPER_MM).map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select></div>
              <div className="field"><label htmlFor="pm">Márgenes del PDF (mm)</label><input id="pm" type="number" min={5} max={50} value={exp.pdfMarginMm} onChange={(e) => setExp({ ...exp, pdfMarginMm: Math.min(50, Math.max(5, Number(e.target.value) || 5)) })} /></div>
              <div className="field"><label htmlFor="jq">Calidad JPG: {Math.round(exp.jpegQuality * 100)} %</label><input id="jq" type="range" min={0.5} max={1} step={0.05} value={exp.jpegQuality} onChange={(e) => setExp({ ...exp, jpegQuality: Number(e.target.value) })} /></div>
            </div>
            <p className="small muted">El PDF contiene una imagen de alta resolución (300 ppp al tamaño elegido). Para impresión vectorial usá SVG. El JPG no admite transparencia.</p>
          </details>
          <div className="row" style={{ marginTop: 12 }}>
            {(['png', 'svg', 'jpeg', 'pdf'] as ExportFormat[]).map((f) => (
              <button key={f} type="button" className={`btn ${f === 'png' ? 'primary' : ''}`} disabled={!matrix || busy !== null} onClick={() => doExport(f)}>{busy === f ? <Spinner /> : null} {f === 'jpeg' ? 'JPG' : f.toUpperCase()}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" disabled={!content} onClick={save}>{draft.projectId ? 'Guardar cambios en la biblioteca' : 'Guardar en la biblioteca'}</button></div>
          <p className="small muted" style={{ marginBottom: 0 }}>Se descargará como <code>{toFileName(baseName)}.{extensionOf(exp.format)}</code></p>
        </section>

        {!quick && (
          <section className="card" aria-labelledby="as-t">
            <header><h2 id="as-t">Asistente de uso</h2></header>
            <div className="field"><label htmlFor="usage">¿Dónde lo vas a usar?</label>
              <select id="usage" value={usage} onChange={(e) => setUsage(e.target.value)}><option value="">Elegí un destino…</option>{USAGE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            {preset && (
              <div className="col" style={{ marginTop: 10 }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{preset.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                <button type="button" className="btn sm" onClick={() => { setDraft((d) => ({ ...d, style: { ...d.style, ...preset.style, ecc: d.style.logo ? 'H' : preset.ecc, margin: preset.margin } })); setExp((e) => ({ ...e, printMm: preset.printMm })); toast('Ajustes recomendados aplicados') }}>Aplicar ajustes recomendados</button>
              </div>
            )}
          </section>
        )}
      </aside>

      <div className="mobile-bar">
        <div className="mini" aria-hidden="true">{svg ? <div style={{ width: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} /> : null}</div>
        <button type="button" className="btn primary grow" disabled={!matrix || busy !== null} onClick={() => doExport('png')}>Descargar PNG</button>
        <button type="button" className="btn" onClick={() => document.getElementById('pv-t')?.scrollIntoView({ behavior: 'smooth' })}>Ver</button>
      </div>
    </div>
  )
}
