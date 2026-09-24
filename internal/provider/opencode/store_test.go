package opencode

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"opencode-session-editor/internal/domain"
)

func TestApplyDocument(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "opencode.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, err = store.db.Exec(`
CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL, time_updated INTEGER NOT NULL);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`INSERT INTO session VALUES ('ses_1','Before','/tmp/project',1)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`INSERT INTO message VALUES ('msg_1','ses_1',1,1,'{"role":"user","time":{"created":1},"text":"before"}')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`INSERT INTO part VALUES ('prt_1','msg_1','ses_1',1,1,'{"type":"text","text":"before"}')`)
	if err != nil {
		t.Fatal(err)
	}
	base, err := store.Read(context.Background(), "ses_1")
	if err != nil {
		t.Fatal(err)
	}
	next := domain.Clone(base)
	next.Session.Title = "After"
	next.Messages[0].Data = json.RawMessage(`{"role":"user","time":{"created":1},"text":"edited"}`)
	next.Messages[0].Parts[0].Data = json.RawMessage(`{"type":"text","text":"edited"}`)
	next.Messages[0].Parts = append(next.Messages[0].Parts, domain.Part{ID: "prt_2", MessageID: "msg_1", SessionID: "ses_1", Time: 2, Data: json.RawMessage(`{"type":"tool","tool":"bash","state":{"status":"completed"}}`)})
	next.Messages = append(next.Messages, domain.Message{ID: "msg_2", SessionID: "ses_1", Time: 3, Data: json.RawMessage(`{"role":"assistant","time":{"created":3}}`), Parts: []domain.Part{{ID: "prt_3", MessageID: "msg_2", SessionID: "ses_1", Time: 3, Data: json.RawMessage(`{"type":"text","text":"new"}`)}}})
	err = store.Apply(context.Background(), base, next)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".bak") {
			t.Fatalf("unexpected backup: %s", entry.Name())
		}
	}
	got, err := store.Read(context.Background(), "ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Session.Title != "After" || len(got.Messages) != 2 || len(got.Messages[0].Parts) != 2 {
		t.Fatalf("unexpected document: %+v", got)
	}
}

func TestApplyConflict(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "opencode.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, err = store.db.Exec(`
CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL, time_updated INTEGER NOT NULL);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
INSERT INTO session VALUES ('ses_1','Before','/tmp/project',1);
INSERT INTO message VALUES ('msg_1','ses_1',1,1,'{"role":"user","time":{"created":1}}');
INSERT INTO part VALUES ('prt_1','msg_1','ses_1',1,1,'{"type":"text","text":"before"}');
`)
	if err != nil {
		t.Fatal(err)
	}
	base, err := store.Read(context.Background(), "ses_1")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`UPDATE session SET title='Changed elsewhere' WHERE id='ses_1'`)
	if err != nil {
		t.Fatal(err)
	}
	err = store.Apply(context.Background(), base, base)
	if err == nil || !strings.Contains(err.Error(), "reload") {
		t.Fatalf("expected conflict, got %v", err)
	}
}
