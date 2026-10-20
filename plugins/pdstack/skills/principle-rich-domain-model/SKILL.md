---
name: principle-rich-domain-model
description: "Apply when writing or changing a business rule for an entity or a domain concept. Behavior lives on the entity, behind intent-named methods and self-validating value objects."
user-invocable: false
---

# Rich Domain Model

Put the behavior of an entity on the entity. Handlers and services do not change its state directly. Each change is a method with an intent name, and that method enforces the rules for the change.

**Why:** When any caller can set any field, every caller must know every rule, and one of them forgets. A method with an intent name holds the rule in one place. The entity cannot reach an invalid state, so the code that reads it does not check again.

**The pattern:**
- **No public setters.** State changes only through entity methods, for example `Rename`, `AssignRole`, or `Close`, never `entity.Status = ...` from a handler.
- **Create through a factory** that validates, not a public constructor that accepts anything.
- **Value objects for domain concepts** (an email, a money amount, a role), not bare primitives. A value object validates on creation, so an invalid one cannot exist.
- **Collections stay private.** Expose a read-only view, and change it only through entity methods.
- **A method that changes state records the change**, for example as a domain event, when other parts of the system react to it.
- **Entity methods and value objects are the functional core** (**principle-functional-core**). Handlers are the shell: load the entity, call one method, save.

**The tests:**
- "Can a handler put this entity in a state that breaks a rule?" If yes, the rule is in the wrong place.
- "Is this `string` or `int` a domain concept with rules?" Make it a value object.
- "Does the method name say what the user did, or which field changed?" Name the intent.

The sign that you skipped this is a handler that sets three fields in a row, or a validation rule copied into a second handler.

The stack pack for the project gives the patterns for its language, for example the `dotnet` pack for C#.
