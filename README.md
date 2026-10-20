# pdstack

A personal, harness-agnostic agent workflow derived from [pstack](https://github.com/cursor/plugins/tree/main/pstack) and [pstack-claude](https://github.com/michael-denyer/pstack-claude). It sends each request to a playbook that plans, builds, verifies, and opens a PR.

Start it with `/pdstack <request>` in Claude Code.

## Install

Install pdstack from your local clone:

1. Clone the repo to `~/repos/pdstack`.
2. In Claude Code, run `/plugin marketplace add ~/repos/pdstack`.
3. Run `/plugin install pdstack@pdstack`.
4. Run `/setup-pdstack` once at the user level. It writes the model sheet at `~/.claude/pdstack-models.md`.
5. Run `/setup-pdstack` in each project repo. It writes `.agents/pdstack.json` and the `docs/agents/` docs.

To get your local edits into the installed plugin, run `/plugin marketplace update pdstack`.

On another machine, you can install from GitHub with `/plugin marketplace add pdevito3/pdstack`.

## Development

To load the working tree directly, start Claude Code with the plugin folder:

```sh
claude --plugin-dir ~/repos/pdstack/plugins/pdstack
```

Run the checks before you commit:

```sh
node --test
node tools/lint-skills.mjs
node tools/check-provenance.mjs
```

The provenance check clones the upstream repos into `.upstreams/` on its first run. The checks need Node 24 and Git, and no packages.

## Layout

- `plugins/pdstack/` is the plugin: the `pdstack` router skill and its playbooks, the leaf skills, the principles, the agents, the stack packs, and the scripts.
- `tools/` holds the repo checks. They do not ship in the plugin.
- `provenance.json` pins each copied file to its upstream commit.
- `docs/spec/v1.md` is the v1 spec. `CONTEXT.md` defines the vocabulary.

## Credits

pdstack copies work from Lauren Tan (pstack), Michael Denyer (pstack-claude), Cursor, and Matt Pocock. See [NOTICE.md](NOTICE.md).
