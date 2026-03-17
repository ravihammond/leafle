import { useEffect, useRef, useState, type RefObject } from 'react'
import { LeaflePdfViewer, type SavedViewState } from './LeaflePdfViewer'

export function useLeaflePdfViewer(
  containerRef: RefObject<HTMLDivElement | null>,
  viewerDivRef: RefObject<HTMLDivElement | null>,
) {
  const controllerRef = useRef<LeaflePdfViewer | null>(null)
  const [hasRendered, setHasRendered] = useState(false)
  const [scale, setScaleState] = useState(1.0)

  useEffect(() => {
    const container = containerRef.current
    const viewerDiv = viewerDivRef.current
    if (!container || !viewerDiv) return

    const controller = new LeaflePdfViewer()
    controller.init(container, viewerDiv)
    controller.onScaleChange = (s) => setScaleState(s)
    controllerRef.current = controller

    return () => {
      controllerRef.current = null
      void controller.destroy()
    }
  }, [containerRef, viewerDivRef])

  async function loadDocument(url: string, initialState?: SavedViewState) {
    const controller = controllerRef.current
    if (!controller) return

    await controller.loadDocument(url, initialState)
    try {
      await controller.onePageRendered
    } catch {
      // ignore (document replaced before first page rendered)
    }
  }

  function markRendered() {
    setHasRendered(true)
  }

  function captureViewState(): SavedViewState | null {
    return controllerRef.current?.captureViewState() ?? null
  }

  function restoreViewState(state: SavedViewState) {
    controllerRef.current?.restoreViewState(state)
  }

  function zoomIn() {
    controllerRef.current?.zoomIn()
  }

  function zoomOut() {
    controllerRef.current?.zoomOut()
  }

  function fitWidth() {
    controllerRef.current?.fitWidth()
  }

  function setScale(value: number) {
    controllerRef.current?.setScale(value)
  }

  return { loadDocument, markRendered, captureViewState, restoreViewState, zoomIn, zoomOut, fitWidth, hasRendered, scale, setScale }
}
