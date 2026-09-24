import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

const json = value => typeof value === "string" ? value : JSON.stringify(value ?? {})
const parse = value => { try { return JSON.parse(json(value)) } catch { return {} } }
const role = message => parse(message.data).role || message.role || "message"
const type = part => parse(part.data).type || "unknown"
const preview = part => { const value = parse(part.data); return value.text || value.tool || value.state?.title || value.state?.status || value.state?.output || type(part) }
const pretty = value => { try { return JSON.stringify(JSON.parse(json(value)), null, 2) } catch { return json(value) } }
const clip = (value, limit = 1600) => { const text = pretty(value); return text.length > limit ? `${text.slice(0, limit)}\n...` : text }

async function request(path, options) {
  const response = await fetch(path, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || response.statusText)
  return body
}

function useVirtualList(items, containerRef, estimate = 220) {
  const heights = useRef([])
  const [version, setVersion] = useState(0)
  const [viewport, setViewport] = useState(600)
  const [scrollTop, setScrollTop] = useState(0)
  const followBottom = useRef(true)
  const frame = useRef(0)

  useEffect(() => {
    heights.current = items.map((_, index) => heights.current[index] || estimate)
    setVersion(value => value + 1)
  }, [items.length, estimate])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return undefined
    const resize = () => setViewport(node.clientHeight)
    const scroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight
      followBottom.current = distance < 40
      if (frame.current) return
      frame.current = requestAnimationFrame(() => { frame.current = 0; setScrollTop(node.scrollTop) })
    }
    resize()
    node.addEventListener("scroll", scroll, { passive: true })
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    return () => { node.removeEventListener("scroll", scroll); observer.disconnect(); if (frame.current) cancelAnimationFrame(frame.current) }
  }, [containerRef])

  const prefix = useMemo(() => {
    const values = [0]
    for (const height of heights.current) values.push(values.at(-1) + height)
    return values
  }, [items.length, version])
  const find = useCallback(value => {
    let low = 0, high = prefix.length - 1
    while (low < high) { const middle = Math.floor((low + high) / 2); if (prefix[middle] < value) low = middle + 1; else high = middle }
    return Math.max(0, low - 1)
  }, [prefix])
  const start = Math.max(0, find(scrollTop) - 3)
  const end = Math.min(items.length, find(scrollTop + viewport) + 4)
  const measure = useCallback((index, height) => {
    const old = heights.current[index] || estimate
    if (Math.abs(old - height) < 1) return
    const node = containerRef.current
    const before = prefix[index]
    heights.current[index] = height
    if (node && followBottom.current) node.scrollTop = node.scrollHeight
    else if (node && before < node.scrollTop) node.scrollTop += height - old
    setVersion(value => value + 1)
  }, [containerRef, estimate, prefix])
  return { prefix, start, end, measure, totalHeight: prefix.at(-1) || 0, followBottom }
}

const Part = memo(function Part({ part, messageRole, selected, onSelect }) {
  return <div className={`part ${selected ? "selected" : ""}`} onClick={() => onSelect("part", part.id)}>
    <div><span className="part-label">{type(part)}</span><span className="part-role">{messageRole}</span></div>
    <div className="part-preview">{preview(part)}</div>
  </div>
})

const Message = memo(function Message({ message, index, selected, onSelect, measure }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) measure(index, ref.current.getBoundingClientRect().height) }, [index, measure, message])
  return <section className="message" data-index={index} ref={ref}>
    <div className="message-head"><span className="role">{role(message)}</span><span>{message.id}</span></div>
    <div className={`message-card ${selected?.kind === "message" && selected.id === message.id ? "selected" : ""}`} onClick={() => onSelect("message", message.id)}>
      <pre className="message-json">{clip(message.data)}</pre>
      {message.parts.map(part => <Part key={part.id} part={part} messageRole={role(message)} selected={selected?.kind === "part" && selected.id === part.id} onSelect={onSelect} />)}
    </div>
  </section>
})

function Timeline({ document, selected, onSelect, searchQuery, onSearchChange, onSearchMove }) {
  const container = useRef(null)
  const items = document?.messages || []
  const virtual = useVirtualList(items, container)
  useLayoutEffect(() => {
    const node = container.current
    if (!node || !items.length) return undefined
    virtual.followBottom.current = true
    const timer = setTimeout(() => node.scrollTo({ top: node.scrollHeight }), 50)
    return () => clearTimeout(timer)
  }, [document?.session?.id, items.length])
  const matches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return items.flatMap((message, index) => `${json(message.data)} ${message.parts.map(part => json(part.data)).join(" ")}`.toLowerCase().includes(query) ? [index] : [])
  }, [items, searchQuery])
  useEffect(() => { onSearchMove?.({ matches, scrollTo: index => { const node = container.current; if (node) node.scrollTop = virtual.prefix[index] || 0 } }) }, [matches, onSearchMove, virtual.prefix])
  if (!document) return <div className="empty">Select a session to inspect its messages, thinking traces, tool calls, and outputs.</div>
  return <div className="timeline" ref={container}>
    <div className="toolbar-search"><input value={searchQuery} onChange={event => onSearchChange(event.target.value)} placeholder="Search this session" /><button className="button" disabled={!matches.length} onClick={() => onSearchMove?.("previous")}>↑</button><button className="button" disabled={!matches.length} onClick={() => onSearchMove?.("next")}>↓</button><span>{matches.length ? `${matches.length} matches` : ""}</span></div>
    <div className="virtual-spacer" style={{ height: virtual.prefix[virtual.start] || 0 }} />
    <div>{items.slice(virtual.start, virtual.end).map((message, offset) => <Message key={message.id} message={message} index={virtual.start + offset} selected={selected} onSelect={onSelect} measure={virtual.measure} />)}</div>
    <div className="virtual-spacer" style={{ height: Math.max(0, virtual.totalHeight - (virtual.prefix[virtual.end] || 0)) }} />
  </div>
}

function App() {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState("")
  const [sessionDocument, setSessionDocument] = useState(null)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState("")
  const [messageSearch, setMessageSearch] = useState("")
  const [matchController, setMatchController] = useState(null)
  const [matchIndex, setMatchIndex] = useState(-1)
  const [sessionTitle, setSessionTitle] = useState("")
  const [editor, setEditor] = useState("")
  const [status, setStatus] = useState("")
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const selectedValue = useMemo(() => { if (!sessionDocument || !selected) return null; if (selected.kind === "message") return sessionDocument.messages.find(item => item.id === selected.id); return sessionDocument.messages.flatMap(item => item.parts).find(item => item.id === selected.id) }, [sessionDocument, selected])

  const loadSessions = useCallback(async () => { const body = await request(`/api/sessions?q=${encodeURIComponent(search)}`); setSessions(body.sessions || []) }, [search])
  useEffect(() => { loadSessions() }, [loadSessions])
  useEffect(() => { setSessionTitle(sessionDocument?.session?.title || "") }, [sessionDocument?.session?.title])
  useEffect(() => { setEditor(selectedValue ? pretty(selectedValue.data) : "") }, [selectedValue])
  const loadSession = async id => { const body = await request(`/api/session?id=${encodeURIComponent(id)}`); setSessionId(id); setSessionDocument(body); setEditing(false); setSelected(null); setMessageSearch(""); requestAnimationFrame(() => globalThis.document.querySelector(".timeline")?.scrollTo({ top: globalThis.document.querySelector(".timeline")?.scrollHeight })) }
  const startEditing = async () => { const body = await request("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) }); setSessionDocument(body.document); setEditing(true); setStatus("Workspace started") }
  const change = async (operation, payload) => { try { const body = await request("/api/workspace/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, operation, ...payload }) }); setSessionDocument(body.document); setStatus("Workspace updated") } catch (error) { setStatus(error.message) } }
  const saveSelected = () => { try { const data = JSON.parse(editor); change(selected?.kind === "message" ? "message.update" : "part.update", { messageId: selected?.kind === "message" ? selected.id : undefined, partId: selected?.kind === "part" ? selected.id : undefined, data }) } catch (error) { setStatus(`Invalid JSON: ${error.message}`) } }
  const apply = async () => { if (!confirm("Apply staged changes to the OpenCode database? A backup will be created first.")) return; try { const body = await request(`/api/apply?sessionId=${encodeURIComponent(sessionId)}`, { method: "POST" }); setSessionDocument(body.document); setEditing(false); setStatus(`Applied. Backup: ${body.backup}`); loadSessions() } catch (error) { setStatus(error.message) } }
  const matchMove = direction => { if (typeof direction === "object") { setMatchController(direction); return } if (!matchController?.matches?.length) return; const next = (matchIndex + (direction === "next" ? 1 : -1) + matchController.matches.length) % matchController.matches.length; setMatchIndex(next); matchController.scrollTo(matchController.matches[next]) }
  const selectedType = selectedValue && type(selectedValue)
  return <div className="app">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}><div className="brand"><h1>OpenCode Session Editor</h1><p>Local OpenCode database</p><button className="button sidebar-close" onClick={() => setSidebarOpen(false)}>Close</button></div><input className="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search sessions" /><div className="session-list">{sessions.map(item => <div className={`session ${item.id === sessionId ? "active" : ""}`} key={item.id} onClick={() => { loadSession(item.id); setSidebarOpen(false) }}><div className="session-title">{item.title || item.id}</div><div className="session-meta">{item.directory} · {new Date(item.updated).toLocaleString()}</div></div>)}</div></aside>
    <main className="main"><div className="toolbar"><button className="button mobile-only" onClick={() => setSidebarOpen(true)}>Sessions</button><h2>{sessionDocument?.session?.title || "Select a session"}</h2><span className={`mode ${editing ? "" : "source"}`}>{editing ? "EDITING" : "BROWSE"}</span><button className="button" disabled={!sessionDocument || editing} onClick={startEditing}>Start editing</button><button className="button primary" disabled={!editing} onClick={apply}>Apply</button><button className="button" disabled={!editing}>Undo</button><button className="button" disabled={!editing}>Redo</button><button className="button" onClick={() => setInspectorOpen(value => !value)}>Inspector</button></div><Timeline document={sessionDocument} selected={selected} onSelect={(kind, id) => { setSelected({ kind, id }); setInspectorOpen(true) }} searchQuery={messageSearch} onSearchChange={value => { setMessageSearch(value); setMatchIndex(0) }} onSearchMove={matchMove} /></main>
    <aside className={`inspector ${inspectorOpen ? "open" : ""}`}><div className="inspector-head"><h3>{selectedValue ? (selected?.kind === "message" ? "Message" : "Part") : "Inspector"}</h3><p>{selectedValue?.id || "Select a message or part."}</p></div><div className="inspector-body"><label className="label">Session title</label><input className="input" disabled={!editing} value={sessionTitle} onChange={event => setSessionTitle(event.target.value)} /><div className="actions"><button className="button" disabled={!editing}>Rename</button><button className="button" disabled={!editing}>Add message</button><button className="button" disabled={!editing}>Add part</button></div><label className="label">Raw JSON</label><textarea className="editor" disabled={!selectedValue || !editing} value={editor} onChange={event => setEditor(event.target.value)} /><div className="hint">{selectedType === "reasoning" ? "Reasoning may include provider signatures or encrypted metadata." : "Workspace edits are staged locally until Apply is confirmed."}</div><div className="status">{status}</div></div><div className="footer"><button className="button" disabled={!selectedValue || !editing} onClick={saveSelected}>Save selected</button><button className="button danger" disabled={!selectedValue || !editing}>Delete selected</button></div></aside>
  </div>
}

createRoot(document.getElementById("root")).render(<App />)
