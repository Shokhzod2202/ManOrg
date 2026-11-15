'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../../components/ui';
import { type ApiError, formatDate, get, post, type Schemas, today } from '../../../../lib/api';
import { useApi } from '../../../../lib/use-api';

type Org = Schemas['OrganizationSummary'];
type Item = Schemas['CatalogItem'];
type DefaultDate = Schemas['DefaultDeliveryDate'];

/** ORD-2 with the date rules: before 10:00 provider time ask "for today?", after it default to tomorrow. */
export default function NewOrderPage() {
  const router = useRouter();
  const providers = useApi<{ items: Org[] }>('/providers');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Item[] | null>(null);
  const [dd, setDd] = useState<DefaultDate | null>(null);
  const [date, setDate] = useState('');
  const [askToday, setAskToday] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!providerId && providers.data?.items[0]) setProviderId(providers.data.items[0].id);
  }, [providers.data, providerId]);

  useEffect(() => {
    if (!providerId) return;
    setCatalog(null);
    setQty({});
    Promise.all([
      get<{ items: Item[] }>(`/catalog?provider_id=${providerId}`),
      get<DefaultDate>(`/orders/default-date?provider_id=${providerId}`),
    ])
      .then(([c, d]) => {
        setCatalog([...c.items].sort((a, b) => a.name.localeCompare(b.name)));
        setDd(d);
        setDate(d.date);
        setAskToday(d.askIfToday);
      })
      .catch((e: ApiError) => setError(e));
  }, [providerId]);

  const shown = useMemo(
    () => (catalog ?? []).filter((i) => i.name.toLowerCase().includes(q.toLowerCase())),
    [catalog, q],
  );
  const count = Object.values(qty).filter((n) => n > 0).length;
  const units = Object.values(qty).reduce((a, b) => a + (b > 0 ? b : 0), 0);

  async function place() {
    if (!providerId) return;
    setBusy(true);
    setError(null);
    try {
      const lines = Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([productId, quantity]) => ({ productId, quantity }));
      await post('/orders', { providerId, deliveryDate: date, lines });
      router.push('/app');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (providers.loading) return <Loading />;
  if (providers.error) return <ErrorBox error={providers.error} onRetry={providers.reload} />;
  if (!providers.data?.items.length)
    return (
      <div className="page">
        <PageHead title="New order" />
        <Empty>No bakery has approved you yet. Apply from Settings and wait for approval.</Empty>
      </div>
    );

  return (
    <div className="page">
      <PageHead title="New order" />
      <ErrorBox error={error} />
      <div className="card stack">
        {providers.data.items.length > 1 ? (
          <label className="field">
            Bakery
            <select value={providerId ?? ''} onChange={(e) => setProviderId(e.target.value)}>
              {providers.data.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <b>From {providers.data.items[0]?.name}</b>
        )}
        {askToday && dd ? (
          <div className="alert" role="alert" style={{ flexWrap: 'wrap' }}>
            Is this order for today, {formatDate(dd.date)}?
            <button className="btn" onClick={() => setAskToday(false)}>
              Yes, today
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const d = new Date(`${dd.date}T00:00:00Z`);
                d.setUTCDate(d.getUTCDate() + 1);
                setDate(d.toISOString().slice(0, 10));
                setAskToday(false);
              }}
            >
              No, tomorrow
            </button>
          </div>
        ) : null}
        <label className="field">
          Delivery date
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <input
        className="input"
        placeholder="Search products"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search products"
      />
      {!catalog ? (
        <Loading />
      ) : !catalog.length ? (
        <Empty>This bakery has no products to order yet.</Empty>
      ) : (
        <div className="card" style={{ padding: 8 }}>
          {shown.map((i) => (
            <div
              key={i.id}
              className="row between"
              style={{ padding: '6px 8px', borderBottom: '1px solid #f1f3f8' }}
            >
              <span className="row">
                <img className="thumb" src={i.imageUrl} alt="" />
                {i.name}
              </span>
              <input
                className="input qty"
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={`${i.name} quantity`}
                value={qty[i.id] ?? ''}
                onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Number(e.target.value)) })}
              />
            </div>
          ))}
        </div>
      )}
      <button className="btn big" disabled={busy || !count || !date || askToday} onClick={place}>
        {count
          ? `Place order: ${count} products, ${units} items, ${date ? formatDate(date) : ''}`
          : 'Add quantities to order'}
      </button>
    </div>
  );
}
