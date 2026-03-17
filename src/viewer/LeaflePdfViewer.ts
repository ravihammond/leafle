import * as pdfjsLib from 'pdfjs-dist'
import { PDFViewer, PDFLinkService, EventBus, LinkTarget } from 'pdfjs-dist/web/pdf_viewer.mjs'

export type SavedViewState = {
  pageNumber: number
  offsetRatio: number
  scale: number
}

export class LeaflePdfViewer {
  private eventBus!: EventBus
  private linkService!: PDFLinkService
  private viewer!: PDFViewer
  private container!: HTMLDivElement
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
  private loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null

  init(container: HTMLDivElement, viewerDiv: HTMLDivElement) {
    this.container = container

    this.eventBus = new EventBus()

    this.linkService = new PDFLinkService({
      eventBus: this.eventBus,
      externalLinkTarget: LinkTarget.BLANK,
    })

    this.viewer = new PDFViewer({
      container,
      viewer: viewerDiv,
      eventBus: this.eventBus,
      linkService: this.linkService,
    })

    this.linkService.setViewer(this.viewer)
  }

  async loadDocument(url: string): Promise<void> {
    // Cancel any in-flight load
    if (this.loadingTask) {
      try {
        await this.loadingTask.destroy()
      } catch {
        // ignore
      }
      this.loadingTask = null
    }

    this.loadingTask = pdfjsLib.getDocument(url)
    const pdfDoc = await this.loadingTask.promise
    this.loadingTask = null

    this.viewer.setDocument(pdfDoc)
    this.linkService.setDocument(pdfDoc)

    if (this.pdfDoc) {
      try {
        await this.pdfDoc.destroy()
      } catch {
        // ignore
      }
    }

    this.pdfDoc = pdfDoc
  }

  zoomIn() {
    this.viewer.increaseScale()
  }

  zoomOut() {
    this.viewer.decreaseScale()
  }

  fitWidth() {
    this.viewer.currentScaleValue = 'page-width'
  }

  captureViewState(): SavedViewState | null {
    if (!this.viewer) return null

    const pageNumber = this.viewer.currentPageNumber
    const scale = this.viewer.currentScale

    // Calculate offset ratio within the current page
    const pageView = this.viewer.getPageView(pageNumber - 1)
    if (!pageView?.div) return { pageNumber, offsetRatio: 0, scale }

    const pageTop = pageView.div.offsetTop
    const pageHeight = pageView.div.offsetHeight
    const viewportCenter = this.container.scrollTop + this.container.clientHeight / 2
    const centerWithinPage = viewportCenter - pageTop
    const offsetRatio = pageHeight > 0 ? centerWithinPage / pageHeight : 0

    return { pageNumber, offsetRatio, scale }
  }

  restoreViewState(state: SavedViewState) {
    if (!this.viewer) return

    this.viewer.currentScale = state.scale
    this.viewer.scrollPageIntoView({ pageNumber: state.pageNumber })

    // Fine-tune scroll position using offsetRatio
    const pageView = this.viewer.getPageView(state.pageNumber - 1)
    if (!pageView?.div) return

    const pageTop = pageView.div.offsetTop
    const pageHeight = pageView.div.offsetHeight
    const targetCenter = pageTop + pageHeight * state.offsetRatio
    const nextTop = Math.max(0, targetCenter - this.container.clientHeight / 2)
    this.container.scrollTop = nextTop
  }

  get onePageRendered(): Promise<unknown> {
    return this.viewer.onePageRendered
  }

  async destroy() {
    if (this.loadingTask) {
      try {
        await this.loadingTask.destroy()
      } catch {
        // ignore
      }
      this.loadingTask = null
    }

    if (this.pdfDoc) {
      try {
        await this.pdfDoc.destroy()
      } catch {
        // ignore
      }
      this.pdfDoc = null
    }
  }
}
