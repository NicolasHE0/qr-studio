import type { QrStyle } from './qr'

export interface Palette { id: string; name: string; fg: string; bg: string; fg2?: string }

export const PALETTES: Palette[] = [
  { id: 'classic', name: 'Clásico', fg: '#000000', bg: '#ffffff' },
  { id: 'minimal', name: 'Minimalista', fg: '#1f2937', bg: '#f9fafb' },
  { id: 'elegant', name: 'Elegante', fg: '#3b1f12', bg: '#faf5ee' },
  { id: 'corporate', name: 'Corporativo', fg: '#0b3b6f', bg: '#ffffff' },
  { id: 'modern', name: 'Moderno', fg: '#4338ca', bg: '#ffffff', fg2: '#7c3aed' },
  { id: 'forest', name: 'Bosque', fg: '#14532d', bg: '#f0fdf4' },
  { id: 'sunset', name: 'Atardecer', fg: '#b91c1c', bg: '#fff7ed', fg2: '#c2410c' },
  { id: 'ocean', name: 'Océano', fg: '#075985', bg: '#f0f9ff', fg2: '#0e7490' },
  { id: 'night', name: 'Noche (claro sobre oscuro)', fg: '#f8fafc', bg: '#0f172a' },
]

export function applyPalette(p: Palette): Partial<QrStyle> {
  return { fg: p.fg, bg: p.bg, fg2: p.fg2 ?? p.fg, gradient: p.fg2 ? 'linear' : 'none', eyeColor: '', transparent: false }
}
