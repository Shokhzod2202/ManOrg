'use client';

import { type FormEvent, useRef, useState } from 'react';
import { Empty, ErrorBox, Icon, Loading, PageHead } from '../../../components/ui';
import {
  api,
  type ApiError,
  formatDate,
  formatTime,
  patch,
  post,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Task = Schemas['Task'];
type Member = Schemas['Member'];
type IngOrder = Schemas['IngredientOrder'];
type Rule = Schemas['RecurringTask'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every Mon, Wed" and the like. */
export function repeatText(r: Pick<Rule, 'frequency' | 'weekdays' | 'dayOfMonth'>): string {
  if (r.frequency === 'daily') return t('Every day');
  if (r.frequency === 'weekly')
    return t('Every {days}', { days: r.weekdays.map((d) => t(WEEKDAYS[d]!)).join(', ') });
  return r.dayOfMonth === 31
    ? t('Every month on the last day')
    : t('Every month on day {day}', { day: r.dayOfMonth ?? 1 });
}

export default function TasksPage() {
  const { actor } = useSession();
  const admin = actor === 'org_admin';
  const [status, setStatus] = useState<'open' | 'done' | 'repeating'>('open');
  const { data, error, loading, reload } = useApi<{ items: Task[] }>(
    `/tasks?status=${status === 'repeating' ? 'open' : status}`,
    60_000,
  );
  const [rulesVersion, setRulesVersion] = useState(0);

  return (
    <div className="page">
      <PageHead title={t('Tasks')}>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={status === 'open'}
            className={status === 'open' ? 'on' : ''}
            onClick={() => setStatus('open')}
          >
            {t('Open')}
          </button>
          <button
            role="tab"
            aria-selected={status === 'done'}
            className={status === 'done' ? 'on' : ''}
            onClick={() => setStatus('done')}
          >
            {t('Done')}
          </button>
          {admin ? (
            <button
              role="tab"
              aria-selected={status === 'repeating'}
              className={status === 'repeating' ? 'on' : ''}
              onClick={() => setStatus('repeating')}
            >
              {t('Repeating')}
            </button>
          ) : null}
        </div>
      </PageHead>
      {admin ? (
        <TaskForm
          onDone={() => {
            reload();
            setRulesVersion((v) => v + 1);
          }}
        />
      ) : null}
      {status === 'repeating' ? (
        <RepeatingTasks key={rulesVersion} />
      ) : (
        <TaskList
          status={status}
          data={data}
          error={error}
          loading={loading}
          reload={reload}
          admin={admin}
        />
      )}
    </div>
  );
}

function TaskList({
  status,
  data,
  error,
  loading,
  reload,
  admin,
}: {
  status: 'open' | 'done';
  data: { items: Task[] } | null | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  admin: boolean;
}) {
  return (
    <>
      <IngredientOrders admin={admin} />
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>{status === 'open' ? t('No open tasks.') : t('No finished tasks yet.')}</Empty>
      ) : null}
      {data?.items.map((t) => (
        <TaskCard key={t.id} task={t} onDone={reload} admin={admin} />
      ))}
    </>
  );
}

/** Phase 3: rules that make a task on each due day; pause, resume or end them. */
function RepeatingTasks() {
  const { data, error, loading, reload } = useApi<{ items: Rule[] }>('/recurring-tasks');
  const [err, setErr] = useState<ApiError | null>(null);

  async function change(r: Rule, body: Partial<Pick<Rule, 'active' | 'endDate'>>) {
    setErr(null);
    try {
      await patch(`/recurring-tasks/${r.id}`, body, { ifMatch: r.version });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>
          {t(
            'No repeating tasks. Choose “Repeat” on a new task to make one every day, week or month.',
          )}
        </Empty>
      ) : null}
      {data?.items.map((r) => {
        const ended = r.endDate !== null && r.endDate < today();
        return (
          <section key={r.id} className="card">
            <div className="row between wrap">
              <h2>{r.title}</h2>
              <span className={r.active && !ended ? 'pill ok' : 'pill'}>
                {ended ? t('Ended') : r.active ? t('On') : t('Paused')}
              </span>
            </div>
            <span className="muted small">
              {repeatText(r)} ·{' '}
              {r.forAll
                ? t('for everyone')
                : t('for {name}', {
                    name: r.assignees.map((p) => p.name).join(', ') || t('nobody'),
                  })}{' '}
              · {t('from {date}', { date: formatDate(r.startDate) })}
              {r.endDate ? ` ${t('to {date}', { date: formatDate(r.endDate) })}` : ''}
              {r.lastMade
                ? ` · ${t('last made {date}', { date: formatDate(r.lastMade.date) })} (${r.lastMade.status === 'done' ? t('done') : t('open')})`
                : ''}
            </span>
            {ended ? null : (
              <div className="row wrap">
                <button className="btn ghost" onClick={() => void change(r, { active: !r.active })}>
                  {r.active ? t('Pause') : t('Resume')}
                </button>
                <button className="btn ghost" onClick={() => void change(r, { endDate: today() })}>
                  {t('End after today')}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

/** TSK-2: done needs a photo taken now with the camera; the server refuses gallery pictures. */
function TaskCard({ task, onDone, admin }: { task: Task; onDone: () => void; admin: boolean }) {
  const { me } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState(false);
  // Theirs, shared with them, or for everyone (decided 2026-11-24).
  const mine = task.forAll || task.assignees.some((p) => p.id === me?.id);

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
        <h2>
          {task.title}
          {task.recurringTaskId ? (
            <span className="pill" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
              {t('Repeats')}
            </span>
          ) : null}
        </h2>
        {task.status === 'done' ? (
          <span className="pill ok">
            <Icon name="check" size={14} /> {t('Done')}
          </span>
        ) : task.dueDate ? (
          <span className={task.dueDate < today() ? 'pill warn' : 'pill'}>
            {t('Due {date}', { date: formatDate(task.dueDate) })}
          </span>
        ) : null}
      </div>
      {editing ? (
        <TaskForm
          task={task}
          onDone={() => {
            setEditing(false);
            onDone();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      {task.description ? <p style={{ margin: 0 }}>{task.description}</p> : null}
      <span className="muted small">
        {forText(task)}
        {task.createdBy ? ` · ${t('from {name}', { name: task.createdBy.name })}` : ''}
        {task.completedAt
          ? ` · ${t('done {date} {time} by {name}', { date: formatDate(task.completedAt.slice(0, 10)), time: formatTime(task.completedAt), name: task.completedBy?.name ?? '' })}`
          : ''}
      </span>
      {admin && task.status === 'open' && task.type === 'general' && !editing ? (
        <button
          className="btn ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setEditing(true)}
        >
          {t('Edit')}
        </button>
      ) : null}
      {task.photos.map((p) => (
        <img
          key={p.id}
          className="photo"
          src={p.url}
          alt={t('Photo for {title}, taken {time}', {
            title: task.title,
            time: formatTime(p.takenAt),
          })}
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
            <Icon name="camera" /> {busy ? t('Uploading…') : t('Take photo and finish')}
          </button>
          <span className="muted small center">
            {t('Use the camera now. Pictures from the gallery are not accepted.')}
          </span>
        </>
      ) : null}
    </section>
  );
}

/** "For everyone", "For Mina, Joon" or "For the admins" (ingredient orders). */
function forText(task: Task): string {
  if (task.forAll) return t('For everyone');
  if (task.assignees.length)
    return t('For {name}', { name: task.assignees.map((p) => p.name).join(', ') });
  return t('For the admins');
}

/**
 * Who a task is for (decided 2026-11-24): everyone, including people who join later, or any number
 * of employees. Several people share one task; whoever does it takes the photo.
 */
function WhoPicker({
  forAll,
  chosen,
  onChange,
}: {
  forAll: boolean;
  chosen: string[];
  onChange: (forAll: boolean, chosen: string[]) => void;
}) {
  const members = useApi<{ items: Member[] }>('/members');
  const employees = (members.data?.items ?? []).filter(
    (m) => m.status === 'active' && m.role === 'employee',
  );
  return (
    <fieldset className="field who">
      <legend>{t('For')}</legend>
      <div className="row wrap">
        <label className="chip">
          <input
            type="checkbox"
            checked={forAll}
            onChange={(e) => onChange(e.target.checked, e.target.checked ? [] : chosen)}
          />
          {t('Everyone (also people who join later)')}
        </label>
        {employees.map((m) => (
          <label key={m.user.id} className="chip" aria-disabled={forAll}>
            <input
              type="checkbox"
              disabled={forAll}
              checked={!forAll && chosen.includes(m.user.id)}
              onChange={(e) =>
                onChange(
                  false,
                  e.target.checked
                    ? [...chosen, m.user.id]
                    : chosen.filter((id) => id !== m.user.id),
                )
              }
            />
            {m.displayName || m.user.name}
          </label>
        ))}
      </div>
      {members.data && !employees.length ? (
        <span className="muted small">
          {t('No employees yet. Choose Everyone: people who join later will see the task.')}
        </span>
      ) : null}
      {!forAll && chosen.length > 1 ? (
        <span className="muted small">
          {t('One task for {n} people: whoever does it takes the photo, and it is done for all.', {
            n: chosen.length,
          })}
        </span>
      ) : null}
    </fieldset>
  );
}

const whoBody = (forAll: boolean, chosen: string[]) =>
  forAll ? { forAll: true } : { assigneeIds: chosen };

/** New task (or repeating task), or editing an open one. */
function TaskForm({
  task,
  onDone,
  onCancel,
}: {
  task?: Task;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(task));
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [forAll, setForAll] = useState(task?.forAll ?? false);
  const [chosen, setChosen] = useState<string[]>(task?.assignees.map((p) => p.id) ?? []);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? today());
  const [repeat, setRepeat] = useState<'none' | Rule['frequency']>('none');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const common = {
      title: title.trim(),
      ...whoBody(forAll, chosen),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    try {
      if (task) {
        await patch(
          `/tasks/${task.id}`,
          { ...common, description: description.trim() || null, dueDate },
          { ifMatch: task.version },
        );
      } else if (repeat === 'none') {
        await post('/tasks', { ...common, dueDate });
      } else {
        await post('/recurring-tasks', {
          ...common,
          frequency: repeat,
          startDate: dueDate,
          ...(repeat === 'weekly' ? { weekdays } : {}),
          ...(repeat === 'monthly' ? { dayOfMonth: Number(dueDate.slice(8, 10)) } : {}),
        });
      }
      setRepeat('none');
      setWeekdays([]);
      setTitle('');
      setDescription('');
      setForAll(false);
      setChosen([]);
      setOpen(false);
      onDone();
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }

  if (!open)
    return (
      <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setOpen(true)}>
        {t('New task')}
      </button>
    );
  return (
    <form className={task ? 'stack' : 'card'} onSubmit={submit}>
      {task ? null : <h2>{t('New task')}</h2>}
      <ErrorBox error={err} />
      <label className="field">
        {t('Title')}
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        {t('Details')}
        <textarea
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <WhoPicker
        forAll={forAll}
        chosen={chosen}
        onChange={(all, ids) => {
          setForAll(all);
          setChosen(ids);
        }}
      />
      <div className="grid2">
        <label className="field">
          {repeat === 'none' ? t('Due') : t('Starting')}
          <input
            type="date"
            required
            min={task ? undefined : today()}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
      </div>
      {task ? null : (
        <label className="field">
          {t('Repeat')}
          <select
            value={repeat}
            onChange={(e) => {
              const v = e.target.value as typeof repeat;
              setRepeat(v);
              if (v === 'weekly' && !weekdays.length)
                setWeekdays([new Date(`${dueDate}T00:00:00Z`).getUTCDay()]);
            }}
          >
            <option value="none">{t('Does not repeat')}</option>
            <option value="daily">{t('Every day')}</option>
            <option value="weekly">{t('Every week on…')}</option>
            <option value="monthly">
              {t('Every month on day {day}', { day: Number(dueDate.slice(8, 10)) })}
            </option>
          </select>
        </label>
      )}
      {repeat === 'weekly' ? (
        <div className="row wrap" role="group" aria-label={t('Weekdays')}>
          {WEEKDAYS.map((name, i) => (
            <label key={name} className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={weekdays.includes(i)}
                onChange={(e) =>
                  setWeekdays(
                    e.target.checked ? [...weekdays, i].sort() : weekdays.filter((d) => d !== i),
                  )
                }
              />
              {t(name)}
            </label>
          ))}
        </div>
      ) : null}
      {repeat !== 'none' ? (
        <span className="muted small">
          {t(
            'A new task is made on each of these days, starting {date}. Finished tasks still need a camera photo.',
            { date: formatDate(dueDate) },
          )}
        </span>
      ) : null}
      <div className="row">
        <button
          className="btn"
          disabled={(repeat === 'weekly' && !weekdays.length) || (!forAll && !chosen.length)}
        >
          {task ? t('Save') : repeat === 'none' ? t('Create task') : t('Start repeating task')}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setOpen(false);
            onCancel?.();
          }}
        >
          {t('Cancel')}
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
      <h2>{t('Ingredient orders')}</h2>
      <ErrorBox error={err} />
      {open.map((o) => (
        <div key={o.id} className="row between wrap">
          <span>
            <b>{o.ingredient.name}</b> × {t('{n} packs', { n: o.quantity })} (
            {o.ingredient.packQuantity} {o.ingredient.packUnit}) · {o.ingredient.source}
            <br />
            <span className="muted small">
              {t('Asked by {name}', { name: o.requestedBy?.name ?? t('someone') })}
              {o.note ? ` · “${o.note}”` : ''}
            </span>
          </span>
          {o.status === 'requested' ? (
            admin ? (
              <button className="btn" onClick={() => act(o.id, 'fulfil')}>
                {t('Bought')}
              </button>
            ) : (
              <span className="pill">{t('Requested')}</span>
            )
          ) : (
            <button className="btn ghost" onClick={() => act(o.id, 'check')}>
              {t('Arrived and checked')}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
