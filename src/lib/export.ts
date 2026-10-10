import { type QrMatrix, type QrStyle, renderSvg, computeLayout } from './qr'

export type ExportFormat = 'png' | 'svg' | 'jpeg' | 'pdf'

export const PAPER_MM: Record<string, [number, number]> = {
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
}

export interface ExportOptions {
  format: ExportFormat
  /** Ancho en píxeles para PNG/JPEG. */
  widthPx: number
  jpegQuality: number
  /** Tamaño impreso del código en mm (PDF). */
  printMm: number
  paper: keyof typeof PAPER_MM
  pdfMarginMm: number
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'png',
  widthPx: 1024,
  jpegQuality: 0.95,
  printMm: 50,
  paper: 'a4',
  pdfMarginMm: 15,
}

const MAX_CANVAS = 8192

export function mimeOf(format: ExportFormat): string {
  return { png: 'image/png', svg: 'image/svg+xml', jpeg: 'image/jpeg', pdf: 'application/pdf' }[format]
}

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('No se pudo dibujar el código. Probá sin logo o con otro formato.'))
      img.src = url
    })
    return img
  } finally {
    // Se libera cuando la imagen ya cargó.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export async function svgToCanvas(svg: string, widthPx: number, background: string | null): Promise<HTMLCanvasElement> {
  const w = Math.min(Math.max(64, Math.round(widthPx)), MAX_CANVAS)
  const img = await loadSvgImage(svg)
  const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1)
  const h = Math.round(w * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tu navegador no permite crear imágenes en este momento.')
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, w, h)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar el archivo.'))), type, quality))
}

/** Genera el archivo final. Todo ocurre en el navegador. */
export async function exportQr(m: QrMatrix, style: QrStyle, opts: ExportOptions): Promise<Blob> {
  if (opts.format === 'svg') {
    return new Blob([renderSvg(m, style, 1024)], { type: mimeOf('svg') })
  }
  const svg = renderSvg(m, style, 1024)
  if (opts.format === 'png') {
    const canvas = await svgToCanvas(svg, opts.widthPx, null)
    return canvasToBlob(canvas, 'image/png')
  }
  if (opts.format === 'jpeg') {
    // JPEG no admite transparencia: se rellena con el color de fondo (o blanco).
    const bg = style.transparent ? '#ffffff' : style.bg
    const canvas = await svgToCanvas(svg, opts.widthPx, bg)
    return canvasToBlob(canvas, 'image/jpeg', opts.jpegQuality)
  }
  return exportPdf([{ matrix: m, style, label: '' }], { ...opts, copies: 1, grid: false })
}

// ------------------------------------------------------------------ PDF

export interface PdfItem {
  matrix: QrMatrix
  style: QrStyle
  label: string
}

/**
 * PDF con imágenes PNG de alta resolución (≥ 300 ppp al tamaño impreso).
 * Nota: no es vectorial; para impresión vectorial usá SVG.
 */
export async function exportPdf(
  items: PdfItem[],
  opts: ExportOptions & { copies: number; grid: boolean; cellGapMm?: number },
): Promise<Blob> {
  const [pw, ph] = PAPER_MM[opts.paper] ?? PAPER_MM.a4
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: 'portrait', compress: true })
  const margin = Math.max(5, opts.pdfMarginMm)
  const usableW = pw - 2 * margin
  const usableH = ph - 2 * margin

  // Raster a 300 ppp según el tamaño impreso (con tope razonable).
  const px = Math.min(MAX_CANVAS, Math.max(256, Math.round((opts.printMm / 25.4) * 300)))
  const images: { data: string; ratio: number; label: string }[] = []
  for (const it of items) {
    const svg = renderSvg(it.matrix, it.style, 1024)
    const canvas = await svgToCanvas(svg, px, it.style.transparent ? null : it.style.bg)
    images.push({ data: canvas.toDataURL('image/png'), ratio: canvas.height / canvas.width, label: it.label })
  }

  if (!opts.grid) {
    const w = Math.min(opts.printMm, usableW, usableH)
    const img = images[0]
    const h = w * img.ratio
    const x = (pw - w) / 2
    const y = margin
    doc.addImage(img.data, 'PNG', x, y, w, h, undefined, 'FAST')
    if (img.label) {
      doc.setFontSize(10)
      doc.text(img.label, pw / 2, y + h + 6, { align: 'center', maxWidth: usableW })
    }
    return doc.output('blob')
  }

  // Hoja con varios QR por página.
  const gap = opts.cellGapMm ?? 6
  const labelH = 6
  const cellW = Math.min(opts.printMm, usableW)
  const maxRatio = Math.max(...images.map((i) => i.ratio))
  const cellH = cellW * maxRatio + labelH
  const cols = Math.max(1, Math.floor((usableW + gap) / (cellW + gap)))
  const rows = Math.max(1, Math.floor((usableH + gap) / (cellH + gap)))
  const perPage = cols * rows
  const total = images.length * Math.max(1, opts.copies)
  const gridW = cols * cellW + (cols - 1) * gap
  const startX = (pw - gridW) / 2
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % perPage === 0) doc.addPage([pw, ph], 'portrait')
    const idx = i % perPage
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const img = images[i % images.length]
    const x = startX + col * (cellW + gap)
    const y = margin + row * (cellH + gap)
    doc.addImage(img.data, 'PNG', x, y, cellW, cellW * img.ratio, undefined, 'FAST')
    if (img.label) {
      doc.setFontSize(8)
      doc.text(img.label, x + cellW / 2, y + cellW * img.ratio + 4, { align: 'center', maxWidth: cellW })
    }
  }
  return doc.output('blob')
}

// --------------------------------------------------------------- descargas

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function extensionOf(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/** Píxeles de salida y tamaño de módulo en píxeles, para informar al usuario. */
export function exportInfo(m: QrMatrix, style: QrStyle, widthPx: number): { modulepx: number; heightPx: number } {
  const lay = computeLayout(m.n, style)
  return { modulepx: widthPx / lay.width, heightPx: Math.round((widthPx * lay.height) / lay.width) }
}
