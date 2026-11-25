'use client';

import { sortProducts, useProductSort } from '../../../lib/product-sort';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Flag, Loading, PageHead } from '../../../components/ui';
import {
  type ApiError,
  del,
  formatMinutes,
  patch,
  post,
  put,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { flagText, t } from '../../../lib/i18n';

type Product = Schemas['Product'];
type Team = Schemas['Team'];
type History = Schemas['OutputHistory'];
type ShiftOutput = Schemas['ShiftOutputDashboard'];

export default function OutputPage() {
  const { actor } = useSession();
  return actor === 'org_admin' ? <AdminOutput /> : <MyOutput />;
}

/** OUT-1 to OUT-4: personal lines, or team lines counted once and shared equally. */
function MyOutput() {
  const { me } = useSession();
  const [date, setDate] = useState(today());
  const products = useApi<{ items: Product[] }>(me ? `/employees/${me.id}/products` : null);
  const [productSort] = useProductSort();
  const teams = useApi<{ items: Team[] }>('/teams');
  const history = useApi<History>(`/output?from=${date}&to=${date}`);
  const [mode, setMode] = useState<string>('personal');
  const [qty, setQty] = useState<Record<string, Record<string, number>>>({});
  const [cleaning, setCleaning] = useState(0);
  const [err, setErr] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const day = history.data?.days.find((d) => d.date === date);
    const next: Record<string, Record<string, number>> = { personal: {} };
    day?.personal.forEach(
      (l) => ((next.personal as Record<string, number>)[l.productId] = l.quantity),
    );
    day?.team.forEach((l) => {
      next[l.team.id] ??= {};
      (next[l.team.id] as Record<string, number>)[l.productId] = l.quantity;
    });
    setQty(next);
    setCleaning(day?.cleaningHours ?? 0);
  }, [history.data, date]);

  async function save() {
    setErr(null);
    setSaved(false);
    try {
      const lines = Object.entries(qty).flatMap(([key, m]) =>
        Object.entries(m)
          .filter(([, q]) => q > 0)
          .map(([productId, quantity]) => ({
            productId,
            quantity,
            teamId: key === 'personal' ? null : key,
          })),
      );
      await put(`/output/${date}`, { lines, cleaningHours: cleaning });
      setSaved(true);
      history.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const day = history.data?.days.find((d) => d.date === date);
  // Decided 2026-11-30: in the person's chosen product sort.
  const list = sortProducts(products.data?.items ?? [], productSort, (p) => ({
    name: p.name,
    sortOrder: p.sortOrder,
    typeName: p.type?.name ?? null,
  }));
  const current = qty[mode] ?? {};

  return (
    <div className="page">
      <PageHead title={t('Output')}>
        <input
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Date')}
        />
      </PageHead>
      <ErrorBox error={products.error ?? history.error ?? err} />
      {day ? (
        <div className="kpis">
          <div className="kpi">
            <b>{Math.round(day.creditedQuantity * 10) / 10}</b>
            <span>{t('Items credited')}</span>
          </div>
          <div className="kpi">
            <b>{formatMinutes(Math.round(day.expectedMinutes))}</b>
            <span>{t('Expected time')}</span>
          </div>
          <div className="kpi">
            <b>{t('{n} h', { n: day.cleaningHours })}</b>
            <span>{t('Cleaning')}</span>
          </div>
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label={t('Log for')}>
        <button
          role="tab"
          aria-selected={mode === 'personal'}
          className={mode === 'personal' ? 'on' : ''}
          onClick={() => setMode('personal')}
        >
          {t('Just me')}
        </button>
        {teams.data?.items.map((tm) => (
          <button
            key={tm.id}
            role="tab"
            aria-selected={mode === tm.id}
            className={mode === tm.id ? 'on' : ''}
            onClick={() => setMode(tm.id)}
          >
            {t('Team {name}', { name: tm.name })}
          </button>
        ))}
      </div>
      {mode !== 'personal' ? (
        <p className="muted center small">
          {t('Team numbers are counted once and shared equally: {names}.', {
            names:
              teams.data?.items
                .find((tm) => tm.id === mode)
                ?.members.map((m) => m.name)
                .join(', ') ?? '',
          })}
        </p>
      ) : null}
      {products.loading ? <Loading /> : null}
      {products.data && !list.length ? (
        <Empty>{t('No products are assigned to you yet. Ask your admin.')}</Empty>
      ) : null}
      {list.length ? (
        <div className="card" style={{ padding: 8 }}>
          {list.map((p) => (
            <div
              key={p.id}
              className="row between"
              style={{ padding: '6px 8px', borderBottom: '1px solid #f1f3f8' }}
            >
              <span className="row">
                <img className="thumb" src={p.imageUrl} alt="" />
                {p.name}
              </span>
              <input
                className="input qty"
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={t('{name} made', { name: p.name })}
                value={current[p.id] ?? ''}
                onChange={(e) =>
                  setQty({
                    ...qty,
                    [mode]: { ...current, [p.id]: Math.max(0, Number(e.target.value)) },
                  })
                }
              />
            </div>
          ))}
          <div className="row between" style={{ padding: '10px 8px' }}>
            <span>{t('Cleaning hours')}</span>
            <input
              className="input qty"
              type="number"
              min={0}
              max={24}
              step={0.25}
              value={cleaning}
              onChange={(e) => setCleaning(Number(e.target.value))}
              aria-label={t('Cleaning hours')}
            />
          </div>
        </div>
      ) : null}
      <MyTeams onChange={teams.reload} />
      <button className="btn big" onClick={save} disabled={!list.length}>
        {t('Save output')}
      </button>
      {saved ? (
        <span className="pill ok" style={{ alignSelf: 'center' }}>
          {t('Saved')}
        </span>
      ) : null}
    </div>
  );
}

/** DSH-3: who made what today, with hours and flags. */
function AdminOutput() {
  const [date, setDate] = useState(today());
  const { data, error, loading, reload } = useApi<ShiftOutput>(
    `/dashboard/shift-output?date=${date}`,
    60_000,
  );
  return (
    <div className="page wide">
      <PageHead title={t('Output')}>
        <input
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Date')}
        />
      </PageHead>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data ? (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <section className="card">
            <h2>{t('By employee')}</h2>
            {!data.employees.length ? <Empty>{t('No one worked on this day.')}</Empty> : null}
            <table className="t cards">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Worked')}</th>
                  <th>{t('Items')}</th>
                  <th>{t('Expected')}</th>
                  <th>{t('Cleaning')}</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.employee.id}>
                    <td data-label={t('Name')}>
                      <b>{e.employee.name}</b>
                      {e.employee.title ? (
                        <span className="muted small"> · {e.employee.title}</span>
                      ) : null}
                      {e.removedOn ? (
                        <span className="pill warn" style={{ marginLeft: 6 }}>
                          {t('Removed')}
                        </span>
                      ) : null}
                      {e.flags.map((f) => (
                        <div key={f.code}>
                          <Flag>{flagText(f)}</Flag>
                        </div>
                      ))}
                    </td>
                    <td data-label={t('Worked')}>{formatMinutes(e.workedMinutes)}</td>
                    <td data-label={t('Items')}>
                      {Math.round(e.output.creditedQuantity * 10) / 10}
                    </td>
                    <td data-label={t('Expected')}>
                      {formatMinutes(Math.round(e.output.expectedMinutes))}
                    </td>
                    <td data-label={t('Cleaning')}>{t('{n} h', { n: e.output.cleaningHours })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>{t('Products made')}</h2>
            {!data.totals.length ? <Empty>{t('Nothing logged.')}</Empty> : null}
            <table className="t">
              <tbody>
                {[...data.totals]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((tm) => (
                    <tr key={tm.productId}>
                      <td>{tm.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        <b>{tm.quantity}</b>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** OUT-4, OUT-5: an employee's own saved teams (admins' shared teams appear too, read-only). */
function MyTeams({ onChange }: { onChange: () => void }) {
  const { me } = useSession();
  const teams = useApi<{ items: Team[] }>('/teams');
  const people = useApi<{ items: { id: string; name: string }[] }>('/colleagues');
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<ApiError | null>(null);

  function start(tm: Team | 'new') {
    setEditing(tm);
    setName(tm === 'new' ? '' : tm.name);
    setChosen(
      new Set(tm === 'new' ? [] : tm.members.map((m) => m.id).filter((id) => id !== me?.id)),
    );
  }
  async function save() {
    setErr(null);
    try {
      const memberIds = [...chosen];
      if (editing === 'new') await post('/teams', { name: name.trim(), memberIds });
      else if (editing)
        await patch(
          `/teams/${editing.id}`,
          { name: name.trim(), memberIds },
          { ifMatch: editing.version },
        );
      setEditing(null);
      teams.reload();
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  async function remove(tm: Team) {
    if (!window.confirm(t('Delete team {name}? Output already logged stays.', { name: tm.name })))
      return;
    try {
      await del(`/teams/${tm.id}`, { ifMatch: tm.version });
      teams.reload();
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  const others = (people.data?.items ?? []).filter((p) => p.id !== me?.id);

  return (
    <section className="card">
      <div className="row between">
        <h2>{t('My teams')}</h2>
        <button className="btn ghost" onClick={() => start('new')}>
          {t('New team')}
        </button>
      </div>
      <ErrorBox error={teams.error ?? err} />
      {teams.data && !teams.data.items.length && !editing ? (
        <Empty>
          {t('Make a team for people you often work with, then log output for it above.')}
        </Empty>
      ) : null}
      {teams.data?.items.map((tm) => (
        <div key={tm.id} className="row between wrap">
          <span>
            <b>{tm.name}</b>{' '}
            {tm.shared ? <span className="pill blue">{t('From admin')}</span> : null}
            <br />
            <span className="muted small">
              {tm.members
                .map((m) => (m.removed ? t('{name} (removed)', { name: m.name }) : m.name))
                .join(', ')}
            </span>
          </span>
          {!tm.shared ? (
            <span className="row">
              <button className="btn ghost" onClick={() => start(tm)}>
                {t('Edit')}
              </button>
              <button className="btn ghost" onClick={() => remove(tm)}>
                {t('Delete')}
              </button>
            </span>
          ) : null}
        </div>
      ))}
      {editing ? (
        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <label className="field">
            {t('Team name')}
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <span className="muted small">
            {t('You are in the team. Choose who works with you:')}
          </span>
          <div className="row wrap">
            {others.map((p) => (
              <label key={p.id} className="chip">
                <input
                  type="checkbox"
                  checked={chosen.has(p.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(p.id);
                    else n.delete(p.id);
                    setChosen(n);
                  }}
                />
                {p.name}
              </label>
            ))}
            {/* Removed from the organization: shown so the admin can take them off (2026-11-28). */}
            {(editing && editing !== 'new' && people.data
              ? editing.members.filter(
                  (x) =>
                    x.removed || !new Set((people.data?.items ?? []).map((p) => p.id)).has(x.id),
                )
              : []
            )
              .filter((x) => x.id !== me?.id)
              .map((x) => (
                <label key={x.id} className="chip removed">
                  <input
                    type="checkbox"
                    checked={chosen.has(x.id)}
                    onChange={(e) => {
                      const n = new Set(chosen);
                      if (e.target.checked) n.add(x.id);
                      else n.delete(x.id);
                      setChosen(n);
                    }}
                  />
                  {t('{name} (removed)', { name: x.name })}
                </label>
              ))}
          </div>
          <div className="row">
            <button className="btn" disabled={!name.trim() || !chosen.size} onClick={save}>
              {t('Save team')}
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
