---
name: merge-risk
description: "Rate how much human attention a change needs before it merges: merge on the normal gate, review named areas, or plan the rollout first. Use for 'merge risk', 'how risky is this PR', 'is this safe to merge', or 'does this need a human'."
---

# Merge risk

Rate a PR or a branch before it merges. Commit work-in-progress first, because the script reads commits only. The result is one verdict and the evidence for it:

- **merge.** The normal review gate is enough.
- **review.** A human reads the named areas before merge.
- **plan.** The change needs a written rollout before merge, with a way back or, for a one-way door, a limit on the harm.

This skill rates risk. It does not hunt for bugs. `thermo-nuclear-review` and `interrogate` hunt for bugs.

## Rate on evidence

Each rating above low names the failure it guards against, with a real `file:line` or command output. A failure with no evidence that its path exists stays low. A fact that the rating needs and that you looked for but cannot reach is unknown, for example consumers in a repo you cannot search. An unknown rates medium, never low, and its evidence is where you looked. Finish the rating without the user, and record each unknown in the report with the fact that would lower it.

## Steps

1. Gather the facts. Run `node <this skill dir>/scripts/signals.mjs`, with `--pr <number>` for a PR, or `--base <ref> --head <ref>` for a branch. It prints each changed file with its kind, its line counts, and its `churn` (commits on the base in the 6 months before the base tip). It also prints `manualSteps`, the lines of the PR title, body, and labels that look like a manual step. Each line is a candidate for you to confirm. The kinds come from path patterns. They are hints, not ratings. Then read the full diff and the PR description. Done when you have read both.
2. Rate each dimension in the table below as low, medium, or high. Done when all five have a rating and evidence.
3. Prove the fact a rating turns on. When a Data or Contracts rating depends on who reads the changed thing, run [`blast-radius`](../blast-radius/SKILL.md). A proven safety fact can lower the rating. An unproven one leaves it as it is.
4. Mark the doors, per [Doors](#doors). Check every Data, Contracts, Exposure, and Deploy rating for a one-way harm. For a low rating, first name the failure it could cause, then check it, and raise the rating if the harm is one-way. Done when each of these ratings at medium or high has a door, and each manual step has one.
5. Apply the safety nets. A safety net lowers a Data, Contracts, Exposure, or Deploy rating by one step only when it covers that exact failure: a test that fails on it, or a flag that turns it off. A flag does not undo a migration. A revert is not a safety net, because every code change has one. The door decides what a revert is worth. Shape never goes down, because a net does not make a change easier to review.
6. Decide the verdict. The highest rating sets it: all low is merge, any medium is review, any high is plan. Then apply the door floor and the manual-step floor.
7. Write the report.

## Dimensions

| Dimension | Low | Medium | High |
|---|---|---|---|
| **Data.** Stored state | No change to what is stored or how it is read | An additive schema change, a new stored field, a change to a cache key or TTL | A rename, drop, or type change, a backfill, a rewrite or delete of existing rows, a stored format that old code cannot read |
| **Contracts.** What other code consumes | Internal symbols with every caller in the diff, or a new surface that nothing consumes yet | An additive change to a public API, event, CLI flag, config key, or shared type that has consumers outside the diff | A removal, rename, or change of meaning on a surface that has consumers outside the diff |
| **Exposure.** Who is on the changed path | Internal tools, dev-only paths, or paths few users reach | A path most users reach | Auth, payments, startup, writes for all users, or a path where a failure is silent |
| **Deploy.** How it reaches production | No change to infrastructure, CI, or dependencies | A minor dependency bump, a new env var, a CI change | A deploy order between services, new infrastructure, a major version bump of a core dependency |
| **Shape.** How hard it is to review | Small, one module, low-churn files | A large diff, many modules, a hotspot file with high `churn`, new branching logic, or a change to concurrency, retries, or a lifecycle state machine | None. A hard review needs a reviewer, not a rollout plan |

## Doors

A risk is a one-way door when its failure leaves lasting harm that a revert does not remove, and that harm is one of these:

- Money moved, for example a charge, a refund, or a payout.
- Data lost, corrupted, or exposed, for example a drop, a backfill, a rewrite, a format that old code cannot read, or a message sent to the wrong people.
- Access lost or weakened, for example a leaked secret, a revoked key that clients still need, or a DNS or certificate change that caches clients onto the wrong target.

Code that you do not deploy, for example a mobile app build, an installed CLI, or a published package version, makes a harm from this list last until users update. It is not a harm by itself. If the merge does not ship the code, for example in a repo that publishes through a release PR, the door opens at the release, so rate that PR for it.

Every other risk is a two-way door. A sent email with a typo, an additive public field, and a new CLI flag are two-way doors. A removal or a change of meaning on a public surface is already Contracts high.

Mark a door only from the rating's evidence. If you cannot tell which door it is, record it in the report under Unknowns, with the fact that would decide it, and treat it as two-way.

A one-way harm raises its rating to at least medium, even on an internal tool or a path few users reach.

**The door floor.** A one-way door that is still medium or higher after the safety nets makes the verdict plan. Shape has no door, because a hard review ends when the review ends.

## Manual steps

A manual step is an action that a human must do outside the automated deploy, before, during, or after it. Examples are a script or backfill run by hand, a production setting or flag changed by hand, a console or `kubectl` change, a manual data fix, a required sign-off, and a team that must hear about the change first. Normal PR review is not a manual step.

Find them in the PR description and in the diff, for example a runbook, a script that nothing calls, or a deploy note. The `manualSteps` list catches only common phrases and can include a line that is not a step, so read the description yourself.

Any manual step makes the verdict at least review. A manual step has a door too, but a revert of the PR does not undo it. The step is two-way only when you can undo it, or rebuild its effect from other data. A reindex rebuilds derived data, and a note to another team changes nothing stored, so both are two-way. A production `UPDATE` is one-way, even when it is safe to run twice. A one-way manual step, for example a production data change or an irreversible cutover, makes the verdict plan. This floor applies after the ratings, and low ratings never cancel it.

## Calibration

- A one-line off-by-one fix in a pagination helper, with a test that fails on the old code. Exposure starts at medium, because most users page through lists. The test covers that exact failure, so Exposure drops to low. All five are low, so the verdict is merge.
- A new table and a new endpoint behind a flag that is off. Data is medium for the additive migration. The flag does not undo the migration, so Data stays medium. An unused table is no lasting harm, so the door is two-way and the verdict is review. Contracts is low, because nothing consumes the endpoint yet.
- A change to the offline sync code in a mobile app release, with no test on the changed path and no remote flag. Exposure is medium. A sync bug in installed builds can corrupt user data until users update, so the door is one-way and the verdict is plan.
- A rename of a session column with a backfill, in the auth middleware that every service imports. Data and Exposure are high, so the verdict is plan.
- A typo fix whose PR body says "run the reindex script after deploy". All five are low. A reindex rebuilds derived data, so the manual step is a two-way door, and the manual-step floor makes the verdict review.

## Report

```
**Merge risk: <merge | review | plan>** for <PR or branch> against <base>

| Dimension | Rating | Door | Evidence |
|---|---|---|---|
| Data | ... | ... | ... |
| Contracts | ... | ... | ... |
| Exposure | ... | ... | ... |
| Deploy | ... | ... | ... |
| Shape | ... | none | ... |

**Manual steps.** None, or each step, its door, and where it is stated.
**Unknowns.** Each unknown fact or door, and the fact that would settle it.
**Before merge.** For review, the areas a human must read, by file. For plan, the rollout and the check that proves it, and for each risk that set the verdict, the way back. For a one-way door, write what limits the harm before it is too late instead, for example a staged rollout, a dry run, or a backup.
```

In the table, Rating is the rating after the safety nets, and Evidence names each net that lowered it. Door is blank for a rating that was low after step 4.

Write the report through [`unslop`](../unslop/SKILL.md).

**Reply:** the report.
