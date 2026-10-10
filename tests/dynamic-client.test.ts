import { describe, expect, it } from 'vitest'
import { friendly, newCode, summarize, validateDestination, type Hit } from '../src/lib/dynamic'

describe('cliente de QR dinámicos', () => {
  it('genera códigos únicos con alfabeto sin ambigüedades', () => {
    const set = new Set(Array.from({ length: 2000 }, () => newCode()))
    expect(set.size).toBe(2000)
    for (const c of set) expect(c).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/)
  })
  it('valida destinos como el servidor', () => {
    expect(validateDestination('ejemplo.com.ar/pagina')).toEqual({ ok: true, url: 'https://ejemplo.com.ar/pagina' })
    expect(validateDestination('http://ejemplo.com').ok).toBe(false)
    expect(validateDestination('javascript:alert(1)').ok).toBe(false)
    expect(validateDestination('').ok).toBe(false)
  })
  it('traduce errores técnicos a mensajes claros', () => {
    expect(friendly(new TypeError('Failed to fetch'))).toMatch(/conexión/)
    expect(friendly({ message: 'new row violates row-level security policy' })).toMatch(/permiso/)
    expect(friendly({ message: 'limit_reached' })).toMatch(/máximo/)
  })
  it('las estadísticas separan robots y no cuentan solicitudes como personas', () => {
    const hits: Hit[] = [
      { ts: '2026-10-01T10:00:00Z', device: 'mobile', is_bot: false },
      { ts: '2026-10-01T11:00:00Z', device: 'mobile', is_bot: false },
      { ts: '2026-10-02T11:00:00Z', device: 'desktop', is_bot: false },
      { ts: '2026-10-02T12:00:00Z', device: 'other', is_bot: true },
    ]
    const s = summarize(hits)
    expect(s.requests).toBe(4)
    expect(s.likelyHuman).toBe(3)
    expect(s.bots).toBe(1)
    expect(s.byDevice).toEqual({ mobile: 2, desktop: 1 })
    expect(s.byDay.reduce((a, d) => a + d.count, 0)).toBe(3)
    expect(summarize([], 'month')).toMatchObject({ requests: 0, byDay: [] })
  })
})
