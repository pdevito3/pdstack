# dotnet stack pack: standards

Scope: .NET code in C#.

Globs: `**/*.cs`, `**/*.csproj`, `**/Directory.Build.props`, `**/Directory.Packages.props`

Apply these standards only to files that match the globs. Project docs win over this pack. This pack wins over principles. A standard that overrides a principle names it.

This pack holds only the rules that apply to any .NET project. The principles give the design: `principle-rich-domain-model`, `principle-functional-core`, `principle-boundary-discipline`, and `principle-type-system-discipline`. The project docs give the patterns of the project, for example its factories, ID format, exceptions, mappers, and folder layout.

## 1. Modern C#

**Rule:** Use the C# features of the language version that the repo targets. Turn on nullable reference types. Use file-scoped namespaces, records for data, primary constructors for injection, `required` members, pattern matching, switch expressions, and collection expressions. Match the style of the file when a project doc names an older form.

**Why:** The newer forms are shorter and let the compiler find more errors. Nullable reference types make a missing value a compiler warning, not a runtime `NullReferenceException`.

**Violation:** `#nullable disable` in new code. A `!` that only silences a nullable warning. A block-scoped namespace in a new file. A class with only properties and equality for data. A field-and-constructor injection block where a primary constructor fits.

## 2. Async all the way, with the CancellationToken

**Rule:** Await each async call. Pass the `CancellationToken` that is in scope to each async call.

**Why:** A block on an async call can deadlock and holds a thread from the pool. A canceled request stops its database and HTTP work only when each call gets the token.

**Violation:** `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()` on a task in app code. `async void` outside an event handler. `await ...Async()` with no token argument while a token is in scope. `CancellationToken.None` in request code.

## 3. No new warnings, central package versions

**Rule:** Fix the cause of each compiler and analyzer warning. To accept one, add its code to `NoWarn` with a comment that gives the reason. When the repo has `Directory.Packages.props`, put each NuGet version there.

**Why:** A warning that nobody fixes hides the next real one. Versions in one file stay consistent across projects.

**Violation:** `#pragma warning disable` with no reason. `Version="..."` on a `PackageReference` in a repo with central package management.

## 4. Structured logs with no personal data

**Rule:** Write logs as message templates with named properties, not string interpolation. Put only IDs, operation names, and counts in log properties, span tags, and span names. Use stable span names with no IDs in them.

**Why:** A template keeps each property searchable. Telemetry goes to shared tools with wide access and long retention.

**Violation:** `logger.LogInformation($"...")`. An email, a name, or user text in a log property or a tag. A span name that contains an ID.

## 5. EF Core tests use a real database

**Rule:** If the repo uses EF Core, test queries and data rules against the real database engine, for example in a container. Generate each migration with the EF Core tools. Do not edit a model snapshot by hand.

**Why:** The EF Core in-memory provider skips SQL translation, constraints, and collations, so it passes queries that fail in production. A hand edit to a snapshot makes the next migration wrong.

**Violation:** `UseInMemoryDatabase` in a test. A unit test that mocks `DbContext` to test a query. A model change with no migration in the diff. A hand edit to a `*ModelSnapshot.cs` file.
