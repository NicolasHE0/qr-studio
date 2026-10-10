import { isPublicHttpsUrl } from './validate.ts'

export interface LinkRow { id: string; destination: string; status: 'active' | 'paused'; stats_enabled: boolean }
export interface HitRow { link_id: string; device: 'mobile' | 'tablet' | 'desktop' | 'other'; is_bot: boolean }

export interface Deps {
  getLink: (code: string) => Promise<LinkRow | null>
  insertHit: (hit: HitRow) => Promise<void>
  /** URL de una página informativa estática (ej. https://mi-app.com/aviso.html). Si falta, se responde HTML propio. */
  infoPageUrl?: string
  rateLimit?: { max: number; windowMs: number }
  now?: () => number
  log?: (msg: string) => void
}

export type State = 'active' | 'paused' | 'not_found' | 'destination_invalid'

const CODE_RE = /^[a-z0-9]{6,16}$/
const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|monitor|uptime|curl|wget|python-requests|axios|go-http|java\/|headless|facebookexternalhit|whatsapp|telegram|discord|skype|slack|linkedin|pinterest|embedly|quora|vkshare|bingpreview|google-read-aloud|lighthouse/i

export function classifyDevice(ua: string): HitRow['device'] {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet'
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile'
  if (/windows|macintosh|linux|cros|x11/i.test(ua)) return 'desktop'
  return 'other'
}

/** Heurística, no certeza: marca robots conocidos, previsualizadores de enlaces y prefetch. */
export function looksLikeBot(req: Request): boolean {
  const ua = req.headers.get('user-agent') ?? ''
  if (!ua) return true
  if (req.method === 'HEAD') return true
  const purpose = `${req.headers.get('purpose') ?? ''} ${req.headers.get('sec-purpose') ?? ''} ${req.headers.get('x-moz') ?? ''}`.toLowerCase()
  if (purpose.includes('prefetch') || purpose.includes('preview')) return true
  return BOT_RE.test(ua)
}

const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
}

const MESSAGES: Record<Exclude<State, 'active'> | 'rate_limited' | 'error', { status: number; title: string; body: string }> = {
  paused: { status: 503, title: 'Este código está pausado', body: 'Su responsable lo desactivó por el momento. Probá de nuevo más tarde o consultale a quien te lo compartió.' },
  not_found: { status: 404, title: 'No encontramos este código', body: 'El enlace no existe o fue eliminado. Revisá que el código esté completo o consultale a quien te lo compartió.' },
  destination_invalid: { status: 502, title: 'No pudimos abrir el destino', body: 'El destino configurado para este código no es seguro o no es válido, así que no te redirigimos.' },
  rate_limited: { status: 429, title: 'Demasiados intentos', body: 'Hiciste muchas solicitudes seguidas. Esperá un minuto y probá de nuevo.' },
  error: { status: 500, title: 'El servicio no está disponible', body: 'Tuvimos un problema técnico y no pudimos completar la redirección. Probá de nuevo en unos minutos.' },
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function infoResponse(kind: keyof typeof MESSAGES, deps: Deps): Response {
  const m = MESSAGES[kind]
  if (deps.infoPageUrl) {
    const target = new URL(deps.infoPageUrl)
    target.searchParams.set('s', kind)
    return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location: target.toString() } })
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.25rem;color:#1b1a17}h1{font-size:1.4rem}p{color:#555}</style></head><body><h1>${esc(m.title)}</h1><p>${esc(m.body)}</p></body></html>`
  const headers: Record<string, string> = { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }
  if (kind === 'rate_limited') headers['retry-after'] = '60'
  return new Response(html, { status: m.status, headers })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, 'content-type': 'application/json', 'access-control-allow-origin': '*' } })
}

export function createHandler(deps: Deps) {
  const now = deps.now ?? Date.now
  const rl = deps.rateLimit ?? { max: 60, windowMs: 60_000 }
  // Contadores solo en memoria (no se persisten ni se registran): clave = IP del visitante.
  const buckets = new Map<string, number[]>()

  function limited(key: string): boolean {
    const t = now()
    const arr = (buckets.get(key) ?? []).filter((x) => t - x < rl.windowMs)
    arr.push(t)
    buckets.set(key, arr)
    if (buckets.size > 5000) for (const [k, v] of buckets) if (t - v[v.length - 1] > rl.windowMs) buckets.delete(k)
    return arr.length > rl.max
  }

  return async function handle(req: Request): Promise<Response> {
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'accept' } })
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD', ...SECURITY_HEADERS } })

      const url = new URL(req.url)
      const code = url.pathname.split('/').filter(Boolean).pop() ?? ''
      const isCheck = url.searchParams.get('check') === '1'
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

      if (limited(ip)) return isCheck ? json({ state: 'rate_limited' }, 429) : infoResponse('rate_limited', deps)
      if (!CODE_RE.test(code)) return isCheck ? json({ state: 'not_found' }, 404) : infoResponse('not_found', deps)

      const link = await deps.getLink(code)
      if (!link) return isCheck ? json({ state: 'not_found' }, 404) : infoResponse('not_found', deps)
      if (link.status === 'paused') return isCheck ? json({ state: 'paused' }, 200) : infoResponse('paused', deps)

      // Se vuelve a validar al redirigir: aunque la base de datos tenga un valor viejo o manipulado, nunca se redirige a algo inseguro.
      const dest = isPublicHttpsUrl(link.destination)
      if (!dest.ok) return isCheck ? json({ state: 'destination_invalid' }, 200) : infoResponse('destination_invalid', deps)
      if (isCheck) return json({ state: 'active' })

      if (link.stats_enabled) {
        const ua = req.headers.get('user-agent') ?? ''
        // Un fallo al registrar nunca debe impedir la redirección.
        try { await deps.insertHit({ link_id: link.id, device: classifyDevice(ua), is_bot: looksLikeBot(req) }) } catch { deps.log?.('hit_insert_failed') }
      }
      return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location: dest.url } })
    } catch {
      deps.log?.('handler_error')
      try { return infoResponse('error', deps) } catch { return new Response('Service unavailable', { status: 503 }) }
    }
  }
}
