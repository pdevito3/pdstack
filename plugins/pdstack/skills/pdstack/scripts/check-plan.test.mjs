import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";

const checker = join(import.meta.dirname, "check-plan.mjs");
const rule =
	"Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";

const validPlan = `# Demo

## How to read this
One box is one unit of work and names the evidence. Check a box only when its evidence exists. See playbooks/.
${rule}

## Program checklist
### Arm the program
- [ ] Write the standing orders. Read the playbook from the installed plugin. Arm the hourly audit tick.
### Spawn owners
- [ ] Spawn one owner per PR.
### PR mechanics
- [ ] Open each PR ready.
### Verdict and merge
- [ ] Record each verdict.
### Boot recipe
\`git show origin/main:\` /loop 1h status message
- [ ] Boot each live lane.

## PR 1
**Depends on.** None.
**Files.**
- [ ] Do the thing.
**Build.**
- [ ] Do the thing.
**You see.**
- [ ] Do the thing.
**Verify, unit.** ${rule}
- [ ] Check the thing.
**Verify, live.** ${rule} Ten lanes on the configured \`swarm workers\` model at the PR head
${Array.from({ length: 10 }, (_, i) => `- [ ] Lane ${i + 1}. Save \`lane-${i + 1}.png\`. Pass when evidence exists.`).join("\n")}
**Verify, perf.** ${rule}
- [ ] Metric. Recorded.
- [ ] Probe. Recorded.
- [ ] Baseline. Recorded.
- [ ] Rule. Recorded.
**Review gate.** None.
**Merge.**
- [ ] Merge when approved.

## Close the program
- [ ] Close.

## Appendix Prototype evidence
Recorded.
`;

const run = (plan, expectedExit) => {
	const directory = mkdtempSync(join(tmpdir(), "check-plan-test-"));
	const file = join(directory, "plan.md");
	writeFileSync(file, plan);
	try {
		const result = spawnSync(process.execPath, [checker, file], { encoding: "utf8" });
		assert.equal(result.status, expectedExit);
		return result;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};
const runPlan = (example, expectedExit) => run(validPlan + example, expectedExit);

test("accepts ordinary, indented, and longer closing fences", () => {
	for (const indent of ["", " ", "  ", "   "])
		runPlan(`${indent}\`\`\`markdown\n## Example only\n${indent}\`\`\`\n`, 0);
	runPlan("```markdown\n## Example only\n````\n", 0);
});

test("accepts nested backticks and tilde info strings", () => {
	runPlan("````markdown\n```markdown\n## Example only\n```\n````\n", 0);
	runPlan("~~~markdown `info`\n## Example only\n ~~~\n", 0);
});

test("keeps mismatched, shorter, and suffixed closers inside the fence", () => {
	runPlan("````markdown\n~~~\n## Example only\n````\n", 0);
	runPlan("````markdown\n```\n## Example only\n````\n", 0);
	runPlan("````markdown\n``` info\n## Example only\n````\n", 0);
});

test("rejects headings and prose outside a proper close", () => {
	for (const suffix of ["  ", "\t"]) {
		const heading = runPlan(`\`\`\`markdown\n## Example only\n\`\`\`${suffix}\n## Example only\n`, 1);
		assert.ok(heading.stderr.includes('"## Example only" after Close the program is not an appendix'));
	}

	const prose = runPlan("```markdown\nThis prose has a mid-sentence colon: inside code\n```\nThis prose has a mid-sentence colon: bad.\n", 1);
	assert.ok(prose.stderr.includes("mid-sentence colon"));
});

test("rejects backtick info strings containing a backtick", () => {
	const result = runPlan("```markdown `invalid`\n## Example only\n```\n", 1);
	assert.ok(result.stderr.includes('"## Example only" after Close the program is not an appendix'));
});

test("ignores prose punctuation inside matching multi-backtick code spans", () => {
	for (const count of [2, 3, 4]) {
		const delimiter = "`".repeat(count);
		runPlan(`Use ${delimiter}echo \`x\`: “quoted” — example${delimiter}.\n`, 0);
	}
});

test("checks prose following a multi-backtick span and unmatched delimiters", () => {
	const outside = runPlan("Use ``echo `x`: y``. Bad: prose.\n", 1);
	assert.ok(outside.stderr.includes("mid-sentence colon"));
	const unmatched = runPlan("Use ``unclosed: bad` here.\n", 1);
	assert.ok(unmatched.stderr.includes("mid-sentence colon"));
});

test("fenced examples cannot supply How to read this guidance", () => {
	const plan = validPlan.replace(/(## How to read this\n)([\s\S]*?)(?=\n## )/, (_, heading, body) => heading + "```markdown\n" + body + "\n```\n");
	const result = run(plan, 1);
	assert.ok(result.stderr.includes('How to read this lacks "One box is one unit of work"'));
});

test("fenced examples cannot supply program markers", () => {
	const plan = validPlan.replace(/(## Program checklist\n)([\s\S]*?)(?=\n## )/, (_, heading, body) =>
		heading + body.replaceAll("hourly", "frequent") + "\n```text\nhourly\n```\n",
	);
	const result = run(plan, 1);
	assert.ok(result.stderr.includes('Program checklist lacks "/hourly|every hour/"'));
});

test("fenced examples cannot supply review gate evidence", () => {
	const plan = validPlan.replace("**Review gate.** None.", "**Review gate.**\n- [ ] Review the change.\n```text\nscreenshot video operator\n```");
	const result = run(plan, 1);
	for (const word of ["screenshot", "video", "operator"]) assert.ok(result.stderr.includes(`Review gate lacks "${word}"`));
});
