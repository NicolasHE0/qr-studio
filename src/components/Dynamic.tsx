import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  CATEGORIES, checkRedirect, createLink, deleteHits, deleteLink, dynamicConfigured, friendly, listHits, listLinks, redirectBase, redirectUrl,
  signIn, signOut, signUp, summarize, updateLink, validateDestination, type CheckResult, type DynLink, type Hit,
} from '../lib/dynamic'
import { buildMatrix, type QrStyle } from '../lib/qr'
import { DEFAULT_EXPORT, downloadBlob, exportQr } from '../lib/export'
import { toFileName } from '../lib/payloads'
import { sanitizeStyle } from '../lib/storage'
import { ConfirmDialog, CopyButton, Spinner, useToast } from './ui'

export function SetupNotice() {
  return (
    <div className="card">
      <h2>QR dinámicos: falta conectar el servicio</h2>
      <p>Los QR dinámicos necesitan un servicio en línea (base de datos, cuentas y una función de redirección). Esta copia de QR Studio todavía no está conectada a ninguno, así que <b>no se puede crear ni administrar ningún QR dinámico</b> y no se muestran datos de ejemplo.</p>
      <ol>
        <li>Creá un proyecto en Supabase (el plan gratuito alcanza para empezar).</li>
        <li>Ejecutá <code>supabase/migrations/001_init.sql</code> en el editor SQL.</li>
        <li>Desplegá la función: <code>supabase functions deploy r --no-verify-jwt</code>.</li>
        <li>Copiá <code>.env.example</code> a <code>.env.local</code> con la URL y la clave pública del proyecto y reiniciá.</li>
      </ol>
      <p className="muted small" style={{ marginBottom: 0 }}>Guía completa, costos y límites en el README. Los QR estáticos funcionan igual, sin servidor.</p>
    </div>
  )
}

export function AccountPanel({ session }: { session: Session | null }) {
  const toast = useToast()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  if (!dynamicConfigured) return <SetupNotice />
  if (session) {
    return (
      <div className="card"><div className="row between"><div><b>Sesión iniciada</b><div className="muted small">{session.user.email}</div></div><button type="button" className="btn" onClick={() => signOut().then(() => toast('Sesión cerrada'))}>Cerrar sesión</button></div></div>
    )
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      if (mode === 'in') await signIn(email.trim(), pass)
      else { const r = await signUp(email.trim(), pass); toast(r === 'confirm' ? 'Te enviamos un correo para confirmar tu cuenta.' : 'Cuenta creada.') }
    } catch (err) { toast(friendly(err), 'err') } finally { setBusy(false) }
  }
  return (
    <form className="card col" onSubmit={submit} style={{ maxWidth: 440 }}>
      <h2>{mode === 'in' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
      <p className="muted small" style={{ margin: 0 }}>La cuenta solo se usa para administrar tus QR dinámicos. Los QR estáticos no la necesitan.</p>
      <div className="field"><label htmlFor="em">Correo electrónico</label><input id="em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="pw">Contraseña</label><input id="pw" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={pass} onChange={(e) => setPass(e.target.value)} />{mode === 'up' && <span className="help">Mínimo 8 caracteres.</span>}</div>
      <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : null}{mode === 'in' ? 'Entrar' : 'Crear cuenta'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'No tengo cuenta' : 'Ya tengo cuenta'}</button>
    </form>
  )
}

function StatsDialog({ link, onClose, onChanged }: { link: DynLink; onClose: () => void; onChanged: (l: DynLink) => void }) {
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [err, setErr] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => {
    let live = true
    setHits(null); setErr('')
    listHits(link.id, days).then((h) => live && setHits(h)).catch((e) => live && setErr(friendly(e)))
    return () => { live = false }
  }, [link.id, days])
  const s = useMemo(() => (hits ? summarize(hits, bucket) : null), [hits, bucket])
  const max = Math.max(1, ...(s?.byDay.map((d) => d.count) ?? [1]))
  return (
    <div className="dialog-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="st-t" style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="row between"><h2 id="st-t">Estadísticas: {link.name}</h2><button type="button" className="btn sm" onClick={onClose}>Cerrar</button></div>
        <div className="issue info">Lo que se cuenta son <b>solicitudes HTTP</b> a la dirección del QR, no personas. Una misma persona puede generar varias, y algunas son robots o vistas previas de mensajería. Los robots conocidos se separan, pero la detección no es perfecta.</div>
        <label className="check"><input type="checkbox" checked={link.stats_enabled} onChange={async (e) => { try { onChanged(await updateLink(link.id, { stats_enabled: e.target.checked })); toast(e.target.checked ? 'Estadísticas activadas' : 'Estadísticas desactivadas: no se registran más visitas') } catch (er) { toast(friendly(er), 'err') } }} /><span>Registrar visitas de este QR</span></label>
        <div className="form-grid">
          <div className="field"><label htmlFor="rd">Conservar datos (días)</label><input id="rd" type="number" min={1} max={365} defaultValue={link.retention_days} onBlur={async (e) => { const v = Math.min(365, Math.max(1, Number(e.target.value) || 90)); if (v === link.retention_days) return; try { onChanged(await updateLink(link.id, { retention_days: v })); toast('Plazo actualizado') } catch (er) { toast(friendly(er), 'err') } }} /><span className="help">Los registros más viejos se borran automáticamente.</span></div>
          <div className="field"><label htmlFor="pd">Período</label><select id="pd" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option><option value={365}>365 días</option></select></div>
          <div className="field"><label htmlFor="pb">Agrupar por</label><select id="pb" value={bucket} onChange={(e) => setBucket(e.target.value as 'day' | 'week' | 'month')}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></div>
        </div>
        {err ? <div className="issue error" role="alert">{err}</div> : !s ? <div className="row"><Spinner /> Cargando…</div> : s.requests === 0 ? (
          <div className="empty">{link.stats_enabled ? 'Todavía no hay solicitudes registradas en este período.' : 'Las estadísticas están desactivadas. Activalas para empezar a registrar.'}</div>
        ) : (
          <>
            <div className="row"><span className="badge gray">{s.requests} solicitudes</span><span className="badge ok">{s.likelyHuman} probablemente de personas</span><span className="badge gray">{s.bots} de robots</span></div>
            <div role="img" aria-label="Solicitudes por período" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, borderBottom: '1px solid var(--border)' }}>
              {s.byDay.map((d) => <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, minWidth: 3, height: `${(d.count / max) * 100}%`, background: 'var(--accent)', borderRadius: '3px 3px 0 0' }} />)}
            </div>
            <div className="table-wrap"><table><thead><tr><th>Período</th><th>Solicitudes</th></tr></thead><tbody>{[...s.byDay].reverse().slice(0, 14).map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.count}</td></tr>)}</tbody></table></div>
            <div className="row">{Object.entries(s.byDevice).map(([k, v]) => <span key={k} className="pill">{k}: {v}</span>)}</div>
            <p className="small muted" style={{ margin: 0 }}>No se registra la IP ni la ubicación. Por eso no hay datos de país o región.</p>
          </>
        )}
        <button type="button" className="btn danger" onClick={() => setConfirmDel(true)}>Borrar todos los datos de estadísticas</button>
        {confirmDel && <ConfirmDialog danger title="¿Borrar las estadísticas?" body="Se eliminarán todas las visitas registradas de este QR. No se puede deshacer." confirmLabel="Borrar" onCancel={() => setConfirmDel(false)} onConfirm={async () => { setConfirmDel(false); try { await deleteHits(link.id); setHits([]); toast('Estadísticas borradas') } catch (e) { toast(friendly(e), 'err') } }} />}
      </div>
    </div>
  )
}

export function Dynamic({ session, style, onOpenInCreator }: { session: Session | null; style: QrStyle; onOpenInCreator: (l: DynLink) => void }) {
  const toast = useToast()
  const [links, setLinks] = useState<DynLink[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [status, setStatus] = useState<'all' | 'active' | 'paused'>('all')
  const [sort, setSort] = useState<'new' | 'old' | 'name'>('new')
  const [editing, setEditing] = useState<string | null>(null)
  const [dest, setDest] = useState('')
  const [destErr, setDestErr] = useState('')
  const [checks, setChecks] = useState<Record<string, CheckResult | 'running'>>({})
  const [confirm, setConfirm] = useState<DynLink | null>(null)
  const [stats, setStats] = useState<DynLink | null>(null)

  const load = useCallback(async () => {
    setError('')
    try { setLinks(await listLinks()) } catch (e) { setError(friendly(e)); setLinks([]) }
  }, [])
  useEffect(() => { if (session) void load(); else setLinks(null) }, [session, load])

  const replace = (l: DynLink) => setLinks((cur) => cur?.map((x) => (x.id === l.id ? l : x)) ?? cur)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = (links ?? []).filter((l) => (cat === 'all' || l.category === cat) && (status === 'all' || l.status === status) && (!s || l.name.toLowerCase().includes(s) || l.destination.toLowerCase().includes(s) || l.code.includes(s)))
    out.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'old' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)))
    return out
  }, [links, q, cat, status, sort])

  if (!dynamicConfigured) return <SetupNotice />
  if (!session) return <div className="col"><div className="issue info">Iniciá sesión para ver y administrar tus QR dinámicos.</div><AccountPanel session={null} /></div>

  const saveDest = async (l: DynLink) => {
    const v = validateDestination(dest)
    if (!v.ok) { setDestErr(v.error); return }
    try { replace(await updateLink(l.id, { destination: v.url })); setEditing(null); toast('Destino actualizado. El QR impreso sigue siendo el mismo.') } catch (e) { setDestErr(friendly(e)) }
  }
  const togglePause = async (l: DynLink) => {
    try { replace(await updateLink(l.id, { status: l.status === 'active' ? 'paused' : 'active' })); toast(l.status === 'active' ? 'QR pausado: los visitantes verán un aviso' : 'QR reactivado') } catch (e) { toast(friendly(e), 'err') }
  }
  const duplicate = async (l: DynLink) => {
    try { const n = await createLink({ name: `${l.name} (copia)`, category: l.category, destination: l.destination, stats_enabled: l.stats_enabled, style: l.style }); setLinks((c) => [n, ...(c ?? [])]); toast('Duplicado con un identificador nuevo') } catch (e) { toast(friendly(e), 'err') }
  }
  const check = async (l: DynLink) => { setChecks((c) => ({ ...c, [l.id]: 'running' })); const r = await checkRedirect(l.code); setChecks((c) => ({ ...c, [l.id]: r })) }
  const dl = async (l: DynLink) => {
    try { const st = l.style ? sanitizeStyle(l.style) : style
      downloadBlob(await exportQr(buildMatrix(redirectUrl(l.code), st.ecc), st, { ...DEFAULT_EXPORT, format: 'png' }), `${toFileName(l.name)}.png`) } catch (e) { toast((e as Error).message, 'err') }
  }
  const checkLabel = (r: CheckResult | 'running' | undefined) => {
    if (!r) return null
    if (r === 'running') return <span className="badge gray">Verificando…</span>
    if (r.state === 'active') return <span className="badge ok">Redirección activa</span>
    if (r.state === 'paused') return <span className="badge warn">Pausado (se muestra un aviso)</span>
    if (r.state === 'not_found') return <span className="badge err">No encontrado en el servicio</span>
    if (r.state === 'destination_invalid') return <span className="badge err">Destino rechazado por el servidor</span>
    if (r.state === 'unreachable') return <span className="badge err" title={r.reason}>No se pudo verificar: {r.reason}</span>
    return null
  }

  return (
    <div className="col">
      <section className="card">
        <header><h2>Mis QR dinámicos</h2><div className="row"><span className="small muted">{session.user.email}</span><button type="button" className="btn sm" onClick={() => signOut()}>Salir</button><button type="button" className="btn sm" onClick={load}>Actualizar</button></div></header>
        <div className="row">
          <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="dq" className="sr-only">Buscar</label><input id="dq" type="search" placeholder="Buscar por nombre, destino o código" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field"><label htmlFor="dc" className="sr-only">Categoría</label><select id="dc" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">Todas</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="ds" className="sr-only">Estado</label><select id="ds" value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'active' | 'paused')}><option value="all">Todos los estados</option><option value="active">Activos</option><option value="paused">Pausados</option></select></div>
          <div className="field"><label htmlFor="do" className="sr-only">Ordenar</label><select id="do" value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'old' | 'name')}><option value="new">Más nuevos</option><option value="old">Más viejos</option><option value="name">Por nombre</option></select></div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Dirección base de las redirecciones: <code>{redirectBase}</code>. Para crear uno nuevo, andá a Crear y elegí "QR dinámico".</p>
      </section>

      {error && <div className="issue error" role="alert">{error} <button type="button" className="link" onClick={load}>Reintentar</button></div>}
      {links === null ? <div className="card row"><Spinner /> Cargando…</div> : links.length === 0 && !error ? (
        <div className="card empty"><b>Todavía no tenés QR dinámicos</b><span>Creá el primero desde la pantalla Crear.</span></div>
      ) : shown.length === 0 && links.length > 0 ? <div className="card empty">Ningún QR coincide con los filtros.</div> : (
        <div className="col">
          {shown.map((l) => (
            <article key={l.id} className="card col">
              <div className="row between">
                <div><h3>{l.name}</h3><div className="row" style={{ marginTop: 4 }}><span className="badge gray">{l.category}</span><span className={`badge ${l.status === 'active' ? 'ok' : 'warn'}`}>{l.status === 'active' ? 'Activo' : 'Pausado'}</span>{l.stats_enabled && <span className="badge gray">Con estadísticas</span>}<span className="small muted">Creado {new Date(l.created_at).toLocaleDateString('es-AR')}</span></div></div>
                {checkLabel(checks[l.id])}
              </div>
              <div><div className="lbl small">URL pública (la que contiene el QR)</div><div className="row"><span className="url-box mono grow">{redirectUrl(l.code)}</span><CopyButton text={redirectUrl(l.code)} /></div></div>
              <div>
                <div className="lbl small">Destino actual</div>
                {editing === l.id ? (
                  <div className="col"><div className="field"><label htmlFor={`dd-${l.id}`} className="sr-only">Nuevo destino</label><input id={`dd-${l.id}`} type="text" value={dest} aria-invalid={destErr ? true : undefined} onChange={(e) => { setDest(e.target.value); setDestErr('') }} />{destErr && <span className="err" role="alert">{destErr}</span>}</div>
                    <div className="row"><button type="button" className="btn sm primary" onClick={() => saveDest(l)}>Guardar destino</button><button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancelar</button></div></div>
                ) : <div className="row"><span className="url-box mono grow">{l.destination}</span><button type="button" className="btn sm" onClick={() => { setEditing(l.id); setDest(l.destination); setDestErr('') }}>Editar destino</button></div>}
              </div>
              <div className="row">
                <button type="button" className="btn sm" onClick={() => togglePause(l)}>{l.status === 'active' ? 'Pausar' : 'Reactivar'}</button>
                <button type="button" className="btn sm" onClick={() => check(l)}>Verificar redirección</button>
                <button type="button" className="btn sm" onClick={() => setStats(l)}>Estadísticas</button>
                <button type="button" className="btn sm" onClick={() => dl(l)}>Descargar PNG</button>
                <button type="button" className="btn sm" onClick={() => onOpenInCreator(l)}>Personalizar diseño</button>
                <button type="button" className="btn sm" onClick={() => duplicate(l)}>Duplicar</button>
                <button type="button" className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={() => setConfirm(l)}>Eliminar</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {stats && <StatsDialog link={stats} onClose={() => setStats(null)} onChanged={(l) => { replace(l); setStats(l) }} />}
      {confirm && <ConfirmDialog danger title="¿Eliminar este QR dinámico?" body={<>Se borrará "{confirm.name}" y su dirección <code>{redirectUrl(confirm.code)}</code> dejará de funcionar para siempre: los códigos ya impresos mostrarán un aviso de que no existe. Si solo querés frenarlo por un tiempo, usá "Pausar".</>} confirmLabel="Eliminar definitivamente" onCancel={() => setConfirm(null)} onConfirm={async () => { const l = confirm; setConfirm(null); try { await deleteLink(l.id); setLinks((c) => c?.filter((x) => x.id !== l.id) ?? c); toast('QR dinámico eliminado') } catch (e) { toast(friendly(e), 'err') } }} />}
    </div>
  )
}
