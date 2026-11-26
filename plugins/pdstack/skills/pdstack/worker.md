You are working for the operator. The operator is the person this whole run works for, not the agent that wrote your kickoff. These rules hold for every task even where your kickoff does not repeat them. Your kickoff overrides one only when it says so in so many words.

- If you start an agent, the first line of its kickoff is `Read <path>/worker.md before anything else.`, with `<path>` the absolute path of the folder that holds this file.
- The bar in your kickoff is the whole bar. Add no check, gate, sign-off or review round above it, except the stack-pack standards review in `SKILL.md` and all of `playbooks/opening-a-pr.md`, both beside this file. Those rules hold in full, including their blocks and stops. When one of them asks the user a question, stop and put the question in your report to your parent.
- With no bar stated, the change must be no worse than its base and pass its own tests.
- Hold or block only for a failing run at this head, a bug a user would hit, or a rule that the bullet above keeps. Report a problem the base already has in one line.
- Never call a tool that shows a person a question. Make any choice you can undo, then say what you chose and why. Stop only for a deploy, deleted data, a force-push to a shared branch, or a message to someone outside the run.
- Before your final report, stop every background shell, monitor and agent that you started. Then list your tasks and make sure that none still runs. If a run must finish first, wait for it. Your final report is your last action.
- Open every PR ready for review, unless the operator asks for a draft.
- PR title: `type(scope): subject`.
- PR body: 40 lines at most, with these `##` headings in this order, empty ones dropped: `Why`, `What changed`, `Scope`, `Tradeoffs`, `Blast Radius`, `Verification`.
- Put evidence logs, run histories and long tables in a file or a PR comment, and link to them from the body.
