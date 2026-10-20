# ios stack pack: verification

Scope: prove a change to an iOS app on its real surface, the app on an iOS simulator.

Globs: `**/*.swift`, `**/project.yml`

## Where this file fits

Read this file first. It sets the surface, the proof bar, and the verdicts. Then use the project `verify` skill if the repo has one (for example `.agents/skills/verify-<app>/`). It knows the app launch, the seed data, and the drive steps. Then use `run` for any gap. If the project skill and this file disagree, the project skill wins.

Unit tests and a green build are not verification. They are preconditions. Verification watches the app do the thing that the request asked for.

## Surface

The primary surface is the app on a simulator that this run creates. Widgets, watch apps, App Intents, and CarPlay are secondary surfaces. State in the reply which surfaces the proof did not reach.

## Steps

1. Generate the project and build once, with no simulator. This is the fastest sanity check.

   ```bash
   xcodegen generate
   xcodebuild -project <App>.xcodeproj -scheme <App> \
     -destination 'generic/platform=iOS Simulator' build
   ```

2. Create a simulator with a unique name. Address it only by UDID. Never boot, erase, or delete a simulator that this run did not create.

   ```bash
   RUN="verify-$(date +%Y%m%d-%H%M%S)-$$"
   EVIDENCE=".verify-evidence/$RUN"; mkdir -p "$EVIDENCE"
   RUNTIME=$(xcrun simctl list runtimes available | awk '/^iOS / {print $NF}' | sort -V | tail -1)
   UDID=$(xcrun simctl create "<App>-$RUN" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "$RUNTIME")
   xcrun simctl boot "$UDID"
   xcrun simctl bootstatus "$UDID" -b
   ```

3. Build for that UDID with a private DerivedData folder, and install the app.

   ```bash
   xcodebuild -project <App>.xcodeproj -scheme <App> -destination "id=$UDID" \
     -derivedDataPath build/verify-dd build-for-testing
   xcrun simctl install "$UDID" build/verify-dd/Build/Products/Debug-iphonesimulator/<App>.app
   ```

4. Start any backend that the app needs in a private container with a free port. Do not use a shared test server.

5. Drive the feature as a user does. Use XCUITest, because `simctl` cannot tap. Run only the drive test, on the pinned UDID, and keep the result bundle.

   ```bash
   xcodebuild test-without-building -project <App>.xcodeproj -scheme <App> \
     -destination "id=$UDID" -derivedDataPath build/verify-dd \
     -only-testing:<App>UITests/<Suite>/<test> \
     -resultBundlePath "$EVIDENCE/<drive>.xcresult"
   xcrun xcresulttool get test-results summary --path "$EVIDENCE/<drive>.xcresult"
   ```

   Find elements by `accessibilityIdentifier`, then by label. Never use coordinates. Launch with the app's documented `--uitesting-*` arguments only.

6. Capture evidence from the host at any time.

   ```bash
   xcrun simctl io "$UDID" screenshot "$EVIDENCE/<name>.png"
   xcrun simctl io "$UDID" recordVideo --codec h264 "$EVIDENCE/<name>.mp4"   # Ctrl+C stops it
   xcrun simctl spawn "$UDID" log show --last 5m \
     --predicate 'subsystem == "<bundle-id>"' > "$EVIDENCE/<name>.log"
   xcrun simctl openurl "$UDID" "<scheme>://<path>"                          # deep links and intents
   ```

7. Read side effects on the other side of the boundary. For example, read the server record back with `curl` after the app writes it.

8. Clean up what this run created. Keep the evidence.

   ```bash
   xcrun simctl shutdown "$UDID"; xcrun simctl delete "$UDID"
   docker compose -p <run-project> down -v
   ```

Put evidence in a gitignored folder in the worktree, for example `.verify-evidence/<run>/`. Cleanup never deletes it.

## Proof bar

- Drive the real user path from a signed-in state. Do not call view model setters, add test-only endpoints, or seed state that a user cannot create.
- Capture the screen and the accessibility tree before and after the key step, not only the final screen.
- Confirm that the installed build matches the worktree. Rebuild and reinstall after each code change.
- Use real backends where the repo can run them. Mock only behind a boundary that production already isolates.

## Verdicts

- **VERIFIED:** The drive passed on a build of the current worktree. The evidence shows the action and the result that the request asked for. Side effects read back as expected.
- **NOT VERIFIED:** The drive ran on a current build, and the app did not do what the request asked. Or the bug still shows. Quote the failing step and attach its screenshot.
- **INCONCLUSIVE:** The proof did not reach the surface, or the result is ambiguous. Examples: the build or the simulator runtime failed for an unrelated reason, or the backend was unreachable. A flaky drive or a run of only unit tests is also inconclusive. Inconclusive is not a pass. Name what blocked the proof.
