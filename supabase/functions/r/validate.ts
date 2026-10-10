// Validación de destinos del lado del servidor. Es una copia deliberada de la lógica del cliente
// (src/lib/dynamic.ts → validateDestination): el servidor NUNCA confía en lo que validó el navegador.
// tests/dynamic-server.test.ts comprueba que ambas den el mismo resultado.

export function isPublicHttpsUrl(input: string): { ok: true; url: string } | { ok: false } {
  let u: URL
  try { u = new URL(input) } catch { return { ok: false } }
  if (u.protocol !== 'https:') return { ok: false }
  if (u.username || u.password) return { ok: false }
  const h = u.hostname.toLowerCase()
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return { ok: false }
  if (h.startsWith('[')) return { ok: false }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return { ok: false }
  }
  if (u.toString().length > 2048) return { ok: false }
  return { ok: true, url: u.toString() }
}
