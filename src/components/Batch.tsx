import { useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { PAYLOAD_BY_ID } from '../lib/payloads'
import { buildMatrix, renderSvg, type QrStyle } from '../lib/qr'
import { BATCH_LIMIT, parseBatch } from '../lib/csv'
import { DEFAULT_EXPORT, PAPER_MM, downloadBlob, exportPdf, svgToCanvas } from '../lib/export'
import { toFileName } from '../lib/payloads'
import { Spinner, useToast, download } from './ui'

type BatchType = 'url' | 'text' | 'phone' | 'email' | 'whatsapp' | 'sms' | 'custom'
const TYPES: BatchType[] = ['url', 'text', 'phone', 'email', 'whatsapp', 'sms', 'custom']

export function Batch({ style }: { style: QrStyle }) {
  const toast = useToast()
  const [type, setType] = useState<BatchType>('url')
  const [text, setText] = useState('')
  const [fmt, setFmt] = useState<'png' | 'svg'>('png')
  const [px, setPx] = useState(1024)
  const [busy, setBusy] = useState<null | string>(null)
  const [progress, setProgress] = useState(0)
  const [paper, setPaper] = useState('a4')
  const [mm, setMm] = useState(40)
  const [copies, setCopies] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => parseBatch(text, type), [text, type])
  const good = rows.filter((r) => !r.error)
  const bad = rows.filter((r) => r.error)

  const loadFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 2_000_000) { toast('El archivo es demasiado grande (máx. 2 MB).', 'err'); return }
    setText(await f.text())
    if (fileRef.current) fileRef.current.value = ''
  }

  const zip = async () => {
    setBusy('zip'); setProgress(0)
    try {
      const files: Record<string, Uint8Array> = {}
      let i = 0
      const names = new Set<string>()
      for (const r of good) {
        let n = toFileName(r.name); let k = 2
        while (names.has(n)) n = `${toFileName(r.name)}-${k++}`
        names.add(n)
        const m = buildMatrix(r.content, style.ecc)
        if (fmt === 'svg') files[`${n}.svg`] = strToU8(renderSvg(m, style, 1024))
        else {
          const canvas = await svgToCanvas(renderSvg(m, style, 1024), px, null)
          const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falló la imagen'))), 'image/png'))
          files[`${n}.png`] = new Uint8Array(await blob.arrayBuffer())
        }
        setProgress(Math.round((++i / good.length) * 100))
      }
      if (bad.length) files['errores.txt'] = strToU8(bad.map((b) => `Fila ${b.line}: ${b.error} (${b.content})`).join('\n'))
      downloadBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), 'qr-lote.zip')
      toast(`ZIP con ${good.length} códigos descargado`)
    } catch (e) { toast((e as Error).message || 'No se pudo crear el ZIP.', 'err') } finally { setBusy(null) }
  }

  const sheet = async () => {
    setBusy('pdf')
    try {
      const items = good.map((r) => ({ matrix: buildMatrix(r.content, style.ecc), style, label: r.name }))
      downloadBlob(await exportPdf(items, { ...DEFAULT_EXPORT, format: 'pdf', paper, printMm: mm, copies, grid: true }), 'qr-hoja-imprimible.pdf')
      toast('Hoja imprimible descargada')
    } catch (e) { toast((e as Error).message || 'No se pudo crear el PDF.', 'err') } finally { setBusy(null) }
  }

  return (
    <div className="col">
      <section className="card">
        <header><h2>Generación por lotes</h2></header>
        <p className="muted" style={{ marginTop: 0 }}>Pegá una lista (una fila por QR) o subí un CSV. Usa el estilo que tengas armado en la pantalla Crear. Formato: <code>nombre,contenido</code> o solo el contenido.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="bt">Tipo de contenido</label><select id="bt" value={type} onChange={(e) => setType(e.target.value as BatchType)}>{TYPES.map((t) => <option key={t} value={t}>{PAYLOAD_BY_ID[t].label}</option>)}</select></div>
          <div className="field"><label htmlFor="bf">Archivo CSV</label><input id="bf" ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} /></div>
        </div>
        <div className="field" style={{ marginTop: 12 }}><label htmlFor="bx">Lista</label><textarea id="bx" style={{ minHeight: 160 }} value={text} placeholder={'nombre,url\nSitio del colegio,https://ejemplo.edu.ar\nBiblioteca,https://ejemplo.edu.ar/biblioteca'} onChange={(e) => setText(e.target.value)} /><span className="help">Hasta {BATCH_LIMIT} filas. Se acepta coma o punto y coma.</span></div>
        <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn sm" onClick={() => download('nombre,contenido\nEjemplo,https://ejemplo.com.ar\n', 'plantilla-lote.csv', 'text/csv')}>Descargar CSV de ejemplo</button>{text && <button type="button" className="btn sm" onClick={() => setText('')}>Vaciar</button>}</div>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <header><h2>Revisión</h2><div className="row"><span className="badge ok">{good.length} válidos</span>{bad.length > 0 && <span className="badge err">{bad.length} con errores</span>}</div></header>
          <div className="table-wrap"><table><thead><tr><th>Fila</th><th>Nombre</th><th>Contenido</th><th>Estado</th></tr></thead>
            <tbody>{rows.slice(0, 200).map((r) => <tr key={r.line + r.name}><td>{r.line}</td><td>{r.name}</td><td className="mono" style={{ overflowWrap: 'anywhere' }}>{r.content.slice(0, 80)}</td><td>{r.error ? <span className="badge err">{r.error}</span> : <span className="badge ok">OK</span>}</td></tr>)}</tbody></table></div>
          {rows.length > 200 && <p className="small muted">Se muestran las primeras 200 filas; se procesan todas.</p>}
        </section>
      )}

      <section className="card">
        <header><h2>Descargar resultados</h2></header>
        <div className="form-grid">
          <div className="field"><label htmlFor="bfmt">Formato en el ZIP</label><select id="bfmt" value={fmt} onChange={(e) => setFmt(e.target.value as 'png' | 'svg')}><option value="png">PNG</option><option value="svg">SVG</option></select></div>
          {fmt === 'png' && <div className="field"><label htmlFor="bpx">Resolución</label><select id="bpx" value={px} onChange={(e) => setPx(Number(e.target.value))}>{[512, 1024, 2048].map((v) => <option key={v} value={v}>{v} px</option>)}</select></div>}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={!good.length || busy !== null} onClick={zip}>{busy === 'zip' ? <><Spinner /> {progress}%</> : `Descargar ZIP (${good.length})`}</button>
        </div>
        <details className="adv"><summary>Hoja imprimible con varios QR por página</summary>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor="bp">Papel</label><select id="bp" value={paper} onChange={(e) => setPaper(e.target.value)}>{Object.keys(PAPER_MM).map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select></div>
            <div className="field"><label htmlFor="bm">Lado de cada QR (mm)</label><input id="bm" type="number" min={15} max={120} value={mm} onChange={(e) => setMm(Math.min(120, Math.max(15, Number(e.target.value) || 15)))} /></div>
            <div className="field"><label htmlFor="bc">Copias de cada uno</label><input id="bc" type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} /></div>
          </div>
          <button type="button" className="btn" style={{ marginTop: 10 }} disabled={!good.length || busy !== null} onClick={sheet}>{busy === 'pdf' ? <Spinner /> : null} Descargar hoja (PDF)</button>
        </details>
      </section>
    </div>
  )
}
