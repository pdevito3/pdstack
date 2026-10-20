# react stack pack: standards

Scope: React single-page apps in TypeScript, with TanStack Query, TanStack Router, Tailwind, and pnpm.

Globs: `**/*.ts`, `**/*.tsx`

Apply these standards only to files that match the globs. Project docs win over this pack. This pack wins over principles. A standard that overrides a principle names it.

## TypeScript

### 1. Apply the TypeScript leaf skill

**Rule:** Apply `pdstack:typescript-best-practices` to each `.ts` and `.tsx` file. This pack adds only the React and app rules below.

**Why:** The leaf skill holds the TypeScript rules: unions, brands, no `as`, no `any`, exhaustiveness, and boundary parsing. One copy of each rule cannot drift.

**Violation:** Any violation that the leaf skill names, in a file that this pack covers.

### 2. String unions, interfaces, and type imports

**Rule:** Use a string union, not an `enum`. Make a list of options with `as const` and derive the union from it. Use `interface` for an object shape and `type` for a union or a computed type. Use `import type` for an import that is only a type.

**Why:** A TypeScript `enum` emits runtime code and does not narrow like a literal union. Type-only imports are removed from the bundle.

**Violation:** `enum` in the diff. A `type X = { ... }` for a plain object shape. A value import that the file uses only as a type.

### 3. API types come from the contract

**Rule:** When the repo generates its API client and types from the OpenAPI document, use the generated types and clients. Do not write a DTO type or a fetch function for an endpoint that the contract has. Do not edit generated files. Regenerate them after an API change and commit them.

**Why:** The generated types change with the server. A CI check fails on drift, so a hand-written copy is the only type that can go stale.

**Violation:** A new `interface UserDto` next to a generated `UserDto`. A hand edit in a `generated` folder. A server change with no regenerated contract in the diff.

**Overrides:** `principle-boundary-discipline`. The generated client does not parse responses at runtime. The contract is generated from the server and checked in CI, so the response type is trusted. Parse at runtime only data that the contract does not cover.

## Server state

### 4. TanStack Query owns server state

**Rule:** Fetch and cache all API data with TanStack Query. Read it from the query each time. Never copy it into `useState`, a context, or a store.

**Why:** A copy goes stale when the query refetches or a mutation invalidates it. The screen then shows two versions of one record.

**Violation:** `const [user, setUser] = useState(data)`. A `useEffect` that fetches and calls `setState`. Query data put into a context value.

### 5. Key factories hold every input

**Rule:** Build query keys with a key factory in `<area>.keys.ts`. Order the parts from general to specific. Put each value that the query function reads in the key.

**Why:** A missing input makes two different requests share one cache entry. The general-to-specific order lets you invalidate one item, one list, or a whole area.

**Violation:** An inline array key such as `['users', id]` in a hook. A query function that reads a filter or an ID that its key does not hold.

### 6. Query hooks live with their area

**Rule:** Put each query and mutation hook in `domain/<area>/apis/`. The hook calls the API client and passes the `signal` from the query function. Share key, function, and options through `queryOptions` when more than one caller uses a query.

**Why:** A reader finds each request of an area in one folder. The `signal` lets TanStack Query cancel a request that nobody needs.

**Violation:** `useQuery` with an inline `queryFn` in a component. A query function that does not pass `signal` to the client.

### 7. Mutations invalidate what they change

**Rule:** After a mutation succeeds, invalidate each query that it changes. For an optimistic update, change only the query cache. Cancel the queries and keep the old data in `onMutate`. Put it back in `onError`. Invalidate in `onSettled`.

**Why:** Without invalidation the screen shows old data until the next refetch.

**Violation:** A `useMutation` with no `onSuccess` or `onSettled` invalidation. An optimistic update that sets component state.

### 8. Each query shows loading and error

**Rule:** Render a loading state and an error state for each query that a screen shows. Use an early return for each state. Do not nest ternaries.

**Why:** A failed query with no error state shows an empty page. The user cannot tell "no data" from "failed".

**Violation:** A component that reads `data` with no branch for `isPending` or `isError`. A ternary inside a ternary in JSX.

## Client state

### 9. Put state in the first place that fits

**Rule:** Choose the first item that fits. Calculate the value during render. Form input goes in React Hook Form. One value in one component goes in `useState`. Values that change together go in `useReducer`. State that survives a reload or goes in a link goes in route search params. A preference of this browser that must survive a browser restart, with no link to share it, goes in `localStorage`, read and written by a small hook. State that distant components share goes in a small context.

**Why:** Each step up adds a source of truth and more renders. Most state needs no storage.

**Violation:** A global store library added to the app. `useState` for a filter that a link must share. A context for state that one component uses. A search param for a preference that must survive a browser restart.

### 10. Calculate, do not store

**Rule:** Calculate derived values during render. Do not store them in state and sync them with an effect.

**Why:** A stored copy is one render behind its source and can drift from it.

**Violation:** `useEffect(() => setX(f(y)), [y])`. A state value that is always a filter or a map of a prop.

### 11. Effects only sync with outside systems

**Rule:** Use `useEffect` only to sync with a system outside React: a browser API, a subscription, a timer, or a library. List each reactive value in the dependency array. Return a cleanup. Give each concern its own effect.

**Why:** An effect for event logic or data transforms adds extra renders and order bugs. A missing cleanup leaks listeners.

**Violation:** An `eslint-disable` for `react-hooks/exhaustive-deps`. An effect that responds to a click, fetches data, or resets state on a prop change. A listener added with no cleanup.

### 12. Memoize only for a reason

**Rule:** Use `useMemo` and `useCallback` only for one of these reasons. A measured calculation takes more than 1 ms. A `React.memo` child needs a stable prop. A query `select` needs a stable reference.

**Why:** Memoization costs memory and reading time. On a cheap value it gives no gain.

**Violation:** `useMemo` around a short `map` or an object literal with no memoized consumer.

## Components

### 13. Function components with typed props

**Rule:** Write function components with a `<Name>Props` interface. Destructure props in the signature, with defaults there. Name a handler prop `onX` and the local handler `handleX`. In React 19, take `ref` as a prop and do not use `forwardRef`.

**Why:** One shape for each component lets a reader scan props and defaults in one place.

**Violation:** `forwardRef` in new code. `props.x` access through the body. A handler prop named `clickHandler`.

### 14. One UI library through components/ui

**Rule:** Use the components in `components/ui/`. Add a missing one with the shadcn CLI in the style that the repo uses. Use the event and state props of the primitive library that the component wraps. Do not add a second UI library.

**Why:** Two primitive libraries give two focus models, two prop styles, and two looks.

**Violation:** A new UI package in `package.json`. A raw `<button>` where `components/ui/button` exists. `onClick` on a React Aria `Button`, which takes `onPress`.

### 15. Accessible names on overlays and icon buttons

**Rule:** Give each dialog and popover a title or an `aria-label`. Give each icon-only button an `aria-label`. Use a tooltip component, not the `title` attribute.

**Why:** Screen readers announce the name. Tests and verification find elements by role and name.

**Violation:** An icon button with no text and no `aria-label`. A dialog with no title. `title="..."` used as a tooltip.

### 16. Tailwind with theme tokens

**Rule:** Style with Tailwind classes. Merge classes with `cn`. Make variants with `cva`. Use theme tokens such as `bg-background` and `text-muted-foreground`, not fixed colors.

**Why:** A fixed color does not change with the dark theme.

**Violation:** `bg-white`, `text-gray-500`, or a hex value in a class. String concatenation of class names. A `style` prop for a value that a class gives.

### 17. Load heavy code on demand

**Rule:** Load a heavy component or library with `lazy` or a dynamic `import()`.

**Why:** It stays out of the first bundle, so the first page loads faster.

**Violation:** A static import of a chart, editor, or PDF library in a route that does not show it at first render.

## Files and forms

### 18. Files, exports, and imports

**Rule:** Name files in kebab case. Use named exports. A route file exports `Route`. Do not make barrel files. Use the `@/` alias for imports outside the current area and relative imports inside it.

**Why:** Barrel files hide where code lives and slow the bundler. Named exports keep one name for each thing across the repo.

**Violation:** `UserCard.tsx`. `export default` outside a file where a tool needs it. An `index.ts` that only re-exports.

### 19. File routes and generated route trees

**Rule:** Add each route as a file in `routes/` with `createFileRoute`. Do not edit the generated route tree.

**Why:** The router plugin writes the route tree again on each change. A hand edit is lost.

**Violation:** A change to `routeTree.gen.ts`. A route registered by hand in a route array.

### 20. Forms with React Hook Form and Zod

**Rule:** Build forms with React Hook Form and a Zod schema through `zodResolver`. Give server data to the form with `values`, or with `defaultValues` when the form renders after the data loads.

**Why:** The schema gives one source for types and validation. Copying server data into state makes it stale.

**Violation:** A form with one `useState` for each field. Server data copied into state and then into the form.

### 21. pnpm only

**Rule:** Use pnpm for installs and scripts. Commit `pnpm-lock.yaml`.

**Why:** A second package manager writes a second lock file with different versions.

**Violation:** `package-lock.json` or `yarn.lock` in the diff. `npm install` in a doc or a script.
