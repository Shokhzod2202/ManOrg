'use client';

import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { api, type ApiError, get, patch, post, put, type Schemas } from '../../../lib/api';
import { groupByType, SortPicker, sortProducts, useProductSort } from '../../../lib/product-sort';
import { refreshApi, useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Product = Schemas['Product'];
type Member = Schemas['Member'];

type ProductType = Schemas['ProductType'];
const sortKey = (p: Product) => ({
  name: p.name,
  sortOrder: p.sortOrder,
  typeName: p.type?.name ?? null,
});

/**
 * PRD-1 to PRD-3. Decided 2026-11-30: products have types, and three sorts (custom, A to Z, by
 * type). In the custom order the admin drags products into place, with a finger or a mouse.
 */
export default function ProductsPage() {
  const { data, error, loading, reload } = useApi<{ items: Product[] }>('/products');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [mode] = useProductSort();
  // While dragging or saving, the order on screen comes from here.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const canDrag = mode === 'custom' && !q.trim();

  const sorted = sortProducts(data?.items ?? [], mode, sortKey);
  const byId = new Map(sorted.map((p) => [p.id, p]));
  const ordered = draft ? draft.map((id) => byId.get(id)).filter((p): p is Product => !!p) : sorted;
  const items = ordered.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  async function toggle(p: Product) {
    setErr(null);
    try {
      await patch(`/products/${p.id}`, { available: !p.available }, { ifMatch: p.version });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  async function saveOrder(ids: string[]) {
    setErr(null);
    setDraft(ids);
    try {
      await put('/products/order', { productIds: ids });
      await reload();
      refreshApi('/catalog', '/orders', '/employees');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setDraft(null);
    }
  }

  function move(id: string, by: number) {
    const ids = items.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void saveOrder(ids);
  }

  // Drag with pointer events, so it works with a finger in the phone and Telegram apps too. The
  // window follows the pointer: the dragged row moves in the page, which would lose a capture.
  const drag = useRef<{ id: string; order: string[] } | null>(null);
  function dragStart(e: ReactPointerEvent, id: string) {
    e.preventDefault();
    drag.current = { id, order: items.map((p) => p.id) };
    startOrder.current = drag.current.order;
    setDragId(id);
    setDraft(drag.current.order);
  }
  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const others = d.order.filter((x) => x !== d.id);
      let at = 0;
      for (const id of others) {
        const r = rows.current.get(id)?.getBoundingClientRect();
        if (r && e.clientY > r.top + r.height / 2) at += 1;
      }
      const next = [...others];
      next.splice(at, 0, d.id);
      if (next.join() !== d.order.join()) {
        d.order = next;
        setDraft(next);
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      setDragId(null);
      if (!d) return;
      // Only save when the order really changed.
      if (d.order.join() !== startOrder.current.join()) void saveOrder(d.order);
      else setDraft(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // The handlers read the drag from refs; they only need re-binding when a drag starts.
  }, [dragId]);
  const startOrder = useRef<string[]>([]);

  const groups =
    mode === 'type' && !draft
      ? groupByType(items, sortKey)
      : [{ type: undefined as string | null | undefined, items }];

  return (
    <div className="page">
      <PageHead title={t('Products')} sub={data ? `${data.items.length} products` : undefined}>
        <SortPicker />
      </PageHead>
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
      {canDrag && items.length > 1 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {t(
            'Drag ⠿ (or use the arrows) to set the order. Everyone who chooses Custom order sees products in this order.',
          )}
        </p>
      ) : null}
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>{t('No products yet. Add the first one above.')}</Empty>
      ) : null}
      {items.length ? (
        <table className="t cards products">
          <thead>
            <tr>
              {canDrag ? <th /> : null}
              <th />
              <th>{t('Name')}</th>
              <th>{t('Type')}</th>
              <th>{t('Price')}</th>
              <th>{t('Minutes per 10')}</th>
              <th>{t('Ingredients')}</th>
              <th>{t('Status')}</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.type ?? 'all'}>
              {g.type !== undefined ? (
                <tr className="group">
                  <th colSpan={8}>{g.type ?? t('No type')}</th>
                </tr>
              ) : null}
              {g.items.map((p, i) => (
                <tr
                  key={p.id}
                  ref={(el) => {
                    if (el) rows.current.set(p.id, el);
                    else rows.current.delete(p.id);
                  }}
                  className={dragId === p.id ? 'dragging' : undefined}
                >
                  {canDrag ? (
                    <td data-label="" className="order-cell">
                      <span className="row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className="drag-handle"
                          aria-label={t('Drag {name} to a new place', { name: p.name })}
                          onPointerDown={(e) => dragStart(e, p.id)}
                        >
                          ⠿
                        </button>
                        <button
                          type="button"
                          className="btn ghost small-btn"
                          disabled={i === 0 || draft !== null}
                          aria-label={t('Move {name} up', { name: p.name })}
                          onClick={() => move(p.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn ghost small-btn"
                          disabled={i === g.items.length - 1 || draft !== null}
                          aria-label={t('Move {name} down', { name: p.name })}
                          onClick={() => move(p.id, 1)}
                        >
                          ↓
                        </button>
                      </span>
                    </td>
                  ) : null}
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
                      aria-label={t('Edit {name}', { name: p.name })}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td data-label={t('Type')} className="small">
                    {p.type?.name ?? '—'}
                  </td>
                  <td data-label={t('Price')}>
                    <PriceCell product={p} onSaved={reload} />
                  </td>
                  <td data-label={t('Minutes per 10')}>{p.minutesPer10}</td>
                  <td data-label={t('Ingredients')} className="small">
                    {p.ingredients.map((x) => x.name).join(', ') || '—'}
                  </td>
                  <td data-label={t('Status')}>
                    <button className={p.available ? 'btn ghost' : 'btn'} onClick={() => toggle(p)}>
                      {p.available ? t('Available') : t('Hidden')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      ) : null}
      <AssignProducts products={data?.items ?? []} />
    </div>
  );
}

/**
 * Decided 2026-11-30: the product's type. "+ New type…" makes a new one on the spot (e.g. Meal for
 * osh and moshkichir, Bakery for bread and somsa).
 */
function TypePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const types = useApi<{ items: ProductType[] }>('/product-types');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);

  async function add() {
    if (!name.trim()) return;
    setErr(null);
    try {
      const created = await post<ProductType>('/product-types', { name: name.trim() });
      await types.reload();
      onChange(created.id);
      setAdding(false);
      setName('');
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <div className="field">
      {t('Type')}
      {adding ? (
        <span className="row" style={{ gap: 6 }}>
          <input
            className="input"
            autoFocus
            maxLength={60}
            placeholder={t('e.g. Meal, Bakery')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            aria-label={t('New type name')}
          />
          <button type="button" className="btn" onClick={() => void add()}>
            {t('Add')}
          </button>
          <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
            {t('Cancel')}
          </button>
        </span>
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__new') setAdding(true);
            else onChange(e.target.value);
          }}
        >
          <option value="">{t('No type')}</option>
          {types.data?.items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
          <option value="__new">{t('+ New type…')}</option>
        </select>
      )}
      <ErrorBox error={err} />
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
  const [typeId, setTypeId] = useState(product?.type?.id ?? '');
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
        typeId: typeId || null,
      };
      if (product) await patch(`/products/${product.id}`, body, { ifMatch: product.version });
      else
        await post('/products', {
          ...body,
          ...(price.trim() ? { unitPrice: Math.round(Number(price)) } : {}),
        });
      setName('');
      setPrice('');
      setTypeId('');
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
      <TypePicker value={typeId} onChange={setTypeId} />
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
