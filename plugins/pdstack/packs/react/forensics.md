# react stack pack: forensics

Scope: capture and read runtime evidence from a React app in Chrome, for CPU, leak, hang, and visual glitch symptoms. The tools are Chrome DevTools and the Chrome DevTools Protocol (CDP).

Globs: `**/*.ts`, `**/*.tsx`

## Where captures go

Write every capture to `forensicsDir` from `.agents/pdstack.json`. If the key is absent, use `$TMPDIR/pdstack/<repo>/<timestamp>/`. Never write captures into the repo.

```bash
REPO=$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")
DIR="${TMPDIR%/}/pdstack/$REPO/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
```

## Connect to the page

Use one of these CDP connections:

- The Chrome DevTools MCP server. It records traces (`performance_start_trace`, `performance_stop_trace`) and runs code in the page (`evaluate_script`).
- Playwright: `const cdp = await page.context().newCDPSession(page)`, then `cdp.send(<method>, <params>)`.
- A Chrome that you start with a debug port and a private profile. Then connect to the WebSocket URL from `http://127.0.0.1:9222/json`.

  ```bash
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --remote-debugging-port=9222 --user-data-dir="$DIR/chrome-profile" "$URL"
  ```

A proof that edits code runs on a dev server in a throwaway worktree in the worktree home. Delete the worktree after the proof.

## Symbols to file and line

CDP gives the URL, line, and column of the served JavaScript, not of the TypeScript source. Resolve each position through the source map.

- The Vite dev server serves each module with an inline source map. A production build needs `build.sourcemap: true`.
- Load the map with the `source-map` package and call `originalPositionFor({ line, column })`.
- CDP lines and columns start at 0. The `source-map` package takes lines that start at 1 and columns that start at 0. Add 1 to the line.
- To go from a DOM node to its component, read the `__reactFiber$<id>` property of the node in the page. Read `type.name` of the fiber and of its `_debugOwner`. React 19 has no `_debugSource`, so search the source for the component name.
- A frame with no source position is not yet a diagnosis.

## CPU: a busy or slow page

- **Capture:** A `cpuprofile` while you reproduce the symptom. Use the DevTools Performance panel, or CDP: `Profiler.enable`, `Profiler.start`, the action, then `Profiler.stop`. Save the returned `profile` as `$DIR/cpu.cpuprofile`. For render cost, also record the React DevTools Profiler and export its JSON.
- **Format:** `.cpuprofile` (JSON with `nodes`, `samples`, and `timeDeltas`).
- **Converter:** Load the profile into sqlite with a short Node script. Make one row per node, with `functionName`, `url`, `lineNumber`, `columnNumber`, and the self sample count. Query for the nodes with the most samples, then walk the parent chain to the hot path.
- **Symbols:** Resolve the `url`, `lineNumber`, and `columnNumber` of the hot node through the source map.
- **Live proof:** Run code in the page with CDP eval (`Runtime.evaluate` or `evaluate_script`). Wrap the suspect function to count calls and time them. Or change the module and let Vite hot reload it with no page reload. Measure the same action again.

## Leak: memory that grows and stays

- **Capture:** Three heap snapshots. Take one, do the suspect action N times, take a second, do it N more times, and take a third. Use the DevTools Memory panel, or CDP: `HeapProfiler.enable`, `HeapProfiler.collectGarbage`, then `HeapProfiler.takeHeapSnapshot`. Join the `HeapProfiler.addHeapSnapshotChunk` events into `$DIR/snap-1.heapsnapshot`.
- **Format:** `.heapsnapshot` (JSON with flat `nodes`, `edges`, and `strings` arrays, described by `snapshot.meta`).
- **Converter:** Load each snapshot into sqlite with a short Node script. Make a `nodes` table (`id`, `type`, `name`, `self_size`, `detachedness`) and an `edges` table (`from_id`, `to_id`, `type`, `name`). Find the objects that the second and third snapshots add in equal numbers. Follow the retainer chain from the leaked object to a GC root with a recursive query. `Detached` DOM nodes, closures held by a listener, and a subscription with no cleanup are common causes.
- **Symbols:** The snapshot `locations` array gives the script, line, and column of each closure. Map the script ID to its URL, then resolve through the source map.
- **Live proof:** Count live instances with CDP eval. Force a GC (`HeapProfiler.collectGarbage`), then call `queryObjects(<Constructor>)` in the DevTools console, or `Runtime.queryObjects` over CDP. The count grows by N for each N repetitions. After the fix, it stays flat.

## Hang: the page does not respond

- **Capture:** A CDP trace of the main thread. Use the DevTools Performance panel, `performance_start_trace` in the MCP server, or CDP `Tracing.start` with the `devtools.timeline`, `disabled-by-default-devtools.timeline`, and `v8.execute` categories. Save it as `$DIR/hang.json.gz`. If the page is frozen, `Runtime.evaluate` does not return. Then call `Debugger.enable` and `Debugger.pause`, and save the `callFrames` of the `Debugger.paused` event.
- **Format:** Trace event JSON (`.json` or `.json.gz`). The paused stack is CDP JSON.
- **Converter:** Load the trace events into sqlite, one row per event, with `name`, `cat`, `ph`, `ts`, `dur`, `pid`, `tid`, and `args`. Query for `RunTask` events over 50 ms on the renderer main thread (`CrRendererMain`), then for the function calls inside them.
- **Symbols:** Resolve the `url`, `lineNumber`, and `columnNumber` of each call frame through the source map.
- **Live proof:** Inject a `PerformanceObserver` for `longtask` entries with CDP eval, and repeat the action. Or set a logpoint with `Debugger.setBreakpointByUrl` and a condition such as `console.log('hit', state), false`. It logs each pass through the loop with no code change.

## Visual glitch: flicker, jump, or layout shift

- **Capture:** A CDP trace with screenshots while you reproduce the glitch. Add the `disabled-by-default-devtools.screenshot` category, or turn on Screenshots in the Performance panel. Turn on paint flashing and layout shift regions in the DevTools Rendering tab, or with `Overlay.setShowPaintRects` and `Overlay.setShowLayoutShiftRegions`. Turn on "Highlight updates" in React DevTools to see each render.
- **Format:** Trace event JSON (`.json` or `.json.gz`). The screenshot events hold JPEG frames in base64.
- **Converter:** Load the trace events into sqlite. Write each screenshot event to a numbered image to find the bad frame. Query the `LayoutShift` events and their `impacted_nodes` near that frame.
- **Symbols:** Resolve each `node_id` from `impacted_nodes` with `DOM.pushNodesByBackendIdsToFrontend`, then `DOM.describeNode`. Go from the node to its component through the fiber, then search the source.
- **Live proof:** With CDP eval, change the suspect style or state on the live page and repeat the action. Or change the module and let Vite hot reload it. The glitch must stop on the same steps.

## After the diagnosis

Report the capture, the reduced finding, the proof, the source location, and the capture paths. Delete any throwaway worktree that a proof used. Do not fix unless the user asks.
