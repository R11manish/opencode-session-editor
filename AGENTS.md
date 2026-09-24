# OpenCode Session Editor

## Product mission

### Current interaction contract

The user has replaced staged editing with direct saving. Selecting a record
enables its fields immediately; Save selected writes that record transactionally.
Do not require Start editing, workspace creation, or Apply in the browser.
Do not create backups. Keep local unsaved drafts while the timeline live-syncs,
and reject a save if the record's source payload differs from the draft's base.
Older workspace architecture notes below describe legacy endpoints only.
Keep source formatted with Prettier/gofmt and do not add explanatory code comments.

Apply the relevant Vercel React performance rules: keep unchanged poll responses
referentially stable, derive shared timeline rows once, memoize measured expensive
boundaries with stable props, cancel obsolete requests/searches, and keep user
confirmations in event handlers rather than state updaters. Verify live draft
preservation along with idle resource usage; DOM node counts alone are not proof
of a responsive page. Use agent-browser CLI for browser checks and close test
sessions when finished.

This product is a browser-based editor for OpenCode sessions. Its core value is
that users can directly inspect and modify the persisted session, not merely
search or view it.

The editor must make it possible to change practically every editable part of
an OpenCode conversation, including:

- session titles and metadata
- human/user chat messages
- assistant responses
- assistant reasoning and thinking traces
- bash calls
- tool calls and tool inputs
- tool outputs and errors
- patches and file-operation records
- step markers and subtask records
- message and part ordering where the source format permits it
- insertion, duplication, deletion, truncation, and replacement of records

The product should feel like an editor for an event stream, not like a
read-only transcript viewer.

## Terminology

- **Session**: one OpenCode conversation identified by a `session.id`.
- **Message**: a user or assistant envelope stored in `message.data`.
- **Part**: an event inside a message stored in `part.data`.
- **Thinking trace**: a `part` with `type: "reasoning"`.
- **Tool event**: a `part` with `type: "tool"`, including its input, output,
  status, timing, and call ID.
- **Workspace**: an editable representation of a source session before changes
  are committed to the OpenCode database.
- **Apply**: the explicit operation that writes validated workspace changes to
  the OpenCode database.

## Product principles

### 1. Broad editing is the USP

Do not narrow the product into a viewer, exporter, search tool, or metadata
manager. Those are supporting features. The central workflow is:

1. Open an existing OpenCode session.
2. Select any session, message, or part.
3. Edit, add, duplicate, reorder, truncate, or delete it.
4. Review the diff and validation results.
5. Apply the changes or create a fork.
6. Continue using the resulting session in OpenCode.

### 2. Source changes are explicit, not accidental

The application is allowed to modify the real OpenCode database. It must not
silently do so while a user is browsing or typing. Use clear modes:

- **Browse**: inspect source data.
- **Edit**: stage changes in a workspace.
- **Apply**: write staged changes to the source database after confirmation.
- **Fork**: create a new session from an edited session while preserving the
  original.

The source database is not permanently read-only. Read-only behavior is a
default safety mode for browsing and staging, not a product limitation.

### 3. Every destructive operation is recoverable

Before applying any mutation:

- require explicit user-approved recovery strategy when needed
- record the operation in the application journal
- show the affected record count
- show a before/after diff when practical
- require confirmation for delete, truncate, overwrite, and apply operations

Support undo, redo, and revert at the workspace level. Do not create database
backups automatically during Apply.

### 4. Preserve the OpenCode data model

The application must understand the relationship:

```text
session
  └── message
        └── part
```

Do not flatten the session permanently into display-only chat bubbles. Keep raw
JSON and identifiers so tool calls, reasoning, patches, timing, provider
metadata, and message relationships can be edited without data loss.

### 5. Validate without blocking legitimate advanced editing

Validation should identify structural problems and provider-sensitive risks,
but the editor should not make arbitrary edits impossible. Show warnings and
explain consequences. Require an explicit override for unsafe apply operations
when necessary.

Examples of validation checks:

- valid JSON in every `data` column
- required `type` fields on parts
- valid message roles
- tool calls with recognizable tool names and call IDs
- tool result/status consistency
- timestamp ordering
- duplicate or missing IDs
- reasoning metadata and signatures
- OpenAI encrypted-reasoning metadata
- orphaned messages or parts
- session summary fields that no longer match the edited content

## OpenCode compatibility

OpenCode is open source. Use its source code as the compatibility reference,
especially:

```text
packages/opencode/src/session/session.ts
packages/opencode/src/session/message.ts
packages/opencode/src/session/message-v2.ts
packages/opencode/src/session/prompt.ts
packages/opencode/src/session/revert.ts
packages/opencode/src/session/compaction.ts
packages/opencode/src/session/processor.ts
packages/opencode/src/session/schema.ts
packages/opencode/src/storage/storage.ts
packages/opencode/src/storage/schema.ts
```

When OpenCode changes its schema or continuation behavior, update the provider
adapter and migrations rather than scattering compatibility logic through the
UI.

The editor must inspect how OpenCode handles:

- session creation and duplication
- message and part IDs
- ordering
- continuation and resume
- revert and truncation
- compaction
- token and cost accounting
- tool-call state transitions
- provider-specific reasoning metadata

## Architecture direction

Use Go for the backend and a browser frontend for the UI.

Preferred structure:

```text
cmd/session-forge/       # executable entry point
internal/app/             # application services and commands
internal/domain/          # session, message, part, operation models
internal/provider/        # OpenCode adapter; future providers
internal/workspace/       # staging, diff, undo/redo, snapshots
internal/repository/      # SQLite and journal persistence
internal/httpapi/         # HTTP handlers and API contracts
internal/validation/      # structural and provider-aware checks
web/                      # browser UI
docs/                     # product and compatibility documentation
migrations/               # application-owned database migrations
```

Keep provider-specific database details inside `internal/provider/opencode`.
The domain and workspace layers should operate on a normalized editable
document while retaining the original raw JSON for lossless writes.

## Editing capabilities

The API and UI should eventually support these operations:

### Session operations

- rename session
- edit session metadata
- archive/unarchive
- duplicate session
- fork session
- delete session with recovery
- export session
- apply a workspace to the original session

### Message operations

- edit message JSON
- edit user content
- edit assistant metadata
- add message
- duplicate message
- delete message
- move message
- truncate after message

### Part operations

- edit raw part JSON
- edit visible text
- edit reasoning text
- edit reasoning metadata
- edit tool name
- edit tool input
- edit tool output
- edit tool status and timing
- edit patch/file content
- add any supported part type
- duplicate part
- delete part
- move part within its message
- move part between messages when valid
- truncate after part

### History operations

- undo
- redo
- revert one operation
- restore deleted records
- inspect operation history
- compare workspace with source
- compare two workspace revisions

## Reasoning and thinking traces

Reasoning is an editable product feature. Do not hide it or treat it as an
implementation detail.

When reasoning has provider metadata such as an Anthropic signature or OpenAI
encrypted content, show a visible warning before apply. Offer explicit choices:

- edit visible reasoning text and preserve metadata
- edit text and remove incompatible provider metadata
- replace the complete reasoning payload
- delete the reasoning part
- cancel

The application must never silently claim that an edited signed or encrypted
reasoning payload remains provider-valid.

## Tool-call editing

Tool calls are first-class editable records. The UI should display them as
structured events with:

- tool name
- call ID
- input
- output
- status
- error state
- start/end timestamps
- related message and step

Users must be able to change both the command/input and the recorded output.
Changing a historical bash command does not execute it automatically. The
editor modifies the transcript; execution is a separate, explicit feature if
ever added.

## Apply protocol

Applying changes to OpenCode should be transactional:

1. Lock the editor operation.
2. Confirm the source database still matches the workspace base snapshot.
3. Do not create a database backup automatically.
4. Validate the complete edited session.
5. Start a database transaction.
6. Apply session, message, part, and related updates in dependency order.
7. Recalculate or invalidate affected summaries and counters.
8. Run SQLite integrity checks.
9. Commit only if every step succeeds.
10. Record the operation and resulting source revision.

If any step fails, roll back and leave the source database unchanged.

## Browser security

This is a local administration tool for sensitive transcripts.

- bind to `127.0.0.1` by default
- never expose the server publicly by default
- require an explicit flag for non-loopback binding
- validate all IDs server-side
- use parameterized SQL only
- do not construct SQL from user-provided table or column names
- cap request sizes
- avoid logging message contents, tool inputs, secrets, or reasoning
- use CSRF protection if the server can be exposed beyond localhost
- make live-write mode unmistakable in the UI

## Development workflow

Before implementing major features:

1. Inspect the current OpenCode schema and source behavior.
2. Add or update domain types and provider tests.
3. Implement workspace operations before source mutations.
4. Add validation and diff output.
5. Test against a copied database.
6. Test apply/rollback behavior with injected failures.
7. Verify the resulting session can be opened or continued by OpenCode.

Do not test destructive operations against the user's live database. Use a
database copy and an isolated temporary workspace first.

## Quality bar

The code should favor:

- small packages with clear ownership
- explicit interfaces at provider boundaries
- context-aware APIs
- typed API request/response models
- structured errors
- SQL transactions
- migrations with versioning
- deterministic tests
- race-safe server behavior
- no hidden global mutable state

Avoid:

- treating arbitrary JSON as validated OpenCode data
- direct SQL writes from HTTP handlers
- UI-only undo
- silently deleting related rows
- assuming timestamps alone define order
- retaining provider signatures after incompatible edits without warning
- adding providers before the OpenCode workflow is correct

## Current implementation status

The existing prototype under this directory is intentionally disposable. It is
only a proof of the browser interaction and should be refactored into the
architecture above before adding more mutation features. Do not expand the
prototype into a large monolithic handler.
