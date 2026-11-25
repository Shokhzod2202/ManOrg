'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { api, type ApiError, get, patch, post, put, type Schemas } from '../../../lib/api';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Product = Schemas['Product'];
type Member = Schemas['Member'];

/** PRD-1 to PRD-3: products A to Z, no categories (decision 2026-11-14). */
export default function ProductsPage() {
  const { data, error, loading, reload } = useApi<{ items: Product[] }>('/products');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const items = [...(data?.items ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  async function toggle(p: Product) {
    setErr(null);
    try {
      await patch(`/products/${p.id}`, { available: !p.available }, { ifMatch: p.version });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <div className="page">
      <PageHead title={t('Products')} sub={data ? `${data.items.length} products` : undefined} />
      {editing ? (
        <ProductForm
          key={editing.id}
          product={editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : (
        <ProductForm onDone={reload} />
      )}
      <input
        className="input"
        placeholder={t('Search products')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('Search products')}
      />
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>{t('No products yet. Add the first one above.')}</Empty>
      ) : null}
      {items.length ? (
        <table className="t cards">
          <thead>
            <tr>
              <th />
              <th>{t('Name')}</th>
              <th>{t('Price')}</th>
              <th>{t('Minutes per 10')}</th>
              <th>{t('Ingredients')}</th>
              <th>{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td data-label="">
                  <img className="thumb" src={p.imageUrl} alt="" />
                </td>
                <td data-label={t('Name')}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setEditing(p);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label={`Edit ${p.name}`}
                  >
                    {p.name}
                  </button>
                </td>
                <td data-label={t('Price')}>
                  <PriceCell product={p} onSaved={reload} />
                </td>
                <td data-label={t('Minutes per 10')}>{p.minutesPer10}</td>
                <td data-label={t('Ingredients')} className="small">
                  {p.ingredients.map((i) => i.name).join(', ') || '—'}
                </td>
                <td data-label={t('Status')}>
                  <button className={p.available ? 'btn ghost' : 'btn'} onClick={() => toggle(p)}>
                    {p.available ? t('Available') : t('Hidden')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <AssignProducts products={data?.items ?? []} />
    </div>
  );
}

/** PRD-1, PRD-2: add a product, or edit one; edits are audited on the server. */
function ProductForm({ product, onDone }: { product?: Product; onDone: () => void }) {
  const [open, setOpen] = useState(Boolean(product));
  const [name, setName] = useState(product?.name ?? '');
  const [minutes, setMinutes] = useState(product?.minutesPer10 ?? 30);
  const [file, setFile] = useState<File | null>(null);
  const [price, setPrice] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const ingredients = useApi<{ items: { id: string; name: string }[] }>(
    open ? '/ingredients' : null,
  );
  const [uses, setUses] = useState<Set<string>>(
    new Set(product?.ingredients.map((i) => i.id) ?? []),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      let imageKey: string | undefined;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        imageKey = (await api<{ imageKey: string }>('POST', '/product-images', { form })).imageKey;
      }
      const body = {
        name: name.trim(),
        minutesPer10: minutes,
        ingredients: [...uses].map((ingredientId) => {
          const kept = product?.ingredients.find((i) => i.id === ingredientId);
          return kept?.quantityPer10
            ? { ingredientId, quantityPer10: kept.quantityPer10 }
            : { ingredientId };
        }),
        ...(imageKey ? { imageKey } : {}),
      };
      if (product) await patch(`/products/${product.id}`, body, { ifMatch: product.version });
      else
        await post('/products', {
          ...body,
          ...(price.trim() ? { unitPrice: Math.round(Number(price)) } : {}),
        });
      setName('');
      setPrice('');
      setFile(null);
      setUses(new Set());
      setOpen(false);
      onDone();
    } catch (e2) {
      setErr(e2 as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setOpen(true)}>
        {t('New product')}
      </button>
    );
  return (
    <form className="card" onSubmit={submit}>
      <h2>{product ? t('Edit {name}', { name: product.name }) : t('New product')}</h2>
      <ErrorBox error={err} />
      <div className="grid2">
        <label className="field">
          {t('Name')}
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('Minutes to make 10')}
          <input
            type="number"
            required
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        {product ? null : (
          <label className="field">
            {t('Price per piece (won, optional)')}
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder={t('Set later')}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="field">
        {t('Ingredients (optional, can be added later)')}
        <div className="row wrap">
          {ingredients.data?.items.map((i) => (
            <label key={i.id} className="chip">
              <input
                type="checkbox"
                checked={uses.has(i.id)}
                onChange={(e) => {
                  const n = new Set(uses);
                  if (e.target.checked) n.add(i.id);
                  else n.delete(i.id);
                  setUses(n);
                }}
              />
              {i.name}
            </label>
          ))}
          {ingredients.data && !ingredients.data.items.length ? (
            <span className="muted small">{t('Add ingredients first.')}</span>
          ) : null}
        </div>
      </div>
      <label className="field">
        {product ? t('New picture (optional)') : t('Picture (optional, JPEG or PNG)')}
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="row">
        <button className="btn" disabled={busy || !name.trim()}>
          {product ? t('Save') : t('Add product')}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setOpen(false);
            if (product) onDone();
          }}
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

/** PRD-3: which products appear on an employee's output form. */
function AssignProducts({ products }: { products: Product[] }) {
  const members = useApi<{ items: Member[] }>('/members');
  const [who, setWho] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!who) return;
    get<{ items: Product[] }>(`/employees/${who}/products`)
      .then((r) => setChosen(new Set(r.items.map((p) => p.id))))
      .catch((e: ApiError) => setErr(e));
  }, [who]);

  async function save() {
    setErr(null);
    setMsg(null);
    try {
      await put(`/employees/${who}/products`, { productIds: [...chosen] });
      setMsg('Saved.');
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const employees = (members.data?.items ?? []).filter(
    (m) => m.role === 'employee' && m.status === 'active',
  );
  if (!products.length) return null;
  return (
    <section className="card">
      <h2>{t('Products each employee logs')}</h2>
      <ErrorBox error={err} />
      <select
        className="input"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label={t('Employee')}
      >
        <option value="">{t('Choose an employee')}</option>
        {employees.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            {m.displayName || m.user.name}
          </option>
        ))}
      </select>
      {who ? (
        <>
          <div className="row wrap">
            {[...products]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
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
          </div>
          <div className="row">
            <button className="btn" onClick={save}>
              {t('Save')}
            </button>
            {msg ? <span className="pill ok">{msg}</span> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** F-001 FIN-1: price per unit in whole won; a new price applies from now on. */
function PriceCell({ product, onSaved }: { product: Product; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(product.unitPrice ?? 0);
  const [err, setErr] = useState<ApiError | null>(null);
  async function save() {
    setErr(null);
    try {
      await put(`/products/${product.id}/price`, { unitPrice: Math.round(value) });
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="btn ghost"
        onClick={() => setEditing(true)}
        aria-label={`Price of ${product.name}`}
        style={
          product.unitPrice === null
            ? { color: 'var(--flag)', borderColor: 'var(--flag)' }
            : undefined
        }
      >
        {product.unitPrice == null
          ? t('Set price')
          : `₩${product.unitPrice.toLocaleString('en-US')}`}
      </button>
    );
  }
  return (
    <span className="row wrap">
      <input
        className="input qty"
        style={{ width: 110 }}
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        aria-label={`New price of ${product.name} in won`}
      />
      <button type="button" className="btn" onClick={save}>
        {t('Save')}
      </button>
      <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
        {t('Cancel')}
      </button>
      {err ? <span className="err small">{t(err.message)}</span> : null}
    </span>
  );
}
