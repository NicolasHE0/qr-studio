import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Create, type Draft } from './components/Create'
import { Library } from './components/Library'
import { Batch } from './components/Batch'
import { AccountPanel, Dynamic } from './components/Dynamic'
import { useToast } from './components/ui'
import { DEFAULT_STYLE } from './lib/qr'
import { PAYLOAD_BY_ID } from './lib/payloads'
import { clearProjects, deleteProject, deleteTemplate, listProjects, listTemplates, newId, saveProject, saveTemplate, sanitizeStyle, type QrProject, type StyleTemplate } from './lib/storage'
import { dynamicConfigured, getSession, onAuth, redirectUrl, type DynLink } from './lib/dynamic'

type Tab = 'create' | 'library' | 'batch' | 'dynamic' | 'account'

const blankDraft = (): Draft => ({ type: 'url', values: { ...PAYLOAD_BY_ID.url.defaults }, style: { ...DEFAULT_STYLE }, title: '', description: '', projectId: null, mode: 'static', dynamic: null })

function loadTheme(): 'light' | 'dark' {
  try { const t = localStorage.getItem('qrs-theme'); if (t === 'light' || t === 'dark') return t } catch { /* sin almacenamiento */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function App() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('create')
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [projects, setProjects] = useState<QrProject[]>([])
  const [templates, setTemplates] = useState<StyleTemplate[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [tplName, setTplName] = useState<string | null>(null)
  const [storageOk, setStorageOk] = useState(true)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('qrs-theme', theme) } catch { /* ignorar */ }
  }, [theme])

  const refresh = useCallback(async () => {
    try { setProjects(await listProjects()); setTemplates(await listTemplates()) } catch { setStorageOk(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void getSession().then(setSession).catch(() => {}); return onAuth(setSession) }, [])

  const save = async (d: Draft, content: string) => {
    const now = Date.now()
    const existing = d.projectId ? projects.find((p) => p.id === d.projectId) : undefined
    const p: QrProject = { id: existing?.id ?? newId(), title: d.title, description: d.description, favorite: existing?.favorite ?? false, type: d.type, values: d.values, content, style: d.style, createdAt: existing?.createdAt ?? now, updatedAt: now }
    try { await saveProject(p); setDraft((x) => ({ ...x, projectId: p.id, title: p.title })); await refresh(); toast(existing ? 'Cambios guardados' : 'Guardado en tu biblioteca') } catch { toast('No se pudo guardar. Revisá que el navegador permita almacenamiento local.', 'err') }
  }

  const edit = (p: QrProject) => { setDraft({ type: p.type, values: { ...p.values }, style: sanitizeStyle(p.style), title: p.title, description: p.description, projectId: p.id, mode: 'static', dynamic: null }); setTab('create'); window.scrollTo({ top: 0 }) }
  const duplicate = async (p: QrProject) => { const now = Date.now(); await saveProject({ ...p, id: newId(), title: `${p.title} (copia)`, favorite: false, createdAt: now, updatedAt: now }); await refresh(); toast('Duplicado. Abrilo para modificarlo.') }
  const toggleFav = async (p: QrProject) => { await saveProject({ ...p, favorite: !p.favorite }); await refresh() }
  const updateMeta = async (p: QrProject, title: string, description: string) => { await saveProject({ ...p, title, description, updatedAt: Date.now() }); await refresh() }
  const remove = async (p: QrProject) => { await deleteProject(p.id); await refresh(); toast('Eliminado') }
  const clear = async () => { await clearProjects(); await refresh(); toast('Historial borrado') }
  const doImport = async (ps: QrProject[], ts: StyleTemplate[]) => { for (const p of ps) await saveProject(p); for (const t of ts) await saveTemplate(t); await refresh() }

  const openDynamicInCreator = (l: DynLink) => {
    // Se abre en modo dinámico para personalizar el diseño; el contenido del QR es la URL estable.
    setDraft({ type: 'url', values: { url: l.destination }, style: sanitizeStyle(l.style ?? DEFAULT_STYLE), title: l.name, description: '', projectId: null, mode: 'dynamic', dynamic: l })
    setTab('create')
    toast(`Este QR apunta a ${redirectUrl(l.code)}`)
  }

  const nav: { id: Tab; label: string; count?: number }[] = [
    { id: 'create', label: 'Crear' }, { id: 'library', label: 'Biblioteca', count: projects.length },
    { id: 'batch', label: 'Lotes' }, { id: 'dynamic', label: 'Mis QR dinámicos' }, { id: 'account', label: session ? 'Cuenta' : 'Ingresar' },
  ]

  return (
    <>
      <a className="skip" href="#main">Saltar al contenido</a>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /><div>QR Studio<small>Privado · se genera en tu dispositivo</small></div></div>
          <nav className="nav" aria-label="Secciones">
            {nav.map((n) => <button key={n.id} type="button" aria-current={tab === n.id ? 'page' : undefined} onClick={() => setTab(n.id)}>{n.label}{n.count ? <span className="count">{n.count}</span> : null}</button>)}
          </nav>
          <button type="button" className="btn sm" aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </header>
      <main id="main">
        {!storageOk && <div className="issue warn" style={{ marginBottom: 16 }}>Tu navegador bloquea el almacenamiento local: la biblioteca y las plantillas no se podrán guardar en esta sesión.</div>}
        {tab === 'create' && <Create draft={draft} setDraft={setDraft} session={session} onSave={save} onSaveTemplate={() => setTplName('')} onGoDynamic={() => setTab('dynamic')} onOpenAccount={() => setTab('account')} />}
        {tab === 'library' && <Library projects={projects} templates={templates} onEdit={edit} onDuplicate={duplicate} onToggleFav={toggleFav} onUpdateMeta={updateMeta} onDelete={remove} onClear={clear} onImport={doImport} onNew={() => { setDraft(blankDraft()); setTab('create') }}
          onDeleteTemplate={async (t) => { await deleteTemplate(t.id); await refresh() }}
          onApplyTemplate={(t) => { setDraft((d) => ({ ...d, style: sanitizeStyle(t.style) })); setTab('create'); toast(`Plantilla "${t.name}" aplicada`) }} />}
        {tab === 'batch' && <Batch style={draft.style} />}
        {tab === 'dynamic' && <Dynamic session={session} style={draft.style} onOpenInCreator={openDynamicInCreator} />}
        {tab === 'account' && <div className="col"><AccountPanel session={session} />{!dynamicConfigured ? null : <p className="muted small">Tu cuenta solo guarda tus QR dinámicos y sus estadísticas opcionales. Los QR estáticos y tu biblioteca nunca salen de este dispositivo.</p>}</div>}
      </main>
      {tplName !== null && (
        <div className="dialog-bg"><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="tp-t" onSubmit={async (e) => { e.preventDefault(); const name = tplName.trim(); if (!name) return; await saveTemplate({ id: newId(), name: name.slice(0, 60), style: draft.style, createdAt: Date.now() }); await refresh(); setTplName(null); toast('Plantilla guardada') }}>
          <h2 id="tp-t">Guardar plantilla de estilo</h2>
          <div className="field"><label htmlFor="tpn">Nombre de la plantilla</label><input id="tpn" type="text" autoFocus maxLength={60} value={tplName} onChange={(e) => setTplName(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setTplName(null)}>Cancelar</button><button className="btn primary" disabled={!tplName.trim()}>Guardar</button></div>
        </form></div>
      )}
    </>
  )
}
