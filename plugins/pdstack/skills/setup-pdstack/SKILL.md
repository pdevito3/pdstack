---
name: setup-pdstack
description: Configure which models pstack uses per role, the model families it runs through their CLIs, and the project config of a repo. Detects available models and writes the current runtime's override sheet, `.agents/pdstack.json`, and the `docs/agents/` docs. Use for /setup-pdstack, "configure pstack models", changing pstack's model choices, adding a model family such as Codex, or setting up a repo for pdstack.
---

# Setup pstack

On another runtime, read [Other runtimes](#other-runtimes) below for where the sheet lives and how it loads; the steps are the same.

Write the current runtime's per-role model override sheet, using the path in [Other runtimes](#other-runtimes). Each pstack skill names a default model inline; the override sheet adapts those defaults to the models you actually have access to.

In a git repo, this skill also writes the project config and the agent docs (steps 11 and 12). Outside a git repo, skip steps 11 and 12.

A second run updates each file in place and never duplicates a line, a key, or a file.

Claude Code has no auto-applied "rules" mechanism like Cursor's `.mdc`. The Claude Code config directory is `$CLAUDE_CONFIG_DIR` when that variable is set and `~/.claude` otherwise. This skill calls it `<config>`. Inclusion is explicit: the user adds a line to `<config>/CLAUDE.md` (or their project `CLAUDE.md`) such as:

```text
@<config>/pdstack-models.md
```

with `<config>` written as the resolved path, so the file is loaded as context for every session.

## Steps

### 1. Detect available models

Enumerate the model names the `Agent` tool's `model` parameter accepts in this session. That is the dependable source. On Claude Code they are the family names listed in [Models](#models) below, each running that family's current model, and a full model ID is rejected. The default panel is listed there too. The panel is chosen for cross-family diversity. Ask the user to confirm or paste any additional slugs they want available. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs. Both mean the role runs on the parent session's model, which the `Agent` call expresses by omitting `model`.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in the Write the override sheet step below. If the current runtime's sheet already exists, read it and treat its values as the current choices. Its `family` lines are the current families (step 4). Otherwise start from those defaults. A line whose role is not in that shape, such as `how critics`, is from a retired role. Drop it. An older sheet may name full model IDs that start with `claude-`, which the `Agent` tool rejects. Replace each with its family name, the word after `claude-`.

### 3. Map and confirm

Show every role with its current model, marking any real slug not in the detected set as needing a choice. Also list each line step 2 dropped or rewrote. Ask whether to accept as-is or change specific roles, offering the detected models, the `<family>:<model>` values of the current families, plus `inherit-parent` and `auto` as the options. Prefer `AskUserQuestion` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

Then ask for the default reasoning effort, the `default effort` line. It is `session`, which keeps the parent session's effort, or one of the levels in [Models](#models). Start from the default listed there. Every role value without a suffix runs at it. Then ask whether any role should run at another level. On Claude Code a role value may carry one after its slug, as in `<slug> @xhigh`; panel entries take their own, as in `<slug> @xhigh, <slug> @max`. Each level is passed as the dispatch's effort, so the choice holds without changing the session. Leave the suffix off for the default effort.

### 4. Add model families

A model family is the models of one provider that pdstack runs through the provider's CLI, for example Codex. Claude needs no family. A family line in the sheet holds the command template: `family <name>: <command>`. The command has `{model}` where the model goes, and it reads the prompt on stdin. A role value `<family>:<model>`, for example `codex:gpt-6-sol`, runs that role through the template.

1. Look on `PATH` for the known CLIs: `codex`, `gemini`, `opencode`, `pi`, and `copilot`. Use `command -v <cli>` on macOS and Linux, and `where <cli>` on Windows. A CLI that already has a family line keeps it, unless the user asks to change it.
2. Offer each new CLI as a family, one question for each. Use the CLI name as the family name. Offer a default template where one is known, and ask for the template otherwise:
   - `codex`: `codex exec --model {model}`
   - `gemini`: `gemini --model {model}`
3. Get the model list from the CLI when it has a list command, for example `pi --list-models`. Otherwise ask the user for the model names. Never write a model that the user did not choose.
4. Make one short test call for each new model before you write it. Write the new family lines to a draft sheet in a temp folder, and write a prompt file there that asks for the word `ok`. Run `node <plugin root>/scripts/run-external.mjs --family <family> --model <model> --prompt-file <prompt> --sheet <draft sheet>`, where `<plugin root>` is two folders above this skill's directory. A model passes when the call exits 0 and its out file is not empty. For a model that fails, show the error and ask whether to fix the template or drop the model. Keep only the models that pass.
5. Offer to put each new family in the roles that ask for a different family: `arena cross-judge pool`, and the panels `arena runners`, `architect runners`, and `interrogate reviewers`. Add the family's model as one more entry. Change no role without a yes.

To add a family later, run this skill again.

With no family besides Claude, the roles that ask for a different family (the eval judge, the `show-me-your-work` audit, the arena cross-judge, and the orchestrate verifier) use a different Claude model from the one that did the work. Step 8 states this gap.

### 5. Validate

Every real slug written must be in the detected set. `inherit-parent` and `auto` always pass. A `<family>:<model>` value must name a family from step 4 and a model that passed its test call. Validate the slug without any `@<level>` suffix, and the level against the effort levels in [Models](#models). The `default effort` value is one of those levels or `session`. On Codex, the levels are the `reasoning_effort` values your Codex models accept instead. If a chosen real slug or level is not available, stop and ask again.

### 6. Write the override sheet

Write the current runtime's sheet with the shape below. Overwrite the whole file so re-runs stay idempotent.

```markdown
# pstack model configuration

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model may carry a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one; `session` keeps the parent session's effort. A value `<family>:<model>`, as in `codex:gpt-6-sol`, runs that role on another model family through `scripts/run-external.mjs`; each `family <name>: <command>` line holds that family's command, with `{model}` for the model and the prompt on stdin.

feature, refactoring: sonnet
bug-fix: opus
perf-issue: opus
hillclimb: opus
judgment and prose: opus
strongest judgment: fable
how explorer: opus
how explainer: opus
why investigators: opus
why synthesizer: opus
reflect tooling: opus
reflect judgment, divergent, synthesizer: opus
arena runners: opus, fable, sonnet, haiku
arena cross-judge pool: opus, fable, sonnet, haiku
swarm workers: opus
architect runners: opus, fable, sonnet, haiku
interrogate reviewers: opus, fable, sonnet, haiku

default effort: session
```

After the `default effort` line, write one `family <name>: <command>` line for each family from step 4, sorted by name, after an empty line.

Then run `node <this skill's directory>/scripts/check-sheet.mjs <sheet path>`, with absolute paths. It prints `sheet ok`, or `sheet invalid:` and each problem. A panel with models from one vendor needs a `panel vendors: any` line. On `sheet invalid`, fix those lines and write the whole sheet again, then rerun the check.

### 7. Wire it in

On Claude Code, if `<config>/CLAUDE.md` does not already include `<config>/pdstack-models.md`, append an `@` line naming the sheet's resolved path, such as `@~/.claude/pdstack-models.md`, so the model rows load on every session. If the user prefers project scope, add the include to the project's `CLAUDE.md` instead.

### 8. Confirm

Tell the user where the override was written, how its model rows load, and which model families it has. With no family besides Claude, say: "No other model family is configured. Roles that ask for a different family use a different Claude model." Re-running this skill updates the override sheet.

### 9. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a project `verify` or `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke [`/create-verification-skill`](../create-verification-skill/SKILL.md). On no, move on without pushing.

### 10. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md). On no, move on without pushing.

### 11. Write the project config

The project config is `.agents/pdstack.json` at the repo root. Its schema is `<plugin root>/schemas/pdstack.schema.json`. Every key is optional, and an absent key takes its default:

| Key | Default |
| --- | --- |
| `worktreeHome` | `../<repo>-worktrees`, where `<repo>` is the name of the repo folder |
| `stackPacks` | `[]` |
| `planPath` | `~/.claude/orchestrate/<slug>/docs/` |
| `forensicsDir` | `$TMPDIR/pdstack/<repo>/<timestamp>/` |

1. If `.agents/pdstack.json` exists, read it. Its values are the current choices.
2. Detect the stack packs from marker files. List the repo files with `git ls-files --cached --others --exclude-standard`, so ignored folders such as `node_modules` stay out.
   - `dotnet`: a `*.csproj` file.
   - `react`: a `package.json` that has `react` in `dependencies`, `devDependencies`, or `peerDependencies`.
   - `ios`: a file inside a `*.xcodeproj` folder.
3. Show the detected packs and the current packs. Ask the user to confirm the list or change it.
4. Ask for the worktree home. Offer the current value, or `../<repo>-worktrees` when there is none.
5. Write `.agents/pdstack.json` with only the keys that differ from the defaults. Write `worktreeHome` only when it is not `../<repo>-worktrees`. Write `stackPacks` only when it is not empty, in the order `dotnet`, `react`, `ios`. Keep the current `planPath` and `forensicsDir` values. Use the key order of the table, two-space indents, and a final newline, so a second run writes the same bytes. When no key differs and the file is absent, do not make the file.
6. Run `node <this skill's directory>/scripts/check-config.mjs .agents/pdstack.json` from the repo root. It prints `config ok`, or `config invalid:` and each problem. On `config invalid`, fix the file and rerun the check.

### 12. Make the agent docs

The skills read the issue tracker from `docs/agents/issue-tracker.md` and the domain docs from `docs/agents/domain.md`. Keep each file that exists without change. Make each file that is absent from the templates in [templates/](templates/).

1. **Issue tracker.** Look at `git remote -v`. Propose GitHub for a GitHub remote, GitLab for a GitLab remote, and local markdown when there is no remote. Ask once, and lead with the proposal. Copy the matching template: [GitHub](templates/issue-tracker-github.md), [GitLab](templates/issue-tracker-gitlab.md), or [local markdown](templates/issue-tracker-local.md). For another tracker, such as Jira or Linear, ask the user to describe the workflow in one paragraph, and write the file from that description. Then add a `## Closing a ticket from a PR` section with the closing syntax of the tracker, for example `Closes #<number>` for GitHub and GitLab. `opening-a-pr` uses it.
2. **Domain docs.** Copy [templates/domain.md](templates/domain.md). If the repo keeps its glossary in `CONTEXT.md`, change `GLOSSARY` to `CONTEXT` in the copy.
3. **Pointer.** Edit `CLAUDE.md` if it exists, else `AGENTS.md`. If neither exists, ask which one to make. If the file has an `## Agent skills` section, update it in place. Otherwise add this section:

   ```markdown
   ## Agent skills

   ### Issue tracker

   [one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

   ### Domain docs

   [one-line summary of the layout: single-context or multi-context]. See `docs/agents/domain.md`.
   ```

## Other runtimes

The role lines are the same everywhere. What differs is the sheet path, how the runtime loads it, and how you list models. Detect models with the runtime's own tool and never write a slug you have not seen listed. A runtime whose subagent call has no model parameter still gets the sheet, as the record of the user's choice, and applies it where it can.

| Runtime | Sheet | Load | List models | Status |
| --- | --- | --- | --- | --- |
| Claude Code | `<config>/pdstack-models.md` | `@<config>/pdstack-models.md` in `<config>/CLAUDE.md` | the `Agent` tool's model parameter | verified live |
| opencode | `~/.config/opencode/pdstack-models.md` | add the path to the `instructions` array in `opencode.json` | the `models` slash command in the session | from published docs, no live session |
| Gemini CLI | `~/.gemini/pdstack-models.md` | `@~/.gemini/pdstack-models.md` in `~/.gemini/GEMINI.md` | the `model` slash command in the session | from published docs, no live session |
| Prime Agent | no documented sheet path; Prime's configuration chooses models | | | no live session |

## Models

Stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`).

- Available Claude models: `opus`, `fable`, `sonnet`, `haiku`
- Default panel: `opus`, `fable`, `sonnet`, `haiku`
- Reasoning effort levels: `low`, `medium`, `high`, `xhigh`, `max`
- Default reasoning effort: `session`
- Single-role default: `opus`
