'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import { haptic } from '../components/telegram';

/** How long a finger rests on a row before it picks the row up. */
const HOLD_MS = 350;
/** Moving further than this before then means the person is scrolling, not holding. */
const SLOP_PX = 10;
/** Near the top or bottom of the screen the page scrolls by itself while dragging. */
const EDGE_PX = 90;

type Drag = { id: string; order: string[]; start: string[]; y: number };
type Hold = { id: string; x: number; y: number; timer: number };

/**
 * Decided 2026-12-01: drag rows into a new order with a mouse (the ⠿ handle), a finger on the
 * handle, or a finger held still on the row for a moment. While dragging the page does not scroll
 * under the finger; near the screen edges it scrolls by itself. Works in the Telegram mini app.
 */
export function useDragOrder({
  ids,
  enabled,
  rows,
  onDrop,
}: {
  /** The rows' ids in the order on screen when a drag starts. */
  ids: () => string[];
  enabled: boolean;
  rows: RefObject<Map<string, HTMLElement>>;
  onDrop: (order: string[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const hold = useRef<Hold | null>(null);
  // The latest values for the document listeners, which are bound once.
  const live = useRef({ ids, enabled, onDrop });
  live.current = { ids, enabled, onDrop };

  function begin(id: string, y: number) {
    const order = live.current.ids();
    drag.current = { id, order, start: order, y };
    setDragId(id);
    setDraft(order);
    haptic();
  }

  function moveTo(y: number) {
    const d = drag.current;
    if (!d) return;
    d.y = y;
    const others = d.order.filter((x) => x !== d.id);
    let at = 0;
    for (const id of others) {
      const r = rows.current?.get(id)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) at += 1;
    }
    const next = [...others];
    next.splice(at, 0, d.id);
    if (next.join() !== d.order.join()) {
      d.order = next;
      setDraft(next);
    }
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    setDragId(null);
    if (!d) return;
    // Only save when the order really changed.
    if (d.order.join() === d.start.join()) {
      setDraft(null);
      return;
    }
    void live.current.onDrop(d.order).finally(() => setDraft(null));
  }

  function cancelHold() {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  }

  useEffect(() => {
    const touchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (drag.current) {
        // Keep the page (and Telegram) from scrolling while a row is held.
        if (e.cancelable) e.preventDefault();
        moveTo(t.clientY);
      } else if (hold.current) {
        const h = hold.current;
        if (Math.hypot(t.clientX - h.x, t.clientY - h.y) > SLOP_PX) cancelHold();
      }
    };
    const touchEnd = () => {
      cancelHold();
      if (drag.current) end();
    };
    const pointerMove = (e: PointerEvent) => {
      if (drag.current && e.pointerType !== 'touch') moveTo(e.clientY);
    };
    const pointerUp = (e: PointerEvent) => {
      if (drag.current && e.pointerType !== 'touch') end();
    };
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd);
    document.addEventListener('touchcancel', touchEnd);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    return () => {
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('touchcancel', touchEnd);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      cancelHold();
    };
    // Bound once; everything they need is read from refs.
  }, []);

  // Near the top or bottom edge the page scrolls by itself, so a row can travel the whole list.
  useEffect(() => {
    if (!dragId) return;
    let frame = 0;
    const step = () => {
      const d = drag.current;
      if (!d) return;
      const bottom = window.innerHeight - EDGE_PX - 60; // above the phone tab bar
      const by =
        d.y < EDGE_PX
          ? -Math.min(18, (EDGE_PX - d.y) / 3)
          : d.y > bottom
            ? Math.min(18, (d.y - bottom) / 3)
            : 0;
      if (by) {
        window.scrollBy(0, by);
        moveTo(d.y);
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [dragId]);

  /** For the ⠿ handle: a mouse or a finger picks the row up at once. */
  function handleProps(id: string) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (!live.current.enabled || e.pointerType === 'touch') return;
        e.preventDefault();
        begin(id, e.clientY);
      },
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!live.current.enabled || !t) return;
        cancelHold();
        begin(id, t.clientY);
      },
    };
  }

  /** For the whole row: a finger held still for a moment picks it up. */
  function rowProps(id: string) {
    return {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!live.current.enabled || !t || drag.current) return;
        // Buttons, fields and links keep their own taps.
        if ((e.target as HTMLElement).closest('button, input, select, textarea, a, label, form'))
          return;
        cancelHold();
        hold.current = {
          id,
          x: t.clientX,
          y: t.clientY,
          timer: window.setTimeout(() => {
            const h = hold.current;
            hold.current = null;
            if (h) begin(h.id, h.y);
          }, HOLD_MS),
        };
      },
      onContextMenu: (e: React.MouseEvent) => {
        if (live.current.enabled) e.preventDefault();
      },
    };
  }

  return { draft, setDraft, dragId, handleProps, rowProps };
}
