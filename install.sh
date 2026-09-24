#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${INSTALL_DIR:-${HOME}/.local/bin}"
WEB_DIR="${BIN_DIR}/web"

cd "$ROOT"

command -v go >/dev/null || { echo "go is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

mkdir -p "$BIN_DIR"

npm --prefix "$ROOT/web" ci
npm --prefix "$ROOT/web" run build
gofmt -w main.go internal/domain/*.go internal/httpapi/*.go internal/provider/opencode/*.go internal/workspace/*.go
go test ./...
go vet ./...
go build -o "$BIN_DIR/opencode-session-editor" .

rm -rf "$WEB_DIR"
mkdir -p "$WEB_DIR"
cp -R "$ROOT/web/dist" "$WEB_DIR/"
chmod 755 "$BIN_DIR/opencode-session-editor"

echo "Installed opencode-session-editor to $BIN_DIR"
echo "Run: opencode-session-editor"
