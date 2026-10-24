# react stack pack: standards

Scope: React apps in TypeScript.

Globs: `**/*.ts`, `**/*.tsx`

Apply these standards only to files that match the globs. Project docs win over this pack. This pack wins over principles. A standard that overrides a principle names it.

This pack holds only the rules that apply to any React project. The principles give the design, for example `principle-functional-core` and `principle-type-system-discipline`. The project docs give the choices of the project, for example its data library, router, UI library, styles, forms, and file names.

## 1. Apply the TypeScript leaf skill

**Rule:** Apply `pdstack:typescript-best-practices` to each `.ts` and `.tsx` file. This pack adds only the React rules below.

**Why:** The leaf skill holds the TypeScript rules: unions, brands, no `as`, no `any`, exhaustiveness, and boundary parsing. One copy of each rule cannot drift.

**Violation:** Any violation that the leaf skill names, in a file that this pack covers.

## 2. Modern React and TypeScript

**Rule:** Write function components. Use the APIs of the React version that the repo targets. In React 19, take `ref` as a prop and do not use `forwardRef`. Use a string union, not an `enum`. Use `import type` for an import that is only a type.

**Why:** Class components and old APIs do not get new React features. A TypeScript `enum` emits runtime code and does not narrow like a literal union.

**Violation:** A new class component. `forwardRef` in new React 19 code. `enum` in the diff. A value import that the file uses only as a type.

## 3. Server data stays in its cache

**Rule:** Read server data from the data-fetching library that the repo uses each time. Do not copy it into `useState`, a context, or a store. After a write, invalidate or update each cached query that the write changes.

**Why:** A copy goes stale when the cache refetches. The screen then shows two versions of one record.

**Violation:** `const [user, setUser] = useState(data)`. A `useEffect` that fetches and calls `setState`. A mutation that changes nothing in the cache.

## 4. Put state in the first place that fits

**Rule:** Choose the first item that fits. Calculate the value during render. Keep a value that one component uses in that component. Put state that survives a reload or goes in a link in the URL. Put state that distant components share in a small context or the store that the repo uses.

**Why:** Each step up adds a source of truth and more renders. A stored copy of a derived value is one render behind its source.

**Violation:** `useEffect(() => setX(f(y)), [y])`. A state value that is always a filter or a map of a prop. Local state for a filter that a link must share. A context for state that one component uses.

## 5. Effects only sync with outside systems

**Rule:** Use `useEffect` only to sync with a system outside React: a browser API, a subscription, a timer, or a library. List each reactive value in the dependency array. Return a cleanup. Give each concern its own effect.

**Why:** An effect for event logic or data transforms adds extra renders and order bugs. A missing cleanup leaks listeners.

**Violation:** An `eslint-disable` for `react-hooks/exhaustive-deps`. An effect that responds to a click or resets state on a prop change. A listener added with no cleanup.

## 6. Memoize only for a reason

**Rule:** Use `useMemo` and `useCallback` only for one of these reasons. A measured calculation is slow. A memoized child needs a stable prop. A library needs a stable reference. When the repo uses the React Compiler, do not memoize by hand.

**Why:** Memoization costs memory and reading time. On a cheap value it gives no gain.

**Violation:** `useMemo` around a short `map` or an object literal with no memoized consumer.

## 7. Each async view shows loading and error

**Rule:** Render a loading state and an error state for each request that a screen shows. Use an early return for each state. Do not nest ternaries.

**Why:** A failed request with no error state shows an empty page. The user cannot tell "no data" from "failed".

**Violation:** A component that reads the data with no branch for the pending or the error state. A ternary inside a ternary in JSX.

## 8. Accessible names on overlays and icon buttons

**Rule:** Give each dialog and popover a title or an `aria-label`. Give each icon-only button an `aria-label`.

**Why:** Screen readers announce the name. Tests and verification find elements by role and name.

**Violation:** An icon button with no text and no `aria-label`. A dialog with no title.

## 9. Load heavy code on demand

**Rule:** Load a heavy component or library with `lazy` or a dynamic `import()`.

**Why:** It stays out of the first bundle, so the first page loads faster.

**Violation:** A static import of a chart, editor, or PDF library in a route that does not show it at first render.

## 10. One package manager

**Rule:** Use the package manager whose lock file the repo commits. Commit the changes to that lock file.

**Why:** A second package manager writes a second lock file with different versions.

**Violation:** A second lock file in the diff, for example `package-lock.json` in a pnpm repo. `npm install` in a doc or a script of a repo that uses another package manager.
