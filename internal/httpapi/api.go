package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"opencode-session-editor/internal/domain"
	"opencode-session-editor/internal/provider/opencode"
	"opencode-session-editor/internal/workspace"
)

type API struct {
	store  *opencode.Store
	work   *workspace.Store
	page   []byte
	assets string
}

func New(store *opencode.Store, work *workspace.Store, page []byte, assets string) *API {
	return &API{store: store, work: work, page: page, assets: assets}
}
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/favicon.ico" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Path == "/" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(a.page)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		name := filepath.Base(r.URL.Path)
		data, err := os.ReadFile(filepath.Join(a.assets, name))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		contentType := "application/octet-stream"
		if strings.HasSuffix(name, ".js") {
			contentType = "application/javascript; charset=utf-8"
		} else if strings.HasSuffix(name, ".css") {
			contentType = "text/css; charset=utf-8"
		}
		w.Header().Set("Content-Type", contentType)
		w.Write(data)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		a.api(w, r)
		return
	}
	http.NotFound(w, r)
}
func (a *API) api(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	switch r.URL.Path {
	case "/api/status":
		write(w, http.StatusOK, map[string]any{"db": a.store.Path(), "live": true, "product": "OpenCode Session Editor"})
	case "/api/sessions":
		if r.Method != "GET" {
			method(w)
			return
		}
		v, err := a.store.List(ctx, r.URL.Query().Get("q"))
		if err != nil {
			fail(w, err)
			return
		}
		write(w, 200, map[string]any{"sessions": v})
	case "/api/session":
		a.session(w, r)
	case "/api/workspace":
		a.workspace(w, r)
	case "/api/workspace/change":
		a.change(w, r)
	case "/api/workspace/undo":
		a.history(w, r, false)
	case "/api/workspace/redo":
		a.history(w, r, true)
	case "/api/apply":
		a.apply(w, r)
	default:
		http.NotFound(w, r)
	}
}
func (a *API) session(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		method(w)
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		failStatus(w, 400, errors.New("missing session id"))
		return
	}
	d, err := a.store.Read(r.Context(), id)
	if err != nil {
		failStatus(w, 404, err)
		return
	}
	write(w, 200, d)
}
func (a *API) workspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		method(w)
		return
	}
	var req struct {
		SessionID string `json:"sessionId"`
	}
	if decode(r, &req) != nil || req.SessionID == "" {
		failStatus(w, 400, errors.New("sessionId is required"))
		return
	}
	d, err := a.store.Read(r.Context(), req.SessionID)
	if err != nil {
		failStatus(w, 404, err)
		return
	}
	write(w, 200, map[string]any{"document": a.work.Start(d), "changed": false})
}
func (a *API) change(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		method(w)
		return
	}
	var req struct {
		SessionID string          `json:"sessionId"`
		Operation string          `json:"operation"`
		MessageID string          `json:"messageId"`
		PartID    string          `json:"partId"`
		Data      json.RawMessage `json:"data"`
		Title     *string         `json:"title"`
	}
	if decode(r, &req) != nil || req.SessionID == "" {
		failStatus(w, 400, errors.New("invalid change"))
		return
	}
	d, err := a.work.Change(req.SessionID, func(d *domain.Document) error {
		switch req.Operation {
		case "message.update":
			if req.MessageID == "" || !json.Valid(req.Data) {
				return errors.New("valid messageId and JSON data required")
			}
			for i := range d.Messages {
				if d.Messages[i].ID == req.MessageID {
					d.Messages[i].Data = append(json.RawMessage(nil), req.Data...)
					return nil
				}
			}
			return errors.New("message not found")
		case "part.update":
			if req.PartID == "" || !json.Valid(req.Data) {
				return errors.New("valid partId and JSON data required")
			}
			for i := range d.Messages {
				for j := range d.Messages[i].Parts {
					if d.Messages[i].Parts[j].ID == req.PartID {
						d.Messages[i].Parts[j].Data = append(json.RawMessage(nil), req.Data...)
						return nil
					}
				}
			}
			return errors.New("part not found")
		case "session.rename":
			if req.Title == nil || strings.TrimSpace(*req.Title) == "" {
				return errors.New("title is required")
			}
			d.Session.Title = *req.Title
			return nil
		case "part.delete":
			for i := range d.Messages {
				for j := range d.Messages[i].Parts {
					if d.Messages[i].Parts[j].ID == req.PartID {
						d.Messages[i].Parts = append(d.Messages[i].Parts[:j], d.Messages[i].Parts[j+1:]...)
						return nil
					}
				}
			}
			return errors.New("part not found")
		case "message.delete":
			for i := range d.Messages {
				if d.Messages[i].ID == req.MessageID {
					d.Messages = append(d.Messages[:i], d.Messages[i+1:]...)
					return nil
				}
			}
			return errors.New("message not found")
		case "part.add":
			if req.MessageID == "" || !json.Valid(req.Data) {
				return errors.New("valid messageId and JSON data required")
			}
			for i := range d.Messages {
				if d.Messages[i].ID == req.MessageID {
					d.Messages[i].Parts = append(d.Messages[i].Parts, domain.Part{ID: domain.NewID("prt"), MessageID: req.MessageID, SessionID: req.SessionID, Time: time.Now().UnixMilli(), Data: append(json.RawMessage(nil), req.Data...)})
					return nil
				}
			}
			return errors.New("message not found")
		case "message.add":
			if !json.Valid(req.Data) {
				return errors.New("valid message JSON required")
			}
			messageID := domain.NewID("msg")
			message := domain.Message{ID: messageID, SessionID: req.SessionID, Time: time.Now().UnixMilli(), Data: append(json.RawMessage(nil), req.Data...)}
			d.Messages = append(d.Messages, message)
			return nil
		default:
			return fmt.Errorf("unknown operation: %s", req.Operation)
		}
	})
	if err != nil {
		failStatus(w, 400, err)
		return
	}
	write(w, 200, map[string]any{"document": d, "changed": true})
}
func (a *API) history(w http.ResponseWriter, r *http.Request, redo bool) {
	if r.Method != "POST" {
		method(w)
		return
	}
	id := r.URL.Query().Get("sessionId")
	var d domain.Document
	var err error
	if redo {
		d, err = a.work.Redo(id)
	} else {
		d, err = a.work.Undo(id)
	}
	if err != nil {
		failStatus(w, 400, err)
		return
	}
	write(w, 200, map[string]any{"document": d})
}
func (a *API) apply(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		method(w)
		return
	}
	id := r.URL.Query().Get("sessionId")
	base, next, ok := a.work.Snapshot(id)
	if !ok {
		failStatus(w, 400, errors.New("workspace not found"))
		return
	}
	backup, err := a.store.Apply(r.Context(), base, next)
	if err != nil {
		if errors.Is(err, opencode.ErrConflict) {
			failStatus(w, 409, err)
		} else {
			failStatus(w, 500, err)
		}
		return
	}
	applied, err := a.store.Read(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	a.work.Finish(id, applied)
	write(w, 200, map[string]any{"ok": true, "backup": backup, "document": applied})
}
func decode(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 20<<20)).Decode(v)
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, err error) { failStatus(w, 500, err) }
func failStatus(w http.ResponseWriter, status int, err error) {
	write(w, status, map[string]string{"error": err.Error()})
}
func method(w http.ResponseWriter) { failStatus(w, 405, errors.New("method not allowed")) }
