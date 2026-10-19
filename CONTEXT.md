# pdstack

A personal, harness-agnostic agent workflow derived from pstack. It sends each request to a playbook that plans, builds, verifies, and reviews the work.

## Language

**Request**:
The task that the user gives to pdstack, in their own words.
_Avoid_: Prompt, ask, job

**Router**:
The entry skill that matches a request to one playbook.
_Avoid_: Dispatcher, mode

**Playbook**:
An ordered sequence of steps for one kind of request, for example bug fix or feature.
_Avoid_: Workflow, recipe, pipeline

**Plan**:
The deliverable of the multi-phase-plan playbook: the PRs of a large effort, their order, and how each PR is verified.
_Avoid_: Roadmap, spec

**Autopilot**:
A playbook that carries the PRs of a plan to merge-ready, with one owner agent for each PR. The user merges.
_Avoid_: Swarm, orchestration

**Step**:
One item in a playbook. A step uses leaf skills and can be skipped only with a stated reason.
_Avoid_: Stage, phase

**Leaf skill**:
A single-purpose skill that steps call, for example `tdd` or `deslop`.
_Avoid_: Tool, helper skill

**Principle**:
A generic engineering rule that shapes decisions in any project. Most come from pstack, and pdstack adds its own.
_Avoid_: Rule, guideline

**Verification**:
Proof on the real surface that the change does what the request asked. Its verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE.
_Avoid_: Testing, validation, check

**Quality loop**:
The passes that make correct code cleaner, for example deslop and interrogate. It stops at "good enough".
_Avoid_: Polish, cleanup

**Review gate**:
The defect hunt for bugs, perf, and security issues, with a pass or fail result. It is separate from the quality loop.
_Avoid_: Code review loop, QA

**Harness**:
The agent host that runs pdstack, for example Claude Code. Claude Code is the primary harness.
_Avoid_: Platform, client, IDE

**Adapter**:
The thin harness-specific packaging around the harness-neutral content.
_Avoid_: Port, integration

**Worktree home**:
The folder where a project keeps its worktrees, by default the sibling `<repo>-worktrees/` folder.
_Avoid_: Worktree dir, workspace

**Stack pack**:
A set of standards for one technology stack, for example .NET, that a project selects.
_Avoid_: Preset, profile, plugin

**Upstream**:
A source repo that pdstack copies files from: cursor/plugins `pstack/` or pstack-claude.
_Avoid_: Origin, parent

**Provenance pin**:
The record that ties one copied file to its upstream, path, and SHA, and states whether pdstack changed it.
_Avoid_: Lock, fork entry
