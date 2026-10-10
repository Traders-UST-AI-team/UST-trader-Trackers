import { exportSeed } from '../server/seed.ts';
const r = exportSeed();
console.log('wrote', r.path, r.rows);
