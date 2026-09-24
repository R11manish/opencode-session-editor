package workspace

import (
	"encoding/json"
	"errors"
	"sync"

	"opencode-session-editor/internal/domain"
)

type Entry struct {
	Base, Current domain.Document
	Undo, Redo    []domain.Document
}
type Store struct {
	mu      sync.Mutex
	entries map[string]*Entry
}

func New() *Store { return &Store{entries: make(map[string]*Entry)} }

func (s *Store) Start(d domain.Document) domain.Document {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.entries[d.Session.ID]; e != nil {
		return domain.Clone(e.Current)
	}
	s.entries[d.Session.ID] = &Entry{Base: domain.Clone(d), Current: domain.Clone(d)}
	return domain.Clone(d)
}

func (s *Store) Read(id string) (domain.Document, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil {
		return domain.Document{}, false
	}
	return domain.Clone(e.Current), true
}

func (s *Store) Snapshot(id string) (domain.Document, domain.Document, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil {
		return domain.Document{}, domain.Document{}, false
	}
	return domain.Clone(e.Base), domain.Clone(e.Current), true
}

func (s *Store) Change(id string, fn func(*domain.Document) error) (domain.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil {
		return domain.Document{}, errors.New("start editing this session first")
	}
	next := domain.Clone(e.Current)
	if err := fn(&next); err != nil {
		return domain.Document{}, err
	}
	if err := domain.Validate(next); err != nil {
		return domain.Document{}, err
	}
	e.Undo = append(e.Undo, e.Current)
	e.Redo = nil
	e.Current = next
	return domain.Clone(next), nil
}

func (s *Store) Undo(id string) (domain.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil || len(e.Undo) == 0 {
		return domain.Document{}, errors.New("nothing to undo")
	}
	e.Redo = append(e.Redo, e.Current)
	e.Current = e.Undo[len(e.Undo)-1]
	e.Undo = e.Undo[:len(e.Undo)-1]
	return domain.Clone(e.Current), nil
}

func (s *Store) Redo(id string) (domain.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil || len(e.Redo) == 0 {
		return domain.Document{}, errors.New("nothing to redo")
	}
	e.Undo = append(e.Undo, e.Current)
	e.Current = e.Redo[len(e.Redo)-1]
	e.Redo = e.Redo[:len(e.Redo)-1]
	return domain.Clone(e.Current), nil
}

func (s *Store) Finish(id string, applied domain.Document) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[id] = &Entry{Base: domain.Clone(applied), Current: domain.Clone(applied)}
}

func (s *Store) Discard(id string) { s.mu.Lock(); defer s.mu.Unlock(); delete(s.entries, id) }
func Changed(base, current domain.Document) bool {
	a, _ := json.Marshal(base)
	b, _ := json.Marshal(current)
	return string(a) != string(b)
}
