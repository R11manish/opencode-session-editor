package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"opencode-session-editor/internal/provider/opencode"
	"opencode-session-editor/internal/workspace"
)

func TestDirectSaveAndLiveRevision(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.db")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
CREATE TABLE session (id TEXT PRIMARY KEY,title TEXT,directory TEXT,time_updated INTEGER);
CREATE TABLE message (id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);
CREATE TABLE part (id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);
INSERT INTO session VALUES ('ses_test','Live test','/tmp',1);
INSERT INTO message VALUES ('msg_test','ses_test',1,1,'{"role":"assistant","time":{"created":1}}');
INSERT INTO part VALUES ('prt_test','msg_test','ses_test',1,1,'{"type":"text","text":"Before","metadata":{"keep":true}}');
`)
	if err != nil {
		t.Fatal(err)
	}
	store, err := opencode.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	api := New(store, workspace.New(), nil, "")
	get := func(etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/session?id=ses_test", nil)
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w
	}
	first := get("")
	if first.Code != http.StatusOK || first.Header().Get("ETag") == "" {
		t.Fatal(first.Code, first.Body.String())
	}
	if get(first.Header().Get("ETag")).Code != http.StatusNotModified {
		t.Fatal("unchanged session was retransmitted")
	}
	_, err = db.Exec(`UPDATE part SET data='{"type":"text","text":"Streamed","metadata":{"keep":true}}' WHERE id='prt_test'`)
	if err != nil {
		t.Fatal(err)
	}
	streamed := get(first.Header().Get("ETag"))
	if streamed.Code != http.StatusOK || streamed.Header().Get("ETag") == first.Header().Get("ETag") {
		t.Fatal("same-count streaming update was missed")
	}
	save := func(before string) *httptest.ResponseRecorder {
		payload, _ := json.Marshal(opencode.Change{SessionID: "ses_test", Operation: "part.update", PartID: "prt_test", Before: json.RawMessage(before), Data: json.RawMessage(`{"type":"text","text":"Line 1\n\n5. Unicode ✓","metadata":{"keep":true}}`)})
		w := httptest.NewRecorder()
		api.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/change", bytes.NewReader(payload)))
		return w
	}
	if save(`{"type":"text","text":"Before","metadata":{"keep":true}}`).Code != http.StatusConflict {
		t.Fatal("stale edit overwrote streamed content")
	}
	_, err = db.Exec(`INSERT INTO part VALUES ('prt_other','msg_test','ses_test',2,2,'{"type":"reasoning","text":"Unrelated new part"}')`)
	if err != nil {
		t.Fatal(err)
	}
	result := save(`{"metadata":{"keep":true},"text":"Streamed","type":"text"}`)
	if result.Code != http.StatusOK {
		t.Fatal(result.Code, result.Body.String())
	}
	document, err := store.Read(context.Background(), "ses_test")
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Messages[0].Parts) != 2 {
		t.Fatal("save removed concurrent part")
	}
	var text struct{ Text string }
	if err = json.Unmarshal(document.Messages[0].Parts[0].Data, &text); err != nil {
		t.Fatal(err)
	}
	if text.Text != "Line 1\n\n5. Unicode ✓" {
		t.Fatalf("text changed: %q", text.Text)
	}
	files, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if filepath.Ext(file.Name()) == ".bak" {
			t.Fatal("backup created")
		}
	}
}
