import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ChannelExposure, Product, SnifferDetectionResult } from '../../../shared/review-types';
import { reviewsApi, type EdgarLookup } from '../../api-reviews';
import { toast } from '../../toast';
import { memberName } from './team';
import { fiscalYearEndNote } from './metrics';

/** A modal with a labelled title, Escape to close, and focus placed inside it. */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // The first field, not the close button that precedes it in the markup.
    (box.current?.querySelector<HTMLElement>('input, select, textarea') ?? box.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="rv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`rv-dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="rv-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function TeamCodeDialog({ onClose, unlock }: { onClose: () => void; unlock: (code: string) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(memberName.get());
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const submit = async () => {
    setBusy(true);
    setWrong(false);
    const ok = await unlock(code.trim()).catch(() => false);
    setBusy(false);
    if (!ok) { setWrong(true); return; }
    if (name.trim()) memberName.set(name);
    toast('Editing unlocked in this browser.', 'success');
    onClose();
  };
  return (
    <Dialog title="Unlock editing" onClose={onClose}>
      <p className="rv-muted">Anyone can read this tracker. Adding companies, collecting reviews and importing need the team code.</p>
      <form className="rv-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="rv-field">Team code
          <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={wrong} required />
        </label>
        {wrong && <p className="rv-error" role="alert">That code was not accepted.</p>}
        <label className="rv-field"><span>Your name <span className="rv-muted">(shown on what you add)</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <div className="rv-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Unlock'}</button>
        </div>
      </form>
    </Dialog>
  );
}

const EXPOSURE_HELP: Record<ChannelExposure, string> = {
  high: 'Sells largely through Amazon / DTC (Logitech, SharkNinja, YETI). Review tone transmits to revenue.',
  medium: 'A meaningful online share alongside retail.',
  low: 'Mostly offline retail (P&G, Colgate). Treat signals as weak.',
};

export function AddCompanyDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (ticker: string) => void }) {
  const [ticker, setTicker] = useState('');
  const [exposure, setExposure] = useState<ChannelExposure>('high');
  const [notes, setNotes] = useState('');
  const [lookup, setLookup] = useState<{ state: 'idle' | 'loading' | 'found' | 'missing' | 'error'; value: EdgarLookup | null }>({ state: 'idle', value: null });
  const [manualName, setManualName] = useState('');
  const [manualFye, setManualFye] = useState(12);
  const [busy, setBusy] = useState(false);

  // Resolve the ticker on EDGAR as the user types, after a short pause.
  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) { setLookup({ state: 'idle', value: null }); return; }
    setLookup({ state: 'loading', value: null });
    let live = true;
    const timer = setTimeout(() => {
      reviewsApi.lookup(t)
        .then((r) => { if (live) setLookup({ state: r.found ? 'found' : 'missing', value: r.found }); })
        .catch(() => { if (live) setLookup({ state: 'error', value: null }); });
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [ticker]);

  const needsManual = lookup.state === 'missing' || lookup.state === 'error';
  const submit = async () => {
    setBusy(true);
    try {
      const res = await reviewsApi.addCompany({
        ticker: ticker.trim().toUpperCase(),
        channel_exposure: exposure,
        notes: notes.trim() || undefined,
        added_by: memberName.get() || undefined,
        ...(needsManual ? { name: manualName.trim(), fiscal_year_end_month: manualFye } : {}),
      });
      const fin = res.financials;
      toast(fin?.status === 'ok' ? `${res.company.ticker} added · ${fin.message}` : `${res.company.ticker} added. Filings: ${fin?.message ?? 'not read'}`, fin && fin.status !== 'ok' ? 'info' : 'success');
      onAdded(res.company.ticker);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a company to the watchlist" onClose={onClose}>
      <form className="rv-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="rv-field">Ticker
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="LOGI" maxLength={10} required autoCapitalize="characters" />
        </label>
        <div className="rv-lookup" aria-live="polite">
          {lookup.state === 'loading' && <span className="rv-muted">Looking up on SEC EDGAR…</span>}
          {lookup.state === 'found' && lookup.value && (
            <span><b>{lookup.value.name}</b> · CIK {lookup.value.cik}{lookup.value.sector ? ` · ${lookup.value.sector}` : ''}<br />
              <span className="rv-muted">Fiscal year ends {fiscalYearEndNote(lookup.value.fiscal_year_end_month)} Quarterly revenue will be read from its filings.</span></span>
          )}
          {lookup.state === 'missing' && <span className="rv-muted">Not on SEC EDGAR (e.g. a non-US listing). State its name and fiscal year end; revenue will not be read automatically.</span>}
          {lookup.state === 'error' && <span className="rv-muted">EDGAR could not be reached. You can still add it by hand.</span>}
        </div>
        {needsManual && (
          <div className="rv-grid2">
            <label className="rv-field">Company name<input value={manualName} onChange={(e) => setManualName(e.target.value)} required /></label>
            <label className="rv-field">Fiscal year ends in
              <select value={manualFye} onChange={(e) => setManualFye(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en', { month: 'long' })}</option>)}
              </select>
            </label>
          </div>
        )}
        <fieldset className="rv-field">
          <legend>Online channel exposure</legend>
          <div className="rv-seg" role="radiogroup">
            {(['high', 'medium', 'low'] as const).map((x) => (
              <label key={x} className={exposure === x ? 'on' : ''}>
                <input type="radio" name="exposure" value={x} checked={exposure === x} onChange={() => setExposure(x)} />{x}
              </label>
            ))}
          </div>
          <span className="rv-muted rv-small">{EXPOSURE_HELP[exposure]}</span>
        </fieldset>
        <label className="rv-field"><span>Why we track it <span className="rv-muted">(optional)</span></span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. M510 / MX Master are top sellers; FY results in late July" />
        </label>
        <div className="rv-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !ticker.trim() || lookup.state === 'loading' || (needsManual && !manualName.trim())}>
            {busy ? 'Adding…' : 'Add company'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Pulls an ASIN out of a pasted Amazon URL, or accepts a bare ASIN. */
export function parseAsin(input: string): { asin: string | null; domain: string | null } {
  const s = input.trim();
  const url = /amazon\.([a-z.]{2,8})\/(?:.*\/)?(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})/i.exec(s);
  if (url) return { asin: url[2].toUpperCase(), domain: `amazon.${url[1].toLowerCase()}` };
  return /^[A-Z0-9]{10}$/i.test(s) ? { asin: s.toUpperCase(), domain: null } : { asin: null, domain: null };
}

export function AddListingDialog({ ticker, onClose, onAdded }: { ticker: string; onClose: () => void; onAdded: (p: Product) => void }) {
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [sku, setSku] = useState('');
  const [collectEvery, setCollectEvery] = useState(24);
  const [busy, setBusy] = useState(false);
  const parsed = parseAsin(source);
  const submit = async () => {
    if (!parsed.asin) return;
    setBusy(true);
    try {
      const p = await reviewsApi.upsertProduct({
        asin: parsed.asin, ticker, title: title.trim(), bestbuy_sku: sku.trim() || undefined,
        amazon_domain: parsed.domain ?? undefined, collect_interval_hours: collectEvery, added_by: memberName.get() || undefined,
      });
      toast(`${p.title} is now tracked for ${ticker}.`, 'success');
      onAdded(p);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Track a product for ${ticker}`} onClose={onClose}>
      <p className="rv-muted">Pick the company's best-selling listings: tone is pooled across them, which is what makes a quarter dense enough to read.</p>
      <form className="rv-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="rv-field">Amazon URL or ASIN
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://www.amazon.com/dp/B003NR57BY" required aria-invalid={source !== '' && !parsed.asin} />
        </label>
        {source && !parsed.asin && <p className="rv-error">No ASIN found. An ASIN is 10 letters or digits, e.g. B003NR57BY.</p>}
        {parsed.asin && <p className="rv-muted rv-small">ASIN <b>{parsed.asin}</b>{parsed.domain ? ` on ${parsed.domain}` : ' on amazon.com'}</p>}
        <label className="rv-field">Product name<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Logitech M510 Wireless Mouse" required maxLength={200} /></label>
        <div className="rv-grid2">
          <label className="rv-field"><span>Best Buy SKU <span className="rv-muted">(optional)</span></span><input value={sku} onChange={(e) => setSku(e.target.value)} inputMode="numeric" placeholder="9226065" /></label>
          <label className="rv-field">Collect every
            <select value={collectEvery} onChange={(e) => setCollectEvery(Number(e.target.value))}>
              <option value={12}>12 hours</option><option value={24}>day</option><option value={72}>3 days</option><option value={168}>week</option>
            </select>
          </label>
        </div>
        <div className="rv-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !parsed.asin || !title.trim()}>{busy ? 'Adding…' : 'Track product'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** CSV import: how to get an export, then drop it, check the detected columns, import. */
export function ImportDialog({ products, initialAsin, onClose, onImported }: { products: Product[]; initialAsin: string | null; onClose: () => void; onImported: () => void }) {
  const [asin, setAsin] = useState(initialAsin ?? products[0]?.asin ?? '');
  const [sniff, setSniff] = useState<SnifferDetectionResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const product = products.find((p) => p.asin === asin);

  const read = (file: File) => {
    setBusy('reading');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setSniff(await reviewsApi.sniff(String(reader.result ?? '')));
      } catch (e) {
        toast(`Could not read ${file.name}: ${(e as Error).message}`, 'error');
        setSniff(null);
      } finally {
        setBusy(null);
      }
    };
    reader.onerror = () => { setBusy(null); toast(`Could not read ${file.name}.`, 'error'); };
    reader.readAsText(file);
  };

  const importNow = async () => {
    if (!sniff || !asin) return;
    setBusy('importing');
    try {
      const r = await reviewsApi.importReviews(asin, sniff.parsedReviews);
      toast(`Imported ${r.imported} reviews${r.skipped ? ` · ${r.skipped} skipped` : ''}. Re-importing the same file updates rather than duplicates.`, r.imported ? 'success' : 'info');
      onImported();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const cols = sniff?.detectedColumns;
  return (
    <Dialog title="Import reviews from a CSV" onClose={onClose} wide>
      <div className="rv-form">
        <label className="rv-field">Product
          <select value={asin} onChange={(e) => setAsin(e.target.value)}>
            {products.map((p) => <option key={p.asin} value={p.asin}>{p.title} · {p.asin}</option>)}
          </select>
        </label>
        <details className="rv-details">
          <summary>Where do I get a CSV?</summary>
          <ol>
            <li>Open the listing's reviews, newest first{product ? <> — <a href={`https://www.${product.amazon_domain ?? 'amazon.com'}/product-reviews/${product.asin}?sortBy=recent`} target="_blank" rel="noreferrer">open {product.asin} ↗</a></> : null}.</li>
            <li>Export them with any review exporter (a browser extension such as Instant Data Scraper, or Helium 10 / Jungle Scout exports).</li>
            <li>Drop the file below. Columns are detected automatically; nothing is stored until you press Import.</li>
          </ol>
        </details>
        <div
          className="rv-drop"
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) read(f); }}
        >
          <input ref={input} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
          {busy === 'reading' ? 'Reading…' : fileName ? <>📄 {fileName} — drop another to replace</> : <>Drop a CSV / TSV here, or <u>choose a file</u></>}
        </div>
        {sniff && cols && (
          <div className="rv-sniff">
            <p><b>{sniff.parsedReviews.length}</b> reviews with text, of {sniff.totalRows} rows · detection confidence {Math.round(sniff.confidence * 100)}%</p>
            <dl className="rv-cols">
              {([['Review text', cols.bodyCol], ['Date', cols.dateCol], ['Rating', cols.ratingCol], ['Title', cols.titleCol], ['Author', cols.authorCol], ['Verified', cols.verifiedCol]] as const).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd className={v ? '' : 'rv-muted'}>{v ?? 'not found'}</dd></div>
              ))}
            </dl>
            {!cols.bodyCol && <p className="rv-error">No review-text column was found, so there is nothing to import.</p>}
            {sniff.parsedReviews.slice(0, 3).map((r, i) => (
              <blockquote key={i} className="rv-quote"><span className="rv-muted">{r.date}{r.rating != null ? ` · ${r.rating}★` : ''}</span> {r.body.length > 180 ? `${r.body.slice(0, 180)}…` : r.body}</blockquote>
            ))}
          </div>
        )}
        <div className="rv-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn" disabled={!sniff || !cols?.bodyCol || sniff.parsedReviews.length === 0 || busy !== null || !asin} onClick={() => void importNow()}>
            {busy === 'importing' ? `Scoring ${sniff?.parsedReviews.length ?? ''} reviews…` : `Import ${sniff?.parsedReviews.length ?? ''} reviews`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
