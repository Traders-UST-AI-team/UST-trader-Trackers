// Email drop-folder adapter: advisory emails the USER is entitled to receive (e.g. a subscription to a maritime advisory list) are saved as
// .eml files in data/inbox/ and ingested here. Generic RFC-822 parsing only — nothing sender-specific is assumed. A per-sender profile
// (data/inbox/senders.json) sets name/tier/affiliation/scope; unknown senders default to an explicitly unrated Tier-2.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestParsed, outletKey, stripHtml, type ParsedItem, type RssResult } from './rss.ts';
import type { NewsSource } from '../registry.ts';

export const INBOX_DIR = process.env.TRACKER_INBOX ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'inbox');

export interface SenderProfile { match: string; name: string; tier: 'Tier-1' | 'Tier-2' | 'Tier-3'; affiliation: string; scope?: string }
export interface ParsedEmail { messageId: string | null; from: string; fromAddress: string; subject: string; date: string | null; body: string }

const decodeWords = (s: string) => s.replace(/=\?([\w-]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, txt: string) => {
  try {
    const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return new TextDecoder(cs.toLowerCase() === 'utf-8' ? 'utf-8' : 'latin1').decode(bytes);
  } catch { return txt; }
}).replace(/\?=\s+=\?/g, '');

function headersOf(block: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of block.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n')) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  return h;
}
const splitPart = (raw: string) => { const norm = raw.replace(/\r\n/g, '\n'); const i = norm.indexOf('\n\n'); return i < 0 ? { head: norm, body: '' } : { head: norm.slice(0, i), body: norm.slice(i + 2) }; };

function decodeBody(body: string, enc: string | undefined, charset: string | undefined): string {
  let bytes: Buffer;
  const e = (enc ?? '').toLowerCase();
  if (e === 'base64') bytes = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (e === 'quoted-printable') bytes = Buffer.from(body.replace(/=\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  else bytes = Buffer.from(body, 'utf8');
  try { return new TextDecoder(/utf-?8/i.test(charset ?? 'utf-8') ? 'utf-8' : 'latin1').decode(bytes); } catch { return bytes.toString('utf8'); }
}

function textOf(raw: string): string {
  const { head, body } = splitPart(raw);
  const h = headersOf(head);
  const ct = h['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (/multipart\//i.test(ct) && boundary) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--')).map((p) => p.replace(/^\n/, ''));
    const texts = parts.map((p) => ({ ct: (headersOf(splitPart(p).head)['content-type'] ?? 'text/plain').toLowerCase(), txt: textOf(p) }));
    return (texts.find((t) => t.ct.startsWith('text/plain')) ?? texts.find((t) => t.ct.startsWith('text/html')) ?? texts[0])?.txt ?? '';
  }
  const decoded = decodeBody(body, h['content-transfer-encoding'], /charset="?([^";]+)"?/i.exec(ct)?.[1]);
  return /text\/html/i.test(ct) ? stripHtml(decoded) : decoded;
}

export function parseEml(raw: string): ParsedEmail {
  const { head } = splitPart(raw);
  const h = headersOf(head);
  const from = decodeWords(h.from ?? '');
  const ts = Date.parse(h.date ?? '');
  let body = textOf(raw).replace(/\r/g, '');
  body = body.split(/\n-- ?\n/)[0].split('\n').filter((l) => !/^>/.test(l)).join('\n'); // drop signature and quoted replies
  return {
    messageId: h['message-id']?.replace(/[<>]/g, '') ?? null, from, fromAddress: /<([^>]+)>/.exec(from)?.[1] ?? from.trim(),
    subject: decodeWords(h.subject ?? '').replace(/^\s*((fwd?|re):\s*|\[external\]\s*)+/gi, '').trim(),
    date: Number.isFinite(ts) ? new Date(ts).toISOString() : null, body: body.replace(/\n{3,}/g, '\n\n').trim(),
  };
}

export function loadProfiles(dir = INBOX_DIR): SenderProfile[] {
  const f = join(dir, 'senders.json');
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')) as SenderProfile[]; } catch { return []; }
}

const UNRATED: Omit<SenderProfile, 'match'> = { name: 'Email sender (not individually rated)', tier: 'Tier-2', affiliation: 'User-supplied advisory email from a sender without a profile in data/inbox/senders.json; treat as unrated' };

export function emailItem(e: ParsedEmail, file: string, profiles: SenderProfile[]): ParsedItem | null {
  if (!e.date || !e.subject) return null; // no timestamp or no subject → not a usable record
  const p = profiles.find((x) => e.fromAddress.toLowerCase().includes(x.match.toLowerCase())) ?? { match: '', ...UNRATED };
  const id = e.messageId ?? createHash('sha1').update(`${e.fromAddress}|${e.date}|${e.subject}`).digest('hex');
  return {
    externalId: id, url: `file://${file}`, title: e.subject, summary: e.body.replace(/\s+/g, ' ').slice(0, 700), publishedAt: e.date,
    publisher: p.name, tier: p.tier, originating: `Email from ${e.fromAddress} (user-supplied; ${p.affiliation})`, countries: [], outlet: outletKey(p.name),
  };
}

export async function ingestInbox(src: NewsSource): Promise<RssResult> {
  if (!existsSync(INBOX_DIR)) mkdirSync(INBOX_DIR, { recursive: true });
  const files = readdirSync(INBOX_DIR).filter((f) => f.toLowerCase().endsWith('.eml')).sort();
  const profiles = loadProfiles();
  const items: ParsedItem[] = [];
  for (const f of files.slice(-src.maxItems)) {
    const it = emailItem(parseEml(readFileSync(join(INBOX_DIR, f), 'utf8')), join(INBOX_DIR, f), profiles);
    if (it) items.push(it);
  }
  return ingestParsed(src, items); // an empty inbox is a quiet source, not a failure
}
