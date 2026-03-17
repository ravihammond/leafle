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

        let stat: fs.Stats
        try {
          stat = fs.statSync(pdfPath)
        } catch {
          res.statusCode = 500
          res.end('Failed to stat PDF')
          return
        }

        const rangeHeader = req.headers['range']

        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Accept-Ranges', 'bytes')

        if (rangeHeader) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
          if (match) {
            const fileSize = stat.size
            const start = match[1] ? parseInt(match[1], 10) : 0
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
            const clampedEnd = Math.min(end, fileSize - 1)

            if (start > clampedEnd || start >= fileSize) {
              res.statusCode = 416
              res.setHeader('Content-Range', `bytes */${fileSize}`)
              res.end()
              return
            }

            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${clampedEnd}/${fileSize}`)
            res.setHeader('Content-Length', String(clampedEnd - start + 1))
            fs.createReadStream(pdfPath, { start, end: clampedEnd }).pipe(res)
            return
          }
        }

        res.setHeader('Content-Length', String(stat.size))
        fs.createReadStream(pdfPath).pipe(res)
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
