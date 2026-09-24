# OpenCode Session Editor

A local browser-based editor for OpenCode sessions.

It can inspect and stage edits to session titles, user and assistant messages,
reasoning traces, tool calls, tool outputs, and other persisted parts. Changes
are applied explicitly to the OpenCode SQLite database after validation and an
automatic backup.

## Run

```sh
go run . --db ~/.local/share/opencode/opencode.db
```

Open `http://127.0.0.1:8787`.

The server binds to loopback by default. The browser editor stages workspace
changes, supports undo/redo, and applies them transactionally.

## Test

```sh
go test ./...
go vet ./...
```

This project is independent and not affiliated with the OpenCode maintainers.
