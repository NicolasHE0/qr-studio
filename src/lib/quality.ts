import { type Ecc, type QrMatrix, type QrStyle, computeLayout, hexToRgb, luminance, safeColor } from './qr'

export type Severity = 'error' | 'warn' | 'info'

export interface QualityIssue {
  id: string
  severity: Severity
  message: string
  /** Cambio sugerido que el usuario puede aplicar con un botón. */
  fix?: { label: string; style?: Partial<QrStyle>; printMm?: number }
}

/** Capacidad de recuperación de errores por nivel (porcentaje aproximado de la norma ISO/IEC 18004). */
export const ECC_RECOVERY: Record<Ecc, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 }

export const ECC_LABELS: Record<Ecc, string> = {
  L: 'L · Bajo (7 %)',
  M: 'M · Medio (15 %)',
  Q: 'Q · Alto (25 %)',
  H: 'H · Máximo (30 %)',
}

/** Relación de contraste WCAG entre dos colores hexadecimales. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Fracción aproximada de los módulos de datos tapada por el logo (incluido su margen). */
export function logoCoverage(n: number, style: QrStyle): number {
  if (!style.logo) return 0
  const side = n * style.logo.size + 2 * Math.min(style.logo.padding, 3)
  const area = style.logo.shape === 'circle' ? Math.PI * (side / 2) ** 2 : side * side
  return area / (n * n)
}

export interface AnalyzeInput {
  content: string
  matrix: QrMatrix | null
  style: QrStyle
  /** Ancho impreso del código completo, en mm. */
  printMm: number
  capacityError?: boolean
}

export function analyze({ content, matrix, style, printMm, capacityError }: AnalyzeInput): QualityIssue[] {
  const out: QualityIssue[] = []
  if (!content) {
    out.push({ id: 'empty', severity: 'error', message: 'Completá el contenido para generar el código.' })
    return out
  }
  if (capacityError || !matrix) {
    out.push({
      id: 'capacity',
      severity: 'error',
      message: 'El contenido es demasiado largo para este nivel de corrección.',
      fix: style.ecc !== 'L' ? { label: 'Bajar la corrección a L', style: { ecc: 'L' } } : undefined,
    })
    return out
  }

  // Contraste (sobre el fondo; si es transparente se asume una superficie clara).
  const bg = style.transparent ? '#ffffff' : safeColor(style.bg, '#ffffff')
  const colors = [safeColor(style.fg, '#000000')]
  if (style.gradient !== 'none') colors.push(safeColor(style.fg2, colors[0]))
  if (style.eyeColor) colors.push(safeColor(style.eyeColor, colors[0]))
  let worst = Infinity
  let inverted = false
  for (const c of colors) {
    worst = Math.min(worst, contrastRatio(c, bg))
    if (luminance(c) > luminance(bg)) inverted = true
  }
  if (worst < 3) {
    out.push({
      id: 'contrast',
      severity: 'error',
      message: `El contraste es muy bajo (${worst.toFixed(1)}:1). Es muy probable que no escanee.`,
      fix: { label: 'Usar negro sobre blanco', style: { fg: '#000000', fg2: '#000000', gradient: 'none', eyeColor: '', bg: '#ffffff' } },
    })
  } else if (worst < 4.5) {
    out.push({ id: 'contrast', severity: 'warn', message: `El contraste es justo (${worst.toFixed(1)}:1). Con poca luz o impreso puede costar escanearlo. Lo ideal es 4.5:1 o más.` })
  }
  if (inverted) {
    out.push({
      id: 'inverted',
      severity: 'warn',
      message: 'El código es más claro que el fondo (invertido). Muchos lectores de QR no lo reconocen.',
      fix: { label: 'Invertir colores', style: { fg: style.bg, bg: style.fg, gradient: 'none' } },
    })
  }
  if (style.transparent) {
    out.push({ id: 'transparent', severity: 'info', message: 'Con fondo transparente el contraste depende de la superficie donde lo coloques: usalo sobre fondos claros y lisos.' })
  }

  // Margen
  if (style.margin < 2) {
    out.push({ id: 'margin', severity: 'error', message: 'El margen libre es demasiado chico. Se necesita al menos 4 módulos de espacio vacío alrededor.', fix: { label: 'Poner margen de 4', style: { margin: 4 } } })
  } else if (style.margin < 4) {
    out.push({ id: 'margin', severity: 'warn', message: 'La norma recomienda un margen libre de 4 módulos como mínimo.', fix: { label: 'Poner margen de 4', style: { margin: 4 } } })
  }

  // Densidad frente al tamaño de impresión
  const total = matrix.n + 2 * style.margin
  const lay = computeLayout(matrix.n, style)
  const widthMm = printMm
  const moduleMm = widthMm / lay.width
  void total
  if (moduleMm < 0.25) {
    out.push({ id: 'density', severity: 'error', message: `Cada módulo medirá ${moduleMm.toFixed(2)} mm: demasiado chico para escanear. Agrandá el tamaño impreso o acortá el contenido.`, fix: { label: 'Subir a 40 mm', printMm: 40 } })
  } else if (moduleMm < 0.4) {
    out.push({ id: 'density', severity: 'warn', message: `Cada módulo medirá ${moduleMm.toFixed(2)} mm. Se recomienda 0.4 mm o más para impresiones comunes.` })
  }
  if (matrix.version >= 20) {
    out.push({ id: 'dense', severity: 'warn', message: `El código es muy denso (versión ${matrix.version}). Acortar el contenido o usar un QR dinámico lo haría mucho más fácil de escanear.` })
  } else if (matrix.version >= 10) {
    out.push({ id: 'dense', severity: 'info', message: `El código tiene bastante información (versión ${matrix.version}). Imprimilo con un tamaño generoso.` })
  }

  // Logo
  if (style.logo) {
    const cov = logoCoverage(matrix.n, style)
    const cap = ECC_RECOVERY[style.ecc]
    if (cov > cap * 0.8) {
      out.push({
        id: 'logo',
        severity: 'error',
        message: `El logo tapa ${(cov * 100).toFixed(0)} % del código y supera lo que la corrección ${style.ecc} puede recuperar. No escaneará.`,
        fix: { label: 'Achicar el logo', style: { logo: { ...style.logo, size: Math.max(0.12, Math.sqrt(cap * 0.4) - 0.04), padding: 1 } } },
      })
    } else if (cov > cap * 0.5 || style.logo.size > 0.28) {
      out.push({ id: 'logo', severity: 'warn', message: `El logo tapa ${(cov * 100).toFixed(0)} % del código. Cuanto más chico, más seguro es el escaneo.` })
    }
    if (style.ecc !== 'H' && style.ecc !== 'Q') {
      out.push({ id: 'logo-ecc', severity: 'warn', message: 'Con logo conviene usar corrección Q o H.', fix: { label: 'Usar nivel H', style: { ecc: 'H' } } })
    }
  }

  // Estilos
  if (['vertical', 'horizontal', 'diamond'].includes(style.moduleShape)) {
    out.push({ id: 'shape', severity: 'info', message: 'Este estilo de módulos es menos legible que el cuadrado. Probá el escaneo antes de imprimir.' })
  }
  if (style.gradient !== 'none') {
    out.push({ id: 'gradient', severity: 'info', message: 'En fotocopias en blanco y negro los degradados pierden contraste. Para eso usá color sólido.' })
  }
  if (style.title.trim().length > 32) {
    out.push({ id: 'title', severity: 'info', message: 'El título es largo y se verá en letra chica.' })
  }

  // Corrección de errores recomendada
  if (!style.logo && style.ecc === 'L' && moduleMm < 0.8) {
    out.push({ id: 'ecc', severity: 'info', message: 'Para impresiones chicas o en papel que se puede arrugar conviene el nivel M o Q.', fix: { label: 'Usar nivel Q', style: { ecc: 'Q' } } })
  }

  return out
}

/** Nivel de corrección sugerido. */
export function recommendEcc(opts: { hasLogo: boolean; rough?: boolean }): Ecc {
  if (opts.hasLogo) return 'H'
  if (opts.rough) return 'Q'
  return 'M'
}

/** Color hex → rgb() legible para pruebas. */
export const rgbOf = hexToRgb

// ------------------------------------------------------- asistente de uso

export interface UsagePreset {
  id: string
  label: string
  tips: string[]
  ecc: Ecc
  printMm: number
  margin: number
  /** Cambios de estilo que conviene aplicar. */
  style: Partial<QrStyle>
  /** Formato de descarga recomendado. */
  format: 'png' | 'svg' | 'pdf'
}

export const USAGE_PRESETS: UsagePreset[] = [
  {
    id: 'school',
    label: 'Fotocopia escolar',
    tips: [
      'Usá negro sobre blanco y sin degradados: la fotocopia pierde color y contraste.',
      'Imprimilo de al menos 25 mm de lado.',
      'Evitá el logo si se va a fotocopiar varias veces.',
    ],
    ecc: 'Q', printMm: 30, margin: 4,
    style: { fg: '#000000', bg: '#ffffff', gradient: 'none', transparent: false, moduleShape: 'square', logo: null },
    format: 'pdf',
  },
  {
    id: 'slides',
    label: 'Presentación',
    tips: [
      'Ponelo grande (al menos un cuarto de la altura de la diapositiva) y en una esquina libre.',
      'Dejá fondo claro alrededor: los proyectores bajan el contraste.',
      'Descargá PNG en alta resolución.',
    ],
    ecc: 'M', printMm: 80, margin: 4,
    style: { transparent: false, bg: '#ffffff' },
    format: 'png',
  },
  {
    id: 'poster',
    label: 'Cartel comercial',
    tips: [
      'Regla práctica: el lado del QR debe ser al menos un décimo de la distancia desde la que se escanea.',
      'Descargá SVG o PDF para que el taller de impresión no pixele el código.',
      'Si agregás logo, usá nivel H y probalo antes de mandar a imprimir.',
    ],
    ecc: 'Q', printMm: 100, margin: 4,
    style: {},
    format: 'svg',
  },
  {
    id: 'social',
    label: 'Publicación digital',
    tips: [
      'Descargá PNG de 1000 px o más: las redes comprimen las imágenes.',
      'Podés usar color y formas, pero mantené buen contraste.',
      'Verificá el escaneo desde otra pantalla antes de publicar.',
    ],
    ecc: 'Q', printMm: 60, margin: 4,
    style: {},
    format: 'png',
  },
  {
    id: 'card',
    label: 'Tarjeta personal',
    tips: [
      'Un lado de 20 a 25 mm alcanza si el contenido es corto.',
      'Para contactos largos (vCard) el código se vuelve denso: probá con un enlace a tu perfil.',
      'Usá nivel Q por si la tarjeta se desgasta.',
    ],
    ecc: 'Q', printMm: 25, margin: 4,
    style: { moduleShape: 'square' },
    format: 'pdf',
  },
]
