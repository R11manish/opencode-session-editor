package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

type Session struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Directory string `json:"directory"`
	Updated   int64  `json:"updated"`
}

type Message struct {
	ID        string          `json:"id"`
	SessionID string          `json:"sessionId"`
	Role      string          `json:"role"`
	Time      int64           `json:"time"`
	Data      json.RawMessage `json:"data"`
	Parts     []Part          `json:"parts"`
}

type Part struct {
	ID        string          `json:"id"`
	MessageID string          `json:"messageId"`
	SessionID string          `json:"sessionId"`
	Role      string          `json:"role"`
	Time      int64           `json:"time"`
	Data      json.RawMessage `json:"data"`
}

type Document struct {
	Session  Session   `json:"session"`
	Messages []Message `json:"messages"`
}

func Clone(d Document) Document {
	out := d
	out.Messages = make([]Message, len(d.Messages))
	for i, message := range d.Messages {
		out.Messages[i] = message
		out.Messages[i].Data = append(json.RawMessage(nil), message.Data...)
		out.Messages[i].Parts = make([]Part, len(message.Parts))
		for j, part := range message.Parts {
			out.Messages[i].Parts[j] = part
			out.Messages[i].Parts[j].Data = append(json.RawMessage(nil), part.Data...)
		}
	}
	return out
}

func Type(part Part) string {
	var value struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(part.Data, &value)
	return value.Type
}

func NewID(prefix string) string {
	return fmt.Sprintf("%s_%x_%x", prefix, time.Now().UnixNano(), idSequence.Add(1))
}

func Validate(document Document) error {
	if strings.TrimSpace(document.Session.ID) == "" {
		return errors.New("session ID cannot be empty")
	}
	if strings.TrimSpace(document.Session.Title) == "" {
		return errors.New("session title cannot be empty")
	}
	messages := make(map[string]bool, len(document.Messages))
	parts := make(map[string]bool)
	for _, message := range document.Messages {
		if message.ID == "" || message.SessionID != document.Session.ID || messages[message.ID] {
			return errors.New("missing or duplicate message ID")
		}
		if !json.Valid(message.Data) {
			return fmt.Errorf("message %s has invalid JSON", message.ID)
		}
		messages[message.ID] = true
		for _, part := range message.Parts {
			if part.ID == "" || part.MessageID != message.ID || part.SessionID != document.Session.ID || parts[part.ID] {
				return errors.New("missing or duplicate part ID")
			}
			if !json.Valid(part.Data) || Type(part) == "" {
				return fmt.Errorf("part %s needs valid JSON with a type", part.ID)
			}
			parts[part.ID] = true
		}
	}
	return nil
}

func MessageValue(message Message) (role string, created int64) {
	var value struct {
		Role string `json:"role"`
		Time struct {
			Created int64 `json:"created"`
		} `json:"time"`
	}
	_ = json.Unmarshal(message.Data, &value)
	return value.Role, value.Time.Created
}

func PartValue(part Part) string {
	var value struct {
		Text  string `json:"text"`
		Tool  string `json:"tool"`
		State struct {
			Status string `json:"status"`
			Title  string `json:"title"`
			Output string `json:"output"`
		} `json:"state"`
	}
	if json.Unmarshal(part.Data, &value) != nil {
		return Type(part)
	}
	for _, candidate := range []string{value.Text, value.Tool, value.State.Title, value.State.Status, value.State.Output} {
		if strings.TrimSpace(candidate) != "" {
			return truncate(candidate, 240)
		}
	}
	return Type(part)
}

func truncate(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > limit {
		return value[:limit] + "..."
	}
	return value
}

var idSequence atomic.Uint64
