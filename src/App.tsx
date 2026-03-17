import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useLeaflePdfViewer } from './viewer/useLeaflePdfViewer'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerDivRef = useRef<HTMLDivElement | null>(null)

  const { loadDocument, markRendered, captureViewState, restoreViewState, zoomIn, zoomOut, fitWidth, hasRendered, scale, setScale } =
    useLeaflePdfViewer(containerRef, viewerDivRef)

  const [fileLabel, setFileLabel] = useState('Loading…')
  const [editingZoom, setEditingZoom] = useState(false)
  const [zoomInput, setZoomInput] = useState('')
  const zoomInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingZoom && zoomInputRef.current) {
      zoomInputRef.current.select()
    }
  }, [editingZoom])

  function commitZoom() {
    const parsed = parseInt(zoomInput, 10)
    if (!isNaN(parsed)) {
      const clamped = Math.min(300, Math.max(25, parsed))
      setScale(clamped / 100)
    }
    setEditingZoom(false)
  }

  useEffect(() => {
    fetch('/api/meta', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setFileLabel(data.mainTex ?? 'Unknown.tex')
      })
      .catch(() => {
        setFileLabel('Unknown.tex')
      })
  }, [])

  const STORAGE_KEY = 'leafle:viewState'

  // Initial load
  useEffect(() => {
    async function init() {
      const saved = localStorage.getItem(STORAGE_KEY)
      const initialState = saved ? (() => { try { return JSON.parse(saved) } catch { return null } })() : null

      await loadDocument(`/pdf/current.pdf?t=${Date.now()}`, initialState)

      if (initialState) {
        restoreViewState(initialState)
      }

      markRendered()
    }
    void init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save on scroll (debounced)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasRendered) return
    let timer: ReturnType<typeof setTimeout>
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const state = captureViewState()
        if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      }, 300)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => { container.removeEventListener('scroll', onScroll); clearTimeout(timer) }
  }, [hasRendered])

  // Save on zoom change
  useEffect(() => {
    if (!hasRendered) return
    const state = captureViewState()
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [scale])

  // Live reload
  useEffect(() => {
    if (!import.meta.hot) return

    import.meta.hot.on('leafle:pdf-updated', async (payload: { version?: number }) => {
      const version = payload?.version ?? Date.now()
      const state = captureViewState()
      await loadDocument(`/pdf/current.pdf?t=${version}`)
      if (state) {
        restoreViewState(state)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="toolbar-left">
          <div className="brand">
            <img src="/leaf_logo.svg" className="brand-logo" alt="" />
            leafle
          </div>
          <span className="toolbar-sep">·</span>
          <div className="file-label">{fileLabel}</div>
        </div>

        <div className="toolbar-right">
          <div className="zoom-controls">
            <button onClick={zoomOut} title="Zoom out">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <input
              type="range"
              className="zoom-slider"
              min={0.25}
              max={3}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              title="Zoom"
            />
            <button onClick={zoomIn} title="Zoom in">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {editingZoom ? (
              <input
                ref={zoomInputRef}
                type="text"
                className="zoom-percent-input"
                value={zoomInput}
                onChange={(e) => setZoomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitZoom() }
                  if (e.key === 'Escape') { setEditingZoom(false) }
                }}
                onBlur={commitZoom}
              />
            ) : (
              <span
                className="zoom-percent"
                title="Click to set zoom"
                onClick={() => {
                  setZoomInput(String(Math.round(scale * 100)))
                  setEditingZoom(true)
                }}
              >
                {Math.round(scale * 100)}%
              </span>
            )}
          </div>
          <button onClick={fitWidth}>Fit width</button>
          <a href="/pdf/current.pdf" download title="Download PDF">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 1v8M4 6l3 3 3-3M1 10v1.5A1.5 1.5 0 0 0 2.5 13h9A1.5 1.5 0 0 0 13 11.5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </header>

      <div ref={containerRef} className="viewer-container">
        {!hasRendered && (
          <div className="empty-state">
            <div>
              <div className="empty-state-spinner" />
              Waiting for the first successful PDF build…
            </div>
          </div>
        )}
        <div ref={viewerDivRef} className="pdfViewer" />
      </div>
    </div>
  )
}
