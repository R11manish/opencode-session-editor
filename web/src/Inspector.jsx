import { useEffect, useState } from "react";
import { pretty } from "./timeline-data.js";

export default function Inspector({
  document,
  selectedRow,
  editing,
  busy,
  onChange,
  onClose,
  open,
  onAdd,
  onDelete,
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(document?.session.title || "");
  }, [document?.session.title]);
  useEffect(() => {
    setText(selectedRow ? pretty(selectedRow.record) : "");
    setError("");
  }, [selectedRow]);

  function save() {
    try {
      const data = JSON.parse(text);
      if (!selectedRow) return;
      onChange(`${selectedRow.kind}.update`, {
        [selectedRow.kind === "message" ? "messageId" : "partId"]:
          selectedRow.record.id,
        data,
      });
      setError("");
    } catch (cause) {
      setError(`Invalid JSON: ${cause.message}`);
    }
  }

  return (
    <aside
      id="inspector"
      className={`inspector ${open ? "open" : ""}`}
      aria-label="Inspector"
    >
      <div className="inspector-head">
        <div className="panel-heading">
          <h3>
            {selectedRow
              ? selectedRow.kind === "part"
                ? "Part"
                : "Message"
              : "Inspector"}
          </h3>
          <button
            className="button inspector-close"
            onClick={onClose}
            aria-label="Close inspector"
          >
            Close
          </button>
        </div>
        <p>{selectedRow?.record.id || "Select a message or part."}</p>
      </div>
      <div className="inspector-body">
        <label htmlFor="session-title">Session title</label>
        <input
          id="session-title"
          className="input"
          disabled={!editing || busy}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="actions">
          <button
            className="button"
            disabled={!editing || busy}
            onClick={() => onChange("session.rename", { title })}
          >
            Rename
          </button>
          <button
            className="button"
            disabled={!editing || busy}
            onClick={() => onAdd("message")}
          >
            Add message
          </button>
          <button
            className="button"
            disabled={!editing || busy || !selectedRow}
            onClick={() => onAdd("part")}
          >
            Add part
          </button>
        </div>
        <label htmlFor="record-json">Raw JSON</label>
        <textarea
          id="record-json"
          className="editor"
          spellCheck={false}
          readOnly={!editing || busy}
          disabled={!selectedRow}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="hint">
          {selectedRow?.type === "reasoning"
            ? "Reasoning may contain provider signatures or encrypted metadata. Editing visible text does not re-sign or decrypt it."
            : "Changes are staged until Apply. Editing a recorded command never executes it."}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="footer">
        <button
          className="button primary"
          disabled={!selectedRow || !editing || busy}
          onClick={save}
        >
          Save selected
        </button>
        <button
          className="button danger"
          disabled={!selectedRow || !editing || busy}
          onClick={onDelete}
        >
          Delete selected
        </button>
      </div>
    </aside>
  );
}
