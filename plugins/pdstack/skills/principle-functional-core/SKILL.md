---
name: principle-functional-core
description: "Apply when writing business logic, or a change that mixes decisions with I/O. Decisions live in pure functions, and a thin shell does the I/O."
user-invocable: false
---

# Functional Core

Split each change into a functional core and an imperative shell. The core makes every decision. It takes plain values and returns plain values, with no I/O, no clock, no randomness, and no framework. The shell reads the inputs, calls the core, and writes the result. It holds no business rules.

**Why:** A decision inside I/O can be tested only with the I/O. A pure decision can be tested with a table of inputs and outputs, and it reads the same in every caller. The shell stays small enough to trust by reading it.

**The pattern:**
- **Core:** pure functions, entity methods, and value objects. Input in, decision out. A side effect becomes a returned value, for example an event, a command, or a list of writes.
- **Shell:** handlers, controllers, jobs, and CLI entry points. Load, call the core, persist, publish. No `if` that encodes a business rule.
- **Inputs the core needs from the world** (the time, an ID, a config value) come in as arguments. The core never reaches for them.
- **Validation at the edge** follows **principle-boundary-discipline**. The core trusts its typed inputs.

**The tests:**
- "Does this function both decide and do I/O?" If yes, split it.
- "Can I test this rule without a database, a network, or a mock?" If no, the rule is in the shell.
- "Does the handler branch on domain state?" Move that branch into the core.

The sign that you skipped this is a test that needs three mocks to check one rule, or the same rule written again in a second handler.
