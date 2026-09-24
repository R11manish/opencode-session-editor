import { useEffect, useState } from "react";
import { pretty } from "./timeline-data.js";

function Field({ label, value, onChange, disabled, multiline = false }) {
  const props = {
    value: value ?? "",
    disabled,
    onChange: (event) => onChange(event.target.value),
    className: multiline ? "field-textarea" : "input",
  };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea {...props} rows={5} /> : <input {...props} />}
    </label>
  );
}

function formFor(row) {
  if (!row) return {};
  const value = row.data || {};
  if (row.kind === "message")
    return {
      role: value.role || "",
      agent: value.agent || "",
      modelID: value.modelID || value.model?.modelID || "",
      providerID: value.providerID || value.model?.providerID || "",
    };
  return {
    type: value.type || "",
    text: value.text || "",
    tool: value.tool || "",
    callID: value.callID || "",
    command: value.state?.input?.command || "",
    input: value.state?.input ? JSON.stringify(value.state.input, null, 2) : "",
    output: value.state?.output || "",
    error: value.state?.error || "",
    status: value.state?.status || "",
    title: value.state?.title || "",
    hash: value.hash || "",
    files: Array.isArray(value.files) ? value.files.join("\n") : "",
    metadata: value.metadata ? JSON.stringify(value.metadata, null, 2) : "",
  };
}

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
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  useEffect(
    () => setTitle(document?.session.title || ""),
    [document?.session.title],
  );
  useEffect(() => {
    setText(selectedRow ? pretty(selectedRow.record) : "");
    setForm(formFor(selectedRow));
    setError("");
  }, [selectedRow]);
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  function structuredData() {
    const original = selectedRow.data || {};
    const next = { ...original, type: form.type || original.type };
    if (selectedRow.kind === "message")
      return {
        ...next,
        role: form.role,
        agent: form.agent,
        modelID: form.modelID,
        providerID: form.providerID,
      };
    if (["text", "reasoning"].includes(next.type)) next.text = form.text;
    if (next.type === "tool") {
      next.tool = form.tool;
      next.callID = form.callID;
      next.state = {
        ...(original.state || {}),
        status: form.status || original.state?.status,
        title: form.title,
      };
      try {
        next.state.input = form.input ? JSON.parse(form.input) : {};
      } catch {
        throw new Error("Input JSON must be valid JSON");
      }
      if (form.command) next.state.input.command = form.command;
      if (form.output !== undefined) next.state.output = form.output;
      if (form.error !== undefined) next.state.error = form.error;
    }
    if (next.type === "patch") {
      next.hash = form.hash;
      next.files = form.files.split("\n").filter(Boolean);
    }
    if (form.metadata) {
      try {
        next.metadata = JSON.parse(form.metadata);
      } catch {
        throw new Error("Metadata must be valid JSON");
      }
    }
    return next;
  }
  function save() {
    try {
      if (!selectedRow) return;
      const data = structuredData();
      onChange(`${selectedRow.kind}.update`, {
        [selectedRow.kind === "message" ? "messageId" : "partId"]:
          selectedRow.record.id,
        data,
      });
      setText(JSON.stringify(data, null, 2));
      setError("");
    } catch (cause) {
      setError(cause.message);
    }
  }
  const disabled = !editing || busy;
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
        <Field
          label="Session title"
          value={title}
          onChange={setTitle}
          disabled={disabled}
        />
        <div className="actions">
          <button
            className="button"
            disabled={disabled}
            onClick={() => onChange("session.rename", { title })}
          >
            Rename
          </button>
          <button
            className="button"
            disabled={disabled}
            onClick={() => onAdd("message")}
          >
            Add message
          </button>
          <button
            className="button"
            disabled={disabled || !selectedRow}
            onClick={() => onAdd("part")}
          >
            Add part
          </button>
        </div>
        {selectedRow?.kind === "message" ? (
          <>
            <Field
              label="Role"
              value={form.role}
              onChange={(value) => update("role", value)}
              disabled={disabled}
            />
            <Field
              label="Agent"
              value={form.agent}
              onChange={(value) => update("agent", value)}
              disabled={disabled}
            />
            <Field
              label="Provider ID"
              value={form.providerID}
              onChange={(value) => update("providerID", value)}
              disabled={disabled}
            />
            <Field
              label="Model ID"
              value={form.modelID}
              onChange={(value) => update("modelID", value)}
              disabled={disabled}
            />
          </>
        ) : null}
        {selectedRow?.kind === "part" && selectedRow.type === "text" ? (
          <Field
            label="Text"
            value={form.text}
            onChange={(value) => update("text", value)}
            disabled={disabled}
            multiline
          />
        ) : null}
        {selectedRow?.kind === "part" && selectedRow.type === "reasoning" ? (
          <Field
            label="Thinking trace"
            value={form.text}
            onChange={(value) => update("text", value)}
            disabled={disabled}
            multiline
          />
        ) : null}
        {selectedRow?.kind === "part" && selectedRow.type === "tool" ? (
          <>
            <Field
              label="Tool"
              value={form.tool}
              onChange={(value) => update("tool", value)}
              disabled={disabled}
            />
            <Field
              label="Call ID"
              value={form.callID}
              onChange={(value) => update("callID", value)}
              disabled={disabled}
            />
            <Field
              label="Command"
              value={form.command}
              onChange={(value) => update("command", value)}
              disabled={disabled}
              multiline
            />
            <Field
              label="Input JSON"
              value={form.input}
              onChange={(value) => update("input", value)}
              disabled={disabled}
              multiline
            />
            <Field
              label="Output"
              value={form.output}
              onChange={(value) => update("output", value)}
              disabled={disabled}
              multiline
            />
            <Field
              label="Error"
              value={form.error}
              onChange={(value) => update("error", value)}
              disabled={disabled}
              multiline
            />
            <Field
              label="Status"
              value={form.status}
              onChange={(value) => update("status", value)}
              disabled={disabled}
            />
          </>
        ) : null}
        {selectedRow?.kind === "part" && selectedRow.type === "patch" ? (
          <>
            <Field
              label="Patch hash"
              value={form.hash}
              onChange={(value) => update("hash", value)}
              disabled={disabled}
            />
            <Field
              label="Files"
              value={form.files}
              onChange={(value) => update("files", value)}
              disabled={disabled}
              multiline
            />
          </>
        ) : null}
        <details className="raw-editor">
          <summary>Advanced raw JSON</summary>
          <textarea
            id="record-json"
            className="editor"
            spellCheck={false}
            readOnly={disabled}
            disabled={!selectedRow}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </details>
        <div className="hint">
          {selectedRow?.type === "reasoning"
            ? "Reasoning may contain provider signatures or encrypted metadata."
            : "Changes are staged until Apply. Recorded commands are never executed by the editor."}
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
          disabled={!selectedRow || disabled}
          onClick={save}
        >
          Save selected
        </button>
        <button
          className="button danger"
          disabled={!selectedRow || disabled}
          onClick={onDelete}
        >
          Delete selected
        </button>
      </div>
    </aside>
  );
}
