import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { DEFAULT_STYLE, isSafeImageDataUrl, type QrStyle } from './qr'
import { PAYLOAD_BY_ID, type PayloadId, type Values } from './payloads'

export interface QrProject {
  id: string
  title: string
  description: string
  favorite: boolean
  type: PayloadId
  values: Values
  /** Contenido final codificado en el momento de guardar. */
  content: string
  style: QrStyle
  createdAt: number
  updatedAt: number
}

export interface StyleTemplate {
  id: string
  name: string
  style: QrStyle
  createdAt: number
}

interface Schema extends DBSchema {
  projects: { key: string; value: QrProject; indexes: { 'by-updated': number } }
  templates: { key: string; value: StyleTemplate }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null
function db() {
  dbp ??= openDB<Schema>('qr-studio', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' }).createIndex('by-updated', 'updatedAt')
      d.createObjectStore('templates', { keyPath: 'id' })
    },
  })
  return dbp
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))

export async function listProjects(): Promise<QrProject[]> {
  return (await (await db()).getAllFromIndex('projects', 'by-updated')).reverse()
}
export async function saveProject(p: QrProject): Promise<void> { await (await db()).put('projects', p) }
export async function deleteProject(id: string): Promise<void> { await (await db()).delete('projects', id) }
export async function clearProjects(): Promise<void> { await (await db()).clear('projects') }
export async function listTemplates(): Promise<StyleTemplate[]> {
  return (await (await db()).getAll('templates')).sort((a, b) => b.createdAt - a.createdAt)
}
export async function saveTemplate(t: StyleTemplate): Promise<void> { await (await db()).put('templates', t) }
export async function deleteTemplate(id: string): Promise<void> { await (await db()).delete('templates', id) }

// -------------------------------------------------- importación / exportación

/**
 * Formato JSON documentado (ver README):
 * { "format": "qr-studio-project", "version": 1, "exportedAt": ISO, "projects": [QrProject], "templates": [StyleTemplate] }
 */
export const EXPORT_FORMAT = 'qr-studio-project'
export const EXPORT_VERSION = 1

export function exportJson(projects: QrProject[], templates: StyleTemplate[]): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), projects, templates }, null, 2)
}

const HEX = /^#[0-9a-fA-F]{3,8}$/
const str = (v: unknown, max: number, d = ''): string => (typeof v === 'string' ? v.slice(0, max) : d)
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const color = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d)

/** Sanea un estilo importado: solo valores conocidos, colores hex, imágenes data: seguras. Nunca confía en el JSON. */
export function sanitizeStyle(raw: unknown): QrStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_STYLE
  let logo: QrStyle['logo'] = null
  const l = r.logo as Record<string, unknown> | null | undefined
  if (l && typeof l === 'object' && typeof l.dataUrl === 'string' && isSafeImageDataUrl(l.dataUrl) && l.dataUrl.length < 3_000_000) {
    logo = {
      dataUrl: l.dataUrl,
      size: num(l.size, 0.08, 0.4, 0.2),
      padding: num(l.padding, 0, 3, 1),
      background: l.background === 'transparent' ? 'transparent' : color(l.background, '#ffffff'),
      shape: l.shape === 'circle' ? 'circle' : 'square',
    }
  }
  return {
    ecc: oneOf(r.ecc, ['L', 'M', 'Q', 'H'] as const, d.ecc),
    fg: color(r.fg, d.fg), fg2: color(r.fg2, d.fg2),
    gradient: oneOf(r.gradient, ['none', 'linear', 'radial'] as const, d.gradient),
    gradientAngle: num(r.gradientAngle, 0, 360, d.gradientAngle),
    bg: color(r.bg, d.bg), transparent: r.transparent === true,
    moduleShape: oneOf(r.moduleShape, ['square', 'rounded', 'dots', 'diamond', 'vertical', 'horizontal'] as const, d.moduleShape),
    eyeFrame: oneOf(r.eyeFrame, ['square', 'rounded', 'circle', 'leaf'] as const, d.eyeFrame),
    eyeBall: oneOf(r.eyeBall, ['square', 'rounded', 'circle', 'diamond'] as const, d.eyeBall),
    eyeColor: r.eyeColor === '' ? '' : color(r.eyeColor, ''),
    margin: num(r.margin, 0, 12, d.margin),
    logo,
    frame: oneOf(r.frame, ['none', 'simple', 'rounded'] as const, d.frame),
    frameColor: color(r.frameColor, d.frameColor),
    title: str(r.title, 48),
    titlePosition: r.titlePosition === 'top' ? 'top' : 'bottom',
    titleColor: color(r.titleColor, d.titleColor),
  }
}

export interface ImportResult { projects: QrProject[]; templates: StyleTemplate[]; skipped: number }

export function parseImport(text: string): ImportResult {
  if (text.length > 25_000_000) throw new Error('El archivo es demasiado grande.')
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('El archivo no es un JSON válido.') }
  const o = data as Record<string, unknown>
  if (!o || typeof o !== 'object' || o.format !== EXPORT_FORMAT) throw new Error('Este archivo no es un proyecto de QR Studio.')
  if (typeof o.version !== 'number' || o.version > EXPORT_VERSION) throw new Error('El archivo fue creado con una versión más nueva de QR Studio.')
  let skipped = 0
  const projects: QrProject[] = []
  for (const p of Array.isArray(o.projects) ? o.projects : []) {
    const r = p as Record<string, unknown>
    const type = typeof r?.type === 'string' && r.type in PAYLOAD_BY_ID ? (r.type as PayloadId) : null
    if (!type || !r.values || typeof r.values !== 'object') { skipped++; continue }
    const values: Values = {}
    for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) if (typeof v === 'string') values[k.slice(0, 40)] = v.slice(0, 5000)
    const built = PAYLOAD_BY_ID[type].build({ ...PAYLOAD_BY_ID[type].defaults, ...values })
    if (!built.ok) { skipped++; continue }
    projects.push({
      id: newId(), // siempre un id nuevo: importar nunca pisa lo existente
      title: str(r.title, 120, 'Sin título'), description: str(r.description, 500),
      favorite: r.favorite === true, type, values, content: built.content,
      style: sanitizeStyle(r.style),
      createdAt: num(r.createdAt, 0, Date.now() + 1e9, Date.now()), updatedAt: Date.now(),
    })
  }
  const templates: StyleTemplate[] = []
  for (const t of Array.isArray(o.templates) ? o.templates : []) {
    const r = t as Record<string, unknown>
    if (!r || typeof r !== 'object') { skipped++; continue }
    templates.push({ id: newId(), name: str(r.name, 60, 'Plantilla'), style: sanitizeStyle(r.style), createdAt: Date.now() })
  }
  return { projects, templates, skipped }
}
