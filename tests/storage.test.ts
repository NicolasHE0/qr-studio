import { describe, expect, it } from 'vitest'
import { exportJson, parseImport, sanitizeStyle, type QrProject } from '../src/lib/storage'
import { DEFAULT_STYLE } from '../src/lib/qr'
import { parseBatch, parseCsv } from '../src/lib/csv'

const proj: QrProject = { id: 'a', title: 'Mi enlace', description: '', favorite: true, type: 'url', values: { url: 'https://ejemplo.com' }, content: 'https://ejemplo.com/', style: DEFAULT_STYLE, createdAt: 1, updatedAt: 2 }

describe('import/export JSON', () => {
  it('ida y vuelta', () => {
    const r = parseImport(exportJson([proj], []))
    expect(r.projects).toHaveLength(1)
    expect(r.projects[0].title).toBe('Mi enlace')
    expect(r.projects[0].id).not.toBe('a')
    expect(r.projects[0].content).toBe('https://ejemplo.com/')
  })
  it('rechaza archivos ajenos o rotos', () => {
    expect(() => parseImport('no json')).toThrow()
    expect(() => parseImport('{"format":"otro"}')).toThrow()
    expect(() => parseImport(JSON.stringify({ format: 'qr-studio-project', version: 99 }))).toThrow()
  })
  it('revalida el contenido: una URL javascript: se descarta', () => {
    const bad = { ...proj, values: { url: 'javascript:alert(1)' }, content: 'javascript:alert(1)' }
    const r = parseImport(exportJson([bad as QrProject], []))
    expect(r.projects).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })
  it('sanea estilos maliciosos', () => {
    const s = sanitizeStyle({ fg: 'red;" onload="x', bg: '#fff', margin: 9999, logo: { dataUrl: 'javascript:alert(1)', size: 1 }, moduleShape: 'evil' })
    expect(s.fg).toBe(DEFAULT_STYLE.fg)
    expect(s.margin).toBe(12)
    expect(s.logo).toBeNull()
    expect(s.moduleShape).toBe('square')
  })
})

describe('CSV por lotes', () => {
  it('parsea comillas y separador ;', () => {
    expect(parseCsv('a;"b;c"\n1;2')).toEqual([['a', 'b;c'], ['1', '2']])
  })
  it('valida por fila y marca errores', () => {
    const rows = parseBatch('nombre,url\nUno,ejemplo.com\nDos,javascript:alert(1)\nTres,https://x.com.ar', 'url')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ line: 2, name: 'Uno', content: 'https://ejemplo.com/' })
    expect(rows[1].error).toBeTruthy()
    expect(rows[2].error).toBeUndefined()
  })
  it('una columna: nombres automáticos y únicos', () => {
    const rows = parseBatch('https://a.com\nhttps://a.com', 'url')
    expect(new Set(rows.map((r) => r.name)).size).toBe(2)
  })
})
