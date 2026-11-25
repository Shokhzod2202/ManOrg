'use client';

import { useEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** A "⋯" button that opens a short list of less common actions, so rows stay uncluttered. */
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <span className="more-menu" ref={box}>
      <button
        type="button"
        className="btn ghost more-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open ? (
        <span className="more-list" role="menu">
          {items.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className={i.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                i.onSelect();
              }}
            >
              {i.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
