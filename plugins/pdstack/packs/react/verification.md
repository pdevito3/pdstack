# react stack pack: verification

Scope: prove a change to a React app on its real surface, the app in a real Chrome browser.

Globs: `**/*.ts`, `**/*.tsx`

## Where this file fits

Read this file first. It sets the surface, the proof bar, and the verdicts. Then use the project `verify` skill if the repo has one. It knows the launch script, the login flow, and the recipes. Then use `run` for any gap. If the project skill and this file disagree, the project skill wins.

`pnpm lint`, `pnpm build`, and `pnpm test` are preconditions, not verification. Verification drives the page as a user does and reads what the page shows.

## Surface

The primary surface is the app in Chrome. The dev server serves it, or an app host that also starts the API. Drive it with the Chrome DevTools MCP server or with Playwright. Both speak the Chrome DevTools Protocol (CDP). State in the reply which viewports, themes, and browsers the proof did not reach.

## Steps

1. Start the app with the command that the project docs give. A full stack with an API often starts through an app host, for example `dotnet aspire start --isolated`. A frontend alone starts with the dev server.

   ```bash
   pnpm install
   pnpm dev
   ```

   In a worktree, use an isolated run or a free port. Never drive a dev server or a browser profile that this run did not start.

2. Open the app URL in a new page. With the Chrome DevTools MCP server, use `new_page` or `navigate_page`. With Playwright, use a new browser context for each run, so that no cookies carry over.

3. Log in through the real login flow with a test user from the project docs.

4. Drive the feature as a user does. Find each element by role and accessible name. Read the names from an accessibility snapshot (`take_snapshot` in the MCP server, or `locator.ariaSnapshot()` in Playwright). Use CSS selectors only for stable `data-*` handles. Never use coordinates.

5. Wait for a state, not for a fixed time. Wait for text, a role, or a network response.

6. Capture evidence before and after the key step: a screenshot (`take_screenshot`) and an accessibility snapshot.

7. Read the console and the network.

   - Read console messages (`list_console_messages`). An uncaught error or a console error fails the run, because an error boundary only logs a render crash.
   - Read network requests (`list_network_requests`, `get_network_request`). Confirm each API call that the feature makes, with its status and body.

8. Read side effects back. Reload the page and confirm that the change persists. Or read the record from the API.

9. For a visual change, check the light and the dark theme, and a narrow and a wide viewport (`resize_page` or `emulate`).

10. Close the pages and stop the servers that this run started. Keep the evidence.

Put evidence in a gitignored folder, for example `artifacts/verify/<run>/`. Prefer a scripted recipe over a manual click path, so that a reviewer can run the same proof again.

## Proof bar

- Drive the real user path from the real login. Do not call component state setters, mock the API in the browser, or seed state that a user cannot create.
- Capture the action and the result, not only the final screen.
- Fail on any uncaught page error or console error, even when each step passes.
- Read each side effect back through a reload or the API.
- Confirm that the page runs the current code. Vite reloads on change. Reload the page after a change to config or environment.

## Verdicts

- **VERIFIED:** The page ran the current code. Each step that the request names passed, with no page or console error. The screenshots and snapshots show the action and the result. Side effects read back as expected.
- **NOT VERIFIED:** The page ran the current code, and a step failed, a page error occurred, or a side effect is wrong. Or the bug still shows. Quote the failing step and attach its screenshot.
- **INCONCLUSIVE:** The proof did not reach the surface, or the result is ambiguous. Examples: the dev server or the API did not start for an unrelated reason, or the login provider was unreachable. A flaky step or a run of only unit tests is also inconclusive. Inconclusive is not a pass. Name what blocked the proof.
