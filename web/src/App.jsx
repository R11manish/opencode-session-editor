import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { post, request } from "./api.js";
import Inspector from "./Inspector.jsx";
import Timeline from "./Timeline.jsx";
import { timelineRows } from "./timeline-data.js";

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [sessionDocument, setSessionDocument] = useState(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingId, setLoadingId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState(null);
  const loadController = useRef(null);
  const sessionId = sessionDocument?.session.id;
  const records = useMemo(
    () =>
      new Map(
        sessionDocument
          ? timelineRows(sessionDocument).map((row) => [row.key, row])
          : [],
      ),
    [sessionDocument],
  );
  const selectedRow = records.get(selected);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      request(`/api/sessions?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((body) => {
          if (!controller.signal.aborted) setSessions(body.sessions || []);
        })
        .catch((cause) => {
          if (cause.name !== "AbortError") setError(cause.message);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, refresh]);

  useEffect(() => () => loadController.current?.abort(), []);
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  async function loadSession(id) {
    if (busy) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoadingId(id);
    setError("");
    setDrawer(null);
    try {
      const body = await request(`/api/session?id=${encodeURIComponent(id)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSessionDocument(body);
      setEditing(false);
      setSelected(null);
      setStatus("");
    } catch (cause) {
      if (cause.name !== "AbortError") setError(cause.message);
    } finally {
      if (!controller.signal.aborted) setLoadingId("");
    }
  }

  async function perform(action, success) {
    if (busy || loadingId) return;
    setBusy(true);
    setError("");
    try {
      const body = await action();
      if (body.document) setSessionDocument(body.document);
      setStatus(typeof success === "function" ? success(body) : success);
      return body;
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function startEditing() {
    const body = await perform(
      () => post("/api/workspace", { sessionId }),
      "Workspace started",
    );
    if (body) setEditing(true);
  }

  const change = (operation, payload) =>
    perform(
      () => post("/api/workspace/change", { sessionId, operation, ...payload }),
      "Workspace updated",
    );
  const history = (direction) =>
    perform(
      () =>
        post(
          `/api/workspace/${direction}?sessionId=${encodeURIComponent(sessionId)}`,
        ),
      direction === "undo" ? "Undid last change" : "Redid last change",
    );

  async function apply() {
    if (!window.confirm("Apply staged changes to the OpenCode database?"))
      return;
    const body = await perform(
      () => post(`/api/apply?sessionId=${encodeURIComponent(sessionId)}`),
      "Applied.",
    );
    if (body) {
      setEditing(false);
      setRefresh((value) => value + 1);
    }
  }

  function add(kind) {
    const example =
      kind === "part"
        ? { type: "text", text: "" }
        : {
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "", modelID: "" },
          };
    const text = window.prompt(
      `New ${kind} JSON`,
      JSON.stringify(example, null, 2),
    );
    if (text === null) return;
    try {
      change(`${kind}.add`, {
        messageId: selectedRow?.messageId,
        data: JSON.parse(text),
      });
    } catch (cause) {
      setError(`Invalid JSON: ${cause.message}`);
    }
  }

  async function remove() {
    if (
      !selectedRow ||
      !window.confirm(
        `Delete this ${selectedRow.kind}? You can undo before applying.`,
      )
    )
      return;
    const body = await change(`${selectedRow.kind}.delete`, {
      [selectedRow.kind === "message" ? "messageId" : "partId"]:
        selectedRow.record.id,
    });
    if (body) setSelected(null);
  }

  const select = useCallback((key) => {
    setSelected(key);
    setDrawer("inspector");
  }, []);
  const blocked = busy || Boolean(loadingId);

  return (
    <div className="app">
      {drawer ? (
        <button
          className={`drawer-backdrop ${drawer}`}
          aria-label="Close panel"
          onClick={() => setDrawer(null)}
        />
      ) : null}
      <aside
        id="sessions-panel"
        className={`sidebar ${drawer === "sessions" ? "open" : ""}`}
        aria-label="Sessions"
      >
        <div className="brand">
          <h1>OpenCode Session Editor</h1>
          <p>Local OpenCode database</p>
          <button
            className="button sidebar-close"
            onClick={() => setDrawer(null)}
          >
            Close sessions
          </button>
        </div>
        <input
          className="search"
          type="search"
          aria-label="Search sessions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions"
        />
        <nav className="session-list" aria-label="Session list" tabIndex={0}>
          {sessions.map((item) => (
            <button
              className={`session ${item.id === sessionId ? "active" : ""}`}
              key={item.id}
              disabled={busy}
              aria-current={item.id === sessionId ? "true" : undefined}
              onClick={() => loadSession(item.id)}
            >
              <span className="session-title">{item.title || item.id}</span>
              <span className="session-meta">
                {item.directory} · {new Date(item.updated).toLocaleString()}
              </span>
            </button>
          ))}
          {!sessions.length ? (
            <div className="empty">No matching sessions.</div>
          ) : null}
        </nav>
      </aside>
      <main className="main">
        <div className="toolbar">
          <button
            className="button mobile-only"
            aria-controls="sessions-panel"
            aria-expanded={drawer === "sessions"}
            onClick={() => setDrawer(drawer === "sessions" ? null : "sessions")}
          >
            Sessions
          </button>
          <h2>{sessionDocument?.session.title || "Select a session"}</h2>
          <span className={`mode ${editing ? "" : "source"}`}>
            {editing ? "EDITING" : "BROWSE"}
          </span>
          <div className="toolbar-actions">
            <button
              className="button"
              disabled={!sessionDocument || editing || blocked}
              onClick={startEditing}
            >
              Start editing
            </button>
            <button
              className="button primary"
              disabled={!editing || blocked}
              onClick={apply}
            >
              Apply
            </button>
            <button
              className="button"
              disabled={!editing || blocked}
              onClick={() => history("undo")}
            >
              Undo
            </button>
            <button
              className="button"
              disabled={!editing || blocked}
              onClick={() => history("redo")}
            >
              Redo
            </button>
            <button
              className="button"
              aria-controls="inspector"
              aria-expanded={drawer === "inspector"}
              onClick={() =>
                setDrawer(drawer === "inspector" ? null : "inspector")
              }
            >
              Inspector
            </button>
          </div>
        </div>
        <div className="content">
          {sessionDocument ? (
            <Timeline
              key={sessionId}
              document={sessionDocument}
              selected={selected}
              onSelect={select}
            />
          ) : (
            <div className="empty">
              Select a session to inspect messages, thinking traces and tool
              calls.
            </div>
          )}
          {loadingId ? (
            <div className="loading" role="status">
              Loading session…
            </div>
          ) : null}
        </div>
        <div
          className={`status ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || (busy ? "Working…" : status)}
        </div>
      </main>
      <Inspector
        document={sessionDocument}
        selectedRow={selectedRow}
        editing={editing}
        busy={blocked}
        onChange={change}
        onAdd={add}
        onDelete={remove}
        open={drawer === "inspector"}
        onClose={() => setDrawer(null)}
      />
    </div>
  );
}
