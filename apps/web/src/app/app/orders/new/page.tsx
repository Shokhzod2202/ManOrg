'use client';

import { SortPicker, sortProducts, useProductSort } from '../../../../lib/product-sort';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../../components/ui';
import { type ApiError, formatDate, get, post, type Schemas, today } from '../../../../lib/api';
import { useApi } from '../../../../lib/use-api';
import { t } from '../../../../lib/i18n';

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

  const [productSort] = useProductSort();
  // Decided 2026-11-30: the bakery's custom order, A to Z, or by type (the person's choice).
  const shown = useMemo(
    () =>
      sortProducts(
        (catalog ?? []).filter((i) => i.name.toLowerCase().includes(q.toLowerCase())),
        productSort,
        (i) => ({ name: i.name, sortOrder: i.sortOrder, typeName: i.type?.name ?? null }),
      ),
    [catalog, q, productSort],
  );
  const count = Object.values(qty).filter((n) => n > 0).length;
  const units = Object.values(qty).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  // F-001: an estimate; the bill uses what is actually delivered.
  const estimate = (catalog ?? []).reduce(
    (sum, i) => sum + (qty[i.id] ?? 0) * (i.unitPrice ?? 0),
    0,
  );

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
        <PageHead title={t('New order')} />
        <Empty>
          {t('No bakery has approved you yet. Apply from Settings and wait for approval.')}
        </Empty>
      </div>
    );

  return (
    <div className="page">
      <PageHead title={t('New order')} />
      <ErrorBox error={error} />
      <div className="card stack">
        {providers.data.items.length > 1 ? (
          <label className="field">
            {t('Bakery')}
            <select value={providerId ?? ''} onChange={(e) => setProviderId(e.target.value)}>
              {providers.data.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <b>{t('From {name}', { name: providers.data.items[0]?.name ?? '' })}</b>
        )}
        {askToday && dd ? (
          <div className="alert" role="alert" style={{ flexWrap: 'wrap' }}>
            {t('Is this order for today, {date}?', { date: formatDate(dd.date) })}
            <button className="btn" onClick={() => setAskToday(false)}>
              {t('Yes, today')}
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
              {t('No, tomorrow')}
            </button>
          </div>
        ) : null}
        <label className="field">
          {t('Delivery date')}
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <SortPicker />
      <input
        className="input"
        placeholder={t('Search products')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('Search products')}
      />
      {!catalog ? (
        <Loading />
      ) : !catalog.length ? (
        <Empty>{t('This bakery has no products to order yet.')}</Empty>
      ) : (
        <div className="card" style={{ padding: 8 }}>
          {shown.map((i, n) => (
            <Fragment key={i.id}>
              {productSort === 'type' && (n === 0 || shown[n - 1]!.type?.name !== i.type?.name) ? (
                <div className="type-heading">{i.type?.name ?? t('Other')}</div>
              ) : null}
              <div
                key={i.id}
                className="row between"
                style={{ padding: '6px 8px', borderBottom: '1px solid #f1f3f8' }}
              >
                <span className="row">
                  <img className="thumb" src={i.imageUrl} alt="" />
                  <span>
                    {i.name}
                    {i.unitPrice !== null ? (
                      <span className="muted small"> · ₩{i.unitPrice.toLocaleString('en-US')}</span>
                    ) : null}
                  </span>
                </span>
                <input
                  className="input qty"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={t('{name} quantity', { name: i.name })}
                  value={qty[i.id] ?? ''}
                  onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Number(e.target.value)) })}
                />
              </div>
            </Fragment>
          ))}
        </div>
      )}
      {estimate > 0 ? (
        <p className="muted center small" style={{ margin: 0 }}>
          {t('About ₩{amount}. You pay for what is delivered.', {
            amount: estimate.toLocaleString('en-US'),
          })}
        </p>
      ) : null}
      <button className="btn big" disabled={busy || !count || !date || askToday} onClick={place}>
        {count
          ? t('Place order: {count} products, {units} items, {date}', {
              count,
              units,
              date: date ? formatDate(date) : '',
            })
          : t('Add quantities to order')}
      </button>
    </div>
  );
}
