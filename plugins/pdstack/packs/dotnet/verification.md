# dotnet stack pack: verification

Scope: prove a change to a .NET back end on its real surface. That surface is the running app host and its endpoints.

Globs: `**/*.cs`, `**/*.csproj`, `**/Directory.Build.props`, `**/Directory.Packages.props`

## Where this file fits

Read this file first. It sets the surface, the proof bar, and the verdicts. Then use the project `verify` skill if the repo has one. It knows the launch script, the auth flow, and the seed data. Then use `run` for any gap. If the project skill and this file disagree, the project skill wins.

`dotnet build` and `dotnet test` are preconditions, not verification. Verification calls the running app the way a client does and reads the result.

## Surface

The primary surface is the Aspire app host, which starts the API, its database, and its other resources. A repo with no app host runs the API project with `dotnet run`. State in the reply which transports (HTTP, gRPC, MCP) the proof did not reach. Also state which callers it did not reach, for example a SPA through a BFF.

## Steps

1. Restore the local tools. The repo can pin the Aspire CLI in `dotnet-tools.json`.

   ```bash
   dotnet tool restore
   ```

2. Start the stack in the background. In a worktree, always use an isolated run: random ports, an empty database, and a copy of the user secrets. Use the command that the project docs give. If they give none, use this one.

   ```bash
   dotnet aspire start --isolated --non-interactive --apphost <AppHost>
   ```

   With a global Aspire CLI, run `aspire` in place of `dotnet aspire`. Never drive or stop a stack that this run did not start.

3. Wait until the resources are healthy, then read their URLs.

   ```bash
   dotnet aspire wait <api-resource> --status healthy --apphost <AppHost>
   dotnet aspire describe --apphost <AppHost> --format Json > "$EVIDENCE/stack.json"
   ```

4. Create the data that the proof needs through the API. An isolated run starts empty, so never rely on rows from an earlier run.

5. Call the endpoint as a client does. Use the URL from step 3. Get a token the way the project docs describe, for example a test user on the dev identity provider. Through a BFF, send its cookie and its CSRF header.

   ```bash
   curl -sS -D "$EVIDENCE/<name>.headers" -o "$EVIDENCE/<name>.json" \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -X POST "$API/api/v1/<entities>" -d @request.json
   ```

   Record the status, the headers (`Location`, `X-Pagination`), and the body. For gRPC, use `grpcurl` with the proto. For MCP, call the tool through an MCP client.

6. Prove the failure paths too. Send a request that breaks a domain rule. Confirm a 422 problem details body with the camelCase field name in `errors`. Confirm 404 for a missing ID, and 409 for a duplicate unique value.

7. Read side effects back. Read the changed entity with a GET. Find the request trace and confirm the spans, the SQL, and any domain event handler work.

   ```bash
   dotnet aspire otel traces <api-resource> --apphost <AppHost> --format Json > "$EVIDENCE/traces.json"
   dotnet aspire otel logs <api-resource> --severity Error --apphost <AppHost>
   dotnet aspire logs <api-resource> -n 200 --apphost <AppHost>
   ```

   The Aspire MCP tools give the same data: `list_resources`, `list_traces`, `list_structured_logs`, `list_console_logs`.

8. After a code change, rebuild the resource. Restart the stack after a change to the app host.

   ```bash
   dotnet aspire resource <api-resource> rebuild --apphost <AppHost>
   ```

9. Stop the stack that this run started. Keep the evidence.

   ```bash
   dotnet aspire stop --apphost <AppHost>
   ```

Put evidence in a gitignored folder, for example `artifacts/verify/<run>/`. Name it `$EVIDENCE` in the commands above.

## Proof bar

- Call the real entrypoint with real auth. Do not call a handler from a test, add a test-only endpoint, or turn auth off.
- Confirm the success status and the body against the contract, not only "200".
- Prove each failure path that the change touches, with its status and its problem details shape.
- Read each side effect back through the API or the trace: the saved row, the queued event, the outgoing call.
- Confirm that the running process has the current code. Rebuild after each change.

## Verdicts

- **VERIFIED:** The stack ran the current code. Each call that the request names returned the expected status and body. Each side effect read back as expected. The evidence files hold the calls and the responses.
- **NOT VERIFIED:** The stack ran the current code, and a call returned the wrong status, body, or side effect. Or the bug still shows. Quote the request and the response.
- **INCONCLUSIVE:** The proof did not reach the surface, or the result is ambiguous. Examples: the stack did not start for an unrelated reason, or auth could not get a token. A missing container image or a run of only tests is also inconclusive. Inconclusive is not a pass. Name what blocked the proof.
