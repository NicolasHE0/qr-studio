import { useMemo, useRef, useState } from 'react'
import { PAYLOAD_BY_ID, type PayloadId, toFileName } from '../lib/payloads'
import { buildMatrix, renderSvg } from '../lib/qr'
import { downloadBlob, exportQr, DEFAULT_EXPORT, extensionOf, type ExportFormat } from '../lib/export'
import { exportJson, parseImport, type QrProject, type StyleTemplate } from '../lib/storage'
import { ConfirmDialog, download, useToast } from './ui'

function Thumb({ p }: { p: QrProject }) {
  const svg = useMemo(() => { try { return renderSvg(buildMatrix(p.content, p.style.ecc), p.style, 200) } catch { return '' } }, [p.content, p.style])
  return <div className="thumb" aria-hidden="true">{svg ? <div style={{ width: '100%', maxWidth: 150 }} dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="muted small">Sin vista previa</span>}</div>
}

export function Library({ projects, templates, onEdit, onDuplicate, onToggleFav, onUpdateMeta, onDelete, onClear, onImport, onDeleteTemplate, onApplyTemplate, onNew }: {
  projects: QrProject[]; templates: StyleTemplate[]
  onEdit: (p: QrProject) => void; onDuplicate: (p: QrProject) => void; onToggleFav: (p: QrProject) => void
  onUpdateMeta: (p: QrProject, title: string, description: string) => void
  onDelete: (p: QrProject) => void; onClear: () => void
  onImport: (projects: QrProject[], templates: StyleTemplate[]) => Promise<void>
  onDeleteTemplate: (t: StyleTemplate) => void; onApplyTemplate: (t: StyleTemplate) => void; onNew: () => void
}) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'all' | PayloadId>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'one'; p: QrProject } | { kind: 'all' }>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftMeta, setDraftMeta] = useState({ title: '', description: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return projects.filter((p) => (cat === 'all' || p.type === cat) && (!favOnly || p.favorite) &&
      (!s || p.title.toLowerCase().includes(s) || p.description.toLowerCase().includes(s) || p.content.toLowerCase().includes(s) || PAYLOAD_BY_ID[p.type].label.toLowerCase().includes(s)))
  }, [projects, q, cat, favOnly])

  const dl = async (p: QrProject, f: ExportFormat) => {
    try { downloadBlob(await exportQr(buildMatrix(p.content, p.style.ecc), p.style, { ...DEFAULT_EXPORT, format: f }), `${toFileName(p.title)}.${extensionOf(f)}`) } catch (e) { toast((e as Error).message || 'No se pudo descargar.', 'err') }
  }
  const importFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const r = parseImport(await f.text())
      await onImport(r.projects, r.templates)
      toast(`Importados ${r.projects.length} QR y ${r.templates.length} plantillas${r.skipped ? ` (${r.skipped} omitidos por inválidos)` : ''}`)
    } catch (e) { toast((e as Error).message, 'err') } finally { if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div className="col">
      <section className="card">
        <header>
          <h2>Mi biblioteca</h2>
          <div className="row">
            <button type="button" className="btn sm" disabled={!projects.length && !templates.length} onClick={() => download(exportJson(projects, templates), 'qr-studio-proyectos.json', 'application/json')}>Exportar JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="imp" onChange={(e) => importFile(e.target.files?.[0])} />
            <label htmlFor="imp" className="btn sm" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}>Importar JSON</label>
            <button type="button" className="btn sm danger" disabled={!projects.length} onClick={() => setConfirm({ kind: 'all' })}>Limpiar historial</button>
          </div>
        </header>
        <div className="row">
          <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="srch" className="sr-only">Buscar</label><input id="srch" type="search" placeholder="Buscar por nombre, contenido o categoría" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field"><label htmlFor="cat" className="sr-only">Categoría</label><select id="cat" value={cat} onChange={(e) => setCat(e.target.value as 'all' | PayloadId)}><option value="all">Todas las categorías</option>{Object.values(PAYLOAD_BY_ID).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <label className="check"><input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /><span>Solo favoritos</span></label>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Tu biblioteca se guarda solo en este navegador. Si borrás los datos del sitio se pierde: exportala a JSON para tener una copia.</p>
      </section>

      {projects.length === 0 ? (
        <div className="card empty"><b>Todavía no guardaste ningún QR</b><span>Creá uno y tocá "Guardar en la biblioteca".</span><button type="button" className="btn primary" onClick={onNew}>Crear un QR</button></div>
      ) : filtered.length === 0 ? (
        <div className="card empty"><b>Sin resultados</b><span>Probá con otra búsqueda o quitá los filtros.</span></div>
      ) : (
        <div className="lib-grid">
          {filtered.map((p) => (
            <article key={p.id} className="card lib-item">
              <Thumb p={p} />
              {editing === p.id ? (
                <div className="col">
                  <div className="field"><label htmlFor={`t-${p.id}`}>Título</label><input id={`t-${p.id}`} type="text" value={draftMeta.title} onChange={(e) => setDraftMeta({ ...draftMeta, title: e.target.value })} /></div>
                  <div className="field"><label htmlFor={`d-${p.id}`}>Descripción</label><input id={`d-${p.id}`} type="text" value={draftMeta.description} onChange={(e) => setDraftMeta({ ...draftMeta, description: e.target.value })} /></div>
                  <div className="row"><button type="button" className="btn sm primary" onClick={() => { onUpdateMeta(p, draftMeta.title.trim() || p.title, draftMeta.description); setEditing(null) }}>Guardar</button><button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancelar</button></div>
                </div>
              ) : (
                <div>
                  <div className="row between"><h3>{p.title}</h3><button type="button" className="btn sm" aria-pressed={p.favorite} aria-label={p.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'} onClick={() => onToggleFav(p)}>{p.favorite ? '★' : '☆'}</button></div>
                  <div className="row" style={{ marginTop: 4 }}><span className="badge gray">{PAYLOAD_BY_ID[p.type].label}</span><span className="small muted">{new Date(p.updatedAt).toLocaleDateString('es-AR')}</span></div>
                  {p.description && <p className="small muted" style={{ margin: '6px 0 0' }}>{p.description}</p>}
                  <p className="small mono muted" style={{ margin: '6px 0 0', overflowWrap: 'anywhere', maxHeight: 40, overflow: 'hidden' }}>{p.content.slice(0, 120)}</p>
                </div>
              )}
              <div className="row">
                <button type="button" className="btn sm primary" onClick={() => onEdit(p)}>Abrir y editar</button>
                <button type="button" className="btn sm" onClick={() => onDuplicate(p)}>Duplicar</button>
                <button type="button" className="btn sm" onClick={() => { setEditing(p.id); setDraftMeta({ title: p.title, description: p.description }) }}>Renombrar</button>
              </div>
              <div className="row">
                <button type="button" className="btn sm" onClick={() => dl(p, 'png')}>PNG</button><button type="button" className="btn sm" onClick={() => dl(p, 'svg')}>SVG</button><button type="button" className="btn sm" onClick={() => dl(p, 'pdf')}>PDF</button>
                <button type="button" className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={() => setConfirm({ kind: 'one', p })}>Eliminar</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="card">
        <header><h2>Plantillas de estilo</h2></header>
        {templates.length === 0 ? <p className="muted" style={{ margin: 0 }}>Todavía no guardaste plantillas. En la pantalla Crear, tocá "Guardar como plantilla" para reutilizar colores, formas y logo.</p> : (
          <div className="lib-grid">
            {templates.map((t) => (
              <div key={t.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="row between"><h3>{t.name}</h3></div>
                <div className="swatches" style={{ margin: '8px 0' }} aria-hidden="true"><span className="swatch" style={{ display: 'grid' }}><i style={{ background: t.style.fg }} /><i style={{ background: t.style.bg }} /></span></div>
                <div className="row"><button type="button" className="btn sm primary" onClick={() => onApplyTemplate(t)}>Aplicar</button><button type="button" className="btn sm danger" onClick={() => onDeleteTemplate(t)}>Eliminar</button></div>
              </div>
            ))}
          </div>
        )}
      </section>

      {confirm && (
        <ConfirmDialog danger title={confirm.kind === 'all' ? '¿Borrar todo el historial?' : '¿Eliminar este QR?'}
          body={confirm.kind === 'all' ? `Se eliminarán ${projects.length} QR de este navegador. Las plantillas se conservan. No se puede deshacer.` : `"${confirm.p.title}" se eliminará de tu biblioteca. No se puede deshacer.`}
          confirmLabel="Eliminar" onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm.kind === 'all') onClear(); else onDelete(confirm.p); setConfirm(null) }} />
      )}
    </div>
  )
}
