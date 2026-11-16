import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, manualStepLines, remoteFor } from "./signals.mjs";

const script = join(import.meta.dirname, "signals.mjs");

test("classify sorts paths into kinds", () => {
	const cases = {
		"src/orders/total.ts": "code",
		"src/ABTest.ts": "code",
		"src/infra/db.ts": "code",
		"src/components/charts/LineChart.tsx": "code",
		"queries/report.sql": "code",
		"src/orders/total.test.ts": "test",
		"tests/test_total.py": "test",
		"test_total.py": "test",
		"alembic/versions/3f2a_add_status.py": "migration",
		"db/schema.rb": "migration",
		"flake.lock": "dependency",
		"go.work": "dependency",
		"Orders.Tests/TotalTests.cs": "test",
		"db/migrate/20260101_add_status.rb": "migration",
		"Migrations/0003_rename.sql": "migration",
		".github/workflows/ci.yml": "ci",
		".github/actions/setup/action.yml": "ci",
		"azure-pipelines.yml": "ci",
		"infra/main.tf": "infra",
		"compose.yaml": "infra",
		"Dockerfile": "infra",
		"pnpm-lock.yaml": "dependency",
		"Api/Api.csproj": "dependency",
		"Pipfile": "dependency",
		"composer.json": "dependency",
		"CMakeLists.txt": "dependency",
		"proto/order.proto": "contract",
		"api/openapi.yaml": "contract",
		"appsettings.Production.json": "config",
		".env.example": "config",
		"README.md": "docs",
	};
	for (const [path, kind] of Object.entries(cases)) assert.equal(classify(path), kind, path);
});

test("manualStepLines finds declared manual steps", () => {
	const body = [
		"## Why",
		"Splits the name column.",
		"After deploy, run the backfill script manually against prod.",
		"After deploy, run node scripts/backfill.ts manually.",
		"Run `scripts/backfill.mjs` by hand after deploy.",
		"Manual step: flip `orders.v2` in the admin console.",
		"Do not auto-merge.",
		"Run `scripts/migrate.sh` manually before deploy, downtime is not required.",
		"Manual step: flip orders.v2 in the admin console (no manual rollback exists).",
		"Manual steps: none in staging, in prod run the backfill manually.",
	].join("\n");
	assert.deepEqual(manualStepLines(body), body.split("\n").slice(2));
});

test("manualStepLines ignores lines that deny a manual step or only mention the word", () => {
	const body = [
		"No manual steps required.",
		"No manual steps.",
		"Manual steps: none",
		"- Manual steps: N/A",
		"Manual QA: clicked through the settings page locally.",
		"Manual verification done in staging.",
		"The old code did this by manual string parsing.",
	].join("\n");
	assert.deepEqual(manualStepLines(body), []);
});

test("remoteFor picks the remote of the PR's base repo, not origin", () => {
	const remotes = [
		"origin\tgit@github.com:me/widgets.git (fetch)",
		"origin\tgit@github.com:me/widgets.git (push)",
		"upstream\thttps://github.com/Acme/widgets.git (fetch)",
		"upstream\thttps://github.com/Acme/widgets.git (push)",
		"bigacme\thttps://github.com/bigacme/widgets (fetch)",
		"ghe\tssh://git@ghe.example.com:2222/acme/tools.git (fetch)",
		"slash\thttps://github.com/acme/gadgets/ (fetch)",
	].join("\n");
	assert.equal(remoteFor(remotes, "https://github.com/acme/widgets/pull/7"), "upstream");
	assert.equal(remoteFor(remotes, "https://github.com/me/widgets/pull/7"), "origin");
	assert.equal(remoteFor(remotes, "https://github.com/other/widgets/pull/7"), null);
	assert.equal(remoteFor(remotes, "https://github.com/bigacme/widgets/pull/7"), "bigacme", "a suffix is not a match");
	assert.equal(remoteFor(remotes, "https://github.com/acme/tools/pull/7"), null, "the host must match");
	assert.equal(remoteFor(remotes, "https://ghe.example.com/acme/tools/pull/7"), "ghe");
	assert.equal(remoteFor(remotes, "https://github.com/acme/gadgets/pull/7"), "slash");
});

test("with no arguments the CLI diffs HEAD against main and reports kinds, line counts, and churn on the base", () => {
	const repo = mkdtempSync(join(tmpdir(), "merge-risk-"));
	try {
		const run = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
		const commit = (path, text, message) => {
			mkdirSync(dirname(join(repo, path)), { recursive: true });
			writeFileSync(join(repo, path), text);
			run("add", path);
			run("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", message);
		};
		run("init", "-q", "-b", "main");
		for (const text of ["a\n", "b\n", "c\n"]) commit("src/hot.ts", text, text);
		for (const text of ["a\n", "b\n"]) commit("src/café/[id].tsx", text, text);
		commit("src/i.tsx", "a\n", "an unrelated file that [id].tsx matches as a glob");
		run("checkout", "-qb", "feature");
		commit("src/hot.ts", "d\ne\n", "change hot");
		commit("src/café/[id].tsx", "c\n", "change page");
		commit("db/migrations/001.sql", "alter table t add c int;\n", "add migration");

		const out = JSON.parse(execFileSync("node", [script], { cwd: repo, encoding: "utf8" }));
		assert.equal(out.pr, null, "no PR without a forge remote");
		assert.equal(out.base, "main");
		assert.deepEqual(out.kinds, { migration: 1, code: 2 });
		const churn = Object.fromEntries(out.files.map((f) => [f.path, f.churn]));
		assert.deepEqual(churn, { "db/migrations/001.sql": 0, "src/café/[id].tsx": 2, "src/hot.ts": 3 }, "churn counts base commits per literal path");
		assert.deepEqual(
			out.files.find((f) => f.path === "src/hot.ts"),
			{ path: "src/hot.ts", added: 2, deleted: 1, kind: "code", churn: 3 },
		);
		assert.deepEqual(out.manualSteps, []);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
