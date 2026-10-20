# ios stack pack: forensics

Scope: capture and read runtime evidence from an iOS app on a simulator, for CPU, leak, hang, and visual glitch symptoms.

Globs: `**/*.swift`, `**/project.yml`

## Where captures go

Write every capture to `forensicsDir` from `.agents/pdstack.json`. If the key is absent, use `$TMPDIR/pdstack/<repo>/<timestamp>/`. Never write captures into the repo.

```bash
REPO=$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")
DIR="${TMPDIR%/}/pdstack/$REPO/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
```

## Find the process

A simulator app runs as a macOS process on the host. Thus the host tools `sample`, `spindump`, `leaks`, `heap`, `vmmap`, and `lldb` attach to it directly.

```bash
xcrun simctl launch "$UDID" <bundle-id>      # prints "<bundle-id>: <pid>"
pgrep -f "<App>.app/<App>"                   # if the app already runs
```

To get allocation stacks with file and line, launch with malloc stack logging:

```bash
SIMCTL_CHILD_MallocStackLogging=1 xcrun simctl launch "$UDID" <bundle-id>
```

## Symbols to file and line

Instruments, `spindump`, and `leaks` print `file:line` when the binary has debug info. A Debug build keeps it in the object files under DerivedData. For an address with no symbol, use `atos` with the load address from the capture:

```bash
xcrun atos -o <App>.app.dSYM/Contents/Resources/DWARF/<App> -arch arm64 -l <load-address> <address>
```

For a Debug build with no dSYM, point `-o` at the app binary. Keep DerivedData until the diagnosis ends. A frame with no file and line is not yet a diagnosis.

## CPU: a spinning or slow app

- **Capture:** Instruments Time Profiler through `xctrace`. For a quick look, `sample` the process.

  ```bash
  xcrun xctrace record --template 'Time Profiler' --device "$UDID" --attach <pid> \
    --time-limit 20s --output "$DIR/cpu.trace"
  sample <pid> 10 -file "$DIR/cpu.sample.txt"
  ```

- **Format:** `.trace` bundle. `sample` writes text.
- **Converter:** List the tables, then export the `time-profile` table to XML. Load the XML into sqlite with a short script, one row per sample with its frames.

  ```bash
  xcrun xctrace export --input "$DIR/cpu.trace" --toc > "$DIR/toc.xml"
  xcrun xctrace export --input "$DIR/cpu.trace" \
    --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' > "$DIR/cpu.xml"
  ```

  Query for the frames with the most samples, then walk to the hot path in app code.
- **Symbols:** Frames in the export carry names and often source paths. Resolve the rest with `atos`.
- **Live proof:** Attach `lldb -p <pid>`. Set a breakpoint on the hot function that logs and continues: `breakpoint set -n <function> -C "bt 5" -G true`. The hit rate confirms the loop with no rebuild.

## Leak: memory that grows and stays

- **Capture:** A memory graph from the live process. Do the suspect action N times between two graphs. Instruments `Leaks` and `Allocations` templates also work with `xctrace record`.

  ```bash
  leaks <pid> --outputGraph="$DIR/before.memgraph"
  # repeat the action N times
  leaks <pid> --outputGraph="$DIR/after.memgraph"
  ```

- **Format:** `.memgraph`.
- **Converter:** The command line tools read a `.memgraph` and print text. Save the text, or load the `heap` table into sqlite.

  ```bash
  leaks "$DIR/after.memgraph" > "$DIR/leaks.txt"
  heap "$DIR/after.memgraph" --diffFrom="$DIR/before.memgraph" > "$DIR/heap-diff.txt"
  heap "$DIR/after.memgraph" --addresses='<TypeName>' > "$DIR/addresses.txt"
  leaks "$DIR/after.memgraph" --traceTree=<address> > "$DIR/retainers.txt"
  vmmap --summary "$DIR/after.memgraph" > "$DIR/vmmap.txt"
  ```

  The `--traceTree` output is the retainer chain from the object to the process roots. A retain cycle shows as a loop in that tree. A closure that captures `self` strongly is the usual cause.
- **Symbols:** With malloc stack logging on, `leaks` prints the allocation backtrace with `file:line`. Use `malloc_history "$DIR/after.memgraph" <address>` for one object.
- **Live proof:** Repeat the action N more times and take a third graph. The instance count of the type grows by N each time. After the fix, the count stays flat.

## Hang: the UI does not respond

- **Capture:** `spindump` while the hang happens. It needs root. Instruments has a `Hangs` instrument that you add to a Time Profiler recording.

  ```bash
  sudo spindump <pid> 10 -file "$DIR/hang.spindump.txt"
  xcrun xctrace record --template 'Time Profiler' --instrument 'Hangs' --device "$UDID" \
    --attach <pid> --time-limit 30s --output "$DIR/hang.trace"
  ```

- **Format:** `spindump` writes text. `xctrace` writes a `.trace` bundle.
- **Converter:** Search the spindump text for the main thread (`com.apple.main-thread`). Read whether it is on CPU or blocked, and the wait reason. Export the hangs table of the trace with `xctrace export --toc`, then `--xpath`.
- **Symbols:** `spindump` symbolicates frames that have debug info. Resolve the rest with `atos`.
- **Live proof:** Attach `lldb -p <pid>` during the hang. Run `process interrupt`, then `bt all`. The main thread stack shows the blocking call. A `Task` that awaits on the main actor, a semaphore wait, or a synchronous file or network call are common causes.

## Visual glitch: flicker, jump, or wrong frame

- **Capture:** A video of the glitch, and a SwiftUI or hitch trace while you reproduce it.

  ```bash
  xcrun simctl io "$UDID" recordVideo --codec h264 "$DIR/glitch.mp4"
  xcrun xctrace record --template 'SwiftUI' --device "$UDID" --attach <pid> \
    --time-limit 15s --output "$DIR/swiftui.trace"
  xcrun xctrace record --template 'Animation Hitches' --device "$UDID" --attach <pid> \
    --time-limit 15s --output "$DIR/hitches.trace"
  ```

- **Format:** `.mp4` and `.trace` bundles.
- **Converter:** Split the video into frames to find the bad frame. Export the view body update and hitch tables to XML, then to sqlite. Count body updates for each view type.

  ```bash
  ffmpeg -i "$DIR/glitch.mp4" -vf fps=30 "$DIR/frame-%04d.png"
  ```

- **Symbols:** The SwiftUI trace names view types. Search the source for the type to get the file. To find why one body runs, add `let _ = Self._printChanges()` to that `body` in a throwaway worktree. It logs the property that changed.
- **Live proof:** Attach `lldb -p <pid>` and print the view hierarchy: `expr -l objc -O -- [[[UIApplication sharedApplication] keyWindow] recursiveDescription]`. Read the view model state with `expr` at a breakpoint. Confirm the frame that the video shows.

## After the diagnosis

Report the capture, the reduced finding, the proof, the source location, and the capture paths. Delete any throwaway worktree that a proof used. Do not fix unless the user asks.
