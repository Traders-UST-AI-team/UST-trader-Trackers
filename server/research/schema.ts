// Research workspace + claim review schema (RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md §3, UNIFIED_MONITOR_PLAN.md §12 H1).
// Additive and repeatable. Source records stay in their original tables; research rows point at them by stable feed key
// ('web:<source>:<external id>' | 'telegram:<channel>:<post id>') and at an immutable captured version.
import type { DatabaseSync } from 'node:sqlite';

export function migrateResearch(db: DatabaseSync) {
  // Never-populated drafts from an earlier attempt with a different shape: dropped only when empty.
  for (const t of ['claims', 'claim_evidence', 'research_dossiers', 'dossier_items', 'research_tasks', 'research_hypotheses', 'hypothesis_evidence', 'calendar_entries']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[];
    const current = cols.some((c) => c.name === 'version' || c.name === 'version_id' || c.name === 'attached_version_id' || c.name === 'first_known_at');
    if (cols.length && !current && (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c === 0) db.exec(`DROP TABLE ${t}`);
  }
  db.exec(`
  -- W0: immutable source versions, captured prospectively (nothing earlier than the first capture is reconstructed)
  CREATE TABLE IF NOT EXISTS source_item_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL, content_hash TEXT NOT NULL,
    title TEXT, excerpt TEXT, url TEXT, published_at TEXT, time_precision TEXT, source_modified_at TEXT, collected_at TEXT,
    captured_at TEXT NOT NULL,
    kind TEXT NOT NULL  -- first_capture | publisher_revision (source-reported modification) | content_changed (edit seen locally) | unavailable | restored
  );
  CREATE INDEX IF NOT EXISTS idx_siv_ref ON source_item_versions (ref, id DESC);
  CREATE TABLE IF NOT EXISTS collection_attempts (   -- telemetry from its actual start; earlier continuity is unknown
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL, partial INTEGER NOT NULL, manual INTEGER NOT NULL, error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_attempts ON collection_attempts (source_id, at);
  CREATE TABLE IF NOT EXISTS source_set_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS research_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, before TEXT, after TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON research_audit (entity, entity_id, id);

  -- H1: claims are attributed statements inside one source item; workflow state and assessment are separate fields
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY, source_ref TEXT NOT NULL, version_id INTEGER NOT NULL, quote TEXT NOT NULL, quote_start INTEGER, quote_end INTEGER,
    actor TEXT, action TEXT, place TEXT, stated_time TEXT, stated_time_precision TEXT, attribution TEXT,
    workflow_state TEXT NOT NULL DEFAULT 'unreviewed', assessment TEXT NOT NULL DEFAULT 'insufficient', rule_version TEXT NOT NULL,
    reviewer TEXT, reviewed_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_claims_ref ON claims (source_ref);
  CREATE TABLE IF NOT EXISTS claim_evidence (
    id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, source_ref TEXT NOT NULL, version_id INTEGER NOT NULL, relationship TEXT NOT NULL,
    rationale TEXT NOT NULL, origin_group TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, removed_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_ev ON claim_evidence (claim_id, source_ref) WHERE removed_at IS NULL;
  CREATE TABLE IF NOT EXISTS claim_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, claim_id TEXT NOT NULL, at TEXT NOT NULL, reviewer TEXT NOT NULL, prev_state TEXT, new_state TEXT NOT NULL,
    prev_assessment TEXT, new_assessment TEXT NOT NULL, rationale TEXT NOT NULL, evidence_versions TEXT NOT NULL, rule_version TEXT NOT NULL
  );

  -- W1: dossiers (user-reviewed groupings — not story clusters, not verified incidents)
  CREATE TABLE IF NOT EXISTS research_dossiers (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', workflow_state TEXT NOT NULL DEFAULT 'open', owner_label TEXT NOT NULL DEFAULT 'me',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS dossier_items (
    dossier_id TEXT NOT NULL, source_ref TEXT NOT NULL, relationship TEXT NOT NULL, attached_version_id INTEGER NOT NULL, basis TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '', attached_at TEXT NOT NULL, detached_at TEXT, PRIMARY KEY (dossier_id, source_ref)
  );
  CREATE TABLE IF NOT EXISTS research_tasks (
    id TEXT PRIMARY KEY, dossier_id TEXT, hypothesis_id TEXT, question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', due_at TEXT,
    resolution_note TEXT, evidence_refs TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, version INTEGER NOT NULL DEFAULT 1
  );

  -- W3: hypotheses (the user's research judgments; never a truth engine)
  CREATE TABLE IF NOT EXISTS research_hypotheses (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, statement TEXT NOT NULL, scope TEXT NOT NULL, targets TEXT NOT NULL DEFAULT '[]', rationale TEXT NOT NULL DEFAULT '',
    invalidation_conditions TEXT NOT NULL, alternative TEXT, status TEXT NOT NULL DEFAULT 'draft', assessment TEXT NOT NULL DEFAULT 'insufficient',
    next_check_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS hypothesis_evidence (
    hypothesis_id TEXT NOT NULL, ref TEXT NOT NULL, version_id INTEGER, relationship TEXT NOT NULL, rationale TEXT NOT NULL,
    reviewer TEXT NOT NULL, reviewed_at TEXT NOT NULL, removed_at TEXT, PRIMARY KEY (hypothesis_id, ref)
  );
  CREATE TABLE IF NOT EXISTS research_decisions (   -- append-only
    id INTEGER PRIMARY KEY AUTOINCREMENT, hypothesis_id TEXT NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL, prev_assessment TEXT NOT NULL,
    new_assessment TEXT NOT NULL, rationale TEXT NOT NULL, evidence_versions TEXT NOT NULL
  );

  -- W4: calendar (provider end dates keep provider meaning; manual entries carry their own source and zone)
  CREATE TABLE IF NOT EXISTS calendar_entries (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, condition_id TEXT, title TEXT NOT NULL, start_utc TEXT, date_local TEXT, time_precision TEXT NOT NULL,
    tz TEXT NOT NULL, basis TEXT NOT NULL, source_url TEXT, status TEXT NOT NULL, first_known_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS calendar_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, at TEXT NOT NULL, field TEXT NOT NULL, before TEXT, after TEXT, basis TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_preferences (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
}
