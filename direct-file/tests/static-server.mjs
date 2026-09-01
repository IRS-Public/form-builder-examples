// A static file server over the generated site, for the smoke test's `webServer`.
//
// Hand-rolled rather than a dependency, and it is ten lines of interest: the generated site is
// plain files, the flow runtime fetches two of them (`fact-dictionary.xml`, `flow-manifest.json`),
// and directory URLs have to resolve to `index.html` because every route is a directory. A package
// that did this would be one more thing to keep current for no more behaviour.
//
// PORT is passed by playwright.config.js; ROOT defaults to the build `make site` writes.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = process.env.SMOKE_ROOT ?? new URL('../out', import.meta.url).pathname
const PORT = Number(process.env.SMOKE_PORT ?? 4008)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

createServer(async (req, res) => {
  // The query string is Author Mode's; the fragment never reaches the server.
  const path = decodeURIComponent(req.url.split('?')[0])
  // normalize() first, so a `..` in the URL cannot walk out of the build directory.
  let file = join(ROOT, normalize(path))
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
  } catch { /* fall through to the read, which reports the 404 */ }

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`))
