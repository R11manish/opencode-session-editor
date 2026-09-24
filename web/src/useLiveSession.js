import { useCallback, useEffect, useRef, useState } from "react";

export default function useLiveSession(sessionId, paused) {
  const [state, setState] = useState({
    document: null,
    error: "",
    syncedAt: null,
    loading: false,
  });
  const refresh = useRef(() => {});

  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let active = null;
    let timer;
    let etag = "";
    let generation = 0;

    async function poll(force = false) {
      clearTimeout(timer);
      if (stopped || paused) return;
      if (active && !force) return;
      if (active) active.abort();
      if (globalThis.document.hidden && !force) {
        timer = setTimeout(poll, 1500);
        return;
      }
      const turn = ++generation;
      const controller = new AbortController();
      active = controller;
      try {
        const response = await fetch(
          `/api/session?id=${encodeURIComponent(sessionId)}`,
          {
            signal: controller.signal,
            headers: etag ? { "If-None-Match": etag } : {},
            cache: "no-cache",
          },
        );
        if (response.status === 304) {
          if (!stopped && turn === generation)
            setState((value) =>
              value.error || value.loading
                ? { ...value, error: "", loading: false }
                : value,
            );
          return;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || response.statusText);
        if (stopped || controller.signal.aborted || turn !== generation) return;
        etag = response.headers.get("ETag") || "";
        setState({
          document: body,
          error: "",
          syncedAt: Date.now(),
          loading: false,
        });
      } catch (cause) {
        if (!stopped && cause.name !== "AbortError" && turn === generation)
          setState((value) => ({
            ...value,
            error: cause.message,
            loading: false,
          }));
      } finally {
        if (active === controller) {
          active = null;
          if (!stopped) timer = setTimeout(poll, 1500);
        }
      }
    }

    setState((value) => ({
      ...value,
      error: "",
      loading: value.document?.session.id !== sessionId,
    }));
    refresh.current = () => poll(true);
    const visible = () => {
      if (!globalThis.document.hidden) poll(true);
    };
    globalThis.document.addEventListener("visibilitychange", visible);
    poll(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
      active?.abort();
      refresh.current = () => {};
      globalThis.document.removeEventListener("visibilitychange", visible);
    };
  }, [sessionId, paused]);

  const sync = useCallback(() => refresh.current(), []);
  return {
    ...state,
    document: state.document?.session.id === sessionId ? state.document : null,
    sync,
  };
}
