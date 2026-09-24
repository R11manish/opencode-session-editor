package main

import (
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"opencode-session-editor/internal/httpapi"
	"opencode-session-editor/internal/provider/opencode"
	"opencode-session-editor/internal/workspace"
)

func main() {
	data := os.Getenv("XDG_DATA_HOME")
	if data == "" {
		data = filepath.Join(os.Getenv("HOME"), ".local", "share")
	}
	path := flag.String("db", filepath.Join(data, "opencode", "opencode.db"), "OpenCode database path")
	addr := flag.String("addr", "127.0.0.1:8787", "local listen address")
	flag.Parse()
	host, _, err := net.SplitHostPort(*addr)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		log.Fatal("--addr must use a loopback host and port")
	}
	store, err := opencode.Open(*path)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	page, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "web", "index.html"))
	if err != nil {
		page, err = os.ReadFile(filepath.Join("web", "index.html"))
	}
	if err != nil {
		log.Fatal(err)
	}
	api := httpapi.New(store, workspace.New(), page)
	log.Printf("Session Editor at http://%s (database: %s)", *addr, *path)
	log.Fatal(http.ListenAndServe(*addr, api))
}
