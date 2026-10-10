import { runIngest } from './ingest.ts';
const cmd = process.argv[2];
if (cmd === 'ingest') {
  const r = await runIngest({ force: process.argv.includes('--force') });
  console.log(JSON.stringify(r, null, 2));
  process.exit(Object.values(r.results).every((x) => x.ok) ? 0 : 1);
} else {
  console.log('usage: tsx server/cli.ts ingest');
}
