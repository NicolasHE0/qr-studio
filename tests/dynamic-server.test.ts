import { describe, expect, it } from 'vitest'
import { createHandler, classifyDevice, looksLikeBot, type HitRow, type LinkRow } from '../supabase/functions/r/handler'
import { isPublicHttpsUrl } from '../supabase/functions/r/validate'
import { validateDestination } from '../src/lib/dynamic'

/** Base en memoria: SOLO para probar la lógica del manejador. No reemplaza una prueba contra el servicio real. */
function setup(opts: { stats?: boolean; failInsert?: boolean; infoPageUrl?: string; max?: number } = {}) {
  const links = new Map<string, LinkRow>()
  const hits: HitRow[] = []
  links.set('abcd2345', { id: 'L1', destination: 'https://destino-uno.com.ar/a', status: 'active', stats_enabled: opts.stats ?? false })
  let t = 1_000_000
  const handler = createHandler({
    getLink: async (c) => links.get(c) ?? null,
    insertHit: async (h) => { if (opts.failInsert) throw new Error('db caída'); hits.push(h) },
    infoPageUrl: opts.infoPageUrl,
    rateLimit: { max: opts.max ?? 1000, windowMs: 60_000 },
    now: () => t,
  })
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    handler(new Request(`https://qr.ejemplo.com${path}`, { method, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari', 'x-forwarded-for': '1.2.3.4', ...headers }, redirect: 'manual' }))
  return { links, hits, get, tick: (ms: number) => { t += ms } }
}

describe('aceptación 2–4: redirección y cambio de destino sin regenerar el QR', () => {
  it('redirige al primer destino', async () => {
    const s = setup()
    const r = await s.get('/r/abcd2345')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://destino-uno.com.ar/a')
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('el MISMO código lleva al nuevo destino tras editarlo', async () => {
    const s = setup()
    expect((await s.get('/r/abcd2345')).headers.get('location')).toBe('https://destino-uno.com.ar/a')
    s.links.get('abcd2345')!.destination = 'https://destino-dos.com.ar/b'
    const r = await s.get('/r/abcd2345')
    expect(r.headers.get('location')).toBe('https://destino-dos.com.ar/b')
  })
  it('funciona con la ruta completa de Supabase y con dominio propio', async () => {
    const s = setup()
    expect((await s.get('/functions/v1/r/abcd2345')).status).toBe(302)
    expect((await s.get('/abcd2345')).status).toBe(302)
  })
})

describe('aceptación 6 y 9: pausado, inexistente, destino inválido, errores', () => {
  it('pausado muestra una página informativa, no un error genérico ni redirección', async () => {
    const s = setup()
    s.links.get('abcd2345')!.status = 'paused'
    const r = await s.get('/r/abcd2345')
    expect(r.status).toBe(503)
    expect(r.headers.get('location')).toBeNull()
    expect(await r.text()).toContain('pausado')
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
  it('código inexistente o mal formado → 404 informativo', async () => {
    const s = setup()
    expect((await s.get('/r/zzzzzzzz')).status).toBe(404)
    expect((await s.get('/r/..%2f..%2fetc')).status).toBe(404)
    expect((await s.get('/r/ab')).status).toBe(404)
  })
  it('un destino inseguro guardado en la base NO se redirige', async () => {
    const s = setup()
    for (const bad of ['javascript:alert(1)', 'http://destino.com', 'https://127.0.0.1/x', 'https://192.168.0.5/', 'https://u:p@x.com/', 'https://localhost/']) {
      s.links.get('abcd2345')!.destination = bad
      const r = await s.get('/r/abcd2345')
      expect(r.status, bad).toBe(502)
      expect(r.headers.get('location'), bad).toBeNull()
    }
  })
  it('si la base falla, responde página de error (no un resultado falso)', async () => {
    const h = createHandler({ getLink: async () => { throw new Error('boom') }, insertHit: async () => {} })
    const r = await h(new Request('https://x.com/r/abcd2345', { headers: { 'user-agent': 'x' } }))
    expect(r.status).toBe(500)
    expect(r.headers.get('location')).toBeNull()
    expect(await r.text()).toContain('no está disponible')
  })
  it('si falla registrar la visita, igual redirige', async () => {
    const s = setup({ stats: true, failInsert: true })
    expect((await s.get('/r/abcd2345')).status).toBe(302)
  })
  it('con INFO_PAGE_URL redirige a la página estática', async () => {
    const s = setup({ infoPageUrl: 'https://app.ejemplo.com/aviso.html' })
    s.links.get('abcd2345')!.status = 'paused'
    const r = await s.get('/r/abcd2345')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://app.ejemplo.com/aviso.html?s=paused')
  })
  it('solo GET/HEAD', async () => {
    const s = setup()
    expect((await s.get('/r/abcd2345', {}, 'POST')).status).toBe(405)
  })
})

describe('verificación de estado (?check=1)', () => {
  it('informa el estado sin registrar visitas', async () => {
    const s = setup({ stats: true })
    const r = await s.get('/r/abcd2345?check=1')
    expect(await r.json()).toEqual({ state: 'active' })
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
    expect(s.hits).toHaveLength(0)
    s.links.get('abcd2345')!.status = 'paused'
    expect(await (await s.get('/r/abcd2345?check=1')).json()).toEqual({ state: 'paused' })
    expect(await (await s.get('/r/nonexist?check=1')).json()).toEqual({ state: 'not_found' })
  })
})

describe('aceptación 7: estadísticas reflejan solicitudes reales y distinguen robots', () => {
  it('registra solo si están activadas', async () => {
    const off = setup({ stats: false }); await off.get('/r/abcd2345'); expect(off.hits).toHaveLength(0)
    const on = setup({ stats: true }); await on.get('/r/abcd2345'); expect(on.hits).toHaveLength(1)
  })
  it('guarda únicamente id, dispositivo y bandera de robot (sin IP, UA ni destino)', async () => {
    const s = setup({ stats: true })
    await s.get('/r/abcd2345')
    expect(Object.keys(s.hits[0]).sort()).toEqual(['device', 'is_bot', 'link_id'])
    expect(JSON.stringify(s.hits[0])).not.toContain('1.2.3.4')
    expect(s.hits[0]).toEqual({ link_id: 'L1', device: 'mobile', is_bot: false })
  })
  it('separa robots, previsualizadores y HEAD; no cuenta cada solicitud como persona', async () => {
    const s = setup({ stats: true })
    await s.get('/r/abcd2345', { 'user-agent': 'WhatsApp/2.23 A' })
    await s.get('/r/abcd2345', { 'user-agent': 'Googlebot/2.1' })
    await s.get('/r/abcd2345', { purpose: 'prefetch' })
    await s.get('/r/abcd2345', {}, 'HEAD')
    await s.get('/r/abcd2345', { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' })
    expect(s.hits.map((h) => h.is_bot)).toEqual([true, true, true, true, false])
  })
  it('clasifica dispositivos', () => {
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('mobile')
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet')
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 13; SM-X700)')).toBe('tablet')
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile')).toBe('mobile')
    expect(classifyDevice('Mozilla/5.0 (Windows NT 10.0)')).toBe('desktop')
    expect(looksLikeBot(new Request('https://x.com', { headers: {} }))).toBe(true)
  })
})

describe('protección frente a abusos', () => {
  it('limita solicitudes por IP y responde 429 con aviso', async () => {
    const s = setup({ max: 5 })
    for (let i = 0; i < 5; i++) expect((await s.get('/r/abcd2345')).status).toBe(302)
    const r = await s.get('/r/abcd2345')
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('60')
    // otra IP no se ve afectada, y pasado el tiempo se libera
    expect((await s.get('/r/abcd2345', { 'x-forwarded-for': '9.9.9.9' })).status).toBe(302)
    s.tick(61_000)
    expect((await s.get('/r/abcd2345')).status).toBe(302)
  })
})

describe('paridad de validación cliente/servidor', () => {
  const cases = ['https://ejemplo.com.ar/x?y=1', 'http://ejemplo.com', 'javascript:alert(1)', 'https://localhost/', 'https://10.0.0.1/', 'https://172.20.1.1/', 'https://8.8.8.8/', 'https://user:pw@sitio.com/', 'https://sitio/', 'ftp://sitio.com/', 'https://x.local/', 'https://[::1]/']
  for (const c of cases) {
    it(c, () => expect(validateDestination(c).ok).toBe(isPublicHttpsUrl(c).ok))
  }
})
