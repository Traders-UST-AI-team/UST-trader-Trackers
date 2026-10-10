import { Fragment, useEffect, useState } from 'react';
import type { CoverageView, HolderGroup, LeaderboardSnapshot, NetTradeValue, WalletDetail, WalletsOverview, WatchedWalletView } from '../../shared/types';
import { api } from '../api';
import { useResource } from '../read';
import { absTime, ago, shortAddr, signed, usdc } from '../format';

const POLYGONSCAN = (tx: string) => `https://polygonscan.com/tx/${tx}`;
const PROFILE = (w: string) => `https://polymarket.com/profile/${w}`;

function Who({ wallet, display_name, pseudonym, watched }: { wallet: string; display_name: string | null; pseudonym: string | null; watched?: boolean }) {
  const name = display_name && !/^0x[0-9a-f]{40}/i.test(display_name) ? display_name : pseudonym;
  return (
    <span className="who" title={`${wallet}\nDisplay names are self-chosen and unverified; an address is not an identified person or institution.`}>
      {watched && <span aria-label="watched">★ </span>}<a href={PROFILE(wallet)} target="_blank" rel="noreferrer"><code>{shortAddr(wallet)}</code></a>{name && <span className="muted"> · {name}</span>}
    </span>
  );
}

function Cov({ c, label }: { c: CoverageView; label: string }) {
  const bad = c.last_status === 'error' || c.stale || c.open_gaps.length > 0;
  const text = c.last_status === 'never' ? 'not collected yet' : `${c.stale ? 'stale · ' : ''}${c.open_gaps.length ? `${c.open_gaps.length} gap(s) · ` : ''}since ${c.covered_since === 'upstream window start' ? 'the start of the API window' : c.covered_since ? absTime(c.covered_since) : '?'}`;
  return <span className={`chip ${bad ? 'warn' : ''}`} title={`${label}: last ok ${absTime(c.last_ok_at)}${c.last_detail ? `\n${c.last_detail}` : ''}${c.open_gaps.map((g) => `\nmissing ${g.from} → ${g.to}`).join('')}`}>{label}: {text}</span>;
}

function NetTable({ n }: { n: NetTradeValue }) {
  return (
    <div>
      <p className="small">
        <b>{n.label}</b> · last {n.window_h >= 48 ? `${n.window_h / 24} days` : `${n.window_h} h`} · <span className={`chip ${n.status === 'complete' ? 'link' : 'warn'}`}>{n.status.replace(/_/g, ' ')}</span>
        {n.complete_wallets > 0 && <span className="muted"> {n.complete_wallets} wallet(s) fully covered</span>}
      </p>
      {n.partial_wallets.length > 0 && <p className="small muted">Excluded (coverage does not span the window): {n.partial_wallets.map((p) => `${shortAddr(p.wallet)} — ${p.reason}`).join('; ')}</p>}
      {n.by_market_outcome.length > 0 ? (
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Market</th><th>Outcome</th><th className="num">Bought</th><th className="num">Sold</th><th className="num">Net (bought − sold)</th><th className="num">Trades</th></tr></thead>
          <tbody>{n.by_market_outcome.map((r) => (
            <tr key={`${r.condition_id}-${r.outcome_index}`}><td>{r.title ?? shortAddr(r.condition_id)}</td><td><b>{r.outcome}</b></td><td className="num">{usdc(r.buy_usdc)}</td><td className="num">{usdc(r.sell_usdc)}</td><td className="num"><b>{signed(r.net_usdc, (v) => usdc(v))}</b></td><td className="num">{r.trades} <span className="muted">({r.wallets} w)</span></td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="small muted">{n.status === 'no_watched_wallets' ? 'No watched wallets yet.' : n.status === 'unavailable' ? 'No watched wallet has complete coverage for this window yet, so no value is shown.' : 'No trades by fully covered watched wallets in this window.'}</p>}
      {Object.keys(n.excluded_activity).length > 0 && <p className="small muted">Not counted as trades: {Object.entries(n.excluded_activity).map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`).join(', ')}.</p>}
      <p className="small muted">{n.note}</p>
    </div>
  );
}

function Holders({ conditionId }: { conditionId: string }) {
  const { data: g } = useResource<HolderGroup[]>(conditionId, () => api.holders(conditionId), { label: 'Holder snapshot', quiet: true });
  if (!g) return <p className="small muted">Loading holders…</p>;
  if (!g.length) return <p className="small muted">No holder snapshot yet.</p>;
  return (
    <div className="holders">
      {g.map((x) => (
        <div key={x.token_id}>
          <b className="small">Outcome {x.outcome_index === 1 ? 'No' : x.outcome_index === 0 ? 'Yes' : '?'}</b> <span className="small muted">· top {x.holders.length} as of {ago(x.snapshot_at)}</span>
          <ol className="small">{x.holders.slice(0, 5).map((h) => <li key={h.wallet}><Who {...h} /> — {h.amount_shares.toLocaleString('en-US', { maximumFractionDigits: 0 })} shares</li>)}</ol>
        </div>
      ))}
      <p className="small muted">{g[0].note}</p>
    </div>
  );
}

function WalletRow({ w, now, onChanged, readOnly }: { w: WatchedWalletView; now: number; onChanged: () => void; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: d } = useResource<WalletDetail | null>(
    open ? `${w.wallet}|${w.last_activity_at}` : null,
    () => (open ? api.walletDetail(w.wallet) : Promise.resolve(null)),
    { label: 'Wallet detail', quiet: true },
  );
  return (
    <>
      <tr>
        <td><button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'}</button> <Who wallet={w.wallet} display_name={w.display_name} pseudonym={w.pseudonym} />{w.note && <div className="small muted">{w.note}</div>}</td>
        <td className="small" title={`Frozen at selection: ${absTime(w.selected_at)}`}>{w.selection_rule}<div className="muted">{absTime(w.selected_at)}</div></td>
        <td className="num">{w.open_positions}<div className="small muted">{usdc(w.positions_value_usdc)}</div></td>
        <td className="num small" title="Provider-reported on the provider's own basis; not independently assessed">{signed(w.provider_unrealized_pnl_usdc, (v) => usdc(v))} <span className="muted">unrealized</span><div>{signed(w.provider_realized_pnl_usdc, (v) => usdc(v))} <span className="muted">realized</span></div></td>
        <td className="small">{ago(w.last_activity_at, now)}<div><Cov c={w.activity_coverage} label="activity" /></div></td>
        <td>{!readOnly && <button className="linkbtn small" onClick={() => api.unwatchWallet(w.wallet).then(onChanged)}>unwatch</button>}</td>
      </tr>
      {open && (
        <tr className="detailrow"><td colSpan={6}>
          {!d ? <p className="small muted">Loading…</p> : (
            <div className="walletdetail">
              <div>
                <h5>Open positions <span className="muted small">(snapshot {ago(d.positions[0]?.snapshot_at ?? null, now)}; provider-reported values)</span></h5>
                {d.positions.length === 0 ? <p className="small muted">None returned.</p> : (
                  <div className="tablewrap"><table className="mini-table small"><thead><tr><th>Market</th><th>Outcome</th><th className="num">Shares</th><th className="num">Entry price</th><th className="num">Value</th><th className="num">Unrealized</th></tr></thead>
                    <tbody>{d.positions.slice(0, 15).map((p) => <tr key={p.token_id}><td>{p.title}{p.tracked_market && <span className="chip link">tracked</span>}</td><td>{p.outcome}</td><td className="num">{p.size_shares?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '—'}</td><td className="num">{p.entry_price_usdc == null ? '—' : `${(p.entry_price_usdc * 100).toFixed(1)}¢`}</td><td className="num">{usdc(p.current_value_usdc)}</td><td className="num">{signed(p.unrealized_pnl_usdc, (v) => usdc(v))}</td></tr>)}</tbody></table></div>
                )}
              </div>
              <div>
                <h5>Recent activity <span className="muted small">(maker and taker fills; redemptions, splits and rewards listed by type)</span></h5>
                <ul className="actlist small">{d.activity.slice(0, 25).map((a) => (
                  <li key={a.key}><span className="muted" title={absTime(a.at)}>{ago(a.at, now)}</span> <b>{a.type === 'TRADE' ? `${a.side} ${a.outcome}` : a.type.toLowerCase().replace(/_/g, ' ')}</b> {usdc(a.usdc_size)} · {a.title ?? ''}{a.seen_via !== 'poll' && <span className="chip">{a.seen_via === 'initial' ? 'initial sync' : 'gap-recovered'}</span>} <a href={POLYGONSCAN(a.tx_hash)} target="_blank" rel="noreferrer">tx ↗</a></li>
                ))}</ul>
              </div>
              <NetTable n={d.net_24h} />
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}

function Leaderboard({ s, watchedCount, onWatch, readOnly }: { s: LeaderboardSnapshot; watchedCount: number; onWatch: (wallet: string, rule: string) => void; readOnly: boolean }) {
  return (
    <div>
      <h5>{s.time_period} · by {s.order_by} · {s.category} <span className="muted small">snapshot {s.snapshot_date}</span></h5>
      <div className="tablewrap"><table className="mini-table small"><thead><tr><th>#</th><th>Wallet</th><th className="num">PnL (provider)</th><th className="num">Volume</th><th /></tr></thead>
        <tbody>{s.rows.slice(0, 15).map((r) => (
          <tr key={r.rank}><td>{r.rank}</td><td><Who wallet={r.wallet} display_name={r.display_name} pseudonym={null} watched={r.watched} /></td><td className="num">{signed(r.pnl_usdc, (v) => usdc(v))}</td><td className="num">{usdc(r.volume_usdc)}</td>
            <td>{!r.watched && !readOnly && <button className="linkbtn" disabled={watchedCount >= 20} onClick={() => onWatch(r.wallet, `leaderboard ${s.time_period} ${s.order_by} ${s.category} rank ${r.rank} on ${s.snapshot_date}`)}>watch</button>}</td></tr>
        ))}</tbody></table></div>
      <p className="small muted">{s.note}</p>
    </div>
  );
}

export function WalletsView({ now, versionKey, onOpenMarket }: { now: number; versionKey: string; onOpenMarket: (id: string) => void }) {
  const { data: d, error: err, reload: load } = useResource<WalletsOverview>(versionKey, () => api.wallets(), { label: 'Markets' });
  const [addr, setAddr] = useState(''); const [note, setNote] = useState(''); const [formErr, setFormErr] = useState<string | null>(null);
  const [win, setWin] = useState<'24h' | '7d'>('24h');
  const [openMarket, setOpenMarket] = useState<string | null>(null);
  const watch = async (wallet: string, rule?: string) => {
    try { await api.watchWallet(wallet, note.trim() || null, rule); setAddr(''); setNote(''); setFormErr(null); load(); } catch (e) { setFormErr((e as Error).message); }
  };
  if (err) return <main className="walletsview"><div className="banner">{err}</div></main>;
  if (!d) return <main className="walletsview"><p className="muted">Loading wallet activity…</p></main>;
  const ro = d.seed_mode;
  return (
    <main className="walletsview">
      <details className="aboutdata small"><summary>About this data — a wallet address is not a person; large trade = screening rule, not a signal</summary><ul className="notes small">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>

      <section className="panel">
        <h3>Large trades on pilot markets <span className="muted small">— market tape (taker side, each fill once)</span></h3>
        {d.large_trades.length === 0 ? <p className="small muted">{ro ? 'Not available offline.' : 'No trade has met a screening criterion yet.'}</p> : (
          <ol className="lt-rows">
            {d.large_trades.map((t) => (
              <li key={t.key} title={`Why listed: ${t.criteria.join('; ')}\ntraded ${absTime(t.at)} · collected ${absTime(t.first_seen_at)}\n${t.size_shares.toLocaleString('en-US', { maximumFractionDigits: 0 })} shares`}>
                <time>{ago(t.at, now)}</time>
                <span className="side">{t.side} {t.outcome}</span>
                <b>{usdc(t.notional_usdc)}</b>
                <span className="px">@ {(t.price_usdc * 100).toFixed(1)}¢</span>
                <button className="linkbtn mkt" onClick={() => onOpenMarket(t.condition_id)}>{t.question}</button>
                <Who wallet={t.wallet} display_name={t.display_name} pseudonym={t.pseudonym} watched={t.watched} />
                <a href={POLYGONSCAN(t.tx_hash)} target="_blank" rel="noreferrer" aria-label="Transaction on Polygonscan">↗</a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <h3>Pilot markets <span className="muted small">— {d.pilot_markets.length} of max 10</span></h3>
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Market</th><th className="num">Trades stored</th><th className="num">P95 trade</th><th>Coverage</th></tr></thead>
          <tbody>{d.pilot_markets.map((m) => (
            <Fragment key={m.condition_id}>
              <tr>
                <td><button className="linkbtn" onClick={() => setOpenMarket(openMarket === m.condition_id ? null : m.condition_id)} aria-expanded={openMarket === m.condition_id}>{openMarket === m.condition_id ? '▾' : '▸'}</button> <button className="linkbtn" onClick={() => onOpenMarket(m.condition_id)}>{m.question}</button>
                  <div className="small muted" title={m.selection_rule}>selected {absTime(m.selected_at)}</div></td>
                <td className="num">{m.trades_stored.toLocaleString('en-US')}<div className="small muted">{m.oldest_trade_at ? `from ${absTime(m.oldest_trade_at)}` : ''}</div></td>
                <td className="num">{m.p95_notional_usdc == null ? <span className="muted small">needs ≥ 50 trades</span> : usdc(m.p95_notional_usdc)}</td>
                <td><Cov c={m.coverage} label="trades" /></td>
              </tr>
              {openMarket === m.condition_id && <tr className="detailrow"><td colSpan={4}><Holders conditionId={m.condition_id} /></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel">
        <h3>Watched wallets <span className="muted small">— {d.watched.length} of max 20</span></h3>
        {!ro && (
          <div className="row2 watchform">
            <input placeholder="0x… wallet address" value={addr} onChange={(e) => setAddr(e.target.value.trim())} aria-label="Wallet address" />
            <input placeholder="your note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
            <button onClick={() => watch(addr)} disabled={!addr || d.watched.length >= 20}>Watch</button>
            {formErr && <span className="chip warn">{formErr}</span>}
          </div>
        )}
        {d.watched.length === 0 ? <p className="small muted">No wallet is watched. Add an address, or pick a candidate from the leaderboard below; the selection rule and time are recorded and cannot be rewritten later.</p> : (
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Wallet</th><th>Selection rule</th><th className="num">Open positions</th><th className="num">PnL (provider)</th><th>Last activity</th><th /></tr></thead>
            <tbody>{d.watched.map((w) => <WalletRow key={w.wallet} w={w} now={now} onChanged={load} readOnly={ro} />)}</tbody>
          </table></div>
        )}
        <div className="rangebar" role="group" aria-label="Net trade value window">
          {(['24h', '7d'] as const).map((x) => <button key={x} className={win === x ? 'on' : ''} onClick={() => setWin(x)}>{x}</button>)}
        </div>
        <NetTable n={win === '24h' ? d.net_24h : d.net_7d} />
      </section>

      <section className="panel">
        <h3>Leaderboard candidates <span className="muted small">— for discovery only</span></h3>
        {d.leaderboards.length === 0 ? <p className="small muted">{ro ? 'Not available offline.' : 'No snapshot yet (taken daily).'}</p> : <div className="lbgrid">{d.leaderboards.map((s) => <Leaderboard key={`${s.time_period}-${s.order_by}-${s.category}`} s={s} watchedCount={d.watched.length} onWatch={(w, r) => watch(w, r)} readOnly={ro} />)}</div>}
      </section>
    </main>
  );
}
