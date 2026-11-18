'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Icon, Loading, PageHead } from '../../../components/ui';
import { type ApiError, get, post, type Schemas } from '../../../lib/api';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Status = Schemas['BotStatus'];
type Message = Schemas['BotMessage'];
type Proposal = Schemas['BotProposal'];
type Conversation = Schemas['BotConversation'];
interface ConversationRow {
  id: string;
  title: string;
  updatedAt: string;
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(show).join(', ');
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}: ${show(x)}`)
    .join(' · ');
};

/**
 * The Bot screen (spec section 10): the admin writes an instruction; every change comes back as a
 * preview with Confirm. Nothing changes until Confirm, and more than 20 rows need it twice.
 */
export default function BotPage() {
  const status = useApi<Status>('/bot');
  const list = useApi<{ items: ConversationRow[] }>('/bot/conversations');
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, proposals]);

  async function open(id: string | null) {
    setErr(null);
    setCurrent(id);
    if (!id) {
      setMessages([]);
      setProposals([]);
      return;
    }
    try {
      const c = await get<Conversation>(`/bot/conversations/${id}`);
      setMessages(c.messages);
      setProposals(c.proposals);
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setErr(null);
    setText('');
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: 'admin', text: t, createdAt: new Date().toISOString() },
    ]);
    try {
      const res = await post<{
        conversationId: string;
        messages: Message[];
        proposals: Proposal[];
      }>('/bot/messages', {
        text: t,
        ...(current ? { conversationId: current } : {}),
      });
      setCurrent(res.conversationId);
      setMessages((m) => [...m.filter((x) => !x.id.startsWith('local-')), ...res.messages]);
      setProposals((p) => [...p, ...res.proposals]);
      list.reload();
      status.reload();
    } catch (e2) {
      setErr(e2 as ApiError);
      setText(t);
      setMessages((m) => m.filter((x) => !x.id.startsWith('local-')));
    } finally {
      setBusy(false);
    }
  }

  async function decide(p: Proposal, action: 'confirm' | 'cancel') {
    setErr(null);
    let second = false;
    if (action === 'confirm' && p.needsSecondConfirmation) {
      if (!window.confirm(`This changes ${p.rows} rows. Apply all of them?`)) return;
      second = true;
    }
    try {
      const updated = await post<Proposal>(
        `/bot/proposals/${p.id}/${action}`,
        action === 'confirm' ? { second } : undefined,
      );
      setProposals((all) => all.map((x) => (x.id === p.id ? updated : x)));
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  if (status.loading && !status.data) return <Loading />;
  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />;
  const usage = status.data?.usage;

  // Messages and proposals in time order.
  const feed = [
    ...messages.map((m) => ({ at: m.createdAt, kind: 'message' as const, m })),
    ...proposals.map((p) => ({ at: p.createdAt, kind: 'proposal' as const, p })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="page">
      <PageHead
        title={t('Bot')}
        sub={
          usage
            ? `This month: ${Math.round((usage.usedTokens / usage.budgetTokens) * 100)}% of the AI budget used`
            : undefined
        }
      >
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <select
            className="input"
            value={current ?? ''}
            onChange={(e) => void open(e.target.value || null)}
            aria-label={t('Conversation')}
          >
            <option value="">{t('New conversation')}</option>
            {list.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      </PageHead>
      {!status.data?.available ? (
        <Empty>
          {t(
            'The AI bot is not set up on this server yet. An administrator sets LLM_PROVIDER and the model key.',
          )}
        </Empty>
      ) : (
        <>
          <section className="card bot-feed" aria-live="polite">
            {!feed.length ? (
              <div className="muted center small stack">
                <span>
                  {t('Ask about your bakery or tell the bot what to change. For example:')}
                </span>
                <span>“Who worked yesterday and were there red flags?”</span>
                <span>“Add ingredient flour, 1500 won, 20 kg from Seoul Flour Co.”</span>
                <span>“Put Mina on 06:00 to 14:00 Monday to Friday.”</span>
                <span>
                  {t(
                    '“Approve the waiting shift corrections and accept City Cafe’s added baguettes.”',
                  )}
                </span>
                <span>“Give Joon a task to clean the oven today.”</span>
                <span>
                  {t(
                    'Every change shows a preview first. Nothing changes until you press Confirm.',
                  )}
                </span>
              </div>
            ) : null}
            {feed.map((item) =>
              item.kind === 'message' ? (
                <div key={item.m.id} className={item.m.role === 'admin' ? 'bubble me' : 'bubble'}>
                  {item.m.text}
                </div>
              ) : (
                <ProposalCard key={item.p.id} p={item.p} onDecide={decide} />
              ),
            )}
            {busy ? <div className="bubble muted">{t('Working…')}</div> : null}
            <div ref={end} />
          </section>
          <ErrorBox error={err} />
          <form className="row" onSubmit={send}>
            <textarea
              className="input"
              style={{ flex: 1, minHeight: 52, padding: 12 }}
              value={text}
              maxLength={4000}
              placeholder={t('Write to the bot')}
              aria-label={t('Message')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button className="btn" disabled={busy || !text.trim()}>
              {t('Send')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function ProposalCard({
  p,
  onDecide,
}: {
  p: Proposal;
  onDecide: (p: Proposal, a: 'confirm' | 'cancel') => void;
}) {
  const label: Record<string, { text: string; cls: string }> = {
    pending: { text: 'Waiting for you', cls: 'pill warn' },
    applied: { text: 'Applied', cls: 'pill ok' },
    cancelled: { text: 'Cancelled', cls: 'pill' },
    expired: { text: 'Expired', cls: 'pill' },
    failed: { text: 'Not applied', cls: 'pill' },
  };
  const s = label[p.status] ?? { text: p.status, cls: 'pill' };
  return (
    <div className="proposal">
      <div className="row between wrap">
        <b>{p.summary}</b>
        <span className={s.cls}>
          {p.status === 'applied' ? <Icon name="check" size={14} /> : null}
          {s.text}
        </span>
      </div>
      <div className="scroll">
        <table className="t">
          <thead>
            <tr>
              <th />
              <th>{t('Now')}</th>
              <th>{t('After')}</th>
            </tr>
          </thead>
          <tbody>
            {p.changes.map((c, i) => (
              <tr key={`${c.label}${i}`}>
                <td>
                  <b>{c.label}</b>
                </td>
                <td className="small">{show(c.before)}</td>
                <td className="small">
                  <b>{show(c.after)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.error ? <div className="error">{p.error}</div> : null}
      {p.status === 'pending' ? (
        <div className="row wrap">
          <button className="btn" onClick={() => onDecide(p, 'confirm')}>
            Confirm{p.needsSecondConfirmation ? ` all ${p.rows} rows` : ''}
          </button>
          <button className="btn ghost" onClick={() => onDecide(p, 'cancel')}>
            {t('Cancel')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
