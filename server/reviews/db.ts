import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateReviews } from './schema.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REVIEWS_DB_PATH = process.env.REVIEWS_DB ?? resolve(root, 'data', 'reviews.sqlite');

/**
 * Opens the reviews store and brings its schema up to date.
 *
 * Deliberately does three things and no more: open, configure, migrate. It does not seed and it
 * keeps no module-global handle, so the caller owns the lifetime and can point it at its own
 * database. Seeding is a separate, explicit boot step (`seedReviewsDatabase`) that only ever
 * replaces rows it owns.
 */
export function openReviewsStore(path: string = REVIEWS_DB_PATH): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrateReviews(db);
  return db;
}

/** Closes a handle from `openReviewsStore`. Safe to call twice (e.g. from a signal handler). */
export function closeReviewsStore(db: DatabaseSync): void {
  try {
    db.close();
  } catch {
    // already closed
  }
}

/**
 * Runs `fn` inside one transaction on this store. The reviews store has its own connection, so it
 * cannot use the main database's `tx()`; this is the equivalent primitive at its own seam. Callers
 * must not perform network I/O inside `fn` — that would hold the write lock for the length of a
 * scoring round-trip.
 */
export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    throw e;
  }
}
