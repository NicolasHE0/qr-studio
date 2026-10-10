import jsQR from 'jsqr'
import { type QrMatrix } from './qr'

/** Convierte la matriz en píxeles RGBA (negro sobre blanco, con zona de silencio) para probar la decodificación. */
export function matrixToImageData(m: QrMatrix, scale = 8, margin = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const size = (m.n + 2 * margin) * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let r = 0; r < m.n; r++) {
    for (let c = 0; c < m.n; c++) {
      if (!m.isDark(r, c)) continue
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = (margin + c) * scale + x
          const py = (margin + r) * scale + y
          const i = (py * size + px) * 4
          data[i] = data[i + 1] = data[i + 2] = 0
        }
      }
    }
  }
  return { data, width: size, height: size }
}

export function decodeImageData(img: { data: Uint8ClampedArray; width: number; height: number }): string | null {
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return res ? res.data : null
}

/** Decodifica la matriz ideal (sin estilos). Prueba que el contenido codificado es correcto. */
export function verifyMatrix(m: QrMatrix, expected: string): boolean {
  return decodeImageData(matrixToImageData(m)) === expected
}

export type ScanTest =
  | { status: 'ok'; text: string }
  | { status: 'mismatch'; text: string }
  | { status: 'fail' }

/**
 * Rasteriza el SVG final (con estilos y logo) en un canvas del navegador y lo decodifica.
 * Es una prueba real del aspecto final, pero NO reemplaza probar con un celular:
 * jsQR es más tolerante o más estricto que algunos lectores.
 */
export async function scanTestSvg(svg: string, expected: string): Promise<ScanTest> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('No se pudo rasterizar el SVG'))
      img.src = url
    })
    const w = 640
    const h = Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas no disponible')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const text = decodeImageData(ctx.getImageData(0, 0, w, h))
    if (text === null) return { status: 'fail' }
    return text === expected ? { status: 'ok', text } : { status: 'mismatch', text }
  } finally {
    URL.revokeObjectURL(url)
  }
}
