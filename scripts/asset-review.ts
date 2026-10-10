// J1 — reference-asset review workflow (no automatic edits to data/assets.json).
//   npx tsx scripts/asset-review.ts export   → docs/review/asset_review.csv (every fact and relationship with its citation, dates,
//                                              inferred flags and approximate coordinates; blank review columns)
//   npx tsx scripts/asset-review.ts import <file.csv>  → records each filled row as a review decision (reviewer + decision + note
//                                              required) in the asset_reviews table: an audit trail; assets.json is changed only by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const A = JSON.parse(readFileSync(resolve(ROOT, 'data/assets.json'), 'utf8')) as { assets: Record<string, any>[]; relations: Record<string, any>[] };
const COLS = ['row_key', 'asset_id', 'asset_name', 'kind', 'statement', 'source_url', 'source_date_or_valid_as_of', 'period_or_relation', 'inferred', 'coordinates', 'current_verified_by', 'reviewer', 'decision (confirmed|corrected|rejected|needs_source)', 'correction_or_note'];
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;

function exportCsv(): string {
  const rows: string[][] = [];
  for (const a of A.assets) {
    rows.push([`asset:${a.id}:location`, a.id, a.name, 'location', `${a.type} at approx. ${a.lat}, ${a.lng}`, '', '', `precision: ${a.precision}`, 'coordinates from general geography, not the cited sources', `${a.lat}, ${a.lng}`, a.verified_by ?? '', '', '', '']);
    (a.facts ?? []).forEach((f: Record<string, any>, i: number) => rows.push([`asset:${a.id}:fact:${i}`, a.id, a.name, 'fact', f.claim, f.source_url, f.source_date ?? '', `${f.period ?? ''} (${f.unit ?? ''})`, '', '', a.verified_by ?? '', '', '', '']));
  }
  A.relations.forEach((r, i) => rows.push([`relation:${i}:${r.company}:${r.relation}:${r.asset_id}`, r.asset_id, A.assets.find((a) => a.id === r.asset_id)?.name ?? r.asset_id, 'relationship', `${r.company} ${String(r.relation).replace(/_/g, ' ')} — ${r.detail}`, r.source_url, r.valid_as_of ?? '', r.relation, /inferred/i.test(`${r.detail} ${r.verified_by}`) ? 'yes' : '', '', r.verified_by ?? '', '', '', '']));
  return [COLS.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
}

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

const cmd = process.argv[2];
if (cmd === 'export') {
  const p = resolve(ROOT, 'docs/review/asset_review.csv');
  writeFileSync(p, exportCsv());
  console.log(`wrote ${p}: ${A.assets.length} assets, ${A.assets.reduce((n, a) => n + (a.facts?.length ?? 0), 0)} facts, ${A.relations.length} relationships`);
} else if (cmd === 'import' && process.argv[3]) {
  const { db } = await import('../server/db.ts');
  db.exec('CREATE TABLE IF NOT EXISTS asset_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, row_key TEXT NOT NULL, statement TEXT NOT NULL, decision TEXT NOT NULL, note TEXT, reviewer TEXT NOT NULL, reviewed_at TEXT NOT NULL, file TEXT NOT NULL)');
  const [head, ...rows] = parseCsv(readFileSync(process.argv[3], 'utf8')).filter((r) => r.some((c) => c.trim()));
  const ix = (name: string) => head.findIndex((h) => h.startsWith(name));
  let n = 0, skipped = 0;
  for (const r of rows) {
    const reviewer = r[ix('reviewer')]?.trim(), decision = r[ix('decision')]?.trim(), note = r[ix('correction_or_note')]?.trim();
    if (!reviewer && !decision) continue;
    if (!reviewer || !['confirmed', 'corrected', 'rejected', 'needs_source'].includes(decision) || (decision !== 'confirmed' && !note)) { skipped++; console.warn(`skipped ${r[0]}: needs reviewer, a valid decision and (unless confirmed) a note`); continue; }
    db.prepare('INSERT INTO asset_reviews (row_key, statement, decision, note, reviewer, reviewed_at, file) VALUES (?,?,?,?,?,?,?)').run(r[ix('row_key')], r[ix('statement')], decision, note || null, reviewer, new Date().toISOString(), process.argv[3]);
    n++;
  }
  console.log(`recorded ${n} review decision(s), skipped ${skipped}. data/assets.json was NOT modified — apply corrections by hand and keep the review trail.`);
} else {
  console.log('usage: npx tsx scripts/asset-review.ts export | import <file.csv>');
}
