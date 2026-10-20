---
name: upstream-review
description: Review the upstream changes since the reviewed feed positions in provenance.json, decide a verdict for each, and apply the approved ones in one PR. Use for "upstream review", "review upstream", "sync upstream", "check for pstack or pstack-claude updates", or moving the feeds forward.
disable-model-invocation: true
---

# Upstream review

pdstack copies files from three upstream feeds: cursor/plugins (the feed of intent), michael-denyer/pstack-claude (the feed of translation), and mattpocock/skills. This review lists each upstream change since the `feeds` positions in `provenance.json`, gets a verdict for each from the user, and applies the approved changes in one PR. The rules are in `docs/spec/v1.md` sections 3 and 12.

## 1. Collect

Run from the repo root:

```sh
node tools/upstream-diff.mjs
```

The script fetches each feed into `.upstreams/<owner>__<repo>` and prints one entry for each upstream commit since the feed position. Add `--json` for the same data as JSON, or `--feed <source>` for one feed.

- A cursor entry shows its translation state: the pstack-claude "Sync to upstream" commit that translated it, or "not translated yet".
- A pstack-claude entry is a sync of a cursor commit or a change of its own. A change of its own shows the reason from pstack-claude `tools/forks.json` for each forked file.
- The Pin column gives the pin status of each pdstack file: `verbatim`, `renamed`, `modified`, a new upstream file with no pin, or "not copied".

Record the `to` sha of each feed from the report header. When no feed has a change, tell the user and stop.

## 2. Recommend

Read the diff of each entry with `git -C .upstreams/<owner>__<repo> show <sha>`. Then write for each entry:

- a summary of one or two sentences
- the pdstack files that it touches
- its translation state
- a recommended verdict, adopt, adapt, or skip, with a reason of one line

Use these rules for the verdict:

- Honor upstream. When pstack-claude translated a cursor change, pdstack takes the pstack-claude text. Recommend skip on the cursor entry with the reason "taken through pstack-claude <sha>", and judge the sync entry.
- A cursor change with no translation is skip (wait for pstack-claude), or adapt when pdstack needs it now.
- adopt copies the upstream text. adapt changes it for pdstack, so the pin is `modified` with a `why`.
- A change to a file with a `modified` pin is adapt.
- A change that touches only "not copied" files is skip.
- A new upstream file is adopt only when spec section 4 copies its folder. Otherwise it is skip.
- Every entry gets a verdict, also an entry with only `verbatim` files.

## 3. Decide

Present all entries in one round, grouped by feed, like a grilling session. Number each entry and show its summary, files, translation state, and recommended verdict. Ask the user to confirm or change each verdict. Do not apply anything before the user answers.

## 4. Apply

Do all the work in one fresh worktree in the worktree home:

```sh
git worktree add ../pdstack-worktrees/upstream-review-<yyyy-mm-dd> -b upstream-review-<yyyy-mm-dd> main
```

Apply the approved changes of each feed, oldest first. For each pdstack file, use the sha of the latest approved change that touches it. The text at that sha holds every earlier upstream change to the file. When an earlier change to the same file is skipped, adapt the file instead.

- `verbatim` or `renamed` file: copy it again from its source. The command applies the `renames` table and `hide` as the provenance check does, and sets the pin `sha`:

  ```sh
  node tools/upstream-diff.mjs --apply <pdstack-path> --to <sha>
  ```

- `modified` file: read the new upstream text with `git -C .upstreams/<owner>__<repo> show <sha>:<path>`. Apply the local change again on it, with the pin `why` as the guide. Set the pin `sha` to the full sha.
- New upstream file: add a pin with `source`, `path`, `sha`, and `status`. A leaf skill `SKILL.md` is `renamed` with `"hide": true`. Then run `--apply` for it.
- Deleted upstream file: delete the pdstack file and its pin, and remove the references to it.
- Adapted change: make the change, then set the pin `status` to `modified` with a `why`.

Move every `feeds` position to the `to` sha of its feed from step 1, also for skipped changes.

Run the checks. All must pass:

```sh
node --test
node tools/lint-skills.mjs
node tools/check-provenance.mjs
```

Open one PR with the `opening-a-pr` playbook in `plugins/pdstack/skills/pdstack/playbooks/opening-a-pr.md`. The PR body holds the table of decisions:

| Feed | Change | Summary | Verdict | Reason |
| --- | --- | --- | --- | --- |
| cursor/plugins | `<short sha>` | ... | skip | taken through pstack-claude `<short sha>` |

A review that only skips still opens this PR. It moves the feed positions.
