import type { BacktestSummary, ChannelExposure, QuarterlyAggregation } from '../../../shared/review-types';
import { QUARTER_SIGNAL_LABEL, SIGNAL_OUTCOME_LABEL, type QuarterSignal } from '../../../shared/review-signals';

export function SignalBadge({ signal }: { signal: QuarterSignal | null | undefined }) {
  if (!signal) return <span className="rv-muted">—</span>;
  const cls = signal === 'negative_swing' ? 'swing' : signal === 'positive' ? 'positive' : 'stable';
  return <span className={`rv-signal ${cls}`}>{signal === 'negative_swing' ? '▼ ' : signal === 'positive' ? '▲ ' : ''}{QUARTER_SIGNAL_LABEL[signal]}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: QuarterlyAggregation['outcome'] }) {
  if (!outcome) return null;
  return <span className={`rv-outcome ${outcome}`} title={SIGNAL_OUTCOME_LABEL[outcome]}>{outcome === 'no_filing' ? 'no filing' : outcome}</span>;
}

const EXPOSURE_LABEL: Record<ChannelExposure, string> = { high: 'High online', medium: 'Mixed', low: 'Mostly offline' };

export function ExposureBadge({ exposure }: { exposure: ChannelExposure }) {
  return <span className={`rv-exposure ${exposure}`} title="Share of sales through Amazon / DTC, where reviews move buyers">{EXPOSURE_LABEL[exposure]}</span>;
}

/** Hit rate of decided swings, against the base rate it has to beat. */
export function HitRate({ backtest, compact = false }: { backtest: BacktestSummary; compact?: boolean }) {
  const decided = backtest.hits + backtest.misses;
  if (backtest.swings === 0) return <span className="rv-muted rv-small">no swings yet</span>;
  if (decided === 0) return <span className="rv-muted rv-small">{backtest.swings} swing{backtest.swings === 1 ? '' : 's'}, awaiting filings</span>;
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  return (
    <span className="rv-hitrate">
      <b>{backtest.hits}/{decided}</b>
      {!compact && <> hit · {pct(backtest.hit_rate)}</>}
      <span className="rv-muted rv-small"> vs base {pct(backtest.base_rate)}</span>
    </span>
  );
}
