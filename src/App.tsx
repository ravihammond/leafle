import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

type SavedView = {
  pageNumber: number
  offsetRatio: number
  scale: number
}

const INITIAL_SCALE = 1.35

export default function App() {
  const viewerContainerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const pdfDocRef = useRef<any>(null)
  const scaleRef = useRef(INITIAL_SCALE)
  const loadingRef = useRef(false)
  const pendingVersionRef = useRef<number | null>(null)
  const firstLoadRef = useRef(true)

  const [fileLabel, setFileLabel] = useState('Loading…')
  const [pdfVersion, setPdfVersion] = useState<number>(Date.now())
  const [hasRenderedPdf, setHasRenderedPdf] = useState(false)

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

  useEffect(() => {
    if (!import.meta.hot) return

    import.meta.hot.on('leafle:pdf-updated', (payload: { version?: number }) => {
      setPdfVersion(payload?.version ?? Date.now())
    })
  }, [])

  useEffect(() => {
    void loadPdf({
      preserveView: !firstLoadRef.current,
      version: pdfVersion,
    })
    firstLoadRef.current = false
  }, [pdfVersion])

async function renderPage(page: any, pageNumber: number, scale: number) {
    const viewport = page.getViewport({ scale })
    const outputScale = window.devicePixelRatio || 1

    const wrapper = document.createElement('div')
    wrapper.className = 'page'
    wrapper.dataset.pageNumber = String(pageNumber)

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })

    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`

    wrapper.appendChild(canvas)

    await page.render({
      canvasContext: context!,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
    }).promise

    const textLayerDiv = document.createElement('div')
    textLayerDiv.className = 'textLayer'
    textLayerDiv.style.setProperty('--scale-factor', String(scale))
    wrapper.appendChild(textLayerDiv)

    const textLayer = new (pdfjsLib as any).TextLayer({
      textContentSource: await page.getTextContent(),
      container: textLayerDiv,
      viewport,
    })
    await textLayer.render()

    return wrapper
  }

  function captureViewState(): SavedView | null {
    const viewer = viewerRef.current
    const viewerContainer = viewerContainerRef.current
    if (!viewer || !viewerContainer) return null

    const pages = Array.from(viewer.querySelectorAll<HTMLElement>('.page'))
    if (pages.length === 0) return null

    const viewportCenter =
      viewerContainer.scrollTop + viewerContainer.clientHeight / 2

    let activePage = pages[0]
    for (const page of pages) {
      const top = page.offsetTop
      const bottom = top + page.offsetHeight
      if (viewportCenter >= top && viewportCenter <= bottom) {
        activePage = page
        break
      }
    }

    const centerWithinPage = viewportCenter - activePage.offsetTop
    const offsetRatio =
      activePage.offsetHeight > 0
        ? centerWithinPage / activePage.offsetHeight
        : 0

    return {
      pageNumber: Number(activePage.dataset.pageNumber),
      offsetRatio,
      scale: scaleRef.current,
    }
  }

  function restoreViewState(saved: SavedView) {
    const viewer = viewerRef.current
    const viewerContainer = viewerContainerRef.current
    if (!viewer || !viewerContainer) return

    const page = viewer.querySelector<HTMLElement>(
      `.page[data-page-number="${saved.pageNumber}"]`,
    )

    if (!page) {
      viewerContainer.scrollTop = 0
      return
    }

    const targetCenter = page.offsetTop + page.offsetHeight * saved.offsetRatio
    const nextTop = Math.max(
      0,
      targetCenter - viewerContainer.clientHeight / 2,
    )
    viewerContainer.scrollTop = nextTop
  }

  async function loadPdf({
    preserveView,
    version,
  }: {
    preserveView: boolean
    version: number
  }) {
    const viewer = viewerRef.current
    const viewerContainer = viewerContainerRef.current
    if (!viewer || !viewerContainer) return

    if (loadingRef.current) {
      pendingVersionRef.current = version
      return
    }

    loadingRef.current = true
    const savedView = preserveView ? captureViewState() : null

    try {
      const loadingTask = pdfjsLib.getDocument(`/pdf/current.pdf?t=${version}`)
      const nextPdfDoc = await loadingTask.promise

      const nextPages: HTMLDivElement[] = []
      for (let pageNumber = 1; pageNumber <= nextPdfDoc.numPages; pageNumber += 1) {
        const page = await nextPdfDoc.getPage(pageNumber)
        nextPages.push(await renderPage(page, pageNumber, scaleRef.current))
      }

      viewer.replaceChildren(...nextPages)

      if (pdfDocRef.current) {
        try {
          await pdfDocRef.current.destroy()
        } catch {
          // ignore
        }
      }

      pdfDocRef.current = nextPdfDoc
      setHasRenderedPdf(true)

      if (savedView && Math.abs(savedView.scale - scaleRef.current) < 0.0001) {
        restoreViewState(savedView)
      } else {
        viewerContainer.scrollTop = 0
      }
    } catch {
      if (!hasRenderedPdf) {
        viewer.replaceChildren()
      }
    } finally {
      loadingRef.current = false

      if (pendingVersionRef.current !== null && pendingVersionRef.current !== version) {
        const nextVersion = pendingVersionRef.current
        pendingVersionRef.current = null
        await loadPdf({
          preserveView: true,
          version: nextVersion,
        })
      }
    }
  }

  async function zoomIn() {
    scaleRef.current = Math.min(scaleRef.current + 0.1, 3)
    await loadPdf({
      preserveView: true,
      version: Date.now(),
    })
  }

  async function zoomOut() {
    scaleRef.current = Math.max(scaleRef.current - 0.1, 0.6)
    await loadPdf({
      preserveView: true,
      version: Date.now(),
    })
  }

  async function fitWidth() {
    const viewerContainer = viewerContainerRef.current
    const pdfDoc = pdfDocRef.current
    if (!viewerContainer || !pdfDoc) return

    const firstPage = await pdfDoc.getPage(1)
    const viewport = firstPage.getViewport({ scale: 1 })
    const availableWidth = Math.max(320, viewerContainer.clientWidth - 64)
    scaleRef.current = availableWidth / viewport.width

    await loadPdf({
      preserveView: true,
      version: Date.now(),
    })
  }

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="toolbar-left">
          <div className="brand">leafle</div>
          <span className="toolbar-sep">·</span>
          <div className="file-label">{fileLabel}</div>
        </div>

        <div className="toolbar-right">
          <button onClick={() => void zoomOut()} title="Zoom out">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={() => void zoomIn()} title="Zoom in">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={() => void fitWidth()}>Fit width</button>
          <a href="/pdf/current.pdf" target="_blank" rel="noreferrer">
            Open PDF
          </a>
        </div>
      </header>

      <main ref={viewerContainerRef} className="viewer-container">
        {!hasRenderedPdf && (
          <div className="empty-state">
            <div>
              <div className="empty-state-spinner" />
              Waiting for the first successful PDF build…
            </div>
          </div>
        )}
        <div ref={viewerRef} className="viewer" />
      </main>
    </div>
  )
}
