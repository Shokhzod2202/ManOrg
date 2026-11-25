'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { won } from '../../../components/orders/value';
import { Empty, ErrorBox, Icon, Loading, PageHead } from '../../../components/ui';
import { api, type ApiError, get, patch, post, put, type Schemas } from '../../../lib/api';
import { groupByType, SortPicker, sortProducts, useProductSort } from '../../../lib/product-sort';
import { refreshApi, useApi } from '../../../lib/use-api';
import { useDragOrder } from '../../../lib/use-drag-order';
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
  const rows = useRef(new Map<string, HTMLElement>());
  const canDrag = mode === 'custom' && !q.trim();
  // Decided 2026-12-01: hold a row (or the ⠿ handle) and drag it; works in Telegram too. While
  // dragging or saving, the order on screen comes from `draft`.
  const { draft, setDraft, dragId, handleProps, rowProps } = useDragOrder({
    ids: () => items.map((p) => p.id),
    enabled: canDrag,
    rows,
    onDrop: (order) => saveOrder(order),
  });

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
    try {
      await put('/products/order', { productIds: ids });
      await reload();
      refreshApi('/catalog', '/orders', '/employees');
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  function move(id: string, by: number) {
    const ids = items.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setDraft(ids);
    void saveOrder(ids).finally(() => setDraft(null));
  }

  const groups =
    mode === 'type' && !draft
      ? groupByType(items, sortKey)
      : [{ type: undefined as string | null | undefined, items }];

  return (
    <div className="page">
      <PageHead title={t('Products')} sub={data ? `${data.items.length} products` : undefined}>
        <SortPicker />
      </PageHead>
      <ProductForm onDone={reload} />
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
            'Hold a product (or drag ⠿) to move it. Everyone who chooses Custom order sees products in this order.',
          )}
        </p>
      ) : null}
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>{t('No products yet. Add the first one above.')}</Empty>
      ) : null}
      {items.length ? (
        <div className={canDrag ? 'plist can-drag' : 'plist'}>
          {groups.map((g) => (
            <div key={g.type ?? 'all'} className="plist-group">
              {g.type !== undefined ? (
                <h3 className="plist-type">{g.type ?? t('No type')}</h3>
              ) : null}
              {g.items.map((p, i) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  rowRef={(el) => {
                    if (el) rows.current.set(p.id, el);
                    else rows.current.delete(p.id);
                  }}
                  dragging={dragId === p.id}
                  canDrag={canDrag}
                  handle={handleProps(p.id)}
                  row={rowProps(p.id)}
                  canMoveUp={canDrag && i > 0 && draft === null}
                  canMoveDown={canDrag && i < g.items.length - 1 && draft === null}
                  onMove={(by) => move(p.id, by)}
                  editing={editing?.id === p.id}
                  onEdit={() => setEditing(editing?.id === p.id ? null : p)}
                  onEdited={() => {
                    setEditing(null);
                    reload();
                  }}
                  onToggle={() => void toggle(p)}
                />
              ))}
            </div>
          ))}
        </div>
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

type PackUnit = Schemas['PackUnit'];
type IngredientItem = { id: string; name: string; packUnit: PackUnit };
/** Decided 2026-12-01: an amount may use any unit of the same kind as the pack unit. */
const KIND: Record<PackUnit, PackUnit[]> = {
  g: ['g', 'kg'],
  kg: ['g', 'kg'],
  mL: ['mL', 'L'],
  L: ['mL', 'L'],
  pc: ['pc'],
};
type Amount = { quantity: string; unit: PackUnit };

/**
 * PRD-1, PRD-2: add a product, or edit one; edits are audited on the server. Decided 2026-12-01:
 * the price, how many pieces one batch makes, and how much of each ingredient one batch needs.
 */
function ProductForm({ product, onDone }: { product?: Product; onDone: () => void }) {
  const [open, setOpen] = useState(Boolean(product));
  const [name, setName] = useState(product?.name ?? '');
  const [minutes, setMinutes] = useState(product?.minutesPer10 ?? 30);
  const [file, setFile] = useState<File | null>(null);
  const [price, setPrice] = useState(product?.unitPrice != null ? String(product.unitPrice) : '');
  const [batchYield, setBatchYield] = useState(
    product?.batchYield != null ? String(product.batchYield) : '',
  );
  const [typeId, setTypeId] = useState(product?.type?.id ?? '');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const ingredients = useApi<{ items: IngredientItem[] }>(open ? '/ingredients' : null);
  const [uses, setUses] = useState<Set<string>>(
    new Set(product?.ingredients.map((i) => i.id) ?? []),
  );
  const [amounts, setAmounts] = useState<Record<string, Amount>>(
    Object.fromEntries(
      (product?.ingredients ?? []).map((i) => [
        i.id,
        { quantity: i.quantity != null ? String(i.quantity) : '', unit: i.unit ?? i.packUnit },
      ]),
    ),
  );
  const known = new Map((ingredients.data?.items ?? []).map((i) => [i.id, i]));
  const chosen = [...uses].map(
    (id) =>
      known.get(id) ??
      ((x) => (x ? { id: x.id, name: x.name, packUnit: x.packUnit } : undefined))(
        product?.ingredients.find((i) => i.id === id),
      ),
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
        batchYield: batchYield.trim() ? Math.round(Number(batchYield)) : null,
        ingredients: [...uses].map((ingredientId) => {
          const a = amounts[ingredientId];
          return a?.quantity.trim()
            ? { ingredientId, quantity: Number(a.quantity), unit: a.unit }
            : { ingredientId, quantity: null };
        }),
        ...(imageKey ? { imageKey } : {}),
        typeId: typeId || null,
      };
      const newPrice = price.trim() ? Math.round(Number(price)) : null;
      if (product) {
        await patch(`/products/${product.id}`, body, { ifMatch: product.version });
        // F-001 FIN-1: a new price applies from now on; past deliveries keep theirs.
        if (newPrice !== null && newPrice !== product.unitPrice)
          await put(`/products/${product.id}/price`, { unitPrice: newPrice });
      } else
        await post('/products', { ...body, ...(newPrice !== null ? { unitPrice: newPrice } : {}) });
      setName('');
      setPrice('');
      setBatchYield('');
      setTypeId('');
      setFile(null);
      setUses(new Set());
      setAmounts({});
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
    <form className={product ? 'stack product-form' : 'card product-form'} onSubmit={submit}>
      {product ? null : <h2>{t('New product')}</h2>}
      <ErrorBox error={err} />
      <div className="grid2">
        <label className="field">
          {t('Name')}
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('Price per piece (won)')}
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
        <label className="field">
          {t('One batch makes (pieces)')}
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder={t('Optional')}
            value={batchYield}
            onChange={(e) => setBatchYield(e.target.value)}
          />
        </label>
      </div>
      <TypePicker value={typeId} onChange={setTypeId} />
      <div className="field">
        {t('One batch needs (optional, can be added later)')}
        <div className="batch-edit">
          {chosen.map((i) =>
            i ? (
              <div key={i.id} className="batch-line">
                <span>{i.name}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  placeholder={t('Amount')}
                  aria-label={t('Amount of {name} per batch', { name: i.name })}
                  value={amounts[i.id]?.quantity ?? ''}
                  onChange={(e) =>
                    setAmounts({
                      ...amounts,
                      [i.id]: { quantity: e.target.value, unit: amounts[i.id]?.unit ?? i.packUnit },
                    })
                  }
                />
                <select
                  className="input"
                  aria-label={t('Unit of {name}', { name: i.name })}
                  value={amounts[i.id]?.unit ?? i.packUnit}
                  onChange={(e) =>
                    setAmounts({
                      ...amounts,
                      [i.id]: {
                        quantity: amounts[i.id]?.quantity ?? '',
                        unit: e.target.value as PackUnit,
                      },
                    })
                  }
                >
                  {KIND[i.packUnit].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  aria-label={t('Take {name} out of the batch', { name: i.name })}
                  onClick={() => {
                    const n = new Set(uses);
                    n.delete(i.id);
                    setUses(n);
                  }}
                >
                  ✕
                </button>
              </div>
            ) : null,
          )}
          <select
            className="input"
            value=""
            aria-label={t('Add an ingredient')}
            onChange={(e) => {
              if (!e.target.value) return;
              setUses(new Set([...uses, e.target.value]));
            }}
          >
            <option value="">{t('+ Add an ingredient…')}</option>
            {(ingredients.data?.items ?? [])
              .filter((i) => !uses.has(i.id))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
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

/**
 * Decided 2026-12-01: one quiet row per product (name, price, Edit, more). "More" opens the
 * details: type, cost from today's ingredient prices, what one batch needs, minutes per 10,
 * availability and the recipe (to come).
 */
function ProductRow({
  product: p,
  rowRef,
  dragging,
  canDrag,
  handle,
  row,
  canMoveUp,
  canMoveDown,
  onMove,
  editing,
  onEdit,
  onEdited,
  onToggle,
}: {
  product: Product;
  rowRef: (el: HTMLElement | null) => void;
  dragging: boolean;
  canDrag: boolean;
  handle: ReturnType<ReturnType<typeof useDragOrder>['handleProps']>;
  row: ReturnType<ReturnType<typeof useDragOrder>['rowProps']>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (by: number) => void;
  editing: boolean;
  onEdit: () => void;
  onEdited: () => void;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cost = p.cost;
  return (
    <div ref={rowRef} className={dragging ? 'prow dragging' : 'prow'} {...(canDrag ? row : {})}>
      <div className="prow-main">
        {canDrag ? (
          <button
            type="button"
            className="drag-handle"
            aria-label={t('Drag {name} to a new place', { name: p.name })}
            {...handle}
          >
            ⠿
          </button>
        ) : null}
        <span className="prow-name">
          {p.name}
          {!p.available ? <span className="pill">{t('Hidden')}</span> : null}
        </span>
        <span className={p.unitPrice == null ? 'prow-price none' : 'prow-price'}>
          {p.unitPrice == null ? t('No price') : won(p.unitPrice)}
        </span>
        <button
          type="button"
          className="btn ghost small-btn"
          onClick={onEdit}
          aria-label={t('Edit {name}', { name: p.name })}
        >
          {t('Edit')}
        </button>
        <button
          type="button"
          className="btn ghost small-btn prow-more-btn"
          aria-expanded={open}
          aria-label={t('More about {name}', { name: p.name })}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>
      {editing ? (
        <ProductForm key={p.version} product={p} onDone={onEdited} />
      ) : open ? (
        <div className="prow-more">
          <div className="prow-facts">
            <img className="thumb" src={p.imageUrl} alt="" />
            <dl>
              <dt>{t('Type')}</dt>
              <dd>{p.type?.name ?? t('No type')}</dd>
              <dt>{t('Cost')}</dt>
              <dd>
                {cost?.perBatch == null ? (
                  <span className="muted">
                    {t('Add ingredient amounts and prices to see the cost.')}
                  </span>
                ) : (
                  <>
                    <b>{t('{amount} per batch', { amount: won(cost.perBatch) })}</b>
                    {cost.perPiece != null ? (
                      <>
                        {' · '}
                        {t('{amount} each', { amount: won(cost.perPiece) })}
                        {p.unitPrice != null ? (
                          <span className="muted small">
                            {' '}
                            {t('(price {price}, leaves {left})', {
                              price: won(p.unitPrice),
                              left: won(p.unitPrice - cost.perPiece),
                            })}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                    {cost.missing ? (
                      <span className="pill warn" style={{ marginLeft: 6 }}>
                        {t('{n} without amount or price', { n: cost.missing })}
                      </span>
                    ) : null}
                  </>
                )}
              </dd>
              <dt>{t('Minutes per 10')}</dt>
              <dd>{p.minutesPer10}</dd>
            </dl>
          </div>
          <div>
            <h4 className="prow-h">
              {p.batchYield
                ? t('1 batch (makes {n}) needs', { n: p.batchYield })
                : t('1 batch needs')}
            </h4>
            {p.ingredients.length ? (
              <ul className="batch-list">
                {p.ingredients.map((x) => (
                  <li key={x.id}>
                    <span>{x.name}</span>
                    <span>
                      {x.quantity != null ? (
                        <b>
                          {formatQty(x.quantity)} {x.unit ?? x.packUnit}
                        </b>
                      ) : (
                        <span className="muted small">{t('amount not set')}</span>
                      )}
                      {x.cost != null ? (
                        <span className="muted small"> · {won(x.cost)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                {t('No ingredients yet. Add them with Edit.')}
              </p>
            )}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t('Recipe: coming soon. Step-by-step instructions with timers set by admins.')}
          </p>
          <div className="row wrap">
            <button type="button" className="btn ghost small-btn" onClick={onToggle}>
              {p.available ? t('Hide from orders') : t('Show in orders')}
            </button>
            {canMoveUp || canMoveDown ? (
              <>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  disabled={!canMoveUp}
                  aria-label={t('Move {name} up', { name: p.name })}
                  onClick={() => onMove(-1)}
                >
                  ↑ {t('Move up')}
                </button>
                <button
                  type="button"
                  className="btn ghost small-btn"
                  disabled={!canMoveDown}
                  aria-label={t('Move {name} down', { name: p.name })}
                  onClick={() => onMove(1)}
                >
                  ↓ {t('Move down')}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const formatQty = (n: number) => String(Number(n.toFixed(3)));
