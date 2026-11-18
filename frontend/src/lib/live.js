// Realtime: one EventSource per tab, shared by every screen. Screens subscribe with useLive() and
// silently re-fetch what changed. The stream carries only ids; data always comes from the normal API.
import { useEffect, useRef, useState } from 'react';

const listeners = new Set();
const statusListeners = new Set();
let es = null;
let status = 'off';
let retryTimer = null;

function setStatus(s) { status = s; statusListeners.forEach((f) => f(s)); }

export function connectLive() {
  if (es || typeof EventSource === 'undefined') return;
  es = new EventSource('/api/events', { withCredentials: true });
  es.addEventListener('hello', () => setStatus('on'));
  es.onopen = () => setStatus('on');
  es.onmessage = (m) => { try { const evt = JSON.parse(m.data); listeners.forEach((f) => f(evt)); } catch { /* ignore malformed */ } };
  es.onerror = () => {
    setStatus('off');
    if (es?.readyState === EventSource.CLOSED) { es = null; clearTimeout(retryTimer); retryTimer = setTimeout(connectLive, 5000); }
  };
}

export function disconnectLive() { clearTimeout(retryTimer); es?.close(); es = null; setStatus('off'); }

/** Call `onEvent(evt)` for live events that pass `filter`. Events are debounced per screen. */
export function useLive(filter, onEvent, deps = []) {
  const cb = useRef(onEvent); cb.current = onEvent;
  const fl = useRef(filter); fl.current = filter;
  useEffect(() => {
    let t = null;
    const fn = (evt) => { if (fl.current && !fl.current(evt)) return; clearTimeout(t); t = setTimeout(() => cb.current(evt), 250); };
    listeners.add(fn);
    return () => { listeners.delete(fn); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useLiveStatus() {
  const [s, setS] = useState(status);
  useEffect(() => { statusListeners.add(setS); return () => statusListeners.delete(setS); }, []);
  return s;
}
