---
name: slop-guard
description: Install the slop guard in a JavaScript or TypeScript repo, so oxlint fails CI on the anti-slop rules.
disable-model-invocation: true
---

# Slop guard

The slop guard turns the anti-slop rules into lint errors that the repo's own CI runs. An agent then fixes a pattern once, at the error, and nobody catches it by hand in review.

[`guard.json`](guard.json) is the one source of truth. It pins the anti-slop commit and the package versions, and lists each required rule with its tier, its options, and why it exists. `<skill-dir>` below is the folder of this file.

## Tiers

1. **Built-in.** Rules that ship in npm packages. The `@cloudflare/oxlint-config` preset comes first, and its `quality/*` plugin already runs 12 of the 18 generic anti-slop rules. The oxlint companion rules and the waiver rules are in this tier too.
2. **anti-slop.** The vendored plugin, only for the 6 rules that no built-in rule covers. Enable no other `anti-slop/*` rule, because its `quality/*` twin would report each finding twice.
3. **Judgment.** `deslop` catches what no lint can, after the lint passes.

## Install

Install the guard in its own branch and PR. Read the repo's package manager, lint config, formatter, and CI first. The config is TypeScript, so the lint needs Node 22.18 or later.

1. Configure the lint for the repo's case. The rules block of [`templates/oxlint.config.ts`](templates/oxlint.config.ts) is the rule list of `guard.json`.
   - **No oxlint.** Install the `devDependencies` of `guard.json` at those exact versions, with the repo's package manager. Copy the template to `oxlint.config.ts` at the repo root. The lint command is `oxlint .`.
   - **Oxlint already.** Upgrade `oxlint` first when it is older than 1.94, the preset's minimum. Pin `@oxlint/plugins` to the installed `oxlint` version. Install the other packages of `guard.json` at its versions. Merge the template's `extends`, `env`, `ignorePatterns`, `jsPlugins`, and `rules` into the config, and keep each existing entry. Convert a `.oxlintrc.json` to `oxlint.config.ts`, because the preset is a module import.
   - **Vite+.** Add `@cloudflare/oxlint-config` and `@eslint-community/eslint-plugin-eslint-comments` with `vp add -D`. Vite+ supplies `oxlint`, `@oxlint/plugins`, and `tsrs` at matching versions. Import `@cloudflare/oxlint-config/vite-plus`, put the template's fields in the `lint` block of `vite.config.ts`, and add the same ignore patterns to `fmt.ignorePatterns`. The lint command is `vp lint`.

   Done when the config names each rule of `guard.json` with its entry from the template.
2. Run `node <skill-dir>/scripts/install-anti-slop.mjs <repo-root>`. It vendors the plugin into `tools/oxlint/anti-slop/` with `UPSTREAM.md`. Done when it exits 0. When it prints `refused`, stop and report the files it names.
3. Make the formatter ignore `tools/oxlint/anti-slop/**`. Run in this order: format, `oxlint --fix` (or `vp lint --fix`), then the format check. `require-readable-spacing` fixes add blank lines, and the format check proves that the formatter keeps them.
4. Adopt in one passing commit. Lint the whole repo, and set each newly failing rule to `"off"` for now. Add the lint command to CI, and keep the type check there, because oxlint reports no TypeScript compiler errors. Commit the packages, the config, the vendored plugin, and the CI change together, with the lint passing.
5. Then make one commit per rule. Remove its `"off"`, fix its findings, rerun the lint and the tests, and commit the config with the fixes. A preset rule outside `guard.json` can stay off, with the reason beside it. A rule in `guard.json` ends at its template entry. Done when no `guard.json` rule is off.
6. Run `node <skill-dir>/scripts/check-slop-guard.mjs <repo-root>`. It lints canary files with the repo's own lint and config. Done when it prints `slop guard ok`. Otherwise each line names a rule or a package that did not load and the fix.

## Waivers

A disable comment has this form, with the reason after `--`:

```ts
// eslint-disable-next-line <rule> -- <reason>
```

The reason names the invariant or the outside constraint that makes the line correct. Use the `eslint-disable` spelling. The guard bans the `oxlint-disable` spelling, because `require-description` does not read it.

To pass the lint, fix the code or write a waiver on the line. Keep each `guard.json` rule at `"error"` with its options, name one rule in each disable comment, and leave `tools/oxlint/anti-slop/` as vendored. `check-slop-guard.mjs` reports a `guard.json` rule that is `"warn"`, `"off"`, or without its options. `install-anti-slop.mjs` refuses to run over an edited vendored file.
