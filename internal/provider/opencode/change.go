package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"opencode-session-editor/internal/domain"
)

var ErrInvalidChange = errors.New("invalid change")

type Change struct {
	SessionID string          `json:"sessionId"`
	Operation string          `json:"operation"`
	MessageID string          `json:"messageId"`
	PartID    string          `json:"partId"`
	Data      json.RawMessage `json:"data"`
	Before    json.RawMessage `json:"before"`
	Title     *string         `json:"title"`
}

func EqualJSON(a, b []byte) bool {
	var left, right any
	if json.Unmarshal(a, &left) != nil || json.Unmarshal(b, &right) != nil {
		return false
	}
	return reflect.DeepEqual(left, right)
}

func (s *Store) Change(ctx context.Context, change Change) error {
	if change.SessionID == "" {
		return fmt.Errorf("%w: sessionId is required", ErrInvalidChange)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var title string
	if err := tx.QueryRowContext(ctx, "SELECT title FROM session WHERE id=?", change.SessionID).Scan(&title); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	switch change.Operation {
	case "part.add", "message.add":
		var data map[string]json.RawMessage
		if json.Unmarshal(change.Data, &data) != nil || data == nil {
			return fmt.Errorf("%w: data must be a JSON object", ErrInvalidChange)
		}
		if change.Operation == "part.add" {
			var messageID string
			if err := tx.QueryRowContext(ctx, "SELECT id FROM message WHERE id=? AND session_id=?", change.MessageID, change.SessionID).Scan(&messageID); err != nil {
				return err
			}
			var partType string
			if json.Unmarshal(data["type"], &partType) != nil || partType == "" {
				return fmt.Errorf("%w: part type is required", ErrInvalidChange)
			}
			_, err = tx.ExecContext(ctx, "INSERT INTO part(id,message_id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?,?)", domain.NewID("prt"), messageID, change.SessionID, now, now, string(change.Data))
		} else {
			var role string
			if json.Unmarshal(data["role"], &role) != nil || (role != "user" && role != "assistant") {
				return fmt.Errorf("%w: role must be user or assistant", ErrInvalidChange)
			}
			_, err = tx.ExecContext(ctx, "INSERT INTO message(id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?)", domain.NewID("msg"), change.SessionID, now, now, string(change.Data))
		}
	case "session.rename":
		var before string
		if json.Unmarshal(change.Before, &before) != nil || change.Title == nil || strings.TrimSpace(*change.Title) == "" {
			return fmt.Errorf("%w: title and original title are required", ErrInvalidChange)
		}
		if title != before {
			return ErrConflict
		}
		_, err = tx.ExecContext(ctx, "UPDATE session SET title=? WHERE id=?", *change.Title, change.SessionID)
	case "part.update", "part.delete", "message.update", "message.delete":
		var original string
		if strings.HasPrefix(change.Operation, "part.") {
			err = tx.QueryRowContext(ctx, "SELECT data FROM part WHERE id=? AND session_id=?", change.PartID, change.SessionID).Scan(&original)
		} else {
			err = tx.QueryRowContext(ctx, "SELECT data FROM message WHERE id=? AND session_id=?", change.MessageID, change.SessionID).Scan(&original)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return ErrConflict
		}
		if err != nil {
			return err
		}
		if len(change.Before) == 0 {
			return fmt.Errorf("%w: original record is required", ErrInvalidChange)
		}
		if !EqualJSON([]byte(original), change.Before) {
			return ErrConflict
		}
		if strings.HasSuffix(change.Operation, ".update") {
			var data, old map[string]json.RawMessage
			if json.Unmarshal(change.Data, &data) != nil || data == nil {
				return fmt.Errorf("%w: data must be a JSON object", ErrInvalidChange)
			}
			_ = json.Unmarshal([]byte(original), &old)
			if change.Operation == "part.update" && !EqualJSON(old["type"], data["type"]) {
				return fmt.Errorf("%w: part type cannot change", ErrInvalidChange)
			}
			if change.Operation == "message.update" && !EqualJSON(old["role"], data["role"]) {
				return fmt.Errorf("%w: message role cannot change", ErrInvalidChange)
			}
			if change.Operation == "part.update" {
				_, err = tx.ExecContext(ctx, "UPDATE part SET data=?,time_updated=? WHERE id=? AND session_id=?", string(change.Data), now, change.PartID, change.SessionID)
			} else {
				_, err = tx.ExecContext(ctx, "UPDATE message SET data=?,time_updated=? WHERE id=? AND session_id=?", string(change.Data), now, change.MessageID, change.SessionID)
			}
		} else if change.Operation == "part.delete" {
			_, err = tx.ExecContext(ctx, "DELETE FROM part WHERE id=? AND session_id=?", change.PartID, change.SessionID)
		} else {
			_, err = tx.ExecContext(ctx, "DELETE FROM part WHERE message_id=? AND session_id=?", change.MessageID, change.SessionID)
			if err == nil {
				_, err = tx.ExecContext(ctx, "DELETE FROM message WHERE id=? AND session_id=?", change.MessageID, change.SessionID)
			}
		}
	default:
		return fmt.Errorf("%w: unsupported direct operation", ErrInvalidChange)
	}
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE session SET time_updated=? WHERE id=?", now, change.SessionID); err != nil {
		return err
	}
	return tx.Commit()
}
