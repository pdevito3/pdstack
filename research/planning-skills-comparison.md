# Planning skills: pstack compared with Paul's skills

Research for [Compare pstack planning skills with my planning skills](https://github.com/pdevito3/pdstack/issues/2). Facts only. No decision or recommendation.

## Sources

All claims cite the file they come from. Paths are relative to these roots.

- **pstack (Cursor).** `cursor/plugins` at commit `75fabac`, folder `pstack/skills/`. Cited as `cursor:<path>`.
- **pstack-claude.** `michael-denyer/pstack-claude` at commit `046341e`, folder `plugins/pstack/skills/`. Cited as `claude:<path>`.
- **Paul's skills.** `~/.claude/skills/` (symlinks to `~/.agents/skills/`). Cited as `mine:<path>`.

## Summary

- pstack plans toward a build that agents run. Its plan names PRs, files, and ten live verification lanes per PR. The plan feeds an autopilot or orchestrate playbook (`cursor:poteto-mode/playbooks/multi-phase-plan.md:8`).
- Paul's skills plan toward shared understanding with the human. They leave issues, a glossary, and ADRs. The build starts from a spec or tickets through `implement` (`mine:to-spec/SKILL.md:19`, `mine:to-tickets/SKILL.md:58-63`, `mine:implement/SKILL.md:7`).
- pstack defaults to autonomy. It asks the human only for calls no experiment can settle (`cursor:poteto-mode/SKILL.md:20`). Paul's grilling makes every decision the human's (`mine:grilling/SKILL.md:26`).
- pstack has multi-model design and review (`architect`, `interrogate`). Paul's planning set has no equivalent.
- Paul's set has a domain glossary and ADR discipline (`domain-modeling`). pstack's planning set has no equivalent artifact.

## pstack skills

### multi-phase-plan (playbook)

File: `cursor:poteto-mode/playbooks/multi-phase-plan.md`. It is a playbook inside `poteto-mode`, not a standalone skill. `poteto-mode` routes "work that spans phases or stacked PRs" to it (`cursor:poteto-mode/SKILL.md:147`).

- **Purpose.** Write a plan for multi-phase or multi-PR work. "The plan is the deliverable. Do not implement." (line 3).
- **Inputs.** The request. Open questions get settled by prototype first (line 6). Codebase facts come from exploration subagents that return file pointers, conventions, test commands, and entry points (line 7).
- **Outputs.** One plan file from a fixed skeleton (lines 17-153). The reply gives the plan path, PR ids with dependencies, the review-gated set, what prototypes proved, and the check script output (line 155).
- **Artifact.** A Markdown plan file under the agent store's `docs/` unless the operator names a path (line 8). In pstack-claude the default path is `~/.claude/orchestrate/<slug>/docs/` (`claude:poteto-mode/playbooks/multi-phase-plan.md:10`). The skeleton holds:
  - A program checklist: arm the program, spawn owners, PR mechanics, verdict and merge, boot recipe (lines 30-76).
  - One section per PR with Depends on, Files, Build, You see, Verify unit, Verify live (ten lanes, one is a regression lane against trunk), Verify perf, Review gate, and Merge (lines 78-131).
  - Appendices for prototype evidence, rejected alternatives, risks, and links (lines 138-152).
  - Prototype branches, SHAs, and screenshots go in Appendix A (line 6).
- **Structural check.** `scripts/check-plan.mjs` validates the plan. It fails when the Program checklist section, its sub-blocks, or PR sections are missing, and prints a per-PR box count (`cursor:poteto-mode/scripts/check-plan.mjs:106-126,191`). Step 6 says to fix every line it prints (line 10).
- **Stop condition.** It stops after hand-back: "Post the plan path and the script's output, then stop" (line 11). Step 1 also stops early when the change is one or two files with an obvious approach (line 5).
- **Handoff to a build.** The plan names its execution playbook: `autopilot-full`, `autopilot-stack`, or `orchestrate` for a standing program (line 8). "Execution starts on the operator's explicit go" (line 11). The plan's first box restates this (line 34). The execution playbook spawns one owner agent per PR (lines 46-47).
  - In Cursor, autopilot-full owners merge their own PRs after the root's swarm verdict (`cursor:poteto-mode/playbooks/autopilot-full.md:3,17`).
  - In pstack-claude, owners stop at merge-ready and the operator clicks every merge (`claude:poteto-mode/playbooks/autopilot-full.md:5,9`).
- **HITL or AFK.** Mostly AFK. The human is asked only for "a product or preference call that no run can settle", with options (line 6). The human gives the go to execute. PRs that change an interaction are review-gated: the operator reviews screenshots and a video before merge (line 13).

### figure-it-out

File: `cursor:figure-it-out/SKILL.md`.

- **Purpose.** Design a bespoke, auditable playbook "when the task matches no playbook" (line 9). `poteto-mode` routes large or cross-cutting efforts, and work the user steps away from, here even when Feature fits (`cursor:poteto-mode/SKILL.md:125`).
- **Inputs.** The task. The first todo is to read the Principles section of `poteto-mode` (line 13).
- **Outputs.** Five phases (lines 15-50):
  - A. Frame. Definition of done as a falsifiable predicate, quantified scope, and a rigor level.
  - B. Design the workflow. Atomic, independently landable units, riskiest first. A verification harness with a baseline before the work. `architect` for one-way-door design decisions.
  - C. Run the loop. Each unit is a hypothesis with a verdict of VERIFIED, NOT VERIFIED, or INCONCLUSIVE.
  - D. Keep the audit trail.
  - E. Verify against the Phase A predicate and hand back.
- **Artifact.** The designed phase list ("That list is what the human reviews", line 32). A decision trail TSV through `show-me-your-work`, usually committed for ambitious work (line 46; format in `cursor:show-me-your-work/SKILL.md`). The code changes themselves.
- **Stop condition.** When the whole work is checked against the Phase A predicate on the real product (line 50). The reply covers the designed playbook, rigor level, trail path, what is verified, and what is still open (line 52).
- **Handoff to a build.** None. It plans and then builds in the same run: "Then execute the design" (line 34). It is planning plus execution, not a planning-only skill.
- **HITL or AFK.** Mostly AFK. It presents framing and tradeoffs before a long run. Reversible work proceeds. "A multi-hour run earns one checkpoint" (line 23). The trail exists so a human can audit after stepping away (line 9).

### architect

File: `cursor:architect/SKILL.md`.

- **Purpose.** Sketch types, signatures, class shapes, and module boundaries before code, then implement against the sketch (line 9). `poteto-mode` routes "code crossing a function boundary" here (`cursor:poteto-mode/SKILL.md:22`). The Feature playbook calls it at step 2 (`cursor:poteto-mode/playbooks/feature.md:6`).
- **Inputs.** The task. Phase A grounding through the `how` skill over the touched subsystems, plus `why` when ownership or layering changes (line 23).
- **Outputs.** Phase B runs the `arena` skill with parallel runners on different models (line 29). It requires at least two structurally distinct candidates (line 33). Candidates are screened against `references/design-red-flags.md` (line 35). Arena returns one synthesized design package (line 39).
- **Artifact.** A type sketch with `not implemented` bodies. One file for small changes, or a module map plus types for larger work (line 79). A one-page rationale per `references/rationale-template.md`: problem, caller usage, shape, synthesis decision, tradeoffs, alternatives, open questions, next step (`cursor:architect/references/rationale-template.md`). The synthesis can ship as its own commit (line 47). pstack-claude adds an "Implementation reconciliation" section that records accepted deviations (`claude:architect/references/rationale-template.md`, and `claude:architect/SKILL.md:58-61`).
- **Stop condition.** It does not stop at design. Phase D implements against the sketch (line 53). Phase E scraps the sketch and loops back to Phase B when friction forms a pattern (lines 55-75).
- **Handoff to a build.** Internal. The same run implements. `interrogate` is an option for adversarial pressure on the sketch (line 47).
- **HITL or AFK.** AFK by default: "No human checkpoint" (line 43). A checkpoint is opt-in when the invoker asks (line 45). Human pushback on the shape triggers a re-ground (line 49).
- **Models.** Cursor default runners are `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast` (line 31). pstack-claude defaults to `opus`, `fable`, `sonnet`, `haiku` (`claude:architect/SKILL.md`, Models section).

### interrogate

File: `cursor:interrogate/SKILL.md`.

- **Purpose.** Multi-model adversarial review of code changes. "The adversarial signal comes from model diversity, not assigned personas" (line 9). `poteto-mode` routes "contested design" here before shipping (`cursor:poteto-mode/SKILL.md:24`). `architect` can run it on a sketch (`cursor:architect/SKILL.md:47`).
- **Inputs.** A diff, files, or the branch diff against main (lines 13-19). A one-paragraph intent statement. It asks the user if the intent is unclear (line 23).
- **Outputs.** One read-only reviewer per configured model (lines 27-34). Each uses `references/reviewer-prompt.md`, the rubric, and the code-quality lens (line 38). The lead sorts findings into Act on, Consider, Noted, and Dismissed (lines 46-51), plus an agreement map (lines 73-74).
- **Artifact.** A synthesized verdict in the reply. No file. "Do NOT auto-apply changes" (line 9).
- **Stop condition.** When the verdict is written.
- **Handoff to a build.** None. It is review input, not a plan. The human or caller acts on the buckets.
- **HITL or AFK.** AFK, except the intent question when unclear (line 23).
- **Models.** Cursor defaults to two reviewers (lines 29-32). pstack-claude defaults to four: `opus`, `fable`, `sonnet`, `haiku` (`claude:interrogate/SKILL.md:34-37`).

### sharpen

File: `cursor:sharpen/SKILL.md`. One paragraph (line 7).

- **Purpose.** Sharpen a task before starting. Ask how a top expert would do it, what the user is really after, and whether the task is over- or underspecified.
- **Inputs.** The task as given.
- **Outputs.** Loosened or added constraints, folded silently into the work. Choices that are the user's stay open. One outside check that the result is right is always kept.
- **Artifact.** None. It runs "without narrating the framing". pstack-claude adds "Don't hand back a rewritten prompt" (`claude:sharpen/SKILL.md:6`).
- **Stop condition.** None of its own. It flows straight into "then do the work".
- **Handoff to a build.** Immediate. The same agent does the work.
- **HITL or AFK.** AFK. It does not ask questions.

### Invocation

In Cursor, all five carry `disable-model-invocation: true` (frontmatter of each file). In pstack-claude that flag is removed from all five (diff of each frontmatter). `multi-phase-plan` is reached only through `poteto-mode` routing.

## Paul's skills

### wayfinder

File: `mine:wayfinder/SKILL.md`.

- **Purpose.** Plan an effort too big for one agent session as a shared map of decision tickets on the issue tracker. Resolve them one at a time until the way to the destination is clear (lines 7-9).
- **Inputs.** Chart mode takes a loose idea (line 109). Work mode takes a map URL or number, and optionally a ticket (line 120).
- **Outputs.**
  - Chart mode: name the destination by grilling plus domain-modeling, map the frontier breadth-first, create the map issue, create tickets and wire blocking in a second pass, and fire research subagents (lines 111-115).
  - Work mode: claim one ticket, resolve it, post a resolution comment, close it, append a pointer to Decisions so far, then graduate fog into new tickets (lines 122-126).
- **Artifact.** A map issue labelled `wayfinder:map` with sections Destination, Notes, Decisions so far, Not yet specified, and Out of scope (lines 21, 31-53). Child ticket issues with a Question body and a `wayfinder:<type>` label (lines 57-65). Native blocking links (line 69). Research findings on throwaway `research/<name>` branches (line 115). Prototype assets linked from tickets (line 78). CONTEXT.md and ADRs through domain-modeling during grilling tickets.
- **Stop condition.** Chart mode stops after charting and "hand-resolves nothing" (line 116). Work mode resolves one ticket per session, research tickets excepted (line 105). The map is done "when the way is clear, with nothing left to decide" (line 13). If charting finds no fog, it stops and asks the user how to proceed (line 112).
- **Handoff to a build.** Not defined in the skill. "Plan, don't do" (line 13). The destination may be a spec, a locked decision, or an in-place change (line 9). An effort can carry execution into the map through Notes (line 13).
- **HITL or AFK.** Mixed per ticket type (lines 75-81). Research is AFK. Prototype and grilling are HITL. Task is HITL or AFK. "The agent never stands in for the human's side" of a HITL ticket (line 75).

### grill-with-docs

File: `mine:grill-with-docs/SKILL.md`.

- **Purpose.** "A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go" (line 3).
- **Behavior.** It only calls `grilling` and `domain-modeling` (line 7). Inputs, outputs, artifacts, stop condition, and HITL status are those of the two skills below combined.

### grilling

File: `mine:grilling/SKILL.md`.

- **Purpose.** Interview the user until there is a shared understanding of a plan, decision, or idea (line 6).
- **Inputs.** The plan, decision, or idea in conversation.
- **Outputs.** Rounds of numbered questions over a design tree. Each round asks the whole frontier, and each question carries a recommended answer (lines 8-22). Facts come from subagents, not the user (line 26).
- **Artifact.** None of its own. The shared understanding lives in the conversation.
- **Stop condition.** "The session is done when the frontier is empty". It does not act until the user confirms shared understanding (line 28).
- **Handoff to a build.** None defined. It does not act before confirmation.
- **HITL or AFK.** HITL. "The decisions are the user's: put each to them and wait" (line 26).
- **Invocation.** No `disable-model-invocation` flag, so the model can call it.

### domain-modeling

Files: `mine:domain-modeling/SKILL.md`, `CONTEXT-FORMAT.md`, `ADR-FORMAT.md`.

- **Purpose.** Actively build and sharpen the project's domain model while designing (line 8).
- **Inputs.** The ongoing design conversation, the existing `CONTEXT.md` or `CONTEXT-MAP.md`, and the code.
- **Outputs.** It challenges terms against the glossary, sharpens fuzzy terms, probes edge-case scenarios, and cross-checks claims against code (lines 44-58).
- **Artifact.** `CONTEXT.md`, updated inline as each term resolves. It is a glossary only, "totally devoid of implementation details" (lines 60-64). ADRs in `docs/adr/NNNN-slug.md`, offered only when a decision is hard to reverse, surprising, and a real trade-off (lines 66-74, `ADR-FORMAT.md`). Files are created lazily (line 40).
- **Stop condition.** None of its own. It runs alongside a design session.
- **Handoff to a build.** None. Other skills consume its artifacts: `to-spec` and `to-tickets` use the glossary vocabulary and respect ADRs (`mine:to-spec/SKILL.md:13`, `mine:to-tickets/SKILL.md:21`).
- **HITL or AFK.** HITL. It asks the user to resolve conflicts and ambiguity. It offers ADRs rather than writing them unasked.
- **Invocation.** No `disable-model-invocation` flag.

### to-spec

File: `mine:to-spec/SKILL.md`.

- **Purpose.** Turn the current conversation into a spec and publish it to the issue tracker. "Do NOT interview the user" (line 7).
- **Inputs.** Conversation context and codebase understanding (line 7). The glossary and ADRs (line 13).
- **Outputs.** Test seams sketched at the highest level possible, with one as the ideal (line 15). A spec with Problem Statement, Solution, User Stories (a long list), Implementation Decisions, Testing Decisions, Out of Scope, and Further Notes (lines 21-75). No file paths or code snippets, except prototype snippets that encode a decision (lines 55-57).
- **Artifact.** One issue on the tracker labelled `ready-for-agent` (line 19).
- **Stop condition.** When the spec is published.
- **Handoff to a build.** The `ready-for-agent` label marks it for an agent. `implement` takes "a spec or set of tickets" (`mine:implement/SKILL.md:3`). `to-tickets` can also break a spec into tickets (`mine:to-tickets/SKILL.md:3`).
- **HITL or AFK.** Mostly AFK. One check: the user confirms the seams match expectations (line 17).

### to-tickets

File: `mine:to-tickets/SKILL.md`.

- **Purpose.** Break a plan, spec, or conversation into tracer-bullet tickets with blocking edges (line 9).
- **Inputs.** Conversation context, or a spec path or issue reference that it fetches with comments (line 17). Optional codebase exploration with prefactoring opportunities (lines 19-23).
- **Outputs.** Vertical slices through every layer, each demoable alone and sized to one fresh context window, prefactoring first (lines 29-36). Wide refactors use expand, migrate, and contract instead (line 40).
- **Artifact.** On a real tracker, one issue per ticket in dependency order with native blocking or sub-issue links and the `ready-for-agent` label (line 63). Locally, one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md` (line 62). Each ticket has What to build, Acceptance criteria, and Blocked by (lines 84-103). It does not close or modify the parent issue (line 67).
- **Stop condition.** When the approved tickets are published.
- **Handoff to a build.** Agents "work the frontier: any ticket whose blockers are all done" (line 65). The tickets are "agent-grabbable by construction" (line 63). `implement` builds from them.
- **HITL or AFK.** HITL at step 4. The user reviews granularity, blocking edges, and merges or splits, and it iterates until the user approves (lines 42-56).

### implement

File: `mine:implement/SKILL.md`.

- **Purpose.** "Implement a piece of work based on a spec or set of tickets" (line 3).
- **Inputs.** The spec or tickets the user names (line 7).
- **Outputs.** Code built with `/tdd` at pre-agreed seams (line 9). Typecheck and single test files run often, the full suite once at the end (line 11). A `/code-review` pass when done (line 13).
- **Artifact.** Commits on the current branch (line 15). No PR step.
- **Stop condition.** When the work is done, reviewed, and committed.
- **Handoff to a build.** It is the build.
- **HITL or AFK.** AFK as written. No human checkpoint is named.

### Invocation

`wayfinder`, `grill-with-docs`, `to-spec`, `to-tickets`, and `implement` carry `disable-model-invocation: true`. `grilling` and `domain-modeling` do not (frontmatter of each file). The Codex manifests for `wayfinder` and `implement` set `allow_implicit_invocation: false` (`mine:wayfinder/agents/openai.yaml`, `mine:implement/agents/openai.yaml`).

## Side-by-side

| Skill | Artifact left | Stops when | Build handoff | Human role |
| --- | --- | --- | --- | --- |
| multi-phase-plan | Plan file with per-PR checklists, checked by script | Plan and script output posted | Named autopilot or orchestrate playbook, on operator's go | Go signal, preference calls, review gate on UI PRs |
| figure-it-out | Phase list, decision trail TSV, code | Whole work verified against predicate | None, it builds | One checkpoint on multi-hour runs |
| architect | Type sketch, rationale doc, code | Code implemented against sketch | None, it builds | Opt-in checkpoint only |
| interrogate | Verdict in reply | Verdict written | None | Intent question if unclear |
| sharpen | None | Flows into the work | Immediate | None |
| wayfinder | Map issue, ticket issues, research branches, CONTEXT.md, ADRs | One ticket per session, map done when no decisions remain | Not defined | Per ticket: grilling and prototype are HITL |
| grill-with-docs | CONTEXT.md, ADRs | Frontier empty and user confirms | None | Full HITL |
| grilling | None | Frontier empty and user confirms | None | Full HITL |
| domain-modeling | CONTEXT.md, ADRs | Runs alongside a session | Consumed by to-spec and to-tickets | HITL |
| to-spec | Spec issue, `ready-for-agent` | Spec published | implement or to-tickets | Seam check |
| to-tickets | Ticket issues or local files with blocking | Approved tickets published | implement, frontier order | Breakdown approval loop |
| implement | Commits on current branch | Done, reviewed, committed | It is the build | None named |

## Overlap and gap map

### Overlaps

- **Large-effort planning.** `multi-phase-plan` and `wayfinder` both plan work too big for one pass. `multi-phase-plan` plans PRs and their verification (`cursor:poteto-mode/playbooks/multi-phase-plan.md:78-131`). `wayfinder` plans decisions, not build slices (`mine:wayfinder/SKILL.md:7,13`).
- **Work breakdown with dependencies.** `multi-phase-plan` has one section per PR, a dependency graph, and file boundaries (`cursor:...multi-phase-plan.md:48-51,80`). `to-tickets` has vertical slices with blocking edges (`mine:to-tickets/SKILL.md:29-38`). Both put dependencies first. The unit differs: a PR versus a tracer-bullet ticket.
- **Settling open questions before writing the plan.** `multi-phase-plan` settles questions by prototype (line 6). `wayfinder` has prototype and research ticket types (`mine:wayfinder/SKILL.md:77-78`). Both send fact-finding to agents. pstack asks the human only for preference calls. `grilling` puts every decision to the human but looks up facts itself (`mine:grilling/SKILL.md:26`).
- **Pre-work framing.** `sharpen` and `figure-it-out` Phase A frame the task before work. `grilling` does the same through a live interview. pstack frames silently or with one checkpoint. Paul's skills frame through questions.
- **Design shape.** `architect` produces interface and module shape. `to-spec` records "the interfaces of those modules" and seams in prose, without file paths or code (`mine:to-spec/SKILL.md:15,47-55`).
- **Out of scope and rejected options.** The multi-phase-plan has Appendix B for rejected alternatives and Appendix C for risks (lines 142-148). The architect rationale has Alternatives considered. `wayfinder` has an Out of scope section. `to-spec` has Out of Scope. ADRs record rejected alternatives when non-obvious (`mine:domain-modeling/ADR-FORMAT.md:47`).
- **Review after the build.** `interrogate` is a multi-model review. `implement` calls `/code-review` (`mine:implement/SKILL.md:13`).

### In pstack, absent from Paul's planning set

- Multi-model parallel design exploration with synthesis (`architect` with `arena`).
- Multi-model adversarial review with Act on, Consider, Noted, and Dismissed buckets (`interrogate`).
- Per-PR verification written into the plan: unit, ten live lanes, perf against trunk, and a review gate (`multi-phase-plan.md:13`).
- A script that checks the plan structure (`check-plan.mjs`).
- A falsifiable done predicate and rigor level set up front (`figure-it-out` Phase A).
- A decision trail log for unattended runs (`show-me-your-work`, used by `figure-it-out`).
- An explicit route from plan to an execution playbook that spawns PR owners (autopilot-full, autopilot-stack, orchestrate).
- A sketch-scrap rule when implementation friction forms a pattern (`architect` Phase E).

### In Paul's set, absent from pstack's planning set

- A domain glossary (`CONTEXT.md`) and lightweight ADRs maintained during design (`domain-modeling`). pstack has a `principle-model-the-domain` skill about code structure, not a glossary artifact (`cursor:poteto-mode/SKILL.md:57`).
- A structured human interview with rounds, a frontier, and recommended answers (`grilling`).
- Planning state on the issue tracker: map, child tickets, native blocking, claims by assignee, and a fog of war section (`wayfinder`).
- A planning stage that stops at decisions and does not plan the build (`wayfinder` "Plan, don't do").
- A product-facing spec with user stories (`to-spec`).
- A ticket breakdown approved by the human (`to-tickets` step 4).
- An expand, migrate, contract recipe for wide refactors (`to-tickets` line 40).

### Differences in shape

- **Where the plan lives.** pstack writes a Markdown file in the agent store. Paul's skills write issues on the tracker, plus repo files for the glossary and ADRs.
- **Who decides.** pstack decides by experiment and asks only on preference calls. Paul's grilling and domain-modeling give each decision to the human.
- **Planning versus building.** `figure-it-out` and `architect` plan and build in one run. `sharpen` flows straight into the work. Only `multi-phase-plan` is planning-only with a stop. All of Paul's planning skills stop before the build. `implement` is a separate step.
- **Build unit.** pstack builds per PR, with an owner agent per PR, swarm verification, and merge rules. `implement` commits to the current branch and names no PR or merge step.
- **Verification in the plan.** pstack writes live and perf verification into each PR section. `to-spec` writes Testing Decisions and seams. `to-tickets` writes acceptance criteria. Neither names live-surface lanes or perf baselines.
- **Session sizing.** `wayfinder` sizes tickets to one 100K-token session and resolves one per session (`mine:wayfinder/SKILL.md:57,105`). `to-tickets` sizes slices to one fresh context window. pstack sizes by PR and fans out to subagents.

### pstack-claude differences that matter here

- All five pstack skills drop `disable-model-invocation`, so the model can call them.
- `architect` adds an implementation reconciliation rule and template section (`claude:architect/SKILL.md:58-61`).
- `interrogate` defaults to four Claude-family reviewers instead of two cross-vendor reviewers (`claude:interrogate/SKILL.md:34-37`).
- `multi-phase-plan` writes to `~/.claude/orchestrate/<slug>/docs/`, runs live lanes in worktrees instead of cloud VMs, and uses a driver skill instead of Cursor's `control-ui` and `control-cli` (`claude:poteto-mode/playbooks/multi-phase-plan.md:10,17,74`).
- `autopilot-full` stops at merge-ready. The operator clicks every merge (`claude:poteto-mode/playbooks/autopilot-full.md:5`).
- `poteto-mode` adds project playbooks under `.agents/playbooks/` that extend bundled playbooks (`claude:poteto-mode/SKILL.md`, Project playbooks paragraph).
