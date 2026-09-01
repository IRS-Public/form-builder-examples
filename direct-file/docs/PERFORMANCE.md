# The 705ms floor

A performance audit of the three surfaces this repo puts in front of you: the generated site as
Docker serves it, the Taxpert workspace chrome laid over it, and Fact Explorer's canvas.

Measured 2026-09-01 against the running stack — `direct-file` on `:3008` (built `--auditMode
--allScreens --scenarioMode --authorMode`), `fact-graph` 3.1.0-SNAPSHOT, and the
`form-builder-graph.json` generated the same day.

Every one of Direct File's 758 pages is a separate document load, and each one re-parses a 2.6 MB
fact dictionary from XML before it will show you anything. All three surfaces are slow; they are slow
for three unrelated reasons, and only one of them is the network.

| | |
|---|---|
| Blocking work, per navigation | **705 ms** — measured in Node/V8, warm. The page is hidden behind a spinner for all of it. |
| Requests, one workspace page | **~131** — HTTP/1.1, no compression, no `Cache-Control`. 73 JS modules, 39 stylesheets. |
| Fact Explorer graph | **8.76 MB** — 4,596 nodes and 8,622 edges, fetched whole to render one slice of it. |

Findings carry an id (`DF-`, `TX-`, `FX-`) so they can be referenced in a tracker. The order to do
them in is at the end, and it is not the order they are listed in.

---

## Surface 1 — the generated site

### The product pages spend 600 ms re-deriving a build-time constant

The static site has no client-side router: each of the 758 pages is a full document load, and each
load boots the Fact Graph from scratch. `fg-fact-graph.js` does that at *top-level await*, so every
other module in the runtime bundle waits on it, and `flow-runtime.js` only un-hides
`#page-content-wrapper` once it returns. The whole boot is therefore a blank screen with a spinner on
it.

```
                          0 ms                     375 ms                    750 ms
index.html (51 KB)        ▏                                                          2 ms
engine transfer (7.7 MB)  ▐▊                                                        46 ms
engine parse + compile      ▐███▌                                                  105 ms
dictionary transfer         ·   ▐▎                                                  17 ms
importFromXml()             ·    ▐████████████████████████████████████████████▌    600 ms
GraphFactory.apply()        ·                                                 ▏     <1 ms
                                                                              ▲
                                                 first content paint ─────────┘
```

Everything left of that mark is a blank screen. Transfer times are loopback and will be worse across
Docker Desktop's VM boundary; the CPU times will be worse in a browser that is also parsing a 51 KB
document.

### What the server is actually sending

```
$ curl -sI -H 'Accept-Encoding: gzip, br' \
    localhost:3008/app/direct-file/resources/vendor/fact-graph/factgraph-3.1.0.js

HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Content-Length: 7731169          ← no Content-Encoding, and gzip was offered
ETag: "6a96b6a2-75f7e1"
Last-Modified: Tue, 01 Sep 2026 11:27:30 GMT
                                 ← no Cache-Control at all
```

What compression would buy, measured on the shipped files:

| Asset | Served | gzip -6 | Ratio |
|---|---:|---:|---:|
| `factgraph-3.1.0.js` | 7,549 KB | 828 KB | 9.1× |
| `fact-dictionary.xml` | 2,660 KB | 231 KB | 11.4× |
| `flow-manifest.json` | 163 KB | 10 KB | 15.6× |
| **Critical path, per navigation** | **10.1 MB** | **1.05 MB** | **9.6×** |

### DF-1 · critical · Ship the fact dictionary as JSON and stop parsing XML in the browser

**−600 ms.** 600 of the 705 ms is `FactDictionaryFactory.importFromXml()` turning 2.6 MB of XML into
3,829 facts — producing a byte-identical result 758 times a session. This is static build-time data
being re-derived at runtime, and the generator already parses the very same file on the JVM.

The escape hatch already exists and is already exported: `JSFactDictionary.fromConfig()` builds the
dictionary from a plain JS object instead of an XML string, with a complete set of JS-facing config
classes behind it. Emit `fact-dictionary.json` alongside the XML at generation time and have the
runtime prefer it. No new API surface, and it pays out in every app on the scaffold.

> form-builder generator + `flow-runtime/js/fg-fact-graph.js` · export at
> `fact-graph/js/src/main/scala/gov/irs/factgraph/JSFactDictionary.scala:16`

### DF-2 · critical · Stop hiding the whole page behind the spinner

**First paint ≈ 50 ms.** The generated HTML is complete and readable on arrival — headings, help
text, the step indicator, the form. Only the *conditional* regions need the graph. Today the runtime
hides everything until the graph is up, so the boot cost is paid as blank screen rather than as
progressive detail.

Inverting the default — render the page, then let `showOrHideAllElements()` hide what the graph rules
out — puts first paint before the engine has even downloaded. It needs care so nothing flashes in and
back out, which is why it's a change to the conditional-region default rather than a one-liner. It
also stacks with DF-1 rather than competing with it.

> form-builder · `flow-runtime/js/flow-runtime.js`, and the theme's `.hidden` / `#loading-spinner`
> contract

### DF-3 · high · Turn on gzip in nginx.conf

**3 lines.** `nginx.conf` is 12 lines and sets no `gzip` directive, so the stock image's default
(off) stands. 10.1 MB of critical path compresses to 1.05 MB. On loopback that buys ~60 ms; across
Docker Desktop's VM boundary, a VPN, or any demo not on the host machine, it is the difference
between usable and not. Add `gzip_static on` and pre-compress at build time if you want it free at
request time.

> `direct-file/nginx.conf` — and the identical file in credit-assistant, benefits-enrollment,
> tax-withholding-estimator, and the fact-explorer container

### DF-4 · high · Send Cache-Control on the vendored assets

**3 lines.** With only `ETag` and `Last-Modified`, the browser must revalidate every subresource on
every navigation — roughly 131 conditional requests per page, all of which answer 304. Everything
under `/resources/vendor/` is content that changes only when the image is rebuilt: serve it
`public, max-age=31536000, immutable` and give the HTML `no-cache`.

> `direct-file/nginx.conf` · a `location ^~ /app/direct-file/resources/vendor/` block

### DF-5 · medium · A development build of the engine is shipping to production

Both the Makefile and the Dockerfile build the engine with `fastOptJS`; the word `fullOptJS` appears
nowhere in fact-graph's `build.sbt`. Full optimisation runs the Scala.js optimiser's inlining and
dead-code elimination, which typically takes a large chunk off the 7.7 MB even with Closure inactive
(it is, for `ModuleKind.ESModule`). Worth measuring before assuming a number — but 7.7 MB of
unminified output on every page is a lot to leave on the table.

> `fact-graph/build.sbt` · `direct-file/Dockerfile` stage 1 · `direct-file/Makefile:17`

### DF-6 · medium · An empty unload listener is disabling the back-forward cache

**Back becomes instant.** `fg-fact-graph.js` registers `window.addEventListener('unload', () => {})`
under a comment noting that its presence disables bfcache in Firefox. It disables it in Chrome too —
so pressing Back re-pays the full 705 ms instead of restoring a live page. The listener has an empty
body and no other caller.

If it is vestigial, deleting it makes backward navigation through the flow instant. If something
depends on it firing, `pagehide` does the same job without costing bfcache. Either way the comment
should say which.

> form-builder · `flow-runtime/js/fg-fact-graph.js`

### DF-7 · medium · 39 stylesheets down a three-deep @import chain

`main.css` imports the theme, which imports fourteen component sheets; the taxpert bundles add twenty
more. CSS `@import` is discovered only after the importing sheet parses, so this is three serial
round trips of render-blocking work — and USWDS's 512 KB stylesheet is behind `main.css`, where the
browser's preload scanner never sees it.

The `@import` tree is good source organisation and worth keeping. Concatenate it at build time, or at
minimum promote the top-level sheets to `<link>` tags so they start in parallel.

> `direct-file/…/styles/main.css` · form-builder `theme/styles/theme.css`

### DF-8 · medium · A 4.6 MB source map ships in the production image

`main.mjs.map` is copied into the runtime image next to the engine. It is only fetched with DevTools
open, so it costs nothing on a normal load — but it is 4.6 MB of image size and 4.6 MB of download
for anyone who opens the inspector to investigate this very problem. Gate it on the dev overlay.

> `direct-file/Dockerfile` stage 2

---

## Surface 2 — the Taxpert workspace chrome

### The nav bar has no markup until a fetch resolves — and that fetch is queued behind the 600 ms

This is the intermittent one, and it is not really a race between two random things. It is a
guaranteed empty window whose length is set by Surface 1. `<taxpert-global-nav>` clones its markup out
of a `<template>` file it fetches on connect, so the element exists in the DOM with no children until
that request lands *and* the main thread is free to run its callback.

```js
// taxpert/src/global-nav/js/taxpert-global-nav.js — connectedCallback()

this.ready = loadNavTemplates(this).then(() => {
  if (this.isConnected && !this._rendered) this.render()
})
// ↑ nothing awaits this.ready, and loadTemplates() rethrows on failure
```

A resolved fetch callback still cannot run while `importFromXml()` holds the main thread. The bar's
render is queued behind the flow runtime's boot.

### TX-1 · critical · Server-render the nav's templates into the page

**The race disappears.** `getTemplate()` already resolves `document.getElementById(id)` first — the
documented host-override handshake that `fragments/audit-panel.html` uses to pass scenario options
in. Use the same seam for the bar itself: have `workspace-head.html` emit `tgn-sprite`, `tgn-bar`,
`tgn-group` and `tgn-item` as real `<template>` elements.

The nav then renders synchronously on connect. No fetch, no preload, no window in which the header is
empty — and no change to taxpert at all, because the mechanism it needs is the one the package
already ships.

> `direct-file/…/templates/fragments/workspace-head.html` · reads
> `taxpert/src/shared/js/templates.js`

### TX-2 · high · A dropped template fetch fails silently

`loadTemplates()` drops its memo and rethrows on failure — correct, so a retry can work. But
`connectedCallback` assigns that promise to `this.ready` and nobody awaits it, so the rejection
surfaces as an unhandled promise rejection and the page simply has no nav bar. That is the shape of
"sometimes needs a hard refresh": the second load hits a warm cache and works, and nothing ever said
what went wrong.

Catch it, log the URL it failed on, and render a degraded bar. Loud failure is already the house
style here — it is what the thrown error inside `getTemplate()` is for.

> `taxpert/src/global-nav/js/taxpert-global-nav.js`

### TX-3 · high · Ship a bundled build beside the raw ESM

**52 requests → 1.** The workspace loads 52 modules across five levels of import waterfall, plus 14
template files and 21 stylesheets — every one a separate uncompressed, uncached request, because
credit-assistant and the Docker apps have no bundler. Each waterfall level is a serial round trip
that cannot start until the level above it has been fetched and parsed.

Keep `src/` as the source of truth and add a build output. The `exports` map can carry both
conditions, so fact-explorer keeps importing source and Vite keeps tree-shaking it, while no-bundler
hosts get one file. This is what makes the package's "raw ESM, works with or without a bundler"
promise cheap as well as true.

> `taxpert/package.json` · consumed by `make copy-shared-ui` and the Dockerfile's vendored COPY

---

## Surface 3 — Fact Explorer

### 8.76 MB fetched to render a slice, then every node in it mounted as a DOM subtree

Worth stating up front, because it redirects the fix: **parsing is not the problem.** Reading,
`JSON.parse`-ing and reference-checking the whole 8.76 MB graph takes about 34 ms. The cost is
transfer and render.

`direct-file/form-builder-graph.json`, as generated:

| Slice | Count | Rendered as canvas nodes? |
|---|---:|---|
| flowPages | 138 | No — kept for `validate()` |
| flowElements | 767 | Yes |
| facts | 3,829 | Yes |
| edges | 8,622 | Yes |
| **"Full graph" option** | **4,596 + 8,622** | All at once, all in the DOM |

### FX-1 · critical · React Flow is rendering every node, on-screen or not

**One prop.** `<ReactFlow>` is mounted without `onlyRenderVisibleElements`, so every node in the slice
becomes a live React component with a full DOM subtree — `FgmNode.jsx` is 173 lines of JSX per node.
On a large slice that is thousands of subtrees mounted, laid out and painted for a viewport showing a
few dozen. This is the single reason a big slice feels slow.

> `fact-explorer/src/canvas/FactExplorer.jsx:603`

### FX-2 · high · Changing any control remounts the entire canvas

The `key` prop on `<ReactFlow>` is a composite of the slice, neighbours flag, filters, facets,
orientation, layout version and scenario. Every one of those is an ordinary user control, and
touching any of them tears the whole instance down and rebuilds it — discarding React Flow's internal
measurement caches and re-mounting thousands of nodes rather than diffing them.

It is there to make `fitView` re-fire on a new slice. An effect that calls
`useReactFlow().fitView()` on the same signature does that without the remount.

> `fact-explorer/src/canvas/FactExplorer.jsx:604`

### FX-3 · high · Shard the graph on the partition the slicer already uses

**8.76 MB → ~50 KB.** `slice.js` opens by saying the graph "is too dense to read as one blob, so the
UI never renders it whole by default" — and then the loader fetches all of it before the first slice
appears. The two partition keys it slices on, `sourceFile` for facts and for flow pages, are exactly
the shards to emit.

Generate an index plus one file per flow module and fact file. Opening the default slice then costs
an index and one shard; "Full graph" becomes the only option that pays for the whole thing, which is
the honest price for it.

> `fact-explorer/scripts/make-static-fgm.mjs` + `src/model/load.js` · shard keys already in
> `src/model/slice.js`

### FX-4 · medium · The mock fixture is fetched on every load, in every mode

**2 lines.** `loadGraph()` does `const mock = await fetchJson(MOCK)` before it checks the mode, so the
real-data path waits on a fixture it will not use. It is only 18 KB, but it is a serial round trip on
the critical path ahead of the 8.76 MB fetch. Move it inside the branch that actually needs it.

> `fact-explorer/src/model/load.js:82`

### FX-5 · medium · The minimap draws a second copy of every node

`<MiniMap pannable zoomable>` renders an SVG rect per node and re-renders on viewport change,
doubling the node cost and putting work on every pan and zoom. It earns its place on a small slice.
Make it opt-in above a node threshold, or expose it in the Display options dialog the app already
owns.

> `fact-explorer/src/canvas/FactExplorer.jsx:621`

### FX-6 · medium · Vite serves taxpert unbundled in dev

`taxpert` is a `file:` dependency, and Vite does not pre-bundle linked dependencies — it treats them
as source. So the 52 modules of Surface 2 arrive as 52 separate dev-server requests here too, on top
of fact-explorer's own graph. Adding the package to `optimizeDeps.include` collapses them.

> `fact-explorer/vite.config.js` · `optimizeDeps.include`

---

## What to do, in the order that keeps each step shippable

This is a real sequence rather than a ranking: each step is independently shippable, and the later
ones are easier to measure once the earlier noise is gone.

**1. gzip and Cache-Control in every nginx.conf** — `DF-3`, `DF-4` · config only · hours

Six lines across five near-identical files, no code, no rebuild of anything but the runtime image. It
covers the workspace chrome and the Fact Explorer container too — they are served by the same stock
config. Do it first, so every measurement after this one is of real work rather than of transfer.

**2. onlyRenderVisibleElements, and drop the ReactFlow key** — `FX-1`, `FX-2`, `FX-4` · fact-explorer · hours

The largest win-per-line anywhere in this document. Fixes the large-slice freeze outright and makes
every control on the canvas respond instead of rebuild.

**3. Server-render the nav templates; make the failure loud** — `TX-1`, `TX-2` · per app · a day

Closes the intermittent-nav bug at its cause rather than making the window smaller. One fragment per
app, using a seam taxpert already ships — and the degraded-bar fallback means the next fetch failure
of any kind is visible instead of silent.

**4. Render the page before the graph is up** — `DF-2`, `DF-6` · form-builder · days

Turns the 705 ms from a blank screen into background work. Needs the conditional-region default
inverted carefully so nothing flashes in and back out — which is the whole of the difficulty, and why
it is not step 1. Delete the empty `unload` listener in the same pass.

**5. fact-dictionary.json and fromConfig()** — `DF-1` · form-builder + fact-graph · a week

The structural fix: 600 ms off every navigation in every app on the scaffold, by moving a parse from
758 page loads to one build step. Do it after step 4 so the win is measurable rather than hidden
behind a spinner, and bundle `DF-5` and `DF-7` into the same release.

**6. Shard the Form Builder Graph; bundle taxpert** — `FX-3`, `TX-3`, `FX-6` · library · a week

Both are the same move made twice: stop shipping the whole of something to use one part of it.
Neither is urgent once steps 1–2 have landed, and both get easier once there is a build step in
taxpert to hang them on.

---

## How to read these numbers

CPU timings are Node/V8 on one machine against the shipped bundle, with warm caches and no competing
document parse; a browser will be slower. Transfer timings are loopback to the running container on
`:3008` and will be worse over Docker Desktop's VM boundary. Neither caveat changes the ranking,
which is what these are for — the 600 ms XML parse dominates by roughly six to one, on any machine,
in any browser.

### Reproducing the measurements

```bash
# Response headers as served (no Content-Encoding, no Cache-Control)
curl -sI -H 'Accept-Encoding: gzip, br' \
  localhost:3008/app/direct-file/resources/vendor/fact-graph/factgraph-3.1.0.js

# Compression ratios on the shipped files
cd out/app/direct-file/resources
for f in vendor/fact-graph/factgraph-3.1.0.js fact-dictionary.xml flow-manifest.json; do
  printf '%s: %s -> %s\n' "$f" "$(stat -f %z "$f")" "$(gzip -6 -c "$f" | wc -c)"
done

# The boot cost. Copy the engine to a .mjs so node will load it as an ES module.
cp out/app/direct-file/resources/vendor/fact-graph/factgraph-3.1.0.js /tmp/fg.mjs
node --input-type=module -e '
  import fs from "node:fs"
  let t = performance.now()
  const fg = await import("/tmp/fg.mjs")
  console.log("engine import", (performance.now() - t).toFixed(0), "ms")
  const xml = fs.readFileSync(process.argv[1], "utf8")
  t = performance.now()
  const d = fg.FactDictionaryFactory.importFromXml(xml)
  console.log("importFromXml", (performance.now() - t).toFixed(0), "ms")
  t = performance.now()
  fg.GraphFactory.apply(d)
  console.log("GraphFactory.apply", (performance.now() - t).toFixed(0), "ms")
' out/app/direct-file/resources/fact-dictionary.xml
```

The request and module counts come from walking the `import` / `@import` graphs from the entry points
in one generated page's `<head>`: 73 JS modules (4 levels deep), 39 CSS files (3 levels deep), 14
template files fetched at runtime, plus the engine, the dictionary, USWDS and the document itself.
