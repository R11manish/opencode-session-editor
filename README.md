# OpenCode Session Editor

A local browser-based editor for OpenCode sessions.

Inspect and directly edit session titles, user/assistant text, thinking traces,
tool commands and results. Select a record, edit its fields, and click **Save
selected**. There is no separate edit mode or Apply step. No backups are created.

The selected session syncs every 1.5 seconds, including streamed changes inside
existing parts; the session list refreshes every 5 seconds. Unchanged sessions
return HTTP 304. Polls stop in hidden tabs and are cancelled on session changes.
Unsaved drafts are preserved while the timeline updates. Saves reject records
changed by OpenCode since the draft began, instead of overwriting newer content.

## Run

```sh
npm --prefix web ci
npm --prefix web run build
go run . --db ~/.local/share/opencode/opencode.db
```

Open `http://127.0.0.1:8787`.

The server binds to loopback by default. Saves and deletes use SQLite
transactions. The editor changes transcript records; editing a command does not
execute it. Deletions are immediate after confirmation.

## Test

```sh
npm --prefix web test
npm --prefix web run format:check
go test ./...
go vet ./...
```

The React timeline uses a virtualized list. Timeline and inspector share one
row index; unchanged poll responses preserve state identity, and repeated
searches reuse weakly held serialized payloads. Search scans yield between
batches and cancel when superseded. Source files stay formatted; Vite handles
production minification.

This project is independent and not affiliated with the OpenCode maintainers.
