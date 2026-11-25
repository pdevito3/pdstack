---
name: deslop
description: Remove AI-generated code slop and clean up code style
user-invocable: false
---

# Remove AI code slop

Check the diff against the branch's base and remove AI-generated slop introduced in the branch. The base is the PR's base branch, else the branch this one was cut from, else the repository's default branch. Include uncommitted changes.

## Deterministic guards first

1. Run the repo's own lint and type check over the changed files. Fix each finding before the judgment pass below.
2. When a stack pack in `stackPacks` of `.agents/pdstack.json` names a guard that the repo lacks, such as the slop guard of the react pack, report it and propose `/slop-guard` as its own PR. Keep the install out of this task.

## Focus Areas

- Extra comments that are unnecessary or inconsistent with local style
- Defensive checks or try/catch blocks that are abnormal for trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should be simplified with early returns
- Other patterns inconsistent with the file and surrounding codebase

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Prefer minimal, focused edits over broad rewrites.
- After editing, rerun the checks that verified the change (tests, type check, and the driver skill for UI work) and report their results.
- Revert any edit whose check fails.
- When the judgment pass removes the same pattern twice, propose a guard for it per `pdstack:correct`.
- Keep the final summary concise (1-3 sentences).
