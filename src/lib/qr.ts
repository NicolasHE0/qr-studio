import qrcode from 'qrcode-generator'

// La biblioteca codifica en Latin-1 por defecto: forzamos UTF-8 para tildes, ñ y emojis.
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s))

export type Ecc = 'L' | 'M' | 'Q' | 'H'
export type ModuleShape = 'square' | 'rounded' | 'dots' | 'diamond' | 'vertical' | 'horizontal'
export type EyeFrameShape = 'square' | 'rounded' | 'circle' | 'leaf'
export type EyeBallShape = 'square' | 'rounded' | 'circle' | 'diamond'
export type GradientKind = 'none' | 'linear' | 'radial'
export type FrameKind = 'none' | 'simple' | 'rounded'

export interface LogoOptions {
  dataUrl: string
  /** Fracción del ancho del código ocupada por el logo (0.1–0.35). */
  size: number
  /** Margen entre el logo y los módulos, en módulos. */
  padding: number
  background: string
  shape: 'square' | 'circle'
}

export interface QrStyle {
  ecc: Ecc
  fg: string
  fg2: string
  gradient: GradientKind
  gradientAngle: number
  bg: string
  transparent: boolean
  moduleShape: ModuleShape
  eyeFrame: EyeFrameShape
  eyeBall: EyeBallShape
  /** Vacío = usar el color principal. */
  eyeColor: string
  /** Zona de silencio en módulos. */
  margin: number
  logo: LogoOptions | null
  frame: FrameKind
  frameColor: string
  title: string
  titlePosition: 'top' | 'bottom'
  titleColor: string
}

export const DEFAULT_STYLE: QrStyle = {
  ecc: 'M',
  fg: '#000000',
  fg2: '#4f46e5',
  gradient: 'none',
  gradientAngle: 45,
  bg: '#ffffff',
  transparent: false,
  moduleShape: 'square',
  eyeFrame: 'square',
  eyeBall: 'square',
  eyeColor: '',
  margin: 4,
  logo: null,
  frame: 'none',
  frameColor: '#000000',
  title: '',
  titlePosition: 'bottom',
  titleColor: '#000000',
}

export interface QrMatrix {
  n: number
  version: number
  ecc: Ecc
  isDark: (r: number, c: number) => boolean
}

export class QrCapacityError extends Error {
  constructor() {
    super('El contenido es demasiado largo para un código QR con este nivel de corrección. Acortalo o bajá el nivel de corrección.')
    this.name = 'QrCapacityError'
  }
}

/** Genera la matriz de módulos. Lanza QrCapacityError si el contenido no entra. */
export function buildMatrix(content: string, ecc: Ecc): QrMatrix {
  const qr = qrcode(0, ecc)
  qr.addData(content, 'Byte')
  try {
    qr.make()
  } catch {
    throw new QrCapacityError()
  }
  const n = qr.getModuleCount()
  return { n, version: (n - 17) / 4, ecc, isDark: (r, c) => qr.isDark(r, c) }
}

// ---------------------------------------------------------------- geometría

const f = (x: number) => Number(x.toFixed(3))

/** Rectángulo con radios por esquina [sup-izq, sup-der, inf-der, inf-izq]. */
function rrect(x: number, y: number, w: number, h: number, r: [number, number, number, number]): string {
  const [tl, tr, br, bl] = r.map((v) => Math.min(v, w / 2, h / 2))
  const arc = (rad: number, dx: number, dy: number) => (rad > 0 ? `A${f(rad)} ${f(rad)} 0 0 1 ${f(dx)} ${f(dy)}` : '')
  return [
    `M${f(x + tl)} ${f(y)}`,
    `H${f(x + w - tr)}`, arc(tr, x + w, y + tr),
    `V${f(y + h - br)}`, arc(br, x + w - br, y + h),
    `H${f(x + bl)}`, arc(bl, x, y + h - bl),
    `V${f(y + tl)}`, arc(tl, x + tl, y),
    'Z',
  ].join('')
}

const circle = (cx: number, cy: number, r: number) =>
  `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`

const diamond = (cx: number, cy: number, r: number) =>
  `M${f(cx)} ${f(cy - r)}L${f(cx + r)} ${f(cy)}L${f(cx)} ${f(cy + r)}L${f(cx - r)} ${f(cy)}Z`

function isFinder(n: number, r: number, c: number): boolean {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
}

function frameRadii(shape: EyeFrameShape, size: number): [number, number, number, number] {
  switch (shape) {
    case 'square': return [0, 0, 0, 0]
    case 'rounded': return [size * 0.28, size * 0.28, size * 0.28, size * 0.28]
    case 'circle': return [size / 2, size / 2, size / 2, size / 2]
    case 'leaf': return [size * 0.42, 0, size * 0.42, 0]
  }
}

function eyePaths(ox: number, oy: number, frame: EyeFrameShape, ball: EyeBallShape): { frame: string; ball: string } {
  const outer = rrect(ox, oy, 7, 7, frameRadii(frame, 7))
  const inner = rrect(ox + 1, oy + 1, 5, 5, frameRadii(frame, 5))
  let b: string
  switch (ball) {
    case 'square': b = rrect(ox + 2, oy + 2, 3, 3, [0, 0, 0, 0]); break
    case 'rounded': b = rrect(ox + 2, oy + 2, 3, 3, [0.9, 0.9, 0.9, 0.9]); break
    case 'circle': b = circle(ox + 3.5, oy + 3.5, 1.5); break
    case 'diamond': b = diamond(ox + 3.5, oy + 3.5, 2.1); break
  }
  return { frame: outer + inner, ball: b }
}


/** Posiciones de los patrones de alineación (norma ISO/IEC 18004, anexo E). */
export function alignmentCenters(version: number): number[] {
  if (version < 2) return []
  const n = 4 * version + 17
  const count = Math.floor(version / 7) + 2
  const last = n - 7
  const step = version === 32 ? 26 : Math.ceil((last - 6) / (count - 1) / 2) * 2
  const pos = [6]
  for (let p = last, k = 1; k < count; p -= step, k++) pos.splice(1, 0, p)
  return pos
}

/** Módulos que pertenecen a algún patrón de alineación (cuadro de 5×5 alrededor de cada centro). */
function alignmentModules(m: QrMatrix): Set<number> {
  const out = new Set<number>()
  const c = alignmentCenters(m.version)
  const last = m.n - 7
  for (const r of c) for (const q of c) {
    if ((r === 6 && q === 6) || (r === 6 && q === last) || (r === last && q === 6)) continue // coinciden con ojos
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) out.add((r + dr) * m.n + (q + dc))
  }
  return out
}

function modulesPath(m: QrMatrix, shape: ModuleShape, skip: (r: number, c: number) => boolean, ox: number, oy: number): string {
  const { n } = m
  // Con estilos que no son cuadrados, los patrones de alineación se dibujan siempre como cuadrados:
  // los lectores los localizan por proporciones 1:1:1 y con puntos o rombos esa señal se pierde.
  const align = shape === 'square' ? new Set<number>() : alignmentModules(m)
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && m.isDark(r, c) && !isFinder(n, r, c) && !skip(r, c) && !align.has(r * n + c)
  const out: string[] = []
  switch (shape) {
    case 'square': {
      // Se unen los módulos contiguos de cada fila para evitar líneas finas entre ellos al rasterizar.
      for (let r = 0; r < n; r++) {
        let c = 0
        while (c < n) {
          if (dark(r, c)) {
            let e = c
            while (dark(r, e + 1)) e++
            out.push(`M${ox + c} ${oy + r}h${e - c + 1}v1h${-(e - c + 1)}Z`)
            c = e + 1
          } else c++
        }
      }
      break
    }
    case 'rounded':
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) out.push(rrect(ox + c + 0.03, oy + r + 0.03, 0.94, 0.94, [0.32, 0.32, 0.32, 0.32]))
      break
    case 'dots':
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) out.push(circle(ox + c + 0.5, oy + r + 0.5, 0.47))
      break
    case 'diamond':
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) out.push(diamond(ox + c + 0.5, oy + r + 0.5, 0.62))
      break
    case 'vertical': {
      for (let c = 0; c < n; c++) {
        let r = 0
        while (r < n) {
          if (dark(r, c)) {
            let e = r
            while (dark(e + 1, c)) e++
            out.push(rrect(ox + c + 0.08, oy + r, 0.84, e - r + 1, [0.42, 0.42, 0.42, 0.42]))
            r = e + 1
          } else r++
        }
      }
      break
    }
    case 'horizontal': {
      for (let r = 0; r < n; r++) {
        let c = 0
        while (c < n) {
          if (dark(r, c)) {
            let e = c
            while (dark(r, e + 1)) e++
            out.push(rrect(ox + c, oy + r + 0.08, e - c + 1, 0.84, [0.42, 0.42, 0.42, 0.42]))
            c = e + 1
          } else c++
        }
      }
      break
    }
  }
  if (align.size) {
    const ad = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && align.has(r * n + c) && m.isDark(r, c) && !skip(r, c)
    for (let r = 0; r < n; r++) {
      let c = 0
      while (c < n) {
        if (ad(r, c)) {
          let e = c
          while (ad(r, e + 1)) e++
          out.push(`M${ox + c} ${oy + r}h${e - c + 1}v1h${-(e - c + 1)}Z`)
          c = e + 1
        } else c++
      }
    }
  }
  return out.join('')
}

// -------------------------------------------------------------- composición

export interface Layout {
  /** Tamaño total en unidades (1 unidad = 1 módulo). */
  width: number
  height: number
  qrX: number
  qrY: number
  /** Lado de la zona del código incluida la zona de silencio. */
  qrSide: number
  titleBand: number
  pad: number
}

export function computeLayout(n: number, style: QrStyle): Layout {
  const qrSide = n + 2 * style.margin
  const pad = style.frame === 'none' ? 0 : Math.max(1.5, Math.round(n * 0.07))
  const hasTitle = style.title.trim().length > 0
  const titleBand = hasTitle ? Math.max(3.5, n * 0.14) : 0
  const width = qrSide + 2 * pad
  const height = qrSide + 2 * pad + titleBand
  const qrY = pad + (style.titlePosition === 'top' ? titleBand : 0)
  return { width, height, qrX: pad, qrY, qrSide, titleBand, pad }
}

export function logoRect(n: number, style: QrStyle, lay: Layout): { x: number; y: number; w: number; cx: number; cy: number } | null {
  if (!style.logo) return null
  const side = n // área de módulos (sin zona de silencio)
  const w = side * style.logo.size
  const cx = lay.qrX + style.margin + n / 2
  const cy = lay.qrY + style.margin + n / 2
  return { x: cx - w / 2, y: cy - w / 2, w, cx, cy }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/

/** Solo se aceptan colores hexadecimales para evitar inyecciones en el SVG. */
export function safeColor(c: string, fallback: string): string {
  return SAFE_COLOR.test(c) ? c : fallback
}

const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/

export function isSafeImageDataUrl(s: string): boolean {
  return SAFE_DATA_IMAGE.test(s)
}

/**
 * Devuelve un SVG autocontenido. `widthPx` define el tamaño en píxeles del ancho;
 * el alto se calcula proporcionalmente.
 */
export function renderSvg(m: QrMatrix, style: QrStyle, widthPx = 512): string {
  const lay = computeLayout(m.n, style)
  const fg = safeColor(style.fg, '#000000')
  const fg2 = safeColor(style.fg2, fg)
  const bg = safeColor(style.bg, '#ffffff')
  const eyeColor = style.eyeColor ? safeColor(style.eyeColor, fg) : ''
  const frameColor = safeColor(style.frameColor, '#000000')
  const titleColor = safeColor(style.titleColor, '#000000')
  const ox = lay.qrX + style.margin
  const oy = lay.qrY + style.margin
  const heightPx = Math.round((widthPx * lay.height) / lay.width)
  const logo = style.logo && isSafeImageDataUrl(style.logo.dataUrl) ? style.logo : null
  const lr = logo ? logoRect(m.n, style, lay) : null

  // Módulos ocultos por el logo (evita ruido detrás de la imagen).
  const clear = logo && lr ? logo.padding : 0
  const skip = (r: number, c: number) => {
    if (!lr) return false
    const mx = ox + c + 0.5
    const my = oy + r + 0.5
    const half = lr.w / 2 + clear
    if (logo!.shape === 'circle') return Math.hypot(mx - lr.cx, my - lr.cy) <= half
    return Math.abs(mx - lr.cx) <= half && Math.abs(my - lr.cy) <= half
  }

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${f(lay.width)} ${f(lay.height)}" width="${widthPx}" height="${heightPx}" role="img" aria-label="Código QR">`)

  // Degradado
  let fill = fg
  if (style.gradient !== 'none') {
    const cx = ox + m.n / 2
    const cy = oy + m.n / 2
    if (style.gradient === 'linear') {
      const a = (style.gradientAngle * Math.PI) / 180
      const dx = Math.cos(a) * (m.n / 2)
      const dy = Math.sin(a) * (m.n / 2)
      parts.push(`<defs><linearGradient id="qrg" gradientUnits="userSpaceOnUse" x1="${f(cx - dx)}" y1="${f(cy - dy)}" x2="${f(cx + dx)}" y2="${f(cy + dy)}"><stop offset="0" stop-color="${fg}"/><stop offset="1" stop-color="${fg2}"/></linearGradient></defs>`)
    } else {
      parts.push(`<defs><radialGradient id="qrg" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(m.n * 0.72)}"><stop offset="0" stop-color="${fg}"/><stop offset="1" stop-color="${fg2}"/></radialGradient></defs>`)
    }
    fill = 'url(#qrg)'
  }

  // Fondo y marco
  const solidFrame = style.frame !== 'none' && !style.transparent
  if (style.frame !== 'none') {
    const rad = style.frame === 'rounded' ? Math.min(lay.width, lay.height) * 0.06 : 0
    if (style.transparent) {
      // Con fondo transparente, el marco es solo un contorno.
      const stroke = lay.pad
      parts.push(`<rect x="${f(stroke / 2)}" y="${f(stroke / 2)}" width="${f(lay.width - stroke)}" height="${f(lay.height - stroke)}" rx="${f(rad)}" fill="none" stroke="${frameColor}" stroke-width="${f(stroke)}"/>`)
    } else {
      parts.push(`<rect x="0" y="0" width="${f(lay.width)}" height="${f(lay.height)}" rx="${f(rad)}" fill="${frameColor}"/>`)
      const innerRad = style.frame === 'rounded' ? rad * 0.6 : 0
      parts.push(`<rect x="${f(lay.pad)}" y="${f(lay.qrY)}" width="${f(lay.qrSide)}" height="${f(lay.qrSide)}" rx="${f(innerRad)}" fill="${bg}"/>`)
    }
  } else if (!style.transparent) {
    parts.push(`<rect width="${f(lay.width)}" height="${f(lay.height)}" fill="${bg}"/>`)
  }

  // Módulos
  const d = modulesPath(m, style.moduleShape, skip, ox, oy)
  parts.push(`<path d="${d}" fill="${fill}"/>`)

  // Ojos
  const eyeFill = eyeColor || fill
  const origins: [number, number][] = [[0, 0], [m.n - 7, 0], [0, m.n - 7]]
  for (const [c0, r0] of origins) {
    const e = eyePaths(ox + c0, oy + r0, style.eyeFrame, style.eyeBall)
    parts.push(`<path d="${e.frame}" fill="${eyeFill}" fill-rule="evenodd"/>`)
    parts.push(`<path d="${e.ball}" fill="${eyeFill}"/>`)
  }

  // Logo
  if (logo && lr) {
    const holder = lr.w + 2 * (logo.padding > 0 ? Math.min(logo.padding, 3) : 0)
    const lbg = safeColor(logo.background, '#ffffff')
    if (logo.background !== 'transparent') {
      if (logo.shape === 'circle') parts.push(`<circle cx="${f(lr.cx)}" cy="${f(lr.cy)}" r="${f(holder / 2)}" fill="${lbg}"/>`)
      else parts.push(`<rect x="${f(lr.cx - holder / 2)}" y="${f(lr.cy - holder / 2)}" width="${f(holder)}" height="${f(holder)}" rx="${f(holder * 0.08)}" fill="${lbg}"/>`)
    }
    const clipId = 'qrlogo'
    if (logo.shape === 'circle') parts.push(`<clipPath id="${clipId}"><circle cx="${f(lr.cx)}" cy="${f(lr.cy)}" r="${f(lr.w / 2)}"/></clipPath>`)
    parts.push(`<image href="${logo.dataUrl}" xlink:href="${logo.dataUrl}" x="${f(lr.x)}" y="${f(lr.y)}" width="${f(lr.w)}" height="${f(lr.w)}" preserveAspectRatio="xMidYMid meet"${logo.shape === 'circle' ? ` clip-path="url(#${clipId})"` : ''}/>`)
  }

  // Título
  const title = style.title.trim().slice(0, 48)
  if (title && lay.titleBand > 0) {
    const bandY = style.titlePosition === 'top' ? lay.pad : lay.pad + lay.qrSide
    const cy = bandY + lay.titleBand / 2
    const maxFs = lay.titleBand * 0.5
    const fitFs = (lay.width * 0.88) / (title.length * 0.58)
    const fs = Math.min(maxFs, fitFs)
    // Sobre un marco de color, el texto se elige automáticamente para tener buen contraste.
    const color = solidFrame ? (luminance(frameColor) > 0.4 ? '#000000' : '#ffffff') : titleColor
    parts.push(`<text x="${f(lay.width / 2)}" y="${f(cy)}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="700" font-size="${f(fs)}" fill="${color}">${esc(title)}</text>`)
  }

  parts.push('</svg>')
  return parts.join('')
}

/** Luminancia relativa WCAG de un color hexadecimal (0–1). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('')
  const num = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(num)) return [0, 0, 0]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

/** Dimensiones relativas (ancho/alto) del resultado final. */
export function aspectRatio(n: number, style: QrStyle): number {
  const lay = computeLayout(n, style)
  return lay.width / lay.height
}
