import { memo, useEffect, useMemo, useRef, useState } from "react";

function Field({ label, value, onChange, disabled, multiline = false }) {
  const props = {
    id: `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    value: value ?? "",
    disabled,
    onChange: (event) => onChange(event.target.value),
    className: multiline ? "field-textarea" : "input",
    spellCheck: false,
  };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea {...props} rows={10} /> : <input {...props} />}
    </label>
  );
}

function replacePath(data, path, value) {
  const next = structuredClone(data);
  let target = next;
  for (const key of path.slice(0, -1)) {
    target[key] ??= {};
    target = target[key];
  }
  target[path.at(-1)] = value;
  return next;
}

const Inspector = memo(function Inspector({
  sessionTitle,
  selectedRow,
  busy,
  onChange,
  onClose,
  open,
  onAdd,
  onDelete,
  onDirty,
}) {
  const incoming = useMemo(
    () => JSON.stringify(selectedRow?.data ?? null),
    [selectedRow?.data],
  );
  const incomingTitle = sessionTitle || "";
  const [base, setBase] = useState(incoming);
  const [draft, setDraft] = useState(incoming);
  const [titleBase, setTitleBase] = useState(incomingTitle);
  const [title, setTitle] = useState(incomingTitle);
  const [rawMode, setRawMode] = useState(false);
  const [error, setError] = useState("");
  const recordDirty = draft !== base;
  const titleDirty = title !== titleBase;
  const dirty = useRef(false);
  dirty.current = recordDirty;

  useEffect(() => {
    if (!dirty.current) {
      setBase(incoming);
      setDraft(incoming);
    }
  }, [incoming]);
  useEffect(() => {
    if (!titleDirty) {
      setTitleBase(incomingTitle);
      setTitle(incomingTitle);
    }
  }, [incomingTitle, titleDirty]);
  useEffect(() => {
    onDirty(recordDirty || titleDirty);
  }, [recordDirty, titleDirty, onDirty]);

  const data = useMemo(() => {
    try {
      return JSON.parse(draft);
    } catch {
      return null;
    }
  }, [draft]);
  const disabled = busy || !selectedRow;

  function update(path, value) {
    setDraft(JSON.stringify(replacePath(data, path, value)));
    setError("");
  }

  const field = (label, path, multiline = false) => {
    const value = path.reduce((item, key) => item?.[key], data);
    return (
      <Field
        key={label}
        label={label}
        value={value}
        multiline={multiline}
        disabled={disabled}
        onChange={(next) => update(path, next)}
      />
    );
  };

  async function save() {
    if (!selectedRow) return;
    try {
      const next = JSON.parse(draft);
      if (!next || typeof next !== "object" || Array.isArray(next))
        throw new Error("Record must be a JSON object");
      const result = await onChange(`${selectedRow.kind}.update`, {
        [selectedRow.kind === "message" ? "messageId" : "partId"]:
          selectedRow.record.id,
        data: next,
        before: JSON.parse(base),
      });
      if (result) {
        setBase(draft);
        setError("");
      }
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function rename() {
    const result = await onChange("session.rename", {
      title,
      before: titleBase,
    });
    if (result) setTitleBase(title);
  }

  const changedElsewhere = recordDirty && incoming !== base;
  const hasFields =
    selectedRow?.kind === "message" ||
    ["text", "reasoning", "tool", "patch", "file"].includes(data?.type);

  return (
    <aside
      id="inspector"
      className={`inspector ${open ? "open" : ""}`}
      aria-label="Inspector"
    >
      <div className="inspector-head">
        <div className="panel-heading">
          <h3>
            {selectedRow?.kind === "part"
              ? "Part"
              : selectedRow
                ? "Message"
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
          disabled={busy || sessionTitle === undefined}
        />
        <div className="actions">
          <button
            className="button"
            disabled={busy || sessionTitle === undefined || !titleDirty}
            onClick={rename}
          >
            Rename
          </button>
          <button
            className="button"
            disabled={busy || sessionTitle === undefined}
            onClick={() => onAdd("message")}
          >
            Add message
          </button>
          <button
            className="button"
            disabled={disabled}
            onClick={() => onAdd("part")}
          >
            Add part
          </button>
        </div>
        {selectedRow ? (
          <>
            <div className="actions">
              <button
                className="button"
                aria-pressed={!rawMode}
                onClick={() => {
                  try {
                    JSON.parse(draft);
                    setRawMode(false);
                    setError("");
                  } catch {
                    setError("Fix invalid JSON before switching to fields.");
                  }
                }}
              >
                Fields
              </button>
              <button
                className="button"
                aria-pressed={rawMode}
                onClick={() => {
                  setRawMode(true);
                  try {
                    setDraft(JSON.stringify(JSON.parse(draft), null, 2));
                  } catch {}
                }}
              >
                Advanced JSON
              </button>
            </div>
            {changedElsewhere ? (
              <p className="hint error" role="alert">
                OpenCode changed this record. Your draft is preserved; reload
                the record before saving.
              </p>
            ) : null}
            {rawMode || !hasFields ? (
              <Field
                label="Raw JSON"
                value={draft}
                onChange={setDraft}
                disabled={disabled}
                multiline
              />
            ) : (
              <>
                {selectedRow.kind === "message" ? (
                  <>
                    <p className="hint">
                      {data?.role} message metadata. Select a text part to edit
                      the message content.
                    </p>
                    {field("Agent", ["agent"])}
                    {field(
                      "Provider ID",
                      data?.role === "user"
                        ? ["model", "providerID"]
                        : ["providerID"],
                    )}
                    {field(
                      "Model ID",
                      data?.role === "user"
                        ? ["model", "modelID"]
                        : ["modelID"],
                    )}
                  </>
                ) : null}
                {["text", "reasoning"].includes(data?.type)
                  ? field(
                      data.type === "text" ? "Text" : "Thinking trace",
                      ["text"],
                      true,
                    )
                  : null}
                {data?.type === "tool" ? (
                  <>
                    {field("Tool", ["tool"])}
                    {field("Call ID", ["callID"])}
                    {typeof data.state?.input?.command === "string"
                      ? field("Command", ["state", "input", "command"], true)
                      : null}
                    {typeof data.state?.output === "string"
                      ? field("Output", ["state", "output"], true)
                      : null}
                    {typeof data.state?.error === "string"
                      ? field("Error", ["state", "error"], true)
                      : null}
                    {field("Tool title", ["state", "title"])}
                    <p className="hint">
                      Status: {data.state?.status}. Other input fields and
                      status are editable in Advanced JSON.
                    </p>
                  </>
                ) : null}
                {data?.type === "patch" ? (
                  <>
                    {field("Patch hash", ["hash"])}
                    <Field
                      label="Files (one per line)"
                      value={data.files?.join("\n") || ""}
                      disabled={disabled}
                      multiline
                      onChange={(value) =>
                        update(["files"], value.split("\n").filter(Boolean))
                      }
                    />
                  </>
                ) : null}
                {data?.type === "file" ? (
                  <>
                    {field("Filename", ["filename"])}
                    {field("MIME type", ["mime"])}
                    {field("URL", ["url"], true)}
                  </>
                ) : null}
              </>
            )}
            <div className="hint">
              {selectedRow.type === "reasoning"
                ? "Provider signatures/encrypted metadata are preserved. Changing text does not re-sign reasoning."
                : "Save writes this record directly to OpenCode. Recorded commands are never executed."}
            </div>
            {recordDirty ? (
              <button
                className="button"
                onClick={() => {
                  setBase(incoming);
                  setDraft(incoming);
                  setError("");
                }}
              >
                Discard draft / reload record
              </button>
            ) : null}
          </>
        ) : (
          <p className="hint">
            Select a record in the timeline to edit it directly.
          </p>
        )}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="footer">
        <button
          className="button primary"
          disabled={disabled || !recordDirty}
          onClick={save}
        >
          Save selected
        </button>
        <button
          className="button danger"
          disabled={disabled || recordDirty}
          onClick={onDelete}
        >
          Delete selected
        </button>
      </div>
    </aside>
  );
});

export default Inspector;
