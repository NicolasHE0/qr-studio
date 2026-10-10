import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Toast = { id: number; text: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
}

export function CopyButton({ text, label = 'Copiar', disabled }: { text: string; label?: string; disabled?: boolean }) {
  const toast = useToast()
  return (
    <button type="button" className="btn sm" disabled={disabled || !text} onClick={async () => {
      const done = await copyText(text)
      toast(done ? 'Copiado al portapapeles' : 'No se pudo copiar', done ? 'ok' : 'err')
    }}>
      {label}
    </button>
  )
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="dialog-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
        <h2 id="dlg-t">{title}</h2>
        <div className="muted">{body}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button ref={ref} type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export function Spinner() { return <span className="spinner" aria-hidden="true" /> }

export function download(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
