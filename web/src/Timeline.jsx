import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Virtuoso } from "react-virtuoso";
import { findMatches, rowPreview } from "./timeline-data.js";

const Scroller = forwardRef(function Scroller(props, ref) {
  return (
    <div
      {...props}
      ref={ref}
      className="timeline"
      tabIndex={0}
      aria-label="Conversation timeline"
      role="region"
    />
  );
});

const components = { Scroller };
const computeItemKey = (_, row) => row.key;
const followOutput = (atBottom) => (atBottom ? "auto" : false);
const overscan = { top: 400, bottom: 400 };
const listStyle = { height: "100%", minHeight: 0 };

const TimelineRow = memo(function TimelineRow({
  row,
  index,
  selected,
  match,
  query,
  onSelect,
}) {
  const text = rowPreview(row, match ? query : "");
  const matchIndex = query
    ? text.toLowerCase().indexOf(query.toLowerCase())
    : -1;
  return (
    <div
      className="timeline-row"
      data-index={index}
      data-record-id={row.record.id}
    >
      <button
        type="button"
        className={`record ${row.kind} ${selected ? "selected" : ""} ${match ? "search-match" : ""}`}
        aria-pressed={selected}
        aria-label={`${row.role} ${row.type} ${row.record.id}`}
        onClick={() => onSelect(row.key)}
      >
        <span className="record-label">
          <strong>
            {row.kind === "message"
              ? row.role
              : row.type === "tool"
                ? row.data.tool || "tool"
                : row.type}
          </strong>
          <small>
            {row.kind === "message" ? "message metadata" : row.role}
          </small>
        </span>
        <span className="record-preview">
          {matchIndex < 0 ? (
            text
          ) : (
            <>
              {text.slice(0, matchIndex)}
              <mark>{text.slice(matchIndex, matchIndex + query.length)}</mark>
              {text.slice(matchIndex + query.length)}
            </>
          )}
        </span>
      </button>
    </div>
  );
});

const Timeline = memo(function Timeline({
  rows,
  messageCount,
  selected,
  onSelect,
}) {
  const list = useRef(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ query: "", matches: [] });
  const [matchPosition, setMatchPosition] = useState(0);
  const [searching, setSearching] = useState(false);
  const searchAnchor = useRef({ term: "", key: null });

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (!term) {
      searchAnchor.current = { term: "", key: null };
      setResult({ query: "", matches: [] });
      setSearching(false);
      return () => controller.abort();
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const matches = await findMatches(rows, term, controller.signal);
        if (controller.signal.aborted) return;
        setResult({ query: term, matches });
        const sameTerm = searchAnchor.current.term === term;
        const kept = sameTerm
          ? matches.findIndex(
              (index) => rows[index].key === searchAnchor.current.key,
            )
          : -1;
        const position = Math.max(0, kept);
        setMatchPosition(position);
        searchAnchor.current = { term, key: rows[matches[position]]?.key };
        setSearching(false);
        if (matches.length && !sameTerm)
          list.current?.scrollToIndex({
            index: matches[0],
            align: "center",
            behavior: "auto",
          });
      } catch (error) {
        if (error.name !== "AbortError") setSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, rows]);

  const moveMatch = (direction) => {
    if (!result.matches.length || searching) return;
    const next =
      (matchPosition + direction + result.matches.length) %
      result.matches.length;
    setMatchPosition(next);
    searchAnchor.current.key = rows[result.matches[next]]?.key;
    list.current?.scrollToIndex({
      index: result.matches[next],
      align: "center",
      behavior: "auto",
    });
  };
  const activeMatch = result.matches[matchPosition];
  const initialPosition = useRef({
    index: Math.max(0, rows.length - 1),
    align: "end",
  });
  const renderRow = useCallback(
    (index, row) => (
      <TimelineRow
        row={row}
        index={index}
        selected={selected === row.key}
        match={index === activeMatch}
        query={result.query}
        onSelect={onSelect}
      />
    ),
    [selected, activeMatch, result.query, onSelect],
  );

  return (
    <section className="timeline-panel" aria-label="Session content">
      <div className="toolbar-search">
        <input
          type="search"
          aria-label="Search this session"
          placeholder="Search text, reasoning, commands, outputs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              moveMatch(event.shiftKey ? -1 : 1);
            }
            if (event.key === "Escape") setQuery("");
          }}
        />
        <button
          className="button"
          aria-label="Previous match"
          disabled={!result.matches.length || searching}
          onClick={() => moveMatch(-1)}
        >
          ↑
        </button>
        <button
          className="button"
          aria-label="Next match"
          disabled={!result.matches.length || searching}
          onClick={() => moveMatch(1)}
        >
          ↓
        </button>
        <output className="match-count" aria-live="polite">
          {searching
            ? "Searching…"
            : result.query
              ? result.matches.length
                ? `${matchPosition + 1} / ${result.matches.length}`
                : "No matches"
              : `${messageCount} messages`}
        </output>
        <button
          className="button"
          disabled={!rows.length}
          onClick={() =>
            list.current?.scrollToIndex({
              index: rows.length - 1,
              align: "end",
              behavior: "auto",
            })
          }
        >
          Latest
        </button>
      </div>
      {rows.length ? (
        <Virtuoso
          ref={list}
          data={rows}
          components={components}
          computeItemKey={computeItemKey}
          initialTopMostItemIndex={initialPosition.current}
          followOutput={followOutput}
          increaseViewportBy={overscan}
          itemContent={renderRow}
          style={listStyle}
        />
      ) : (
        <div className="empty">This session has no messages yet.</div>
      )}
    </section>
  );
});

export default Timeline;
