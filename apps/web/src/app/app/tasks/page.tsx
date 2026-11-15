'use client';

import { type FormEvent, useRef, useState } from 'react';
import { Empty, ErrorBox, Icon, Loading, PageHead } from '../../../components/ui';
import {
  api,
  type ApiError,
  formatDate,
  formatTime,
  post,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';

type Task = Schemas['Task'];
type Member = Schemas['Member'];
type IngOrder = Schemas['IngredientOrder'];

export default function TasksPage() {
  const { actor } = useSession();
  const admin = actor === 'org_admin';
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const { data, error, loading, reload } = useApi<{ items: Task[] }>(
    `/tasks?status=${status}`,
    60_000,
  );

  return (
    <div className="page">
      <PageHead title="Tasks">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={status === 'open'}
            className={status === 'open' ? 'on' : ''}
            onClick={() => setStatus('open')}
          >
            Open
          </button>
          <button
            role="tab"
            aria-selected={status === 'done'}
            className={status === 'done' ? 'on' : ''}
            onClick={() => setStatus('done')}
          >
            Done
          </button>
        </div>
      </PageHead>
      {admin ? <NewTask onCreated={reload} /> : null}
      <IngredientOrders admin={admin} />
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>{status === 'open' ? 'No open tasks.' : 'No finished tasks yet.'}</Empty>
      ) : null}
      {data?.items.map((t) => (
        <TaskCard key={t.id} task={t} onDone={reload} />
      ))}
    </div>
  );
}

/** TSK-2: done needs a photo taken now with the camera; the server refuses gallery pictures. */
function TaskCard({ task, onDone }: { task: Task; onDone: () => void }) {
  const { me } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const mine = task.assignee?.id === me?.id;

  async function openCamera() {
    setErr(null);
    try {
      const t = await post<Schemas['CaptureToken']>(`/tasks/${task.id}/capture-token`);
      setToken(t.captureToken);
      input.current?.click();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  async function upload(file: File) {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('captureToken', token);
      form.append('photo', file);
      await api('POST', `/tasks/${task.id}/complete`, { form });
      onDone();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
      setToken(null);
    }
  }

  return (
    <section className="card">
      <div className="row between wrap">
        <h2>{task.title}</h2>
        {task.status === 'done' ? (
          <span className="pill ok">
            <Icon name="check" size={14} /> Done
          </span>
        ) : task.dueDate ? (
          <span className={task.dueDate < today() ? 'pill warn' : 'pill'}>
            Due {formatDate(task.dueDate)}
          </span>
        ) : null}
      </div>
      {task.description ? <p style={{ margin: 0 }}>{task.description}</p> : null}
      <span className="muted small">
        {task.assignee ? `For ${task.assignee.name}` : 'For the admins'}
        {task.createdBy ? ` · from ${task.createdBy.name}` : ''}
        {task.completedAt
          ? ` · done ${formatDate(task.completedAt.slice(0, 10))} ${formatTime(task.completedAt)} by ${task.completedBy?.name ?? ''}`
          : ''}
      </span>
      {task.photos.map((p) => (
        <img
          key={p.id}
          className="photo"
          src={p.url}
          alt={`Photo for ${task.title}, taken ${formatTime(p.takenAt)}`}
        />
      ))}
      <ErrorBox error={err} />
      {task.status === 'open' && task.type === 'general' && mine ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <button className="btn big" disabled={busy} onClick={openCamera}>
            <Icon name="camera" /> {busy ? 'Uploading…' : 'Take photo and finish'}
          </button>
          <span className="muted small center">
            Use the camera now. Pictures from the gallery are not accepted.
          </span>
        </>
      ) : null}
    </section>
  );
}

function NewTask({ onCreated }: { onCreated: () => void }) {
  const members = useApi<{ items: Member[] }>('/members');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState(today());
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await post('/tasks', {
        title: title.trim(),
        assigneeId,
        dueDate,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setTitle('');
      setDescription('');
      setOpen(false);
      onCreated();
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }

  if (!open)
    return (
      <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setOpen(true)}>
        New task
      </button>
    );
  return (
    <form className="card" onSubmit={submit}>
      <h2>New task</h2>
      <ErrorBox error={err} />
      <label className="field">
        Title
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Details
        <textarea
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="grid2">
        <label className="field">
          For
          <select required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Choose</option>
            {members.data?.items
              .filter((m) => m.status === 'active' && m.role === 'employee')
              .map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Due
          <input
            type="date"
            required
            min={today()}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button className="btn">Create task</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** ING-5, ING-6: requested → fulfilled (bought) → checked. */
function IngredientOrders({ admin }: { admin: boolean }) {
  const { data, reload } = useApi<{ items: IngOrder[] }>('/ingredient-orders', 60_000);
  const [err, setErr] = useState<ApiError | null>(null);
  const open = (data?.items ?? []).filter((o) => o.status !== 'checked');
  if (!open.length) return null;
  async function act(id: string, step: 'fulfil' | 'check') {
    setErr(null);
    try {
      await post(`/ingredient-orders/${id}/${step}`);
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>Ingredient orders</h2>
      <ErrorBox error={err} />
      {open.map((o) => (
        <div key={o.id} className="row between wrap">
          <span>
            <b>{o.ingredient.name}</b> × {o.quantity} packs ({o.ingredient.packQuantity}{' '}
            {o.ingredient.packUnit}) · {o.ingredient.source}
            <br />
            <span className="muted small">
              Asked by {o.requestedBy?.name ?? 'someone'}
              {o.note ? ` · “${o.note}”` : ''}
            </span>
          </span>
          {o.status === 'requested' ? (
            admin ? (
              <button className="btn" onClick={() => act(o.id, 'fulfil')}>
                Bought
              </button>
            ) : (
              <span className="pill">Requested</span>
            )
          ) : (
            <button className="btn ghost" onClick={() => act(o.id, 'check')}>
              Arrived and checked
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
