package workspace

import (
	"encoding/json"
	"testing"

	"opencode-session-editor/internal/domain"
)

func testDocument() domain.Document {
	return domain.Document{
		Session: domain.Session{ID: "ses_test", Title: "Test"},
		Messages: []domain.Message{{
			ID: "msg_test", SessionID: "ses_test", Data: json.RawMessage(`{"role":"user"}`),
			Parts: []domain.Part{{ID: "prt_test", MessageID: "msg_test", SessionID: "ses_test", Data: json.RawMessage(`{"type":"text","text":"before"}`)}},
		}},
	}
}

func TestChangeUndoRedo(t *testing.T) {
	store := New()
	document := store.Start(testDocument())
	changed, err := store.Change(document.Session.ID, func(value *domain.Document) error {
		value.Messages[0].Parts[0].Data = json.RawMessage(`{"type":"text","text":"after"}`)
		return nil
	})
	if err != nil || string(changed.Messages[0].Parts[0].Data) != `{"type":"text","text":"after"}` {
		t.Fatalf("change failed: %v", err)
	}
	undone, err := store.Undo(document.Session.ID)
	if err != nil || string(undone.Messages[0].Parts[0].Data) != `{"type":"text","text":"before"}` {
		t.Fatalf("undo failed: %v", err)
	}
	redone, err := store.Redo(document.Session.ID)
	if err != nil || string(redone.Messages[0].Parts[0].Data) != `{"type":"text","text":"after"}` {
		t.Fatalf("redo failed: %v", err)
	}
}
