'use client';

import { type FormEvent, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { type ApiError, formatDate, get, patch, post, put, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Ingredient = Schemas['Ingredient'];
type Member = Schemas['Member'];
interface Price {
  id: string;
  packPrice: number;
  effectiveFrom: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const won = (n: number) => `₩${n.toLocaleString('en-US')}`;

/** ING-1 to ING-6. A new price applies from now on; past costs keep their price (decision 2026-11-12). */
export default function IngredientsPage() {
  const { actor } = useSession();
  const admin = actor === 'org_admin';
  const { data, error, loading, reload } = useApi<{ items: Ingredient[] }>('/ingredients');
  const items = [...(data?.items ?? [])].sort(
    (a, b) => Number(b.dueToday) - Number(a.dueToday) || a.name.localeCompare(b.name),
  );

  return (
    <div className="page">
      <PageHead title={t('Ingredients')} />
      {admin ? <NewIngredient onCreated={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !items.length ? <Empty>{t('No ingredients yet.')}</Empty> : null}
      {items.map((i) => (
        <IngredientCard key={i.id} ing={i} admin={admin} onChange={reload} />
      ))}
    </div>
  );
}

function IngredientCard({
  ing,
  admin,
  onChange,
}: {
  ing: Ingredient;
  admin: boolean;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'order' | 'price' | 'people' | 'edit'>('none');
  const [f, setF] = useState({
    name: ing.name,
    source: ing.source,
    packQuantity: ing.packQuantity,
    packUnit: ing.packUnit as string,
    weekday: ing.orderSchedule ? String(ing.orderSchedule.weekday) : '',
    time: ing.orderSchedule?.time ?? '18:00',
  });
  const [packs, setPacks] = useState(1);
  const [note, setNote] = useState('');
  const [price, setPrice] = useState(ing.packPrice ?? 0);
  const [history, setHistory] = useState<Price[] | null>(null);
  const members = useApi<{ items: Member[] }>(admin && mode === 'people' ? '/members' : null);
  const [people, setPeople] = useState<Set<string>>(
    new Set(ing.responsibleEmployees.map((p) => p.id)),
  );
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(t(done));
      setMode('none');
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <section className="card">
      <div className="row between wrap">
        <div>
          <h2>{ing.name}</h2>
          <span className="muted small">
            {t('{qty} {unit} per pack', { qty: ing.packQuantity, unit: ing.packUnit })} ·{' '}
            {ing.source}
            {ing.orderSchedule
              ? ` · ${t('order {day} by {time}', { day: t(WEEKDAYS[ing.orderSchedule.weekday]), time: ing.orderSchedule.time })}`
              : ''}
          </span>
        </div>
        <div className="row wrap">
          {ing.dueToday ? <span className="pill warn">{t('Order today')}</span> : null}
          {ing.isMyResponsibility ? <span className="pill blue">{t('You order this')}</span> : null}
          {ing.packPrice != null ? <b>{won(ing.packPrice)} / pack</b> : null}
        </div>
      </div>
      <span className="muted small">
        Responsible: {ing.responsibleEmployees.map((p) => p.name).join(', ') || 'nobody yet'}
      </span>
      <ErrorBox error={err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      <div className="row wrap">
        <button className="btn" onClick={() => setMode(mode === 'order' ? 'none' : 'order')}>
          {t('Ask to order')}
        </button>
        {admin ? (
          <button className="btn ghost" onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')}>
            {t('Edit')}
          </button>
        ) : null}
        {admin ? (
          <button
            className="btn ghost"
            onClick={() => setMode(mode === 'price' ? 'none' : 'price')}
          >
            {t('Change price')}
          </button>
        ) : null}
        {admin ? (
          <button
            className="btn ghost"
            onClick={() => setMode(mode === 'people' ? 'none' : 'people')}
          >
            {t('Responsible')}
          </button>
        ) : null}
        {ing.packPrice != null ? (
          <button
            className="btn ghost"
            onClick={async () => {
              const r = await get<{ items: Price[] }>(`/ingredients/${ing.id}/prices`).catch(
                () => null,
              );
              setHistory(r?.items ?? []);
            }}
          >
            {t('Price history')}
          </button>
        ) : null}
      </div>
      {mode === 'edit' ? (
        <div className="stack">
          <div className="grid2">
            <label className="field">
              {t('Name')}
              <input
                value={f.name}
                maxLength={120}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </label>
            <label className="field">
              {t('Where it is bought')}
              <input
                value={f.source}
                maxLength={200}
                onChange={(e) => setF({ ...f, source: e.target.value })}
              />
            </label>
            <label className="field">
              {t('Pack size')}
              <input
                type="number"
                min={0.001}
                step="any"
                value={f.packQuantity}
                onChange={(e) => setF({ ...f, packQuantity: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              {t('Unit')}
              <select value={f.packUnit} onChange={(e) => setF({ ...f, packUnit: e.target.value })}>
                {['g', 'kg', 'pc', 'L', 'mL'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('Order day')}
              <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
                <option value="">{t('No fixed day')}</option>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {t(d)}
                  </option>
                ))}
              </select>
            </label>
            {f.weekday !== '' ? (
              <label className="field">
                {t('Order by')}
                <input
                  type="time"
                  value={f.time}
                  onChange={(e) => setF({ ...f, time: e.target.value })}
                />
              </label>
            ) : null}
          </div>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            disabled={!f.name.trim() || !f.source.trim() || !(f.packQuantity > 0)}
            onClick={() =>
              run(
                () =>
                  patch(
                    `/ingredients/${ing.id}`,
                    {
                      name: f.name.trim(),
                      source: f.source.trim(),
                      packQuantity: f.packQuantity,
                      packUnit: f.packUnit,
                      orderSchedule:
                        f.weekday === '' ? null : { weekday: Number(f.weekday), time: f.time },
                    },
                    { ifMatch: ing.version },
                  ),
                'Saved.',
              )
            }
          >
            {t('Save')}
          </button>
        </div>
      ) : null}
      {mode === 'order' ? (
        <div className="row wrap">
          <input
            className="input qty"
            type="number"
            min={1}
            value={packs}
            onChange={(e) => setPacks(Math.max(1, Number(e.target.value)))}
            aria-label={t('Packs')}
          />
          <span>packs</span>
          <input
            className="input"
            placeholder={t('Note (optional)')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button
            className="btn"
            onClick={() =>
              run(
                () =>
                  post('/ingredient-orders', {
                    ingredientId: ing.id,
                    quantity: packs,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  }),
                'Sent to the admins.',
              )
            }
          >
            {t('Send')}
          </button>
        </div>
      ) : null}
      {mode === 'price' ? (
        <div className="row wrap">
          <span>₩</span>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            value={price}
            onChange={(e) => setPrice(Math.max(0, Math.round(Number(e.target.value))))}
            aria-label={t('Price per pack in won')}
          />
          <button
            className="btn"
            onClick={() =>
              run(
                () => put(`/ingredients/${ing.id}/price`, { packPrice: price }),
                'New price saved. It applies from now on.',
              )
            }
          >
            {t('Save price')}
          </button>
          <span className="muted small">{t('Past costs keep the old price.')}</span>
        </div>
      ) : null}
      {mode === 'people' ? (
        <div className="stack">
          <div className="row wrap">
            {(members.data?.items ?? [])
              .filter((m) => m.role === 'employee' && m.status === 'active')
              .map((m) => (
                <label key={m.user.id} className="chip">
                  <input
                    type="checkbox"
                    checked={people.has(m.user.id)}
                    onChange={(e) => {
                      const n = new Set(people);
                      if (e.target.checked) n.add(m.user.id);
                      else n.delete(m.user.id);
                      setPeople(n);
                    }}
                  />
                  {m.user.name}
                </label>
              ))}
          </div>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              run(
                () => put(`/ingredients/${ing.id}/responsible`, { employeeIds: [...people] }),
                'Saved.',
              )
            }
          >
            {t('Save')}
          </button>
        </div>
      ) : null}
      {history ? (
        <table className="t">
          <thead>
            <tr>
              <th>{t('From')}</th>
              <th>{t('Price per pack')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.effectiveFrom.slice(0, 10))}</td>
                <td>{won(h.packPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function NewIngredient({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: '',
    source: '',
    packQuantity: 1,
    packUnit: 'kg',
    packPrice: 0,
    weekday: '',
    time: '18:00',
  });
  const [err, setErr] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await post('/ingredients', {
        name: f.name.trim(),
        source: f.source.trim(),
        packQuantity: f.packQuantity,
        packUnit: f.packUnit,
        packPrice: f.packPrice,
        orderSchedule: f.weekday === '' ? null : { weekday: Number(f.weekday), time: f.time },
      });
      setOpen(false);
      onCreated();
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }
  if (!open)
    return (
      <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setOpen(true)}>
        {t('New ingredient')}
      </button>
    );
  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('New ingredient')}</h2>
      <ErrorBox error={err} />
      <div className="grid2">
        <label className="field">
          {t('Name')}
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          {t('Where it is bought')}
          <input
            required
            value={f.source}
            onChange={(e) => setF({ ...f, source: e.target.value })}
          />
        </label>
        <label className="field">
          {t('Pack size')}
          <input
            type="number"
            min={0.001}
            step="any"
            required
            value={f.packQuantity}
            onChange={(e) => setF({ ...f, packQuantity: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          {t('Unit')}
          <select value={f.packUnit} onChange={(e) => setF({ ...f, packUnit: e.target.value })}>
            {['g', 'kg', 'pc', 'L', 'mL'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('Price per pack (won)')}
          <input
            type="number"
            min={0}
            step={1}
            value={f.packPrice}
            onChange={(e) => setF({ ...f, packPrice: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          {t('Order day')}
          <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
            <option value="">{t('No fixed day')}</option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {t(d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn">{t('Add ingredient')}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}
