export function payload(record) {
  if (typeof record.data !== "string") return record.data ?? {};
  try {
    return JSON.parse(record.data);
  } catch {
    return { text: record.data };
  }
}

export function pretty(record) {
  return JSON.stringify(payload(record), null, 2);
}

export function timelineRows(document) {
  const rows = [];
  for (const message of document.messages ?? []) {
    const data = payload(message);
    const role = data.role || message.role || "message";
    rows.push({
      key: `message:${message.id}`,
      kind: "message",
      record: message,
      messageId: message.id,
      role,
      type: "message",
      data,
    });
    for (const part of message.parts ?? []) {
      const partData = payload(part);
      rows.push({
        key: `part:${part.id}`,
        kind: "part",
        record: part,
        messageId: message.id,
        role,
        type: partData.type || "unknown",
        data: partData,
      });
    }
  }
  return rows;
}

const searchableData = new WeakMap();

function searchData(data) {
  if (!data || typeof data !== "object") {
    const json = JSON.stringify(data) ?? "";
    return { json, lower: json.toLowerCase() };
  }
  let entry = searchableData.get(data);
  if (!entry) {
    const json = JSON.stringify(data);
    entry = { json, lower: json.toLowerCase() };
    searchableData.set(data, entry);
  }
  return entry;
}

export function rowPreview(row, query = "") {
  if (query) {
    const { json: full, lower } = searchData(row.data);
    const index = lower.indexOf(query.toLowerCase());
    if (index >= 0) {
      const start = Math.max(0, index - 70);
      return `${start ? "…" : ""}${full.slice(start, start + 480)}${full.length > start + 480 ? "…" : ""}`;
    }
  }
  if (row.kind === "message") {
    return [
      row.data.agent,
      row.data.modelID || row.data.model?.modelID,
      row.record.id,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const value = row.data;
  const candidates = [
    value.text,
    value.state?.input?.command,
    value.state?.title,
    value.state?.output,
    value.state?.error,
    value.filename,
    value.tool,
    row.type,
  ];
  const text =
    candidates.find((item) => typeof item === "string" && item) || row.type;
  return text.length > 480 ? `${text.slice(0, 480)}…` : text;
}

export async function findMatches(rows, query, signal) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const matches = [];
  for (let index = 0; index < rows.length; index++) {
    if (signal.aborted)
      throw new DOMException("Search cancelled", "AbortError");
    const row = rows[index];
    if (
      `${row.role} ${row.record.id}`.toLowerCase().includes(term) ||
      searchData(row.data).lower.includes(term)
    ) {
      matches.push(index);
    }
    if (index % 100 === 99)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return matches;
}
