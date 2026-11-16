#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const KINDS = [
	["test", [/(^|\/)(tests?|__tests__|spec)\//i, /(^|\/)test_[^/]+\.py$/, /[._-](test|spec)\.[^/]+$/i, /[a-z0-9]Tests?\.[^/.]+$/]],
	["migration", [/(^|\/)(migrations?|migrate)\//i, /(^|\/)alembic\/versions\//, /(^|\/)(schema\.prisma|db\/schema\.rb|db\/structure\.sql)$/]],
	["ci", [/^\.github\/(workflows|actions)\//, /(^|\/)\.gitlab-ci\.ya?ml$/, /(^|\/)Jenkinsfile$/, /^\.circleci\//, /(^|\/)azure-pipelines[^/]*\.ya?ml$/]],
	["infra", [/\.tf$/, /^(terraform|k8s|kubernetes|helm|charts|infra|deploy)\//i, /(^|\/)Dockerfile[^/]*$/, /(^|\/)(docker-)?compose[^/]*\.ya?ml$/]],
	[
		"dependency",
		[
			/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
			/(^|\/)(go\.mod|go\.sum|go\.work|flake\.lock|Cargo\.toml|Cargo\.lock|Gemfile(\.lock)?|pom\.xml|build\.gradle(\.kts)?)$/,
			/(^|\/)(requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(\.lock)?)$/,
			/(^|\/)(composer\.(json|lock)|CMakeLists\.txt)$/,
			/\.csproj$/,
			/(^|\/)(Directory\.Packages\.props|packages\.lock\.json)$/,
		],
	],
	["contract", [/\.(proto|graphql|gql|avsc)$/, /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i]],
	["config", [/(^|\/)\.env[^/]*$/, /(^|\/)config\//i, /(^|\/)appsettings[^/]*\.json$/, /\.(ya?ml|toml|ini)$/]],
	["docs", [/\.(md|mdx|rst)$/i, /^docs\//]],
];

const MANUAL_STEP =
	/manual(ly)? (step|action|intervention|migration|backfill|deploy)|\b(run|apply|execute)\b[^\n]{0,60}\b(manually|by hand)\b|manually (run|apply|execute|update|flip|set|change|delete|purge)|(requires|needs) manual|do not auto-?merge|don'?t auto-?merge|manual-review-required/i;
const NO_MANUAL_STEP = /^\W*(no manual (steps?|actions?)( (are |is )?(required|needed))?|manual (steps?|actions?)\W*(none|n\/a))\W*$/i;

export function classify(path) {
	for (const [kind, patterns] of KINDS) {
		if (patterns.some((p) => p.test(path))) return kind;
	}
	return "code";
}

export function manualStepLines(text) {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => MANUAL_STEP.test(line) && !NO_MANUAL_STEP.test(line));
}

export function parseNumstat(numstat) {
	return numstat
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [added, deleted, path] = line.split("\t");
			return { path, added: added === "-" ? null : Number(added), deleted: deleted === "-" ? null : Number(deleted) };
		});
}

function repoKey(url) {
	const match = url.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/*$/i);
	return match ? `${match[1]}/${match[2]}/${match[3]}`.toLowerCase() : null;
}

export function remoteFor(remotes, prUrl) {
	const { host, pathname } = new URL(prUrl);
	const [owner, repo] = pathname.split("/").slice(1, 3);
	const key = `${host}/${owner}/${repo}`.toLowerCase();
	for (const line of remotes.split("\n")) {
		const [name, url] = line.split(/\s+/);
		if (url && repoKey(url) === key) return name;
	}
	return null;
}

export function summarize({ base, head, numstat, churnLog, pr }) {
	const churn = new Map();
	for (const path of churnLog.split("\n").filter(Boolean)) churn.set(path, (churn.get(path) ?? 0) + 1);

	const files = parseNumstat(numstat).map((file) => ({ ...file, kind: classify(file.path), churn: churn.get(file.path) ?? 0 }));
	const kinds = {};
	for (const file of files) kinds[file.kind] = (kinds[file.kind] ?? 0) + 1;

	const prText = pr ? [pr.title, pr.body, ...pr.labels].join("\n") : "";
	return {
		base,
		head,
		pr: pr ? { number: pr.number, title: pr.title, labels: pr.labels } : null,
		files,
		kinds,
		manualSteps: manualStepLines(prText),
	};
}

function git(args) {
	return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function viewPr(number) {
	const args = ["pr", "view", ...(number ? [number] : []), "--json", "number,title,body,labels,baseRefName,headRefOid,url"];
	try {
		const pr = JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
		return { ...pr, labels: pr.labels.map((label) => label.name) };
	} catch (error) {
		if (number) throw new Error(`gh pr view ${number} failed: ${error.stderr || error.message}`);
		return null;
	}
}

function defaultBase() {
	for (const ref of ["origin/HEAD", "main", "master"]) {
		try {
			git(["rev-parse", "--verify", "--quiet", ref]);
			return ref;
		} catch {}
	}
	throw new Error("no origin/HEAD, main, or master: pass --base <ref>");
}

function main() {
	const { values } = parseArgs({ options: { pr: { type: "string" }, base: { type: "string" }, head: { type: "string" } } });
	const pr = values.pr || !(values.base || values.head) ? viewPr(values.pr) : null;

	let base = values.base;
	let head = values.head ?? "HEAD";
	if (pr) {
		const remote = remoteFor(git(["remote", "-v"]), pr.url);
		if (!remote) throw new Error(`no git remote points at ${pr.url.replace(/\/pull\/\d+$/, "")}`);
		git(["fetch", "--quiet", remote, pr.baseRefName, `pull/${pr.number}/head`]);
		base ??= `${remote}/${pr.baseRefName}`;
		if (values.pr) head = values.head ?? pr.headRefOid;
	}
	base ??= defaultBase();

	const numstat = git(["diff", "--numstat", "--no-renames", `${base}...${head}`]);
	const since = new Date(git(["log", "-1", "--format=%cI", base]).trim());
	since.setMonth(since.getMonth() - 6);
	const churnLog = git(["log", "--format=", "--name-only", "--no-renames", `--since=${since.toISOString()}`, base]);

	console.log(JSON.stringify(summarize({ base, head, numstat, churnLog, pr }), null, 2));
}

function invokedDirectly() {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

if (invokedDirectly()) main();
