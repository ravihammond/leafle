import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function leaflePlugin(): Plugin {
  return {
    name: 'leafle-plugin',
    configureServer(server) {
      const cacheDir = process.env.LEAFLE_CACHE_DIR
      const pdfName = process.env.LEAFLE_PDF_NAME
      const mainTex = process.env.LEAFLE_MAIN_TEX ?? 'Start leafle via the CLI'
      const pdfPath = cacheDir && pdfName ? path.join(cacheDir, pdfName) : null

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url !== '/api/meta') return next()

        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            mainTex,
            pdfName,
          }),
        )
      })

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url !== '/pdf/current.pdf') return next()

        if (!pdfPath || !fs.existsSync(pdfPath)) {
          res.statusCode = 404
          res.end('PDF not built yet')
          return
        }

        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Type', 'application/pdf')
        fs.createReadStream(pdfPath).pipe(res)
      })

      if (!pdfPath) return

      let lastMtimeMs = 0

      const timer = setInterval(() => {
        fs.stat(pdfPath, (err, stats) => {
          if (err) return

          if (stats.mtimeMs !== lastMtimeMs) {
            lastMtimeMs = stats.mtimeMs

            server.ws.send({
              type: 'custom',
              event: 'leafle:pdf-updated',
              data: { version: Date.now() },
            })
          }
        })
      }, 350)

      server.httpServer?.once('close', () => {
        clearInterval(timer)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), leaflePlugin()],
  server: {
    host: 'localhost',
    strictPort: true,
  },
  clearScreen: false,
})
