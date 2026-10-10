// Team write access for a shared deployment.
//
// When TEAM_WRITE_TOKEN is set, anyone can read but every write (any non-GET /api request) must
// carry the team code in the `x-team-token` header. That keeps a public demo from spending the
// team's scorer and data-provider credits, or editing the watchlist. Unset, nothing changes: a
// local install stays open, as it always was.
import { timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** The page's own liveness poll; it reads status and is harmless without collection enabled. */
const OPEN_WRITES = new Set(['/api/keep-fresh']);

export const teamToken = (): string | null => process.env.TEAM_WRITE_TOKEN || null;

export function tokenMatches(given: unknown, expected: string | null): boolean {
  if (!expected) return true;
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function teamWriteGuard(req: Request, res: Response, next: NextFunction) {
  const expected = teamToken();
  if (!expected || READ_METHODS.has(req.method) || !req.path.startsWith('/api/') || OPEN_WRITES.has(req.path)) return next();
  if (tokenMatches(req.get('x-team-token'), expected)) return next();
  res.status(401).json({ error: 'This workspace is read-only without the team code.', code: 'team_code_required' });
}

export function registerTeamRoutes(app: Express) {
  // Lets the page decide whether to offer an "unlock" control, and check a code before storing it.
  app.get('/api/session', (req, res) => {
    const expected = teamToken();
    res.json({ write_protected: Boolean(expected), can_write: tokenMatches(req.get('x-team-token'), expected) });
  });
}
