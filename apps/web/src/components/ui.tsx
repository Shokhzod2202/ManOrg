'use client';

import { type InputHTMLAttributes, type ReactNode, useState } from 'react';
import { type ApiError } from '../lib/api';
import { t } from '../lib/i18n';

const PATHS: Record<string, ReactNode> = {
  chevron: <path d="m6 9 6 6 6-6" />,
  home: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  orders: <path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" />,
  deliveries: (
    <>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  shifts: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  output: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </>
  ),
  tasks: <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />,
  products: (
    <>
      <path d="M4 7l8-4 8 4-8 4z" />
      <path d="M4 7v10l8 4 8-4V7" />
    </>
  ),
  ingredients: <path d="M6 3h12l-1 6a5 5 0 0 1-10 0zM12 14v7M8 21h8" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.4 2.6 4 5.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3.1V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 2z" />
    </>
  ),
  wall: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  more: <path d="M4 6h16M4 12h16M4 18h16" />,
  money: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M9 13h.01M15 13h.01M9.5 17h5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warn: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  list: <path d="M3 5h18M3 12h18M3 19h18" />,
  matrix: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  stroke = 2,
}: {
  name: string;
  size?: number;
  stroke?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      {t(label)}
    </div>
  );
}

export function ErrorBox({
  error,
  onRetry,
  inlineFields = false,
}: {
  error: ApiError | Error | null;
  onRetry?: () => void;
  /** The form shows field problems next to each field, so they are not repeated here. */
  inlineFields?: boolean;
}) {
  if (!error) return null;
  // Say which field is wrong and why, not only "The request is not valid."
  const reasons =
    !inlineFields && 'fields' in error && error.fields
      ? [...new Set(Object.values(error.fields).flat())]
      : [];
  return (
    <div className="error" role="alert">
      <Icon name="warn" />
      <span style={{ flex: 1 }}>
        {reasons.length ? reasons.map((r) => t(r)).join(' ') : t(error.message)}
      </span>
      {onRetry ? (
        <button type="button" className="btn ghost" onClick={onRetry}>
          {t('Try again')}
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{typeof children === 'string' ? t(children) : children}</div>;
}

/** A red flag always carries an icon and words, never colour alone. */
export function Flag({ children }: { children: ReactNode }) {
  return (
    <span className="flag">
      <Icon name="warn" size={16} />
      {children}
    </span>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[] | undefined;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {t(label)}
      {children}
      {error?.length ? <span className="err">{error.map((x) => t(x)).join(' ')}</span> : null}
    </label>
  );
}

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <h1>{t(title)}</h1>
      {sub ? <div className="muted">{sub}</div> : null}
      {children}
    </header>
  );
}

/** A picker that adds one product to a form; used for unordered delivery lines and order changes. */
export function AddProduct({
  options,
  onAdd,
  label = 'Add a product…',
}: {
  options: { id: string; name: string }[];
  onAdd: (id: string) => void;
  label?: string;
}) {
  if (!options.length) return null;
  return (
    <select
      className="input"
      value=""
      aria-label={t(label)}
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
      }}
    >
      <option value="">{t(label)}</option>
      {[...options]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
    </select>
  );
}

/** A password field with an eye button that shows or hides what was typed. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="eye"
        aria-label={shown ? t('Hide password') : t('Show password')}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        <Icon name={shown ? 'eyeOff' : 'eye'} />
      </button>
    </span>
  );
}

/** A person's profile picture, or their initials on the brand colour when they have none. */
export function Avatar({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return url ? (
    <img className="avatar" src={url} alt="" style={{ width: size, height: size }} />
  ) : (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}
