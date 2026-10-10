import { describe, expect, it } from 'vitest'
import { PAYLOAD_BY_ID, PAYLOAD_TYPES, normalizeUrl, normalizePhone, toFileName, suggestName } from '../src/lib/payloads'
import { buildMatrix } from '../src/lib/qr'
import { verifyMatrix } from '../src/lib/verify'

const build = (id: Parameters<typeof PAYLOAD_BY_ID.url.build>[0] extends never ? never : keyof typeof PAYLOAD_BY_ID, v: Record<string, string>) =>
  PAYLOAD_BY_ID[id].build({ ...PAYLOAD_BY_ID[id].defaults, ...v })

describe('URL', () => {
  it('agrega https si falta', () => {
    expect(normalizeUrl('ejemplo.com.ar')).toEqual({ ok: true, url: 'https://ejemplo.com.ar/' })
  })
  it('rechaza esquemas peligrosos', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'vbscript:x']) {
      expect(normalizeUrl(bad).ok).toBe(false)
    }
  })
  it('rechaza espacios, vacío y credenciales', () => {
    expect(normalizeUrl('').ok).toBe(false)
    expect(normalizeUrl('hola mundo.com').ok).toBe(false)
    expect(normalizeUrl('https://user:pass@x.com').ok).toBe(false)
  })
  it('acepta host:puerto sin esquema', () => {
    expect(normalizeUrl('localhost:3000/x')).toEqual({ ok: true, url: 'https://localhost:3000/x' })
  })
})

describe('teléfono', () => {
  it('normaliza', () => expect(normalizePhone('+54 9 3755 123-456')).toEqual({ ok: true, phone: '+5493755123456' }))
  it('rechaza letras y largos inválidos', () => {
    expect(normalizePhone('abc').ok).toBe(false)
    expect(normalizePhone('123').ok).toBe(false)
  })
})

describe('Wi-Fi', () => {
  it('escapa caracteres especiales', () => {
    const r = build('wifi', { ssid: 'Mi;Red:1', security: 'WPA', password: 'clave;con"raros' })
    expect(r).toEqual({ ok: true, content: String.raw`WIFI:T:WPA;S:Mi\;Red\:1;P:clave\;con\"raros;;` })
  })
  it('red abierta no lleva contraseña', () => {
    expect(build('wifi', { ssid: 'Libre', security: 'nopass' })).toEqual({ ok: true, content: 'WIFI:T:nopass;S:Libre;;' })
  })
  it('valida largo de clave WPA', () => {
    expect(build('wifi', { ssid: 'x', security: 'WPA', password: '123' }).ok).toBe(false)
  })
  it('red oculta', () => {
    const r = build('wifi', { ssid: 'x', security: 'WPA', password: '12345678', hidden: 'true' })
    expect(r.ok && r.content.endsWith('H:true;;')).toBe(true)
  })
})

describe('vCard', () => {
  it('genera vCard 3.0 válida con CRLF', () => {
    const r = build('vcard', { firstName: 'María', lastName: 'González', phone: '+54 9 3755 123456', email: 'm@e.com', org: 'A, B', website: 'ejemplo.com' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.content.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true)
      expect(r.content).toContain('FN:María González')
      expect(r.content).toContain('ORG:A\\, B')
      expect(r.content).toContain('TEL;TYPE=CELL:+5493755123456')
      expect(r.content.endsWith('END:VCARD')).toBe(true)
    }
  })
  it('no permite inyectar propiedades con saltos de línea', () => {
    const r = build('vcard', { firstName: 'Ana\r\nTEL:911', lastName: '' })
    expect(r.ok && !/\r\nTEL:911/.test(r.content)).toBe(true)
  })
  it('exige nombre y valida correo', () => {
    expect(build('vcard', { firstName: '' }).ok).toBe(false)
    expect(build('vcard', { firstName: 'A', email: 'nope' }).ok).toBe(false)
  })
})

describe('email, sms, whatsapp, tel', () => {
  it('mailto codifica asunto y cuerpo', () => {
    expect(build('email', { to: 'a@b.com', subject: 'Hola mundo', body: 'ñandú & co' })).toEqual({
      ok: true, content: 'mailto:a@b.com?subject=Hola%20mundo&body=%C3%B1and%C3%BA%20%26%20co',
    })
  })
  it('sms', () => expect(build('sms', { phone: '+5491112345678', message: 'Hola' })).toEqual({ ok: true, content: 'sms:+5491112345678?body=Hola' }))
  it('whatsapp usa wa.me solo con dígitos', () => {
    expect(build('whatsapp', { phone: '+54 9 3755 123456', message: 'Hola!' })).toEqual({ ok: true, content: 'https://wa.me/5493755123456?text=Hola!' })
  })
  it('whatsapp exige código de país', () => expect(build('whatsapp', { phone: '3755123456' }).ok).toBe(false))
  it('tel', () => expect(build('phone', { phone: '0800 222 1234' })).toEqual({ ok: true, content: 'tel:08002221234' }))
})

describe('ubicación', () => {
  it('coordenadas válidas', () => {
    expect(build('location', { mode: 'coords', lat: '-27,4871', lng: '-55.1199', format: 'geo' })).toEqual({ ok: true, content: 'geo:-27.4871,-55.1199' })
  })
  it('rechaza fuera de rango', () => {
    expect(build('location', { mode: 'coords', lat: '95', lng: '10' }).ok).toBe(false)
    expect(build('location', { mode: 'coords', lat: 'x', lng: '10' }).ok).toBe(false)
  })
  it('dirección a enlace de mapas', () => {
    const r = build('location', { mode: 'address', address: 'Oberá, Misiones' })
    expect(r.ok && r.content).toBe('https://www.google.com/maps/search/?api=1&query=Ober%C3%A1%2C%20Misiones')
  })
})

describe('evento', () => {
  it('genera VEVENT con fechas', () => {
    const r = build('event', { title: 'Muestra', startDate: '2026-11-20', startTime: '09:00', endTime: '12:30', location: 'Salón' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.content).toContain('DTSTART:20261120T090000')
      expect(r.content).toContain('DTEND:20261120T123000')
      expect(r.content).toContain('SUMMARY:Muestra')
    }
  })
  it('todo el día: DTEND exclusivo', () => {
    const r = build('event', { title: 'Feriado', allDay: 'true', startDate: '2026-12-31' })
    expect(r.ok && r.content).toContain('DTEND;VALUE=DATE:20270101')
  })
  it('rechaza fin anterior al inicio', () => {
    expect(build('event', { title: 'x', startDate: '2026-11-20', startTime: '10:00', endTime: '09:00' }).ok).toBe(false)
  })
  it('enlace de Google Calendar', () => {
    const r = build('event', { title: 'Hola', startDate: '2026-11-20', startTime: '09:00', endTime: '10:00', format: 'google' })
    expect(r.ok && r.content.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE')).toBe(true)
  })
})

describe('redes sociales y personalizado', () => {
  it('arma el enlace del perfil', () => {
    expect(build('social', { platform: 'instagram', handle: '@instituto.emanuel' })).toEqual({ ok: true, content: 'https://www.instagram.com/instituto.emanuel' })
  })
  it('rechaza usuarios con caracteres raros', () => expect(build('social', { platform: 'instagram', handle: 'a b/c' }).ok).toBe(false))
  it('personalizado se codifica tal cual', () => expect(build('custom', { content: '{"a":1}' })).toEqual({ ok: true, content: '{"a":1}' }))
})

describe('nombres', () => {
  it('toFileName es seguro', () => {
    expect(toFileName('Enlace - ñandú/../x')).toBe('qr-enlace-nandu-x')
  })
  it('suggestName usa el dominio', () => {
    expect(suggestName(PAYLOAD_BY_ID.url, { url: 'https://www.argentina.gob.ar/x' })).toBe('URL - argentina.gob.ar')
  })
})

describe('todos los ejemplos generan QR que decodifican igual', () => {
  for (const t of PAYLOAD_TYPES) {
    it(t.label, () => {
      const r = t.build({ ...t.defaults, ...t.example })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
        expect(verifyMatrix(buildMatrix(r.content, ecc), r.content)).toBe(true)
      }
    })
  }
  it('UTF-8: tildes, ñ y emojis', () => {
    const txt = 'Ñandú café ✓ 🎓 — ¿Qué tal?'
    expect(verifyMatrix(buildMatrix(txt, 'M'), txt)).toBe(true)
  })
})

import { alignmentCenters } from '../src/lib/qr'
describe('patrones de alineación (norma ISO/IEC 18004)', () => {
  it('coinciden con la tabla oficial', () => {
    expect(alignmentCenters(1)).toEqual([])
    expect(alignmentCenters(2)).toEqual([6, 18])
    expect(alignmentCenters(7)).toEqual([6, 22, 38])
    expect(alignmentCenters(14)).toEqual([6, 26, 46, 66])
    expect(alignmentCenters(32)).toEqual([6, 34, 60, 86, 112, 138])
    expect(alignmentCenters(40)).toEqual([6, 30, 58, 86, 114, 142, 170])
  })
})
