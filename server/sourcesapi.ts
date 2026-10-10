// Sources view API (J2 + Package D): per-source health, effective cadence/budget (editable, validated, persisted) and
// per-channel Telegram state (allowlist, coverage gaps, measured collection lag).
import type { Express } from 'express';
import { db } from './db.ts';
import { allConfigs, configVersion, setConfig } from './sourceconfig.ts';
import { sourceHealth } from './sourcehealth.ts';
import { getBreaker } from './breaker.ts';
import { channelConfig, collectionLag, openGaps, setChannelConfig } from './sources/telegram.ts';
import { channelDueAt, telegramBusy } from './tgscheduler.ts';
import { configOf } from './sourceconfig.ts';
import type { SourcesResponse, TgChannelView } from '../shared/types.ts';

type Row = Record<string, any>;

export function telegramChannels(): TgChannelView[] {
  return channelConfig().map((c) => {
    const st = db.prepare('SELECT title, subscribers, last_attempt_at, last_error, (SELECT COUNT(*) FROM tg_posts p WHERE p.channel = c.channel) AS posts FROM tg_channels c WHERE channel = ?').get(c.channel) as Row | undefined;
    const run = db.prepare('SELECT * FROM tg_runs WHERE channel = ? ORDER BY started_at DESC LIMIT 1').get(c.channel) as Row | undefined;
    const due = channelDueAt(c.channel);
    const br = getBreaker(`telegram:${c.channel}`);
    return {
      channel: c.channel, enabled: c.enabled, added_by: c.added_by, title: st?.title ?? null, subscribers: st?.subscribers ?? null, posts: st?.posts ?? 0,
      last_attempt_at: st?.last_attempt_at ?? null, last_error: st?.last_error ?? null, next_attempt_at: c.enabled && due !== null ? new Date(due).toISOString() : null,
      breaker_open_until: br.open_until,
      open_gaps: openGaps(c.channel).map((g) => ({ id: g.id, low_id: g.low_id, high_id: g.high_id, cursor_before: g.cursor_before, opened_at: g.opened_at, pages_used: g.pages_used, recovered_posts: g.recovered_posts })),
      resolved_gaps_7d: (db.prepare("SELECT COUNT(*) c FROM tg_gaps WHERE channel = ? AND resolved_at >= ?").get(c.channel, new Date(Date.now() - 7 * 86400e3).toISOString()) as { c: number }).c,
      lag: collectionLag(c.channel),
      last_run: run ? { started_at: run.started_at, finished_at: run.finished_at, pages_latest: run.pages_latest, pages_gap: run.pages_gap, pages_history: run.pages_history, inserted: run.inserted, error: run.error } : null,
    };
  });
}

export function registerSourcesRoutes(app: Express, opts: { seed: boolean }) {
  app.get('/api/sources', (_req, res) => {
    const cfg = new Map(allConfigs().map((c) => [c.source_id, c]));
    const tg = configOf('telegram')!;
    const out: SourcesResponse = {
      seed_mode: opts.seed, config_version: configVersion(),
      sources: sourceHealth().map((h) => ({ health: h, config: cfg.get(h.source_id)! })),
      telegram: {
        interval_min: tg.interval_min, pages_per_channel: tg.request_budget, busy: telegramBusy(), channels: telegramChannels(),
        note: opts.seed ? 'Seed mode: Telegram is not polled and the snapshot holds no Telegram posts.' : 'Polled on its own scheduler; five-minute polling is the pilot target, not a delivery guarantee. Lag is measured, not promised.',
      },
    };
    res.json(out);
  });
  app.put('/api/sources/:id/config', (req, res) => {
    if (opts.seed) return res.status(409).json({ error: 'seed mode: collection settings are read-only (nothing is fetched)' });
    const r = setConfig(req.params.id, req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r.config);
  });
  app.get('/api/telegram/config', (_req, res) => res.json({ channels: channelConfig() }));
  app.put('/api/telegram/config', (req, res) => {
    if (opts.seed) return res.status(409).json({ error: 'seed mode: the channel allowlist is read-only (nothing is fetched)' });
    const r = setChannelConfig(req.body?.channels);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ channels: r.channels });
  });
}
