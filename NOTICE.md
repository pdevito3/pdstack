# NOTICE

pdstack copies files from upstream MIT-licensed work. The pdstack changes and additions are (c) 2026 Paul DeVito, under the [MIT license](LICENSE). All upstream copyright notices and license terms stay in place.

`provenance.json` records the upstream, the path, and the commit of each copied file, and states whether pdstack changed it.

## Upstream sources

| Upstream | Copyright | License file | What pdstack copies |
|---|---|---|---|
| [cursor/plugins `pstack/`](https://github.com/cursor/plugins/tree/main/pstack) | (c) 2026 Lauren Tan | [LICENSE-pstack](LICENSE-pstack) | The original pstack skills, principles, playbooks, and agents, through pstack-claude. |
| [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude) | (c) 2026 Lauren Tan, (c) 2026 Michael Denyer | [LICENSE-pstack-claude](LICENSE-pstack-claude) | The Claude Code port of pstack. pdstack copies its files directly. |
| [cursor/plugins `cursor-team-kit/`](https://github.com/cursor/plugins/tree/main/cursor-team-kit) | (c) 2026 Cursor | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) | `deslop`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, and `what-did-i-get-done`, through pstack-claude. |
| [cursor/plugins `thermos/`](https://github.com/cursor/plugins/tree/main/thermos) | (c) 2026 Cursor | [LICENSE-thermos](LICENSE-thermos) | The thermo skills and agents, through pstack-claude. |
| [mattpocock/skills](https://github.com/mattpocock/skills) | (c) 2026 Matt Pocock | [LICENSE-mattpocock-skills](LICENSE-mattpocock-skills) | `domain-modeling`, `wait-what`, and `writing-for-agents`. |
| [humanlayer/skills](https://github.com/humanlayer/skills) | (c) 2026 HumanLayer | [LICENSE-humanlayer-skills](LICENSE-humanlayer-skills) | `show-me`. |
| [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) | (c) 2026 Dillon Mulroy | [LICENSE-anti-slop](LICENSE-anti-slop) | The `slop-guard` canary fixtures, derived from its rule tests. `install-anti-slop.mjs` copies its oxlint plugin and its LICENSE into a target repo at the commit that `guard.json` pins. |

The `slop-guard` config template and adoption steps follow the README and the migration guide of [cloudflare/oxlint-config](https://github.com/cloudflare/oxlint-config), (c) 2026 Cloudflare, Inc., under the Apache 2.0 license. pdstack copies no Cloudflare file. A target repo installs the preset from npm.
