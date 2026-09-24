package domain

import (
	"encoding/json"
	"testing"
)

func TestValidateDocument(t *testing.T) {
	document := Document{
		Session: Session{ID: "ses_test", Title: "Test"},
		Messages: []Message{{
			ID: "msg_test", SessionID: "ses_test", Data: json.RawMessage(`{"role":"user"}`),
			Parts: []Part{{ID: "prt_test", MessageID: "msg_test", SessionID: "ses_test", Data: json.RawMessage(`{"type":"text"}`)}},
		}},
	}
	if err := Validate(document); err != nil {
		t.Fatal(err)
	}
	document.Messages[0].Parts[0].MessageID = "msg_other"
	if err := Validate(document); err == nil {
		t.Fatal("expected invalid relationship")
	}
}
