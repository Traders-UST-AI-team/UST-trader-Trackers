// Evaluate the link rule on the labelled benchmark; print term-coverage per pair to help pick a threshold.
import { readFileSync } from 'node:fs';
process.env.TRACKER_DB ??= '/tmp/eval-links.sqlite';
const { matchPair, buildIdf, termCoverage } = await import('../server/link.ts');
const bench = JSON.parse(readFileSync(new URL('../server/fixtures/link_benchmark.json', import.meta.url), 'utf8')).pairs as { event: string; contract: string; label: boolean | null; split: string }[];
const corpus = JSON.parse(readFileSync(new URL('../server/fixtures/contracts_corpus.json', import.meta.url), 'utf8')).texts as string[];
const idf = buildIdf(corpus);
const rows = bench.filter((p) => p.label !== null).map((p) => ({ ...p, tc: termCoverage(p.event, p.contract, idf), pass: matchPair(p.event, p.contract, idf) !== null }));
for (const r of rows.sort((a, b) => a.tc - b.tc)) console.log(r.tc.toFixed(2), r.label ? 'TRUE ' : 'false', r.split.padEnd(10), r.pass ? 'PASS' : 'drop', r.contract.slice(0, 60));
