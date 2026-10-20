# dotnet stack pack: standards

Scope: .NET back ends with a rich domain model, EF Core, and CQRS through MediatR in vertical slices.

Globs: `**/*.cs`, `**/*.csproj`, `**/Directory.Build.props`, `**/Directory.Packages.props`

Apply these standards only to files that match the globs. Project docs win over this pack. This pack wins over principles. A standard that overrides a principle names it. A repo with no domain layer or no MediatR (for example a library) skips the standards that do not apply.

## Entities

### 1. Private setters

**Rule:** Give each entity property a private setter. Only methods on the entity change its state.

**Why:** Code outside the entity cannot then skip a business rule. Each rule has one location.

**Violation:** `{ get; set; }` or `{ get; init; }` on an entity property. A handler or a service that assigns `entity.Property = value`.

### 2. Static Create factory

**Rule:** Create an entity only with `public static <Entity> Create(<Entity>ForCreation model)`. Give EF Core a `protected` parameterless constructor. Do not add a public constructor.

**Why:** `Create` validates the new entity and queues its created event. A public constructor makes an entity that skipped both.

**Violation:** `new Order(...)` outside the entity class. A `public` constructor on an entity. A `Create` with a long list of primitive parameters in place of a creation model.

### 3. One intent method for each change

**Rule:** Add one public method for each business change, named for the intent, for example `UpdateRole` or `AddPermission`. Each method enforces its rules, queues its event, and returns `this`.

**Why:** An intent name says why the state changed. The rules for that change live in one method.

**Violation:** A new `SetX` method that only assigns a value. A handler that calls several setters in sequence to do one business change. A new field added only to a broad `Update(model)` when the change has its own rule or event.

### 4. ValidationException with the request field name

**Rule:** Validate in the entity and in value objects. On a failed rule, throw `ValidationException` with the request field name in camelCase, for example `"firstName"`, and a message for the user.

**Why:** The field name becomes the key in the `errors` of the problem details response. The client then shows the message next to the correct field.

**Violation:** `throw new ValidationException("...")` with no field name. A PascalCase or `nameof(...)` field name. A FluentValidation `Validator` class in a feature folder that no pipeline runs. A domain rule checked in the endpoint.

**Overrides:** `principle-boundary-discipline`. The entity is a boundary of its own invariants, so it validates even when a request DTO validated the shape. DTO validation checks presence and format. The entity checks the business rule.

### 5. Guards for state rules

**Rule:** When a rule blocks changes in some states, put it in a private guard method, for example `GuardIfInFinalState(field, subject)`. Call the guard first in each method that it protects.

**Why:** One guard gives one message and one check. A copied `if` drifts when the rule changes.

**Violation:** The same state check copied into two or more entity methods. A state rule checked in a handler before it calls the entity.

### 6. Private collections

**Rule:** Keep a child collection in a private `List<T>` field. Expose it as `IReadOnlyCollection<T>`. Change it only with entity methods. Configure EF Core to use the field.

**Why:** A public list lets callers add or remove children and skip the rules.

**Violation:** `public List<T>` or `ICollection<T>` on an entity. A handler that calls `.Add` on an entity collection.

### 7. Prefixed string IDs

**Rule:** Give each entity a `public const string IdPrefix`. IDs are strings in the form `{prefix}_{uuidv7}`, not `Guid`. The EF constructor calls `base(IdPrefix)`.

**Why:** A prefixed ID shows its type in logs, URLs, and support tickets. Two IDs of different types cannot be mixed by mistake.

**Violation:** A `Guid Id` on a new entity. An entity with no `IdPrefix`, or a prefix that another entity uses.

## Value objects

### 8. Value objects for domain concepts

**Rule:** Model a domain concept such as an email, a role, or a rating as a value object that derives from `ValueObject`. It validates in its constructor and has a static `Of(value)` factory. Map it to a column with `ComplexProperty`.

**Why:** A bare `string` accepts any value. A value object that validates on creation is always valid after that.

**Violation:** A new entity property of type `string`, `int`, or `decimal` for a concept with rules. A value object with a public constructor and no `Of`. Validation of the concept copied into a handler.

### 9. Fixed options behind a private SmartEnum

**Rule:** When a value has a fixed set of options, back the value object with a private nested `SmartEnum`. Put the behavior for each option on the SmartEnum subclass. Parse with `TryFromName` and throw `ValidationException` with the request field name on a bad value.

**Why:** Behavior for each option lives with the option. A new option is one subclass, not a new branch in each `switch`.

**Violation:** A `switch` or an `if` chain on a role or status string. A public C# `enum` for a domain concept with behavior. A SmartEnum that is public outside its value object.

## Domain events

### 10. Events queued in the entity

**Rule:** Make each event a `sealed record` that derives from `DomainEvent`, named in the past tense. Queue it in the entity method that changes the state. `SaveChangesAsync` publishes it. Do not add an event for a delete.

**Why:** The event then fires only for a change that the entity accepted and saved. A handler cannot forget it.

**Violation:** `new SomethingHappened(...)` in a handler. `mediator.Publish` for a domain event. An event named in the present tense or as a command.

### 11. Event handlers are independent and safe to repeat

**Rule:** Give each event handler one job. It does not depend on another handler for the same event. It gives the same result when it runs two times. An event carries the data that its handlers need.

**Why:** Handlers run after the save in the same request, in no fixed order. A failure leaves the save in place. A retry must not do the work twice.

**Violation:** A handler that reads a value that another handler writes. A handler that sends a message or adds a row with no check for a repeat.

## Features

### 12. One folder for each feature

**Rule:** Put each feature in `Domain/<Entity>s/Features/<FeatureName>/`. The core file has a static class with a `sealed record` named `Command` or `Query` and a `sealed class Handler`. Inject services with a primary constructor.

**Why:** A reader finds the request, the handler, and each entrypoint of a feature in one folder.

**Violation:** A handler in a shared `Handlers/` folder. One file with two features. A handler with a field-and-constructor injection block.

### 13. Thin command handlers

**Rule:** A command handler loads the entity, calls one entity method or `Create`, and calls `SaveChangesAsync`. A check that needs the database, such as a unique value, stays in the handler and throws `ConflictException` on the request field. A query does not change data and uses `AsNoTracking()` for lists.

**Why:** Business rules then live in the entity, where unit tests reach them with no database.

**Violation:** An `if` on entity state in a handler. A handler that assigns entity properties. A query handler that calls `SaveChangesAsync`.

### 14. Pass the CancellationToken

**Rule:** Pass the `CancellationToken` to each async call in a handler, a service, and an endpoint.

**Why:** A canceled request then stops its database and HTTP work. Without the token, the work runs to the end for no caller.

**Violation:** `await ...Async()` in a handler with no token argument while a token is in scope. `CancellationToken.None` in request code.

## Contracts

### 15. DTOs, never entities

**Rule:** Return a DTO from each handler and endpoint. Make each DTO a `sealed record` with `init` properties. Use separate DTOs for the response and for each request body. A request DTO has no `Id`, audit fields, or internal data.

**Why:** An entity in a response leaks internal fields and ties the API to the database shape. Lazy-loaded navigations can also throw.

**Violation:** A handler that returns `Task<User>`. A request DTO with `Id`, `CreatedBy`, or `TenantId`. One DTO used for both create and response.

### 16. Mapperly maps with no logic

**Rule:** Map with Mapperly in a `static partial class` with `[Mapper]`. Write each map as an extension method. Add an `IQueryable` projection for list queries. Map a value object to its primitive with a private method. Put no business logic in a mapper.

**Why:** Mapperly generates the code at compile time and reports unmapped members. A projection becomes one SQL query.

**Violation:** A hand-written map method. A mapper method that branches on business state. A list query that loads entities and maps them in memory where a projection works.

### 17. Endpoints are thin adapters

**Rule:** An endpoint or a controller action sends one MediatR request and returns the result of its transport. It does not use `DbContext` or EF Core. It does not catch domain exceptions. Transport types such as `HttpContext` stay out of requests, handlers, entities, and DTOs.

**Why:** The same feature can then serve HTTP, gRPC, or MCP. The shared pipeline maps each domain exception to the same status on each transport.

**Violation:** `AppDbContext` injected in an endpoint or controller. `try`/`catch` around `mediator.Send`. `using Microsoft.AspNetCore.Http` in a handler or an entity.

### 18. Errors are domain exceptions

**Rule:** Throw the domain exceptions (`ValidationException`, `NotFoundException`, `ConflictException`, `ForbiddenAccessException`) from the entity or the handler. Let the central mapping turn them into problem details. Declare each error status that the endpoint can return in its OpenAPI metadata.

**Why:** Each client gets the same RFC 7807 shape for the same failure. The OpenAPI contract states every response.

**Violation:** `return Results.BadRequest(...)` or `BadRequest(...)` for a domain rule. A new exception type with no entry in the central mapping. A write endpoint with no 422 in its metadata.

## Data

### 19. One configuration class for each entity

**Rule:** Configure each entity in a `sealed` class that implements `IEntityTypeConfiguration<T>`. Give each string a max length. Set `OnDelete` on each relationship. Index each column that queries filter or sort on. Add a migration after each change.

**Why:** Unbounded strings and default cascades cause data loss and slow queries that show only in production.

**Violation:** Entity setup inside `OnModelCreating`. A string property with no `HasMaxLength`. A relationship with no `OnDelete`. A configuration change with no migration in the diff. A hand edit to a migration snapshot.

### 20. Soft delete and unique indexes

**Rule:** Delete through `Remove`, and let the context change it to a soft delete. When a deleted row must free a unique value, filter the index with `HasFilter("is_deleted = false")`.

**Why:** A soft-deleted row still holds its unique value. Without the filter, a user cannot reuse a value that they deleted.

**Violation:** A new unique index on a soft-deleted entity with no filter and no reason. A handler that sets `IsDeleted` directly.

### 21. Paged lists have a fixed order

**Rule:** Give each paged list query a total order. With no caller sort, sort by a natural key, then by `Id`. After a caller sort, also sort by `Id`. Index the default sort.

**Why:** Without a total order, the database can return a row on two pages or on no page.

**Violation:** A paged query with no `OrderBy`. An `OrderBy` on a column that is not unique with no `ThenBy(x => x.Id)`.

## Build and telemetry

### 22. No new warnings, central package versions

**Rule:** Fix the cause of each compiler and analyzer warning. To accept one, add its code to `NoWarn` with a comment that gives the reason. When the repo has `Directory.Packages.props`, put each NuGet version there.

**Why:** A warning that nobody fixes hides the next real one. Versions in one file stay consistent across projects.

**Violation:** `#pragma warning disable` with no reason. `Version="..."` on a `PackageReference` in a repo with central package management.

### 23. No personal data in telemetry

**Rule:** Put only IDs, operation names, and counts in span tags, span names, and log properties. Use stable dotted span names with no IDs in them. Write logs as message templates with named properties, not string interpolation.

**Why:** Telemetry goes to shared tools with wide access and long retention. A template keeps each property searchable.

**Violation:** An email, a name, or user text in a tag or a log property. `logger.LogInformation($"...")`. A span name that contains an ID.

### 24. Tests that run the real database

**Rule:** Test entity and value object rules in unit tests with no database. Test handlers against a real database in a container. Test endpoints through the HTTP client of the app. Each test creates its own data.

**Why:** The EF Core in-memory provider skips SQL translation, constraints, and collations, so it passes queries that fail in production. Shared rows make parallel tests flaky.

**Violation:** `UseInMemoryDatabase` in a test. A test that depends on a row from another test. A unit test that mocks `DbContext` to test a business rule.
