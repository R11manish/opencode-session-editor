import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { post, request } from "./api.js";
import Inspector from "./Inspector.jsx";
import Timeline from "./Timeline.jsx";
import { timelineRows } from "./timeline-data.js";
import useLiveSession from "./useLiveSession.js";

const SessionList = memo(function SessionList({
  sessions,
  sessionId,
  busy,
  onLoad,
}) {
  return (
    <nav className="session-list" aria-label="Session list" tabIndex={0}>
      {sessions.map((item) => (
        <button
          className={`session ${item.id === sessionId ? "active" : ""}`}
          key={item.id}
          disabled={busy}
          aria-current={item.id === sessionId ? "true" : undefined}
          onClick={() => onLoad(item.id)}
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
  );
});

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState(null);
  const dirty = useRef(false);
  const [listRefresh, setListRefresh] = useState(0);
  const live = useLiveSession(sessionId, busy);
  const sessionDocument = live.document;
  const rows = useMemo(
    () => (sessionDocument ? timelineRows(sessionDocument) : []),
    [sessionDocument],
  );
  const records = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  );
  const selectedRow = records.get(selected);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        if (!globalThis.document.hidden) {
          const body = await request(
            `/api/sessions?q=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            setSessions((current) =>
              current.length === body.sessions?.length &&
              current.every((item, index) => {
                const other = body.sessions[index];
                return (
                  item.id === other.id &&
                  item.title === other.title &&
                  item.directory === other.directory &&
                  item.updated === other.updated
                );
              })
                ? current
                : body.sessions || [],
            );
        }
      } catch (cause) {
        if (cause.name !== "AbortError") setError(cause.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
      }
    }
    timer = setTimeout(poll, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, listRefresh]);

  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") setDrawer(null);
    };
    const leaving = (event) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("keydown", close);
    window.addEventListener("beforeunload", leaving);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("beforeunload", leaving);
    };
  }, []);

  const loadSession = useCallback(
    (id) => {
      if (saving.current) return;
      if (id === sessionId) {
        setDrawer(null);
        return;
      }
      if (
        dirty.current &&
        !window.confirm("Discard unsaved edits and open this session?")
      )
        return;
      dirty.current = false;
      setSelected(null);
      setSessionId(id);
      setDrawer(null);
      setStatus("");
      setError("");
    },
    [sessionId],
  );

  const change = useCallback(
    async (operation, payload) => {
      if (saving.current || !sessionId) return;
      saving.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await post("/api/change", {
          sessionId,
          operation,
          ...payload,
        });
        setStatus("Saved to OpenCode");
        setListRefresh((value) => value + 1);
        return result;
      } catch (cause) {
        setError(cause.message);
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [sessionId],
  );

  const add = useCallback(
    async (kind) => {
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
        await change(`${kind}.add`, {
          messageId: selectedRow?.messageId,
          data: JSON.parse(text),
        });
      } catch (cause) {
        setError(`Invalid JSON: ${cause.message}`);
      }
    },
    [change, selectedRow?.messageId],
  );

  const remove = useCallback(async () => {
    if (
      !selectedRow ||
      !window.confirm(`Delete this ${selectedRow.kind} from OpenCode?`)
    )
      return;
    const result = await change(`${selectedRow.kind}.delete`, {
      [selectedRow.kind === "message" ? "messageId" : "partId"]:
        selectedRow.record.id,
      before: selectedRow.data,
    });
    if (result) {
      dirty.current = false;
      setSelected(null);
    }
  }, [change, selectedRow]);

  const select = useCallback(
    (key) => {
      if (saving.current) return;
      if (
        selected !== key &&
        dirty.current &&
        !window.confirm("Discard unsaved edits and select another record?")
      )
        return;
      if (selected !== key) dirty.current = false;
      setSelected(key);
      setDrawer("inspector");
    },
    [selected],
  );
  const onDirty = useCallback((value) => {
    dirty.current = value;
  }, []);
  const closeInspector = useCallback(() => setDrawer(null), []);

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
          <p>Direct editing · live updates</p>
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
        <SessionList
          sessions={sessions}
          sessionId={sessionId}
          busy={busy}
          onLoad={loadSession}
        />
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
          <span
            className={`mode ${live.error ? "source" : ""}`}
            title={
              live.syncedAt
                ? `Content loaded ${new Date(live.syncedAt).toLocaleTimeString()}; checking for updates automatically`
                : "Waiting for session"
            }
          >
            {live.error ? "RECONNECTING" : "LIVE"}
          </span>
          <div className="toolbar-actions">
            <button
              className="button"
              disabled={!sessionId || busy}
              onClick={live.sync}
            >
              Sync now
            </button>
            <button
              className="button"
              aria-controls="inspector"
              disabled={!sessionDocument}
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
              rows={rows}
              messageCount={sessionDocument.messages.length}
              selected={selected}
              onSelect={select}
            />
          ) : (
            <div className="empty">
              {live.loading
                ? "Loading session…"
                : "Select a session to inspect messages, thinking traces and tool calls."}
            </div>
          )}
        </div>
        <div
          className={`status ${error || live.error ? "error" : ""}`}
          role={error || live.error ? "alert" : "status"}
        >
          {error || live.error || (busy ? "Saving…" : status)}
        </div>
      </main>
      <Inspector
        key={`${sessionId}:${selected}`}
        sessionTitle={sessionDocument?.session.title}
        selectedRow={selectedRow}
        busy={busy}
        onChange={change}
        onDirty={onDirty}
        onAdd={add}
        onDelete={remove}
        open={drawer === "inspector"}
        onClose={closeInspector}
      />
    </div>
  );
}
