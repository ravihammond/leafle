import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useLeaflePdfViewer } from './viewer/useLeaflePdfViewer'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerDivRef = useRef<HTMLDivElement | null>(null)

  const { loadDocument, captureViewState, restoreViewState, zoomIn, zoomOut, fitWidth, hasRendered } =
    useLeaflePdfViewer(containerRef, viewerDivRef)

  const [fileLabel, setFileLabel] = useState('Loading…')

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

  // Initial load
  useEffect(() => {
    void loadDocument(`/pdf/current.pdf?t=${Date.now()}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          <div className="brand">leafle</div>
          <span className="toolbar-sep">·</span>
          <div className="file-label">{fileLabel}</div>
        </div>

        <div className="toolbar-right">
          <button onClick={zoomOut} title="Zoom out">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={zoomIn} title="Zoom in">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={fitWidth}>Fit width</button>
          <a href="/pdf/current.pdf" target="_blank" rel="noreferrer">
            Open PDF
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
