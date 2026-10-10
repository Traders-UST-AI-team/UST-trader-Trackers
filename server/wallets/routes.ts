// /api/wallets/* — read model plus the bounded configuration a user may change (watched wallets, pilot markets, screening
// threshold). Seed mode is read-only and fetches nothing.
import type { Express } from 'express';
import { addWatch, removeWatch, setPilotMarkets, watchedWallets } from './store.ts';
import { holderGroups, largeTrades, overview, setLargeTradeUsdc, walletDetail } from './analytics.ts';
import { isAddress } from './parse.ts';
import { bump } from '../versions.ts';

export function registerWalletRoutes(app: Express, opts: { seed: boolean }) {
  const ro = (res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(409).json({ error: 'seed mode: wallet settings are read-only (nothing is fetched)' });
  app.get('/api/wallets', (_req, res) => res.json(overview(opts.seed)));
  app.get('/api/wallets/markets/:id/large-trades', (req, res) => res.json(largeTrades({ conditionId: req.params.id, limit: Math.min(200, Number(req.query.limit ?? 100) || 100) })));
  app.get('/api/wallets/markets/:id/holders', (req, res) => res.json(holderGroups(req.params.id)));
  app.get('/api/wallets/watch/:wallet', (req, res) => {
    if (!isAddress(req.params.wallet)) return res.status(400).json({ error: 'not a wallet address' });
    const d = walletDetail(req.params.wallet);
    if (!d) return res.status(404).json({ error: 'wallet is not on the watch list' });
    res.json(d);
  });
  app.post('/api/wallets/watch', (req, res) => {
    if (opts.seed) return ro(res);
    const r = addWatch(req.body?.wallet, req.body?.note, req.body?.selection_rule);
    if (!r.ok) return res.status(400).json({ error: r.error });
    bump('pm-wallets');
    res.status(201).json({ items: watchedWallets() });
  });
  app.delete('/api/wallets/watch/:wallet', (req, res) => {
    if (opts.seed) return ro(res);
    const removed = removeWatch(req.params.wallet);
    if (removed) bump('pm-wallets');
    res.json({ removed, note: 'Stored activity of the wallet is kept as history.' });
  });
  app.put('/api/wallets/pilot', (req, res) => {
    if (opts.seed) return ro(res);
    const r = setPilotMarkets(req.body?.condition_ids);
    if (!r.ok) return res.status(400).json({ error: r.error });
    bump('pm-trades');
    res.json(overview(opts.seed).pilot_markets);
  });
  app.put('/api/wallets/large-trade-threshold', (req, res) => {
    if (opts.seed) return ro(res);
    const r = setLargeTradeUsdc(req.body?.usdc);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  });
}
