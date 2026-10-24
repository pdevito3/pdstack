# ios stack pack: standards

Scope: iOS apps in Swift and SwiftUI.

Globs: `**/*.swift`, `**/project.yml`

Apply these standards only to files that match the globs. Project docs win over this pack. This pack wins over principles. A standard that overrides a principle names it.

This pack holds only the rules that apply to any iOS project. The principles give the design, for example `principle-functional-core`, `principle-boundary-discipline`, and `principle-type-system-discipline`. The project docs give the choices of the project, for example its folders, store, dependency wiring, and shared types.

## 1. Modern Swift and SwiftUI

**Rule:** Use the Swift features of the language version that the repo targets. Use `async`/`await` and actors, not completion handlers or `DispatchQueue`. Mark each view model `@MainActor @Observable final class`. Do not use `ObservableObject`, `@Published`, or `@StateObject` in new code.

**Why:** The compiler checks data races only in structured concurrency. `@Observable` tracks only the properties that a view reads, so a view updates less.

**Violation:** A new completion-handler API. `DispatchQueue.main.async` to set view state. `ObservableObject` or `@Published` in the diff. A view model with no `@MainActor`.

## 2. Domain data in Sendable value types

**Rule:** Model domain data as `struct` and `enum` types that are `Sendable`. Use `let` properties. A change returns a new value from a method on the type.

**Why:** Value types copy on assignment, so no other code changes a value under you. They cross actors without data races. This is how `principle-rich-domain-model` applies in Swift: the rules live on the type, and no caller sets a field.

**Violation:** A `class` for domain data with no identity. A `var` property on a domain struct that callers set from outside. A domain type marked `@unchecked Sendable`.

## 3. A generated Xcode project changes only through its spec

**Rule:** If the repo generates the Xcode project with a tool such as XcodeGen or Tuist, change the spec file. Then run the generator. Do not edit `*.xcodeproj` by hand.

**Why:** The generator writes the `.xcodeproj` again from the spec. A hand edit to the `.xcodeproj` is lost on the next run.

**Violation:** The diff changes `project.pbxproj` with no matching change in the spec file.

## 4. Derive view state once, off the main actor

**Rule:** Derive expensive view data once into an immutable `Sendable` snapshot, off the main actor. Views read stored fields. Use `LazyVStack` or `List` for long scroll content. Do not allocate a `DateFormatter` or a similar formatter in a loop or in `body`.

**Why:** A computed property on an `@Observable` view model runs again on each body update, also during scroll. That gives visible jitter.

**Violation:** A computed property on a view model that scans a collection. A `ScrollView { VStack { ForEach ... } }` over unbounded data. `DateFormatter()` inside `body`, `ForEach`, or a `map`.

## 5. Credentials only in the Keychain

**Rule:** Store tokens, passwords, and server connections only in the Keychain. Do not store them in `UserDefaults`, files, a database, or next to other cached data. Read a token live when you need it.

**Why:** Other stores are not encrypted with the device key and can go into backups. A token copied into a cache outlives sign-out.

**Violation:** A key with `token`, `password`, or `secret` in a `UserDefaults` call. A token field on a persisted record or a cache file.

## 6. No secrets in logs or in error text

**Rule:** Do not use `print()` in app code. Log through `os.Logger`, or the logger that the repo uses, with privacy markers. Never log tokens, auth headers, or request and response bodies. Show the user a fixed error message. Do not put `error.localizedDescription` in UI text.

**Why:** Logs ship in Release builds and in diagnostic exports. A system error text can hold host names, paths, and URLs with tokens.

**Violation:** `print(` in a non-test file. A log call that interpolates a URL, a header, or a body without redaction. `Text("... \(error.localizedDescription)")`.

## 7. Stable accessibility identifiers on controls

**Rule:** Give each control that a UI test or a verification drive taps an `accessibilityIdentifier`. Use the identifier format of the repo. Give each icon-only button an accessibility label.

**Why:** UI tests and verification drives find elements by identifier. A label changes with copy edits and localization. Coordinates break on each layout change.

**Violation:** A new button, field, or row that a test reaches by its visible text or by coordinates. An `Image` button with no `accessibilityLabel`.

## 8. Swift Testing for unit tests, XCUITest for UI

**Rule:** Write unit tests with Swift Testing (`import Testing`, `@Test`, `#expect`). Write UI tests with XCUITest.

**Why:** Swift Testing gives parameterized tests and clear failure output.

**Violation:** A new `XCTestCase` for a unit test. A UI test that drives a view model directly.

## 9. Pin the simulator by UDID

**Rule:** Run tests on a simulator that the run creates, and address it with `-destination "id=<udid>"`. Delete it at the end. Use the project test scripts when they exist.

**Why:** Many simulators can share a name across iOS runtimes. Then `xcodebuild` stops and waits for input. Two worktrees on one simulator corrupt each other.

**Violation:** `-destination 'platform=iOS Simulator,name=iPhone 16'` in a script, a doc, or a CI file. A script that boots a simulator and has no cleanup trap.
