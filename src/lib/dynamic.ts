import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'

/**
 * Cliente de QR dinámicos. Solo usa la clave pública (anon): la seguridad real la imponen
 * las políticas RLS de la base de datos y la función de redirección (ver supabase/).
 * Si las variables de entorno no están configuradas, la app lo informa y NO simula nada.
 */
const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const BASE = (import.meta.env.VITE_REDIRECT_BASE as string | undefined)?.replace(/\/$/, '')

export const dynamicConfigured = Boolean(URL_ && KEY)
/** Base pública de redirección. Con dominio propio: https://qr.midominio.com/r  (ver README). */
export const redirectBase = BASE || (URL_ ? `${URL_}/functions/v1/r` : '')

let client: SupabaseClient | null = null
export function sb(): SupabaseClient {
  if (!URL_ || !KEY) throw new Error('Los QR dinámicos todavía no están configurados (faltan las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY).')
  client ??= createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  return client
}

export const redirectUrl = (code: string) => `${redirectBase}/${code}`

export type LinkStatus = 'active' | 'paused'
export interface DynLink {
  id: string
  code: string
  name: string
  category: string
  destination: string
  status: LinkStatus
  stats_enabled: boolean
  retention_days: number
  style: unknown | null
  created_at: string
  updated_at: string
}
export interface Hit { ts: string; device: string; is_bot: boolean }

export const CATEGORIES = ['Web', 'Documentos y educación', 'Redes sociales', 'Contacto', 'Comercial', 'Campaña', 'Otro'] as const

/** Mismas reglas que valida el servidor: solo https (y http si es localhost no se permite), sin credenciales, sin hosts internos. */
export function validateDestination(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Ingresá el destino.' }
  let u: URL
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`) } catch { return { ok: false, error: 'La dirección no es válida.' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'Los QR dinámicos solo admiten destinos https://.' }
  if (u.username || u.password) return { ok: false, error: 'El destino no puede incluir usuario ni contraseña.' }
  const h = u.hostname.toLowerCase()
  if (!h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h === 'localhost') return { ok: false, error: 'El destino debe ser una dirección pública.' }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return { ok: false, error: 'El destino debe ser una dirección pública.' }
  }
  if (h.startsWith('[') ) return { ok: false, error: 'No se admiten direcciones IPv6 numéricas.' }
  if (u.toString().length > 2048) return { ok: false, error: 'El enlace es demasiado largo.' }
  // Evita redirecciones encadenadas hacia el propio servicio de redirección.
  if (redirectBase) { try { if (u.host === new URL(redirectBase).host && u.pathname.startsWith(new URL(redirectBase).pathname)) return { ok: false, error: 'El destino no puede apuntar a otro QR dinámico.' } } catch { /* ignore */ } }
  return { ok: true, url: u.toString() }
}

// ------------------------------------------------------------------ sesión

export async function getSession(): Promise<Session | null> {
  if (!dynamicConfigured) return null
  const { data } = await sb().auth.getSession()
  return data.session
}
export function onAuth(cb: (s: Session | null) => void): () => void {
  if (!dynamicConfigured) return () => {}
  const { data } = sb().auth.onAuthStateChange((_e, s) => cb(s))
  return () => data.subscription.unsubscribe()
}
export async function signIn(email: string, password: string) {
  const { error } = await sb().auth.signInWithPassword({ email, password })
  if (error) throw new Error(translateAuthError(error.message))
}
export async function signUp(email: string, password: string): Promise<'confirm' | 'ready'> {
  const { data, error } = await sb().auth.signUp({ email, password })
  if (error) throw new Error(translateAuthError(error.message))
  return data.session ? 'ready' : 'confirm'
}
export async function signOut() { await sb().auth.signOut() }

function translateAuthError(m: string): string {
  if (/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.'
  if (/already registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Probá iniciar sesión.'
  if (/password/i.test(m)) return 'La contraseña no cumple los requisitos (mínimo 8 caracteres).'
  if (/rate limit/i.test(m)) return 'Demasiados intentos. Esperá un momento y probá de nuevo.'
  if (/email not confirmed/i.test(m)) return 'Primero confirmá tu correo con el enlace que te enviamos.'
  return 'No se pudo completar la operación de cuenta.'
}

/** Traduce errores de red/servidor para no mostrar mensajes técnicos ni resultados falsos. */
export function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'No hay conexión con el servicio. Revisá tu internet y probá de nuevo.'
  if (/row-level security|permission denied/i.test(msg)) return 'No tenés permiso para hacer esto.'
  if (/duplicate key/i.test(msg)) return 'Ya existe un registro con ese identificador. Probá de nuevo.'
  if (/limit_reached/i.test(msg)) return 'Alcanzaste el máximo de QR dinámicos configurado para tu cuenta.'
  if (/invalid_destination/i.test(msg)) return 'El destino no es válido.'
  return msg || 'Ocurrió un error inesperado. Probá de nuevo.'
}

// -------------------------------------------------------------------- datos

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // sin caracteres ambiguos (0/o, 1/l/i)
export function newCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

export async function listLinks(): Promise<DynLink[]> {
  const { data, error } = await sb().from('qr_links').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data as DynLink[]
}

export async function createLink(input: { name: string; category: string; destination: string; stats_enabled: boolean; style?: unknown }): Promise<DynLink> {
  const v = validateDestination(input.destination)
  if (!v.ok) throw new Error(v.error)
  const { data: s } = await sb().auth.getSession()
  if (!s.session) throw new Error('Iniciá sesión para crear QR dinámicos.')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await sb().from('qr_links').insert({
      code: newCode(), owner: s.session.user.id, name: input.name.trim().slice(0, 120) || 'Sin nombre', category: input.category,
      destination: v.url, stats_enabled: input.stats_enabled, style: input.style ?? null,
    }).select().single()
    if (!error) return data as DynLink
    if (!/duplicate key/i.test(error.message)) throw error
  }
  throw new Error('No se pudo generar un identificador único. Probá de nuevo.')
}

export async function updateLink(id: string, patch: Partial<Pick<DynLink, 'name' | 'category' | 'destination' | 'status' | 'stats_enabled' | 'retention_days' | 'style'>>): Promise<DynLink> {
  if (patch.destination !== undefined) {
    const v = validateDestination(patch.destination)
    if (!v.ok) throw new Error(v.error)
    patch = { ...patch, destination: v.url }
  }
  const { data, error } = await sb().from('qr_links').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as DynLink
}
export async function deleteLink(id: string): Promise<void> {
  const { error } = await sb().from('qr_links').delete().eq('id', id)
  if (error) throw error
}

export async function listHits(linkId: string, days: number): Promise<Hit[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await sb().from('qr_hits').select('ts, device, is_bot').eq('link_id', linkId).gte('ts', since).order('ts', { ascending: true }).limit(10000)
  if (error) throw error
  return data as Hit[]
}
export async function deleteHits(linkId: string): Promise<void> {
  const { error } = await sb().from('qr_hits').delete().eq('link_id', linkId)
  if (error) throw error
}

export type CheckResult = { state: 'active' | 'paused' | 'not_found' | 'destination_invalid' } | { state: 'unreachable'; reason: string }
/** Pide al servicio de redirección el estado del código sin registrar una visita. */
export async function checkRedirect(code: string): Promise<CheckResult> {
  try {
    const r = await fetch(`${redirectUrl(code)}?check=1`, { headers: { accept: 'application/json' } })
    if (!r.ok && r.status !== 404 && r.status !== 410) return { state: 'unreachable', reason: `El servicio respondió ${r.status}.` }
    const j = (await r.json()) as { state?: string }
    if (j.state === 'active' || j.state === 'paused' || j.state === 'not_found' || j.state === 'destination_invalid') return { state: j.state }
    return { state: 'unreachable', reason: 'Respuesta inesperada del servicio.' }
  } catch {
    return { state: 'unreachable', reason: 'No se pudo conectar con el servicio de redirección.' }
  }
}

// ------------------------------------------------------------- estadísticas

export interface StatsSummary { requests: number; likelyHuman: number; bots: number; byDay: { day: string; count: number }[]; byDevice: Record<string, number> }

/** Agrega solicitudes registradas. "Solicitudes" ≠ personas: ver README. */
export function summarize(hits: Hit[], bucket: 'day' | 'week' | 'month' = 'day'): StatsSummary {
  const byDay = new Map<string, number>()
  const byDevice: Record<string, number> = {}
  let bots = 0
  for (const h of hits) {
    if (h.is_bot) { bots++; continue }
    const d = new Date(h.ts)
    let key: string
    if (bucket === 'month') key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    else if (bucket === 'week') { const t = new Date(d); t.setDate(d.getDate() - ((d.getDay() + 6) % 7)); key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
    else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
    byDevice[h.device] = (byDevice[h.device] ?? 0) + 1
  }
  return { requests: hits.length, likelyHuman: hits.length - bots, bots, byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })), byDevice }
}
