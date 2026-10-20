# dotnet stack pack: forensics

Scope: capture and read runtime evidence from a .NET process, for CPU, leak, hang, and visual glitch symptoms.

Globs: `**/*.cs`, `**/*.csproj`, `**/Directory.Build.props`, `**/Directory.Packages.props`

## Where captures go

Write every capture to `forensicsDir` from `.agents/pdstack.json`. If the key is absent, use `$TMPDIR/pdstack/<repo>/<timestamp>/`. Never write captures into the repo.

```bash
REPO=$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")
DIR="${TMPDIR%/}/pdstack/$REPO/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
```

## Tools and the process

Install the diagnostic tools as global or local .NET tools: `dotnet-trace`, `dotnet-counters`, `dotnet-gcdump`, `dotnet-dump`, and `dotnet-stack`. Find the process ID of the API, not of the `dotnet run` wrapper:

```bash
dotnet-trace ps
```

A proof that edits code uses Hot Reload or a REPL patch. Run that stack in a throwaway worktree in the worktree home. Delete the worktree after the proof.

## Symbols to file and line

- `dotnet-trace` and `dotnet-gcdump` give method and type names, not lines. Search the source for the method or the type.
- `dotnet-dump analyze` reads the PDB files next to the assemblies. Then `clrstack` prints `file @ line` for each managed frame. Run `setsymbolserver -ms` for framework frames.
- A span or a log with `code.file.path` and `code.line.number` attributes leads to the call site directly.
- A frame with no method name or a type with no source is not yet a diagnosis.

## CPU: a busy or slow process

- **Capture:** Watch the counters first, then take a sampled trace while the symptom happens.

  ```bash
  dotnet-counters monitor -p <pid> --counters System.Runtime
  dotnet-counters collect -p <pid> --format csv -o "$DIR/counters.csv" --counters System.Runtime
  dotnet-trace collect -p <pid> --profile cpu-sampling --duration 00:00:00:30 -o "$DIR/cpu.nettrace"
  ```

  Newer `dotnet-trace` versions rename the CPU profile. Run `dotnet-trace list-profiles` and pick the sampled thread time profile.
- **Format:** `.nettrace` and `.csv`.
- **Converter:** Print the top methods as text, or convert to Speedscope JSON and load the samples into sqlite. Import the counters CSV directly.

  ```bash
  dotnet-trace report "$DIR/cpu.nettrace" topN -n 30 > "$DIR/cpu-top.txt"
  dotnet-trace convert "$DIR/cpu.nettrace" --format Speedscope -o "$DIR/cpu.speedscope.json"
  sqlite3 "$DIR/counters.db" ".import --csv $DIR/counters.csv counters"
  ```

  Query for the frames with the most samples, then walk up to the first frame in app code.
- **Symbols:** Method names come from the trace. Search the source for them.
- **Live proof:** Change the suspect code with Hot Reload (`dotnet watch`, or the Aspire rebuild for the resource) and send the same request. The CPU counter and the hot frame must change. If the repo has a C# REPL hook into the process, wrap the method there to time it with no restart.

## Leak: memory that grows and stays

- **Capture:** Watch `gc-heap-size` with `dotnet-counters`. Take a GC heap dump, repeat the suspect action N times, and take a second dump.

  ```bash
  dotnet-gcdump collect -p <pid> -o "$DIR/before.gcdump"
  # repeat the action N times
  dotnet-gcdump collect -p <pid> -o "$DIR/after.gcdump"
  dotnet-dump collect -p <pid> --type Heap -o "$DIR/after.dmp"
  ```

- **Format:** `.gcdump` and a core dump (`.dmp`).
- **Converter:** Print the type tables as text and diff them. Use the full dump for the retainer chain.

  ```bash
  dotnet-gcdump report "$DIR/before.gcdump" > "$DIR/before-types.txt"
  dotnet-gcdump report "$DIR/after.gcdump" > "$DIR/after-types.txt"
  dotnet-dump analyze "$DIR/after.dmp" -c "dumpheap -stat" -c "exit" > "$DIR/heap-stat.txt"
  dotnet-dump analyze "$DIR/after.dmp" -c "dumpheap -type <TypeName>" -c "exit" > "$DIR/instances.txt"
  dotnet-dump analyze "$DIR/after.dmp" -c "gcroot <address>" -c "exit" > "$DIR/retainers.txt"
  ```

  `gcroot` prints the chain from the object to a GC root: a static field, a handle, or a thread. A static cache, an event subscription that nobody removes, or a singleton that holds a scoped service are common causes.
- **Symbols:** Type and field names come from the dump. Search the source for them.
- **Live proof:** Repeat the action N more times and take a third dump. The instance count of the type grows by N each time. After the fix, the count stays flat after a full GC.

## Hang: requests that do not finish

- **Capture:** Watch `threadpool-queue-length` and `threadpool-thread-count` with `dotnet-counters`. A queue that grows while CPU is low means thread pool starvation. Take live stacks, then a full dump.

  ```bash
  dotnet-stack report -p <pid> > "$DIR/stacks.txt"
  dotnet-dump collect -p <pid> -o "$DIR/hang.dmp"
  ```

- **Format:** Text from `dotnet-stack`, and a core dump.
- **Converter:** Run the SOS commands as text output. Search for the frames that most threads share.

  ```bash
  dotnet-dump analyze "$DIR/hang.dmp" -c "pstacks" -c "exit" > "$DIR/pstacks.txt"
  dotnet-dump analyze "$DIR/hang.dmp" -c "clrstack -all" -c "exit" > "$DIR/clrstack.txt"
  dotnet-dump analyze "$DIR/hang.dmp" -c "syncblk" -c "threadpool" -c "dumpasync" -c "exit" > "$DIR/waits.txt"
  ```

  `.Result`, `.Wait()`, or `GetAwaiter().GetResult()` on many threads is sync-over-async. `syncblk` shows lock owners for a deadlock. `dumpasync` shows async state machines that wait.
- **Symbols:** `clrstack` prints `file @ line` when the PDB files are present.
- **Live proof:** Take `dotnet-stack report` two times a few seconds apart. The same frames on the same threads confirm the block. Then remove the blocking call with Hot Reload and confirm that the queue length falls.

## Visual glitch: wrong or unstable data on the screen

A back end has no pixels. A visual glitch that it causes is wrong, stale, or unstable data in a response. Examples are a row on two pages, a value that flips between two reads, or a stale cache entry.

- **Capture:** Record the responses and the traces while you reproduce the glitch. Export the browser network log as HAR if a SPA shows it.

  ```bash
  for i in 1 2 3; do curl -sS -D "$DIR/r$i.headers" -o "$DIR/r$i.json" -H "Authorization: Bearer $TOKEN" "$URL"; done
  dotnet aspire otel spans <api-resource> --apphost <AppHost> --format Json > "$DIR/spans.json"
  ```

- **Format:** JSON response bodies, headers, HAR, and OpenTelemetry span JSON.
- **Converter:** Load the responses and the spans into sqlite, one row per item or per span. Compare the item IDs and the order across calls. Read the SQL text of each database span.
- **Symbols:** A tagged query span carries its call site in `code.file.path` and `code.line.number`. A feature span is named for its request class. Search the source for it.
- **Live proof:** Change the suspect code with Hot Reload, for example add `ThenBy(x => x.Id)` to the sort, and repeat the same calls. The glitch must stop with no restart. Hot Reload works only in a Debug build. A rude edit, such as a changed method signature, needs a restart.

## After the diagnosis

Report the capture, the reduced finding, the proof, the source location, and the capture paths. Revert each Hot Reload change and each REPL patch. Delete any throwaway worktree that a proof used. Do not fix unless the user asks.
