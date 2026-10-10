/**
 * Tipos de contenido para QR. Cada tipo define su formulario, su validación y
 * la construcción del texto codificado según el estándar correspondiente:
 *  - URL / texto: texto plano
 *  - Wi-Fi: formato "WIFI:" (ZXing / Android / iOS)
 *  - vCard: vCard 3.0 (RFC 2426)
 *  - Email: mailto: (RFC 6068)
 *  - Teléfono: tel: (RFC 3966)
 *  - SMS: sms: (RFC 5724)
 *  - WhatsApp: enlace oficial wa.me
 *  - Ubicación: geo: (RFC 5870) o enlace de Google Maps
 *  - Evento: iCalendar VEVENT (RFC 5545) o enlace de Google Calendar
 */

export type FieldType =
  | 'text' | 'textarea' | 'select' | 'date' | 'time' | 'checkbox'
  | 'password' | 'tel' | 'email' | 'url' | 'number'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  help?: string
  required?: boolean
  options?: { value: string; label: string }[]
  /** Solo se muestra si otro campo tiene cierto valor. */
  showIf?: { key: string; equals?: string; notEquals?: string }
}

export type Values = Record<string, string>

export type BuildResult =
  | { ok: true; content: string }
  | { ok: false; errors: Record<string, string> }

export interface PayloadType {
  id: PayloadId
  label: string
  short: string
  description: string
  category: string
  fields: FieldDef[]
  defaults: Values
  example: Values
  build: (v: Values) => BuildResult
}

export type PayloadId =
  | 'url' | 'text' | 'wifi' | 'vcard' | 'email' | 'phone'
  | 'whatsapp' | 'sms' | 'location' | 'event' | 'social' | 'custom'

// ---------------------------------------------------------------- utilidades

const ok = (content: string): BuildResult => ({ ok: true, content })
const fail = (errors: Record<string, string>): BuildResult => ({ ok: false, errors })

const trim = (s: string | undefined) => (s ?? '').trim()

/** Esquemas permitidos para enlaces web. Nunca javascript:, data:, file:, etc. */
const SAFE_WEB_SCHEMES = ['http:', 'https:']

export function normalizeUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const raw = trim(input)
  if (!raw) return { ok: false, error: 'Ingresá una dirección web.' }
  if (/\s/.test(raw)) return { ok: false, error: 'La dirección no puede tener espacios.' }
  // Si trae un esquema explícito (algo: sin ser host:puerto), debe ser http(s).
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw)
  const looksLikeHostPort = /^[^/\s:]+:\d+(\/|$)/.test(raw)
  let candidate = raw
  if (schemeMatch && !looksLikeHostPort) {
    if (!SAFE_WEB_SCHEMES.includes(schemeMatch[0].toLowerCase())) {
      return { ok: false, error: 'Solo se permiten enlaces http:// o https://.' }
    }
  } else {
    candidate = 'https://' + raw
  }
  try {
    const u = new URL(candidate)
    if (!SAFE_WEB_SCHEMES.includes(u.protocol)) return { ok: false, error: 'Solo se permiten enlaces http:// o https://.' }
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') {
      return { ok: false, error: 'La dirección no parece válida (falta el dominio, por ejemplo .com.ar).' }
    }
    if (u.username || u.password) return { ok: false, error: 'No incluyas usuario ni contraseña dentro del enlace.' }
    return { ok: true, url: u.toString() }
  } catch {
    return { ok: false, error: 'La dirección web no es válida.' }
  }
}

export function normalizePhone(input: string): { ok: true; phone: string } | { ok: false; error: string } {
  const raw = trim(input)
  if (!raw) return { ok: false, error: 'Ingresá un número de teléfono.' }
  const plus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 6 || digits.length > 15) {
    return { ok: false, error: 'El número debe tener entre 6 y 15 dígitos.' }
  }
  if (!/^[\d\s()+\-.]+$/.test(raw)) return { ok: false, error: 'El número solo puede tener dígitos, espacios, + y guiones.' }
  return { ok: true, phone: (plus ? '+' : '') + digits }
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/
export const isEmail = (s: string) => EMAIL_RE.test(trim(s))

/** Escapa caracteres especiales del formato WIFI: */
export const escapeWifi = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')

/** Escapa texto para vCard 3.0 / iCalendar. */
export const escapeIcs = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Quita saltos de línea para impedir inyección de propiedades en vCard/iCal. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

const pad = (n: number) => String(n).padStart(2, '0')

// ----------------------------------------------------------------- los tipos

const urlType: PayloadType = {
  id: 'url',
  label: 'Enlace web',
  short: 'URL',
  description: 'Páginas web, documentos y recursos digitales.',
  category: 'Web',
  fields: [
    { key: 'url', label: 'Dirección web', type: 'url', required: true, placeholder: 'https://ejemplo.com.ar/pagina', help: 'Si no escribís http o https, usamos https automáticamente.' },
  ],
  defaults: { url: '' },
  example: { url: 'https://www.argentina.gob.ar' },
  build: (v) => {
    const r = normalizeUrl(v.url)
    return r.ok ? ok(r.url) : fail({ url: r.error })
  },
}

const textType: PayloadType = {
  id: 'text',
  label: 'Texto libre',
  short: 'Texto',
  description: 'Mensajes, instrucciones o notas cortas.',
  category: 'Texto',
  fields: [
    { key: 'text', label: 'Texto', type: 'textarea', required: true, placeholder: 'Escribí el mensaje que se verá al escanear', help: 'Cuanto más corto, más fácil de escanear.' },
  ],
  defaults: { text: '' },
  example: { text: 'Hola, ¡bienvenidos a la feria de ciencias!' },
  build: (v) => (trim(v.text) ? ok(v.text) : fail({ text: 'Escribí un texto para codificar.' })),
}

const wifiType: PayloadType = {
  id: 'wifi',
  label: 'Wi-Fi',
  short: 'Wi-Fi',
  description: 'Conectarse a una red escaneando el código.',
  category: 'Conectividad',
  fields: [
    { key: 'ssid', label: 'Nombre de la red (SSID)', type: 'text', required: true, placeholder: 'MiRedWiFi' },
    { key: 'security', label: 'Seguridad', type: 'select', options: [
      { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
      { value: 'WEP', label: 'WEP (antigua)' },
      { value: 'nopass', label: 'Sin contraseña' },
    ] },
    { key: 'password', label: 'Contraseña', type: 'password', placeholder: 'Contraseña de la red', showIf: { key: 'security', notEquals: 'nopass' } },
    { key: 'hidden', label: 'Red oculta', type: 'checkbox' },
  ],
  defaults: { ssid: '', security: 'WPA', password: '', hidden: '' },
  example: { ssid: 'Invitados', security: 'WPA', password: 'bienvenidos2026', hidden: '' },
  build: (v) => {
    const errors: Record<string, string> = {}
    if (!trim(v.ssid)) errors.ssid = 'Ingresá el nombre de la red.'
    if (v.ssid.length > 32) errors.ssid = 'El nombre de una red Wi-Fi tiene como máximo 32 caracteres.'
    const sec = v.security || 'WPA'
    if (sec !== 'nopass') {
      if (!v.password) errors.password = 'Ingresá la contraseña o elegí "Sin contraseña".'
      else if (sec === 'WPA' && (v.password.length < 8 || v.password.length > 63)) errors.password = 'Una clave WPA tiene entre 8 y 63 caracteres.'
    }
    if (Object.keys(errors).length) return fail(errors)
    const parts = [`T:${sec}`, `S:${escapeWifi(v.ssid)}`]
    if (sec !== 'nopass') parts.push(`P:${escapeWifi(v.password)}`)
    if (v.hidden === 'true') parts.push('H:true')
    return ok(`WIFI:${parts.join(';')};;`)
  },
}

const vcardType: PayloadType = {
  id: 'vcard',
  label: 'Contacto (vCard)',
  short: 'Contacto',
  description: 'Tarjeta de contacto para guardar en la agenda.',
  category: 'Contacto',
  fields: [
    { key: 'firstName', label: 'Nombre', type: 'text', required: true, placeholder: 'María' },
    { key: 'lastName', label: 'Apellido', type: 'text', placeholder: 'González' },
    { key: 'phone', label: 'Teléfono', type: 'tel', placeholder: '+54 9 3755 123456' },
    { key: 'email', label: 'Correo electrónico', type: 'email', placeholder: 'maria@ejemplo.com' },
    { key: 'org', label: 'Organización', type: 'text', placeholder: 'Instituto Emanuel' },
    { key: 'title', label: 'Cargo', type: 'text', placeholder: 'Docente' },
    { key: 'address', label: 'Dirección', type: 'text', placeholder: 'Calle 1 123, Oberá, Misiones' },
    { key: 'website', label: 'Sitio web', type: 'url', placeholder: 'https://ejemplo.com.ar' },
  ],
  defaults: { firstName: '', lastName: '', phone: '', email: '', org: '', title: '', address: '', website: '' },
  example: { firstName: 'María', lastName: 'González', phone: '+54 9 3755 123456', email: 'maria@ejemplo.com', org: 'Instituto Emanuel', title: 'Docente', address: 'Oberá, Misiones', website: 'https://ejemplo.com.ar' },
  build: (v) => {
    const errors: Record<string, string> = {}
    if (!trim(v.firstName)) errors.firstName = 'Ingresá al menos el nombre.'
    let phone = ''
    if (trim(v.phone)) {
      const p = normalizePhone(v.phone)
      if (p.ok) phone = p.phone
      else errors.phone = p.error
    }
    if (trim(v.email) && !isEmail(v.email)) errors.email = 'El correo no parece válido.'
    let website = ''
    if (trim(v.website)) {
      const u = normalizeUrl(v.website)
      if (u.ok) website = u.url
      else errors.website = u.error
    }
    if (Object.keys(errors).length) return fail(errors)
    const fn = oneLine(`${v.firstName} ${v.lastName ?? ''}`)
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${escapeIcs(oneLine(v.lastName ?? ''))};${escapeIcs(oneLine(v.firstName))};;;`,
      `FN:${escapeIcs(fn)}`,
    ]
    if (trim(v.org)) lines.push(`ORG:${escapeIcs(oneLine(v.org))}`)
    if (trim(v.title)) lines.push(`TITLE:${escapeIcs(oneLine(v.title))}`)
    if (phone) lines.push(`TEL;TYPE=CELL:${phone}`)
    if (trim(v.email)) lines.push(`EMAIL:${oneLine(v.email)}`)
    if (trim(v.address)) lines.push(`ADR;TYPE=WORK:;;${escapeIcs(oneLine(v.address))};;;;`)
    if (website) lines.push(`URL:${website}`)
    lines.push('END:VCARD')
    return ok(lines.join('\r\n'))
  },
}

const emailType: PayloadType = {
  id: 'email',
  label: 'Correo electrónico',
  short: 'Email',
  description: 'Abre un correo con destinatario, asunto y mensaje.',
  category: 'Contacto',
  fields: [
    { key: 'to', label: 'Dirección de correo', type: 'email', required: true, placeholder: 'contacto@ejemplo.com' },
    { key: 'subject', label: 'Asunto', type: 'text', placeholder: 'Consulta' },
    { key: 'body', label: 'Mensaje', type: 'textarea', placeholder: 'Hola, quisiera consultar…' },
  ],
  defaults: { to: '', subject: '', body: '' },
  example: { to: 'contacto@ejemplo.com', subject: 'Consulta', body: 'Hola, quisiera más información.' },
  build: (v) => {
    if (!isEmail(v.to)) return fail({ to: trim(v.to) ? 'El correo no parece válido.' : 'Ingresá una dirección de correo.' })
    const q: string[] = []
    if (trim(v.subject)) q.push('subject=' + encodeURIComponent(v.subject))
    if (trim(v.body)) q.push('body=' + encodeURIComponent(v.body))
    return ok(`mailto:${trim(v.to)}${q.length ? '?' + q.join('&') : ''}`)
  },
}

const phoneType: PayloadType = {
  id: 'phone',
  label: 'Teléfono',
  short: 'Llamada',
  description: 'Número listo para llamar.',
  category: 'Contacto',
  fields: [
    { key: 'phone', label: 'Número de teléfono', type: 'tel', required: true, placeholder: '+54 9 3755 123456', help: 'Incluí el código de país (+54) para que funcione desde cualquier lugar.' },
  ],
  defaults: { phone: '' },
  example: { phone: '+54 9 3755 123456' },
  build: (v) => {
    const r = normalizePhone(v.phone)
    return r.ok ? ok(`tel:${r.phone}`) : fail({ phone: r.error })
  },
}

const whatsappType: PayloadType = {
  id: 'whatsapp',
  label: 'WhatsApp',
  short: 'WhatsApp',
  description: 'Abre un chat con un número y un mensaje opcional.',
  category: 'Contacto',
  fields: [
    { key: 'phone', label: 'Número con código de país', type: 'tel', required: true, placeholder: '+54 9 3755 123456', help: 'En Argentina el formato internacional es +54 9 + código de área + número, sin 0 ni 15.' },
    { key: 'message', label: 'Mensaje predefinido (opcional)', type: 'textarea', placeholder: 'Hola, vi tu cartel y quiero consultar…' },
  ],
  defaults: { phone: '', message: '' },
  example: { phone: '+54 9 3755 123456', message: 'Hola, quiero consultar.' },
  build: (v) => {
    const r = normalizePhone(v.phone)
    if (!r.ok) return fail({ phone: r.error })
    const digits = r.phone.replace(/\D/g, '')
    if (!r.phone.startsWith('+')) return fail({ phone: 'Para WhatsApp, empezá con + y el código de país (por ejemplo +54).' })
    const text = trim(v.message) ? `?text=${encodeURIComponent(v.message)}` : ''
    return ok(`https://wa.me/${digits}${text}`)
  },
}

const smsType: PayloadType = {
  id: 'sms',
  label: 'SMS',
  short: 'SMS',
  description: 'Mensaje de texto con número y texto predefinido.',
  category: 'Contacto',
  fields: [
    { key: 'phone', label: 'Número de teléfono', type: 'tel', required: true, placeholder: '+54 9 3755 123456' },
    { key: 'message', label: 'Mensaje', type: 'textarea', placeholder: 'Quiero recibir información' },
  ],
  defaults: { phone: '', message: '' },
  example: { phone: '+54 9 3755 123456', message: 'Quiero recibir información' },
  build: (v) => {
    const r = normalizePhone(v.phone)
    if (!r.ok) return fail({ phone: r.error })
    return ok(`sms:${r.phone}${trim(v.message) ? '?body=' + encodeURIComponent(v.message) : ''}`)
  },
}

const locationType: PayloadType = {
  id: 'location',
  label: 'Ubicación',
  short: 'Mapa',
  description: 'Coordenadas o dirección, con enlace a mapas.',
  category: 'Lugares',
  fields: [
    { key: 'mode', label: 'Cómo querés indicarla', type: 'select', options: [
      { value: 'address', label: 'Dirección o nombre del lugar' },
      { value: 'coords', label: 'Coordenadas (latitud y longitud)' },
    ] },
    { key: 'address', label: 'Dirección o lugar', type: 'text', required: true, placeholder: 'Plaza San Martín, Oberá, Misiones', showIf: { key: 'mode', equals: 'address' } },
    { key: 'lat', label: 'Latitud', type: 'text', placeholder: '-27.4871', showIf: { key: 'mode', equals: 'coords' }, help: 'Entre -90 y 90. Usá punto como separador decimal.' },
    { key: 'lng', label: 'Longitud', type: 'text', placeholder: '-55.1199', showIf: { key: 'mode', equals: 'coords' }, help: 'Entre -180 y 180.' },
    { key: 'format', label: 'Formato del código', type: 'select', options: [
      { value: 'maps', label: 'Enlace de Google Maps (más compatible)' },
      { value: 'geo', label: 'Estándar geo: (abre la app de mapas del celular)' },
    ], showIf: { key: 'mode', equals: 'coords' } },
  ],
  defaults: { mode: 'address', address: '', lat: '', lng: '', format: 'maps' },
  example: { mode: 'address', address: 'Plaza San Martín, Oberá, Misiones', lat: '', lng: '', format: 'maps' },
  build: (v) => {
    if (v.mode === 'coords') {
      const errors: Record<string, string> = {}
      const lat = Number(v.lat.replace(',', '.'))
      const lng = Number(v.lng.replace(',', '.'))
      if (!trim(v.lat) || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = 'La latitud debe ser un número entre -90 y 90.'
      if (!trim(v.lng) || !Number.isFinite(lng) || lng < -180 || lng > 180) errors.lng = 'La longitud debe ser un número entre -180 y 180.'
      if (Object.keys(errors).length) return fail(errors)
      const pair = `${lat},${lng}`
      return ok(v.format === 'geo' ? `geo:${pair}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pair)}`)
    }
    if (!trim(v.address)) return fail({ address: 'Ingresá una dirección o el nombre de un lugar.' })
    return ok(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trim(v.address))}`)
  },
}

const eventType: PayloadType = {
  id: 'event',
  label: 'Evento de calendario',
  short: 'Evento',
  description: 'Agregar un evento al calendario al escanear.',
  category: 'Lugares',
  fields: [
    { key: 'title', label: 'Título', type: 'text', required: true, placeholder: 'Muestra de ciencias' },
    { key: 'allDay', label: 'Evento de todo el día', type: 'checkbox' },
    { key: 'startDate', label: 'Fecha de inicio', type: 'date', required: true },
    { key: 'startTime', label: 'Hora de inicio', type: 'time', showIf: { key: 'allDay', equals: '' } },
    { key: 'endDate', label: 'Fecha de fin', type: 'date', help: 'Si la dejás vacía, es la misma que la de inicio.' },
    { key: 'endTime', label: 'Hora de fin', type: 'time', showIf: { key: 'allDay', equals: '' } },
    { key: 'location', label: 'Lugar', type: 'text', placeholder: 'Salón de actos' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
    { key: 'format', label: 'Formato', type: 'select', options: [
      { value: 'ics', label: 'iCalendar (.ics) – funciona con la mayoría de los calendarios' },
      { value: 'google', label: 'Enlace de Google Calendar' },
    ] },
  ],
  defaults: { title: '', allDay: '', startDate: '', startTime: '09:00', endDate: '', endTime: '10:00', location: '', description: '', format: 'ics' },
  example: { title: 'Muestra de ciencias', allDay: '', startDate: '2026-11-20', startTime: '09:00', endDate: '', endTime: '12:00', location: 'Salón de actos', description: 'Entrada libre y gratuita.', format: 'ics' },
  build: (v) => {
    const errors: Record<string, string> = {}
    const allDay = v.allDay === 'true'
    if (!trim(v.title)) errors.title = 'Ingresá un título.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)) errors.startDate = 'Elegí la fecha de inicio.'
    if (v.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.endDate)) errors.endDate = 'La fecha de fin no es válida.'
    if (!allDay && !/^\d{2}:\d{2}$/.test(v.startTime)) errors.startTime = 'Elegí la hora de inicio.'
    if (!allDay && v.endTime && !/^\d{2}:\d{2}$/.test(v.endTime)) errors.endTime = 'La hora de fin no es válida.'
    if (Object.keys(errors).length) return fail(errors)
    const endDate = v.endDate || v.startDate
    const compact = (d: string) => d.replace(/-/g, '')
    const startStr = allDay ? compact(v.startDate) : `${compact(v.startDate)}T${v.startTime.replace(':', '')}00`
    let endStr: string
    if (allDay) {
      // En eventos de todo el día, DTEND es exclusivo: sumamos un día.
      const d = new Date(endDate + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + 1)
      endStr = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    } else {
      endStr = `${compact(endDate)}T${(v.endTime || v.startTime).replace(':', '')}00`
    }
    if (!allDay && endStr < startStr) return fail({ endDate: 'El evento no puede terminar antes de empezar.' })
    if (allDay && endDate < v.startDate) return fail({ endDate: 'La fecha de fin no puede ser anterior al inicio.' })

    if (v.format === 'google') {
      const p = new URLSearchParams({ action: 'TEMPLATE', text: oneLine(v.title), dates: `${startStr}/${endStr}` })
      if (trim(v.location)) p.set('location', oneLine(v.location))
      if (trim(v.description)) p.set('details', v.description)
      return ok(`https://calendar.google.com/calendar/render?${p.toString()}`)
    }
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//QR Studio//ES',
      'BEGIN:VEVENT',
      `UID:${startStr}-${Math.abs(hash(v.title))}@qrstudio`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      allDay ? `DTSTART;VALUE=DATE:${startStr}` : `DTSTART:${startStr}`,
      allDay ? `DTEND;VALUE=DATE:${endStr}` : `DTEND:${endStr}`,
      `SUMMARY:${escapeIcs(oneLine(v.title))}`,
    ]
    if (trim(v.location)) lines.push(`LOCATION:${escapeIcs(oneLine(v.location))}`)
    if (trim(v.description)) lines.push(`DESCRIPTION:${escapeIcs(v.description)}`)
    lines.push('END:VEVENT', 'END:VCALENDAR')
    return ok(lines.join('\r\n'))
  },
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export const SOCIAL_PLATFORMS: Record<string, { label: string; base: string; placeholder: string }> = {
  instagram: { label: 'Instagram', base: 'https://www.instagram.com/', placeholder: 'usuario' },
  tiktok: { label: 'TikTok', base: 'https://www.tiktok.com/@', placeholder: 'usuario' },
  x: { label: 'X (Twitter)', base: 'https://x.com/', placeholder: 'usuario' },
  facebook: { label: 'Facebook', base: 'https://www.facebook.com/', placeholder: 'nombre.de.pagina' },
  youtube: { label: 'YouTube', base: 'https://www.youtube.com/@', placeholder: 'canal' },
  linkedin: { label: 'LinkedIn', base: 'https://www.linkedin.com/in/', placeholder: 'nombre-apellido' },
  github: { label: 'GitHub', base: 'https://github.com/', placeholder: 'usuario' },
  custom: { label: 'Otro (enlace completo)', base: '', placeholder: 'https://…' },
}

const socialType: PayloadType = {
  id: 'social',
  label: 'Redes sociales',
  short: 'Redes',
  description: 'Enlace a un perfil, canal o publicación.',
  category: 'Web',
  fields: [
    { key: 'platform', label: 'Red social', type: 'select', options: Object.entries(SOCIAL_PLATFORMS).map(([value, p]) => ({ value, label: p.label })) },
    { key: 'handle', label: 'Usuario o enlace', type: 'text', required: true, placeholder: 'usuario', help: 'Podés pegar el enlace completo del perfil o publicación, o solo el nombre de usuario.' },
  ],
  defaults: { platform: 'instagram', handle: '' },
  example: { platform: 'instagram', handle: 'instituto.emanuel' },
  build: (v) => {
    const raw = trim(v.handle)
    if (!raw) return fail({ handle: 'Ingresá el usuario o pegá el enlace.' })
    if (/^https?:\/\//i.test(raw) || v.platform === 'custom') {
      const r = normalizeUrl(raw)
      return r.ok ? ok(r.url) : fail({ handle: r.error })
    }
    const handle = raw.replace(/^@/, '')
    if (!/^[\w.\-]{1,100}$/.test(handle)) return fail({ handle: 'El usuario solo puede tener letras, números, puntos, guiones y guiones bajos.' })
    const p = SOCIAL_PLATFORMS[v.platform] ?? SOCIAL_PLATFORMS.instagram
    return ok(p.base + encodeURIComponent(handle))
  },
}

const customType: PayloadType = {
  id: 'custom',
  label: 'Contenido personalizado',
  short: 'Libre',
  description: 'Cualquier texto o estructura (JSON, códigos, etc.).',
  category: 'Texto',
  fields: [
    { key: 'content', label: 'Contenido exacto a codificar', type: 'textarea', required: true, placeholder: 'Se codifica tal cual lo escribas', help: 'No se modifica ni se interpreta. Máximo 2900 caracteres aprox. según el nivel de corrección.' },
  ],
  defaults: { content: '' },
  example: { content: '{"curso":"3° Economía","modulo":"Derecho"}' },
  build: (v) => (v.content ? ok(v.content) : fail({ content: 'Escribí el contenido a codificar.' })),
}

export const PAYLOAD_TYPES: PayloadType[] = [
  urlType, textType, wifiType, vcardType, emailType, phoneType,
  whatsappType, smsType, locationType, eventType, socialType, customType,
]

export const PAYLOAD_BY_ID: Record<PayloadId, PayloadType> = Object.fromEntries(
  PAYLOAD_TYPES.map((t) => [t.id, t]),
) as Record<PayloadId, PayloadType>

/** Campos visibles según los valores actuales (por `showIf`). */
export function visibleFields(type: PayloadType, values: Values): FieldDef[] {
  return type.fields.filter((f) => {
    if (!f.showIf) return true
    const current = values[f.showIf.key] ?? ''
    if (f.showIf.notEquals !== undefined) return current !== f.showIf.notEquals
    return f.showIf.equals === '' ? current !== 'true' : current === f.showIf.equals
  })
}

/** Nombre sugerido para archivos y para la biblioteca. */
export function suggestName(type: PayloadType, v: Values): string {
  const pick = (...keys: string[]) => keys.map((k) => trim(v[k])).find(Boolean) ?? ''
  let base = ''
  switch (type.id) {
    case 'url': { try { base = new URL(normalizeUrlLoose(v.url)).hostname.replace(/^www\./, '') } catch { base = '' } break }
    case 'wifi': base = pick('ssid'); break
    case 'vcard': base = oneLine(`${v.firstName ?? ''} ${v.lastName ?? ''}`); break
    case 'email': base = pick('to'); break
    case 'phone': case 'whatsapp': case 'sms': base = pick('phone'); break
    case 'location': base = pick('address') || [v.lat, v.lng].filter(Boolean).join(' '); break
    case 'event': base = pick('title'); break
    case 'social': base = pick('handle'); break
    case 'text': base = pick('text').slice(0, 30); break
    case 'custom': base = pick('content').slice(0, 30); break
  }
  return base ? `${type.short} - ${base}` : type.short
}

const normalizeUrlLoose = (s: string) => (/^[a-z]+:\/\//i.test(trim(s)) ? trim(s) : 'https://' + trim(s))

/** Convierte un nombre en un nombre de archivo seguro. */
export function toFileName(name: string): string {
  const cleaned = name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `qr-${cleaned || 'codigo'}`.toLowerCase()
}
