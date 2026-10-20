// The watcher's domain types, as JSDoc. Only nonEmpty and parsePrNumber run.

/** @typedef {import("./landing.mjs").LandingRevision} LandingRevision */

/** @typedef {number} PrNumber A positive integer, made by parsePrNumber. */

/**
 * @template T
 * @typedef {readonly [T, ...T[]]} NonEmpty
 */

/**
 * @template T
 * @param {readonly T[]} items
 * @returns {NonEmpty<T> | null}
 */
export function nonEmpty(items) {
  return items.length === 0 ? null : [items[0], ...items.slice(1)];
}
/**
 * @param {unknown} value
 * @returns {PrNumber}
 */
export function parsePrNumber(value, label = "PR number") {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer`);
  return value;
}

/** @typedef {{ readonly owner: string, readonly repo: string }} Repository */
/** @typedef {Repository & { readonly number: PrNumber }} PrContext */
/** @typedef {"BEHIND" | "BLOCKED" | "CLEAN" | "CONFLICTING" | "DIRTY" | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE"} MergeStateStatus */
/** @typedef {"ERROR" | "EXPECTED" | "FAILURE" | "PENDING" | "SUCCESS" | null} RollupState */
/** @typedef {"APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null} ReviewDecision */

/**
 * An OPEN PR also carries a full LandingRevision: headRefOid and baseRefOid
 * are non-null strings.
 *
 * @typedef {object} PullRequestFacts
 * @property {PrContext} context
 * @property {"MERGEABLE" | "CONFLICTING" | "UNKNOWN"} mergeable
 * @property {MergeStateStatus} mergeStateStatus
 * @property {ReviewDecision} reviewDecision
 * @property {string | null} headRefOid
 * @property {string | null} baseRefOid
 * @property {string} headRefName
 * @property {string} baseRefName
 * @property {"OPEN" | "CLOSED" | "MERGED"} state
 * @property {string | null} mergedAt
 * @property {boolean} isDraft
 */

/**
 * @typedef {object} OpenPullRequest
 * @property {PrNumber} number
 * @property {Repository | null} headRepository
 * @property {string} headRefName
 * @property {string} baseRefName
 */

/**
 * @typedef {object} ReviewComment
 * @property {string | null} authorLogin
 * @property {string} body
 * @property {string | null} path
 * @property {number | null} line
 * @property {string} createdAt
 */

/**
 * @typedef {object} ReviewThread
 * @property {string} id
 * @property {ReviewComment | null} firstComment
 * @property {boolean} isBugbot
 * @property {number} bugbotReviewPasses
 */

/**
 * `kind` is "passed", "skipped", "failed", "pending", or "code-review-gate".
 * A "code-review-gate" check is always named "Code Review Gate".
 *
 * @typedef {object} Check
 * @property {"passed" | "skipped" | "failed" | "pending" | "code-review-gate"} kind
 * @property {string} name
 * @property {string} reportedState
 * @property {string} description
 * @property {string} link
 * @property {string} workflow
 */
/** @typedef {Check & { readonly kind: "failed" }} FailedCheck */
/** @typedef {Check & { readonly kind: "pending" }} PendingCheck */

/**
 * @typedef {object} ReportedChecks
 * @property {"reported"} kind
 * @property {"gh-pr-checks" | "graphql-rollup"} source
 * @property {NonEmpty<Check>} checks
 */
/** `resolveChecks` owns what counts as `no-checks`. */
/** @typedef {ReportedChecks | { readonly kind: "no-checks" }} CheckRead */

/** @typedef {{ readonly oid: string, readonly state: RollupState }} CommitRollup */

/**
 * BLOCKED with an ERROR or FAILURE head rollup is a refusal. Any other
 * BLOCKED is allowed on the "rollup" basis, and any other merge state is
 * allowed on the "merge-state" basis.
 *
 * @typedef {{ readonly kind: "refused", readonly mergeStateStatus: "BLOCKED", readonly headRollupState: "ERROR" | "FAILURE" }} GitHubMergeRefusal
 * @typedef {{ readonly kind: "allowed", readonly basis: "merge-state" | "rollup", readonly mergeStateStatus: MergeStateStatus, readonly headRollupState: RollupState }} GitHubMergeAllowed
 * @typedef {GitHubMergeAllowed | GitHubMergeRefusal} GitHubMergeAssessment
 */

/**
 * One CI state per kind:
 * - "ci-failing": `failed` is non-empty; carries `github`.
 * - "ci-github-rejected": no failed check, but `github` is a refusal.
 * - "ci-pending": `pending` is non-empty.
 * - "ci-clean": nothing failed or pending; `github` allows the merge.
 * - "ci-none": confirmed no checks; `github` allows the merge.
 * - "ci-unreported": no checks seen yet; not readiness proof.
 * Every kind but ci-none and ci-unreported carries `source` and `all`.
 *
 * @typedef {object} CiState
 * @property {"ci-failing" | "ci-github-rejected" | "ci-pending" | "ci-clean" | "ci-none" | "ci-unreported"} kind
 * @property {ReportedChecks["source"]} [source]
 * @property {NonEmpty<Check>} [all]
 * @property {readonly FailedCheck[]} failed
 * @property {readonly PendingCheck[]} pending
 * @property {boolean} hadPreviousPassingCi
 * @property {GitHubMergeAssessment} [github]
 */

/**
 * A "merged" or "closed" row has only context and facts.
 *
 * @typedef {object} PrSnapshot
 * @property {"merged" | "closed" | "open"} kind
 * @property {PrContext} context
 * @property {PullRequestFacts} facts
 * @property {readonly ReviewThread[]} [threads]
 * @property {CiState} [ci]
 * @property {boolean} [reviewAutomationRunning]
 */

/**
 * An open READY row must carry positive readiness proof. A first sighting of
 * no checks (ci-unreported) is not readiness proof.
 *
 * @typedef {object} ReadyPr
 * @property {"ready-pr"} kind
 * @property {PrContext} context
 * @property {{ readonly revision: LandingRevision, readonly mergeability: "clear", readonly threads: readonly [], readonly ci: CiState, readonly gate: { readonly state: "OPEN", readonly reviewDecision: "APPROVED" | null, readonly draft: "not-draft" | "draft-allowed" } }} proof
 */
/** @typedef {{ readonly kind: "merged-pr", readonly context: PrContext, readonly mergedAt: string | null }} MergedPr */

/** @typedef {"closed-without-merge" | "draft-pr" | "changes-requested" | "review-required" | "behind-base" | "merge-blocked"} MergeGateReason */

/**
 * @typedef {{ readonly kind: "merge-conflicts", readonly pr: PrContext, readonly facts: PullRequestFacts }
 *   | { readonly kind: "review-threads", readonly pr: PrContext, readonly threads: NonEmpty<ReviewThread> }
 *   | { readonly kind: "failing-checks", readonly pr: PrContext, readonly ci: CiState }
 *   | { readonly kind: "merge-gate", readonly pr: PrContext, readonly reason: MergeGateReason }} MergeBlocker
 */

/**
 * "deadline" and "spawn-failed" and "invalid-context-url" are not retryable;
 * every other kind is. "command-exit" carries `code`, and "missing-key" and
 * "invalid-context-url" can carry `rawValue`.
 *
 * @typedef {object} QueryFailure
 * @property {"deadline" | "spawn-failed" | "snapshot-changed" | "invalid-stack" | "json-parse" | "missing-key" | "command-exit" | "checks-unavailable" | "invalid-context-url"} kind
 * @property {boolean} retryable
 * @property {string} detail
 * @property {number} [code]
 * @property {string} [rawValue]
 */

/**
 * @typedef {{ readonly kind: "pending-checks", readonly pending: NonEmpty<PendingCheck> }
 *   | { readonly kind: "checks-unreported" }
 *   | { readonly kind: "mergeability-unknown" }} WaitReason
 */

/**
 * `frontier` names the lowest unmerged PR that is actually waiting, and
 * `reason` carries that PR's checks only. Pooling every row's pending under the
 * bottom PR's number misattributed upstack waits to the frontier.
 *
 * This decision serves single and `--stack` mode. Queued mode deliberately
 * reports its own merge frontier instead: when that PR is blocker-free it
 * emits a merge-queue wait that ignores upstack pending, because upstack
 * checks do not block the frontier's merge. That is the Python watcher's
 * contract, not an attribution bug.
 *
 * @typedef {{ readonly kind: "waiting", readonly frontier: PrContext, readonly reason: WaitReason }} WaitingDecision
 */
/**
 * @typedef {{ readonly kind: "blocker", readonly blocker: MergeBlocker }
 *   | WaitingDecision
 *   | { readonly kind: "ready", readonly pr: ReadyPr }
 *   | { readonly kind: "merged", readonly pr: MergedPr }} PrDecision
 */
/**
 * @typedef {{ readonly kind: "blocker", readonly blocker: MergeBlocker }
 *   | WaitingDecision
 *   | { readonly kind: "clear", readonly prs: NonEmpty<ReadyPr | MergedPr> }} StackDecision
 */

/** @typedef {"single" | "stack" | "queued-stack"} WatchMode */

/**
 * Every verdict has the envelope `schemaVersion` (1), `sequence`,
 * `observedAt`, `mode`, `kind`, and `terminal`. A terminal verdict also has
 * `exitCode`.
 *
 * Progress kinds (terminal false): QUEUE (queued-stack, `queue`), STATUS
 * (stack or queued-stack, `reason` "poll" or "whole-stack-sweep", `rows`),
 * WAITING (`frontier`, `reason`: a WaitReason or `{ kind: "merge-queue",
 * unmergedCount }`), ADVANCE (queued-stack, `merged`, `frontier`,
 * `remaining`), and RETRY (`failure`, `consecutiveFailures`,
 * `retryInSeconds`).
 *
 * Terminal kinds and exit codes: STATUS 0 (`reason` "status-only", `rows`),
 * READY 0 (single or stack, `scope`), COMPLETE 0 (queued-stack, `queue`,
 * `merged`), BLOCKER 2 merge-conflicts, 3 review-threads, 4 failing-checks,
 * 6 merge-gate, 7 status-query (`{ kind: "status-query", failures, failure }`),
 * and TIMEOUT 5 (`reason`: a WaitReason, `{ kind: "status-unavailable",
 * failure }`, or `{ kind: "queued-stack", frontier, unmergedCount }`).
 *
 * @typedef {object} WatcherVerdict
 * @property {1} schemaVersion
 * @property {number} sequence
 * @property {string} observedAt
 * @property {WatchMode} mode
 * @property {"QUEUE" | "STATUS" | "WAITING" | "ADVANCE" | "RETRY" | "READY" | "COMPLETE" | "BLOCKER" | "TIMEOUT"} kind
 * @property {boolean} terminal
 * @property {0 | 2 | 3 | 4 | 5 | 6 | 7} [exitCode]
 */
/** @typedef {WatcherVerdict & { readonly terminal: false }} ProgressVerdict */
/** @typedef {WatcherVerdict & { readonly terminal: true, readonly exitCode: 0 | 2 | 3 | 4 | 5 | 6 | 7 }} TerminalVerdict */
/** @typedef {TerminalVerdict & { readonly kind: "BLOCKER" }} BlockerVerdict */
/** @typedef {TerminalVerdict & { readonly kind: "TIMEOUT", readonly exitCode: 5 }} TimeoutVerdict */
/** @typedef {TerminalVerdict} QueueTerminalVerdict COMPLETE, BLOCKER, or TIMEOUT. */

/**
 * @typedef {{ readonly kind: "checks", readonly checks: readonly Check[] }
 *   | { readonly kind: "none-reported" }
 *   | { readonly kind: "unusable", readonly exitCode: number, readonly stderr: string }} ChecksFastPath
 */
/**
 * @typedef {{ readonly kind: "contexts", readonly checks: readonly Check[], readonly endCursor: string | null }
 *   | { readonly kind: "no-rollup" }} RollupPage
 */
/**
 * @typedef {object} RawReviewThread
 * @property {string} id
 * @property {ReviewComment | null} firstComment
 * @property {boolean} resolved
 */
/** @typedef {{ readonly threads: readonly RawReviewThread[], readonly endCursor: string | null }} ReviewThreadPage */

/**
 * @typedef {object} GitHubReader
 * @property {() => Promise<Repository | null>} originRepo
 * @property {(pr: PrNumber | null) => Promise<PrContext>} currentPr
 * @property {(context: PrContext) => Promise<PullRequestFacts>} pullRequest
 * @property {(repository: Repository) => Promise<readonly OpenPullRequest[]>} openPullRequests
 * @property {(repository: Repository) => Promise<string>} defaultBranch
 * @property {(context: PrContext) => Promise<ChecksFastPath>} checksFastPath
 * @property {(context: PrContext, after: string | null) => Promise<RollupPage>} checkRollupPage
 * @property {(context: PrContext, after: string | null) => Promise<ReviewThreadPage>} reviewThreadPage
 * @property {(context: PrContext) => Promise<readonly CommitRollup[]>} commitRollups
 */

/**
 * @typedef {object} PollingOptions
 * @property {number} interval
 * @property {number} sweepInterval
 * @property {number} timeout
 * @property {number} maxQueryErrors
 * @property {boolean} allowDraft
 */
