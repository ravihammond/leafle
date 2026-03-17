#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

function usage() {
  console.log(`Usage: leafle [--port PORT] [--open] [--verbose] <main.tex>

Options:
  --port PORT   Port for the Vite dev server (default: 3000)
  --open        Open the browser automatically
  --verbose     Stream latexmk output directly to the terminal
  -h, --help    Show this help
`)
}

function parseArgs(argv) {
  let port = 3000
  let open = false
  let verbose = false
  let texFile = null

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--port') {
      const next = argv[i + 1]
      if (!next) {
        throw new Error('Missing value for --port')
      }
      port = Number(next)
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid port: ${next}`)
      }
      i += 1
      continue
    }

    if (arg === '--open') {
      open = true
      continue
    }

    if (arg === '--verbose') {
      verbose = true
      continue
    }

    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (texFile !== null) {
      throw new Error('Please provide exactly one main .tex file')
    }

    texFile = arg
  }

  if (!texFile) {
    throw new Error('You must provide a main .tex file')
  }

  return { port, open, verbose, texFile }
}

async function openBrowser(url) {
  const child = spawn('open', ['-a', 'Google Chrome', url], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

async function main() {
  try {
    const { port, open, verbose, texFile } = parseArgs(process.argv.slice(2))

    const texAbs = path.resolve(process.cwd(), texFile)
    if (!fs.existsSync(texAbs)) {
      throw new Error(`File not found: ${texAbs}`)
    }
    if (path.extname(texAbs) !== '.tex') {
      throw new Error(`Expected a .tex file, got: ${texAbs}`)
    }

    const docDir = path.dirname(texAbs)
    const mainFile = path.basename(texAbs)
    const baseName = path.basename(texAbs, '.tex')

    const projectId = createHash('sha256')
      .update(`${docDir}/${mainFile}`)
      .digest('hex')
      .slice(0, 16)

    const cacheDir = path.join(os.homedir(), '.cache', 'leafle', projectId)
    fs.mkdirSync(cacheDir, { recursive: true })

    const logsDir = path.join(cacheDir, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })

    const stdoutLog = path.join(logsDir, 'latexmk.stdout.log')
    const stderrLog = path.join(logsDir, 'latexmk.stderr.log')

    process.env.LEAFLE_CACHE_DIR = cacheDir
    process.env.LEAFLE_PDF_NAME = `${baseName}.pdf`
    process.env.LEAFLE_MAIN_TEX = mainFile

    const stdoutTarget = verbose ? 'inherit' : fs.openSync(stdoutLog, 'a')
    const stderrTarget = verbose ? 'inherit' : fs.openSync(stderrLog, 'a')

    const latexmk = spawn(
      'latexmk',
      ['-pdf', '-pvc', '-view=none', '-cd', `-outdir=${cacheDir}`, texAbs],
      {
        cwd: docDir,
        stdio: ['ignore', stdoutTarget, stderrTarget],
      },
    )

    latexmk.on('error', (err) => {
      console.error('')
      console.error(`leafle: failed to start latexmk: ${err.message}`)
      process.exit(1)
    })

    const vite = await createServer({
      root: projectRoot,
      configFile: path.join(projectRoot, 'vite.config.ts'),
      mode: 'development',
      server: {
        host: 'localhost',
        port,
        strictPort: true,
      },
      clearScreen: false,
    })

    await vite.listen()
    vite.printUrls()

    if (process.stdin.isTTY) {
      vite.bindCLIShortcuts({ print: true })
    }

    const localUrl =
      vite.resolvedUrls?.local[0] ?? `http://localhost:${port}`

    console.log('')
    console.log(`  file   ${mainFile}`)
    console.log(`  cache  ${cacheDir}`)
    if (!verbose) {
      console.log(`  logs   ${stdoutLog}`)
    }
    console.log('  stop   Ctrl+C')
    console.log('')

    if (open) {
      await openBrowser(localUrl)
    }

    let shuttingDown = false

    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true

      try {
        latexmk.kill('SIGINT')
      } catch {}

      try {
        await vite.close()
      } catch {}

      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    latexmk.on('exit', async (code, signal) => {
      if (shuttingDown) return

      console.error('')
      console.error('leafle: latexmk stopped unexpectedly')
      console.error(`  code   ${code ?? 'null'}`)
      console.error(`  sig    ${signal ?? 'null'}`)
      if (!verbose) {
        console.error(`  out    ${stdoutLog}`)
        console.error(`  err    ${stderrLog}`)
      }
      console.error('')

      await vite.close()
      process.exit(code ?? 1)
    })
  } catch (err) {
    console.error(`leafle: ${err.message}`)
    usage()
    process.exit(1)
  }
}

main()
