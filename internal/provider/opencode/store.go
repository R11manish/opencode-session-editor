package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"opencode-session-editor/internal/domain"
)

var ErrConflict = errors.New("source session changed since editing began; reload before applying")

type Store struct {
	db   *sql.DB
	path string
}

func Open(path string) (*Store, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", "file:"+abs+"?_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, path: abs}, nil
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Path() string { return s.path }

func (s *Store) List(ctx context.Context, query string) ([]domain.Session, error) {
	like := "%" + query + "%"
	rows, err := s.db.QueryContext(ctx, `SELECT id,title,directory,time_updated FROM session WHERE title LIKE ? OR directory LIKE ? OR id LIKE ? ORDER BY time_updated DESC LIMIT 200`, like, like, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Session{}
	for rows.Next() {
		var session domain.Session
		if err := rows.Scan(&session.ID, &session.Title, &session.Directory, &session.Updated); err != nil {
			return nil, err
		}
		result = append(result, session)
	}
	return result, rows.Err()
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func read(ctx context.Context, q queryer, id string) (domain.Document, error) {
	document := domain.Document{Messages: []domain.Message{}}
	if err := q.QueryRowContext(ctx, `SELECT id,title,directory,time_updated FROM session WHERE id=?`, id).Scan(&document.Session.ID, &document.Session.Title, &document.Session.Directory, &document.Session.Updated); err != nil {
		return document, err
	}
	rows, err := q.QueryContext(ctx, `SELECT id,session_id,data FROM message WHERE session_id=? ORDER BY time_created,id`, id)
	if err != nil {
		return document, err
	}
	defer rows.Close()
	messages := []domain.Message{}
	for rows.Next() {
		var message domain.Message
		var raw string
		if err := rows.Scan(&message.ID, &message.SessionID, &raw); err != nil {
			return document, err
		}
		message.Data = json.RawMessage(raw)
		message.Role, message.Time = domain.MessageValue(message)
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return document, err
	}
	if err := rows.Close(); err != nil {
		return document, err
	}
	for i := range messages {
		messages[i].Parts, err = readParts(ctx, q, messages[i].ID, id)
		if err != nil {
			return document, err
		}
	}
	document.Messages = messages
	return document, nil
}

func readParts(ctx context.Context, q queryer, messageID, sessionID string) ([]domain.Part, error) {
	rows, err := q.QueryContext(ctx, `SELECT id,message_id,session_id,time_created,data FROM part WHERE message_id=? AND session_id=? ORDER BY rowid,id`, messageID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	parts := []domain.Part{}
	for rows.Next() {
		var part domain.Part
		var raw string
		if err := rows.Scan(&part.ID, &part.MessageID, &part.SessionID, &part.Time, &raw); err != nil {
			return nil, err
		}
		part.Data = json.RawMessage(raw)
		parts = append(parts, part)
	}
	return parts, rows.Err()
}

func (s *Store) Read(ctx context.Context, id string) (domain.Document, error) {
	return read(ctx, s.db, id)
}

func (s *Store) Apply(ctx context.Context, base, next domain.Document) error {
	if base.Session.ID != next.Session.ID {
		return errors.New("session ID cannot be changed")
	}
	if err := domain.Validate(next); err != nil {
		return err
	}
	current, err := s.Read(ctx, base.Session.ID)
	if err != nil {
		return err
	}
	if !sameSource(current, base) {
		return ErrConflict
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current, err = read(ctx, tx, base.Session.ID)
	if err != nil {
		return err
	}
	if !sameSource(current, base) {
		return ErrConflict
	}
	if err := applySession(ctx, tx, base, next); err != nil {
		return err
	}
	if err := applyMessages(ctx, tx, base, next); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func applySession(ctx context.Context, tx *sql.Tx, base, next domain.Document) error {
	if next.Session.Title == base.Session.Title {
		return nil
	}
	_, err := tx.ExecContext(ctx, `UPDATE session SET title=?,time_updated=? WHERE id=?`, next.Session.Title, time.Now().UnixMilli(), base.Session.ID)
	return err
}

func applyMessages(ctx context.Context, tx *sql.Tx, base, next domain.Document) error {
	baseMessages := map[string]domain.Message{}
	for _, message := range base.Messages {
		baseMessages[message.ID] = message
	}
	for _, message := range next.Messages {
		old, exists := baseMessages[message.ID]
		if !exists {
			if err := insertMessage(ctx, tx, message); err != nil {
				return err
			}
			continue
		}
		if message.SessionID != old.SessionID {
			return fmt.Errorf("message session cannot change: %s", message.ID)
		}
		if string(message.Data) != string(old.Data) {
			if _, err := tx.ExecContext(ctx, `UPDATE message SET data=?,time_updated=? WHERE id=? AND session_id=?`, string(message.Data), time.Now().UnixMilli(), message.ID, base.Session.ID); err != nil {
				return err
			}
		}
		if err := applyParts(ctx, tx, old, message, base.Session.ID); err != nil {
			return err
		}
		delete(baseMessages, message.ID)
	}
	for _, message := range baseMessages {
		if _, err := tx.ExecContext(ctx, `DELETE FROM part WHERE message_id=? AND session_id=?`, message.ID, base.Session.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM message WHERE id=? AND session_id=?`, message.ID, base.Session.ID); err != nil {
			return err
		}
	}
	return nil
}

func insertMessage(ctx context.Context, tx *sql.Tx, message domain.Message) error {
	if message.ID == "" {
		return errors.New("new message requires an ID")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO message(id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?)`, message.ID, message.SessionID, message.Time, time.Now().UnixMilli(), string(message.Data)); err != nil {
		return err
	}
	for _, part := range message.Parts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO part(id,message_id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?,?)`, part.ID, message.ID, message.SessionID, part.Time, time.Now().UnixMilli(), string(part.Data)); err != nil {
			return err
		}
	}
	return nil
}

func applyParts(ctx context.Context, tx *sql.Tx, base, next domain.Message, sessionID string) error {
	baseParts := map[string]domain.Part{}
	for _, part := range base.Parts {
		baseParts[part.ID] = part
	}
	for _, part := range next.Parts {
		old, exists := baseParts[part.ID]
		if !exists {
			if part.MessageID != next.ID || part.SessionID != sessionID {
				return fmt.Errorf("new part relationship is invalid: %s", part.ID)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO part(id,message_id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?,?)`, part.ID, next.ID, sessionID, part.Time, time.Now().UnixMilli(), string(part.Data)); err != nil {
				return err
			}
			continue
		}
		if part.MessageID != old.MessageID || part.SessionID != old.SessionID || part.Time != old.Time || domain.Type(part) != domain.Type(old) {
			return fmt.Errorf("part identity cannot change: %s", part.ID)
		}
		if string(part.Data) != string(old.Data) {
			if _, err := tx.ExecContext(ctx, `UPDATE part SET data=?,time_updated=? WHERE id=? AND message_id=? AND session_id=?`, string(part.Data), time.Now().UnixMilli(), part.ID, next.ID, sessionID); err != nil {
				return err
			}
		}
		delete(baseParts, part.ID)
	}
	for id := range baseParts {
		if _, err := tx.ExecContext(ctx, `DELETE FROM part WHERE id=? AND message_id=? AND session_id=?`, id, next.ID, sessionID); err != nil {
			return err
		}
	}
	return nil
}

func sameSource(a, b domain.Document) bool {
	if a.Session.ID != b.Session.ID || a.Session.Title != b.Session.Title || a.Session.Updated != b.Session.Updated || len(a.Messages) != len(b.Messages) {
		return false
	}
	for i := range a.Messages {
		x, y := a.Messages[i], b.Messages[i]
		if x.ID != y.ID || x.SessionID != y.SessionID || x.Role != y.Role || x.Time != y.Time || string(x.Data) != string(y.Data) || len(x.Parts) != len(y.Parts) {
			return false
		}
		for j := range x.Parts {
			p, q := x.Parts[j], y.Parts[j]
			if p.ID != q.ID || p.MessageID != q.MessageID || p.SessionID != q.SessionID || p.Time != q.Time || strings.TrimSpace(string(p.Data)) != strings.TrimSpace(string(q.Data)) {
				return false
			}
		}
	}
	return true
}
