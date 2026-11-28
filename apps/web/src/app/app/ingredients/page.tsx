'use client';

import { type FormEvent, useState } from 'react';
import { MoreMenu } from '../../../components/menu';
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
  const { admin } = useSession();
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

/**
 * Decided 2026-11-28: one quiet card per ingredient: what it is and its price, then Ask to order,
 * Edit (one form for name, source, pack, order day, price and who orders it) and a ⋯ menu with
 * the price history.
 */
function IngredientCard({
  ing,
  admin,
  onChange,
}: {
  ing: Ingredient;
  admin: boolean;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'order' | 'edit' | 'history'>('none');
  const blank = () => ({
    name: ing.name,
    source: ing.source,
    packQuantity: ing.packQuantity,
    packUnit: ing.packUnit as string,
    weekday: ing.orderSchedule ? String(ing.orderSchedule.weekday) : '',
    time: ing.orderSchedule?.time ?? '18:00',
    price: ing.packPrice != null ? String(ing.packPrice) : '',
    waste: ing.wasteQuantity ? String(ing.wasteQuantity) : '',
  });
  const [f, setF] = useState(blank);
  const [packs, setPacks] = useState(1);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<Price[] | null>(null);
  const members = useApi<{ items: Member[] }>(admin && mode === 'edit' ? '/members' : null);
  const initialPeople = () => new Set(ing.responsibleEmployees.map((p) => p.id));
  const [people, setPeople] = useState<Set<string>>(initialPeople);
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done: string) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg(t(done));
      setMode('none');
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  function open(next: typeof mode) {
    setErr(null);
    setMsg(null);
    if (next === 'edit') {
      setF(blank());
      setPeople(initialPeople());
    }
    setMode(mode === next ? 'none' : next);
  }

  /** Saves only what changed: the details, the price (from now on) and who orders it. */
  async function saveAll() {
    const schedule = f.weekday === '' ? null : { weekday: Number(f.weekday), time: f.time };
    const wasteValue = f.waste.trim() === '' ? 0 : Number(f.waste);
    const was = ing.orderSchedule ?? null;
    const detailsChanged =
      f.name.trim() !== ing.name ||
      f.source.trim() !== ing.source ||
      f.packQuantity !== ing.packQuantity ||
      f.packUnit !== ing.packUnit ||
      wasteValue !== ing.wasteQuantity ||
      JSON.stringify(schedule) !==
        JSON.stringify(was ? { weekday: was.weekday, time: was.time } : null);
    const newPrice = f.price.trim() === '' ? null : Math.max(0, Math.round(Number(f.price)));
    const priceChanged = newPrice !== null && newPrice !== ing.packPrice;
    const before = initialPeople();
    const peopleChanged = before.size !== people.size || [...people].some((id) => !before.has(id));
    await run(
      async () => {
        if (detailsChanged) {
          await patch(
            `/ingredients/${ing.id}`,
            {
              name: f.name.trim(),
              source: f.source.trim(),
              packQuantity: f.packQuantity,
              packUnit: f.packUnit,
              wasteQuantity: wasteValue,
              orderSchedule: schedule,
            },
            { ifMatch: ing.version },
          );
        }
        if (priceChanged) await put(`/ingredients/${ing.id}/price`, { packPrice: newPrice });
        if (peopleChanged) {
          await put(`/ingredients/${ing.id}/responsible`, { employeeIds: [...people] });
        }
      },
      priceChanged ? 'Saved. The new price applies from now on.' : 'Saved.',
    );
  }

  async function showHistory() {
    const r = await get<{ items: Price[] }>(`/ingredients/${ing.id}/prices`).catch(() => null);
    setHistory(r?.items ?? []);
    setMode('history');
  }

  return (
    <section className="card ing-card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2>{ing.name}</h2>
          <span className="muted small">
            {t('{qty} {unit} per pack', { qty: ing.packQuantity, unit: ing.packUnit })}
            {ing.wasteQuantity
              ? ` (${t('{waste} {unit} thrown away, {usable} {unit} usable', {
                  waste: ing.wasteQuantity,
                  usable: ing.usableQuantity,
                  unit: ing.packUnit,
                })})`
              : ''}{' '}
            · {ing.source}
            {ing.orderSchedule
              ? ` · ${t('order {day} by {time}', { day: t(WEEKDAYS[ing.orderSchedule.weekday]), time: ing.orderSchedule.time })}`
              : ''}
          </span>
        </div>
        {ing.packPrice != null ? (
          <b className="ing-price">
            {won(ing.packPrice)}
            <span className="muted small"> / {t('pack')}</span>
          </b>
        ) : null}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {ing.dueToday ? <span className="pill warn">{t('Order today')}</span> : null}
        {ing.isMyResponsibility ? <span className="pill blue">{t('You order this')}</span> : null}
        <span className="muted small">
          {t('Ordered by: {names}', {
            names: ing.responsibleEmployees.map((p) => p.name).join(', ') || t('nobody yet'),
          })}
        </span>
      </div>
      <ErrorBox error={err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      <div className="row ing-actions">
        <button className="btn" onClick={() => open('order')}>
          {t('Ask to order')}
        </button>
        {admin ? (
          <button
            className="btn ghost"
            onClick={() => open('edit')}
            aria-expanded={mode === 'edit'}
          >
            {t('Edit')}
          </button>
        ) : null}
        {ing.packPrice != null ? (
          <MoreMenu
            label={t('More for {name}', { name: ing.name })}
            items={[{ label: t('Price history'), onSelect: () => void showHistory() }]}
          />
        ) : null}
      </div>
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
          <span>{t('packs')}</span>
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
            disabled={busy}
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
      {mode === 'edit' ? (
        <form
          className="stack ing-edit"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void saveAll();
          }}
        >
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
              <span className="row" style={{ gap: 6 }}>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={f.packQuantity}
                  onChange={(e) => setF({ ...f, packQuantity: Number(e.target.value) })}
                  style={{ minWidth: 0 }}
                />
                <select
                  value={f.packUnit}
                  onChange={(e) => setF({ ...f, packUnit: e.target.value })}
                  aria-label={t('Unit')}
                  style={{ width: 'auto' }}
                >
                  {['g', 'kg', 'pc', 'L', 'mL'].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </span>
            </label>
            <WasteField
              value={f.waste}
              unit={f.packUnit}
              pack={f.packQuantity}
              onChange={(waste) => setF({ ...f, waste })}
            />
            <label className="field">
              {t('Price per pack (won)')}
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder={t('Set later')}
                value={f.price}
                onChange={(e) => setF({ ...f, price: e.target.value })}
              />
              <span className="muted small">{t('A new price applies from now on.')}</span>
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
          <div className="field">
            {t('Who orders it')}
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
                    {m.displayName || m.user.name}
                  </label>
                ))}
            </div>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={busy || !f.name.trim() || !f.source.trim() || !(f.packQuantity > 0)}
            >
              {t('Save')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setMode('none')}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {mode === 'history' && history ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between">
            <b>{t('Price history')}</b>
            <button
              type="button"
              className="btn ghost small-btn"
              onClick={() => setMode('none')}
              aria-label={t('Close the list')}
            >
              ✕
            </button>
          </div>
          <table className="t">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h.effectiveFrom.slice(0, 10))}</td>
                  <td style={{ textAlign: 'right' }}>{won(h.packPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    waste: '',
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
        ...(f.waste.trim() ? { wasteQuantity: Number(f.waste) } : {}),
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
        <WasteField
          value={f.waste}
          unit={f.packUnit}
          pack={f.packQuantity}
          onChange={(waste) => setF({ ...f, waste })}
        />
        <label className="field">
          {t('Price per pack (won)')}
          <input
            type="number"
            min={0}
            step={1}
            value={f.packPrice || ''}
            placeholder="0"
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

/**
 * Decided 2026-11-28: how much of one pack is thrown away (peel, trimmings), e.g. 4 kg of a 20 kg
 * sack of potatoes. Product costs use what is left.
 */
function WasteField({
  value,
  unit,
  pack,
  onChange,
}: {
  value: string;
  unit: string;
  pack: number;
  onChange: (v: string) => void;
}) {
  const waste = Number(value) || 0;
  const usable = Math.round((pack - waste) * 1000) / 1000;
  return (
    <label className="field">
      {t('Thrown away per pack ({unit})', { unit })}
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        placeholder={t('e.g. peel, trimmings: 0 if none')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {waste > 0 ? (
        waste >= pack ? (
          <span className="hint-bad">{t('Must be less than the pack.')}</span>
        ) : (
          <span className="muted small">
            {t('{usable} {unit} of each pack can be used; costs use that.', { usable, unit })}
          </span>
        )
      ) : null}
    </label>
  );
}
