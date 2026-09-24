import assert from "node:assert/strict";
import test from "node:test";
import { findMatches, rowPreview, timelineRows } from "./timeline-data.js";

function session(data) {
  return {
    messages: [
      {
        id: "msg_1",
        data: { role: "assistant" },
        parts: [{ id: "prt_1", data }],
      },
    ],
  };
}

test("repeated searches reuse serialized data and receive new streamed payloads", async () => {
  let serializations = 0;
  const data = {
    type: "tool",
    toJSON() {
      serializations++;
      return {
        type: "tool",
        tool: "bash",
        state: { input: { command: "printf Needle" }, output: "complete" },
      };
    },
  };
  const rows = timelineRows(session(data));
  const { signal } = new AbortController();
  assert.deepEqual(await findMatches(rows, "needle", signal), [1]);
  assert.deepEqual(await findMatches(rows, "complete", signal), [1]);
  assert.match(rowPreview(rows[1], "needle"), /printf Needle/);
  assert.equal(serializations, 1);
  const streamed = timelineRows(
    session({ type: "text", text: "Streamed response" }),
  );
  assert.deepEqual(await findMatches(streamed, "needle", signal), []);
  assert.deepEqual(await findMatches(streamed, "streamed", signal), [1]);
});

test("search sees full text beyond clipped preview and yields for cancellation", async () => {
  const fullText = "prefix ".repeat(1000) + "MATCH AT END";
  const rows = timelineRows(session({ type: "text", text: fullText }));
  const controller = new AbortController();
  assert.ok(rowPreview(rows[1]).length < 500);
  assert.deepEqual(
    await findMatches(rows, "match at end", controller.signal),
    [1],
  );
  assert.match(rowPreview(rows[1], "match at end"), /MATCH AT END/);
  assert.equal(rows[1].data.text, fullText);
  const manyRows = Array.from({ length: 3000 }, (_, index) => ({
    ...rows[1],
    record: { id: `prt_${index}` },
  }));
  const pending = findMatches(manyRows, "match", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
