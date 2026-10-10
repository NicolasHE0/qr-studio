import { PAYLOAD_BY_ID, type PayloadId, type Values } from './payloads'

/** Parser CSV (RFC 4180): comillas, comas y saltos de línea dentro de campos. Detecta ; como separador. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface BatchRow {
  line: number
  name: string
  content: string
  error?: string
}

export const BATCH_LIMIT = 500

/**
 * Filas: `nombre,contenido`. Si la primera fila es un encabezado (nombre/name, contenido/content/url/texto) se omite.
 * Con una sola columna, cada fila es el contenido y el nombre se arma solo.
 * El contenido se valida según el tipo elegido (url, texto, teléfono, etc.).
 */
export function parseBatch(text: string, type: Extract<PayloadId, 'url' | 'text' | 'phone' | 'email' | 'whatsapp' | 'sms' | 'custom'>): BatchRow[] {
  let rows = parseCsv(text)
  if (rows.length === 0) return []
  const head = rows[0].map((c) => c.trim().toLowerCase())
  const looksHeader = head.some((h) => ['nombre', 'name', 'titulo', 'título'].includes(h)) && head.some((h) => ['contenido', 'content', 'url', 'enlace', 'texto', 'telefono', 'teléfono', 'correo', 'email'].includes(h))
  const startLine = looksHeader ? 2 : 1
  if (looksHeader) rows = rows.slice(1)
  const t = PAYLOAD_BY_ID[type]
  const keyOf: Record<string, string> = { url: 'url', text: 'text', phone: 'phone', email: 'to', whatsapp: 'phone', sms: 'phone', custom: 'content' }
  const out: BatchRow[] = []
  rows.slice(0, BATCH_LIMIT).forEach((cols, i) => {
    const line = startLine + i
    const [a, b] = cols.map((c) => c.trim())
    const hasName = cols.length >= 2 && (b ?? '') !== ''
    const value = hasName ? b : a
    const values: Values = { ...t.defaults, [keyOf[type]]: value ?? '' }
    const res = t.build(values)
    if (res.ok) out.push({ line, name: hasName ? a || `fila-${line}` : '', content: res.content })
    else out.push({ line, name: hasName ? a : '', content: value ?? '', error: Object.values(res.errors)[0] })
  })
  if (rows.length > BATCH_LIMIT) out.push({ line: startLine + BATCH_LIMIT, name: '', content: '', error: `Se procesan solo las primeras ${BATCH_LIMIT} filas.` })
  // Nombres automáticos y únicos
  const used = new Set<string>()
  for (const r of out) {
    let base = r.name || (r.content.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30) || `fila-${r.line}`)
    let n = base
    let k = 2
    while (used.has(n)) n = `${base}-${k++}`
    used.add(n)
    r.name = n
    base = n
  }
  return out
}
