### Authoring or modifying a skill

**You own the skill's voice.**

1. Read `SKILL.md` and `SKILL-MECHANICS.md` of the **writing-for-agents** skill (`../../writing-for-agents/`) by path, and follow them.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve.
3. For a new rule, attach it to the action it guards, not to one playbook. Before you scope the fix, list every path to that action: each playbook, a follow-up chat message, a PR opened by hand or by another session, and a stacked PR. When the rule must not be missed, enforce it with a script or a hook, per the **encode-lessons-in-structure** principle skill.
4. Test cases if structural. Skip if subjective.
5. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
