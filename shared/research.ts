// Contracts for the research workspace (RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md) and claim review (UNIFIED_MONITOR_PLAN.md §12 H1).
// Source records, dossiers, claims and hypotheses stay distinct; every judgment carries an author, time, rationale and the exact
// source versions it was made on.

export const CLAIM_RULE_VERSION = 'claim-review-1.0';

export interface SourceItemRef {
  ref: string; platform: 'web' | 'telegram'; event_id: string | null; source_id: string; source_name: string; title: string; text: string; url: string;
  published_at: string; time_precision: 'instant' | 'date'; collected_at: string; source_modified_at: string | null; language: string | null;
  tier: string | null; viewpoint_label: string | null; origin_group: string; place: string | null;
}
export type VersionKind = 'first_capture' | 'publisher_revision' | 'content_changed' | 'unavailable' | 'restored';
export interface SourceVersion {
  id: number; ref: string; content_hash: string; title: string | null; excerpt: string | null; url: string | null; published_at: string | null;
  time_precision: string | null; source_modified_at: string | null; collected_at: string | null; captured_at: string; kind: VersionKind;
}
export interface AuditEntry { at: string; actor: string; action: string; before: unknown; after: unknown }

// ── H1 claims ──
export type ClaimWorkflow = 'unreviewed' | 'in_review' | 'reviewed';
export type ClaimAssessment = 'insufficient' | 'supported' | 'contradicted' | 'contested';
export type EvidenceRelationship = 'supporting' | 'contradicting' | 'unclear';
export interface ClaimEvidenceView {
  id: string; source_ref: string; version_id: number; relationship: EvidenceRelationship; rationale: string; origin_group: string; added_by: string; added_at: string;
  source: SourceItemRef | null; version: SourceVersion | null; newer_version: SourceVersion | null;
}
export interface ClaimView {
  id: string; source_ref: string; version_id: number; quote: string; actor: string | null; action: string | null; place: string | null;
  stated_time: string | null; stated_time_precision: string | null; attribution: string | null;
  workflow_state: ClaimWorkflow; assessment: ClaimAssessment; rule_version: string; reviewer: string | null; reviewed_at: string | null;
  created_at: string; version: number; source: SourceItemRef | null; evidence: ClaimEvidenceView[];
  /** Distinct evidence-origin groups per relationship (retellings of one upstream report count once). */
  origin_groups: Record<EvidenceRelationship, number>;
  review_needed: string | null; history: { at: string; reviewer: string; prev_state: string | null; new_state: string; prev_assessment: string | null; new_assessment: string; rationale: string; evidence_versions: number[] }[];
}

// ── W1 dossiers ──
export type DossierState = 'open' | 'active' | 'closed';
export type ItemRelationship = 'report' | 'update' | 'correction' | 'context';
export interface DossierSummary { id: string; title: string; description: string; workflow_state: DossierState; created_at: string; updated_at: string; version: number; items: number; open_tasks: number; claims: number }
export interface TimelineItem {
  source_ref: string; relationship: ItemRelationship; basis: 'manual' | 'accepted_suggestion'; rationale: string; attached_at: string;
  attached_version: SourceVersion | null; source: SourceItemRef | null; versions: SourceVersion[]; changed_since_attach: boolean;
}
export interface Suggestion { source_ref: string; title: string; source_name: string; published_at: string; time_precision: string; reason: string }
export interface TaskView {
  id: string; dossier_id: string | null; hypothesis_id: string | null; question: string; status: 'open' | 'resolved' | 'dismissed'; due_at: string | null;
  resolution_note: string | null; evidence_refs: string[]; created_at: string; updated_at: string; resolved_at: string | null; version: number;
}
export interface Disagreement { field: 'place' | 'stated_time' | 'actor' | 'action'; values: { value: string; claims: { id: string; source_name: string; attribution: string | null }[] }[] }
export interface DossierDetail { dossier: DossierSummary; timeline: TimelineItem[]; suggestions: Suggestion[]; tasks: TaskView[]; claims: ClaimView[]; disagreements: Disagreement[]; audit: AuditEntry[] }

// ── W3 hypotheses ──
export type HypothesisStatus = 'draft' | 'active' | 'closed';
export type HypothesisAssessment = 'insufficient' | 'strengthened' | 'weakened' | 'unchanged';
export interface HypothesisEvidenceView {
  ref: string; version_id: number | null; relationship: EvidenceRelationship; rationale: string; reviewer: string; reviewed_at: string;
  source: SourceItemRef | null; claim: { id: string; quote: string; assessment: ClaimAssessment } | null; newer_version: SourceVersion | null;
}
export interface HypothesisView {
  id: string; title: string; statement: string; scope: string; targets: string[]; rationale: string; invalidation_conditions: string; alternative: string | null;
  status: HypothesisStatus; assessment: HypothesisAssessment; next_check_at: string | null; created_at: string; updated_at: string; version: number;
  evidence: HypothesisEvidenceView[]; review_needed: string[]; decisions: { at: string; author: string; prev_assessment: string; new_assessment: string; rationale: string; evidence_versions: { ref: string; version_id: number | null }[] }[];
  tasks: TaskView[];
}

// ── W4 calendar ──
export type CalendarStatus = 'scheduled' | 'revised' | 'postponed' | 'cancelled' | 'unknown' | 'closed';
export interface CalendarEntryView {
  id: string; kind: 'provider_end_date' | 'manual'; condition_id: string | null; venue: string | null; title: string;
  start_utc: string | null; date_local: string | null; time_precision: 'instant' | 'date'; tz: string; basis: string; source_url: string | null;
  status: CalendarStatus; first_known_at: string; updated_at: string; notes: string; version: number;
  revisions: { at: string; field: string; before: string | null; after: string | null; basis: string }[];
}

// ── W5 coverage ──
export interface CoverageSource {
  source_id: string; name: string; kind: string; status: string; last_success_at: string | null; newest_data_at: string | null; assessment: string;
  attempts: { window_h: number; scheduled_ok: number; scheduled_total: number; rate: number | null; manual: number; partial: number; since: string | null };
  breaker_open_until: string | null; languages: string[]; scope: string | null;
}
export interface CoverageReport {
  generated_at: string; window_h: number; telemetry_since: string | null; sources: CoverageSource[];
  telegram: { channel: string; enabled: boolean; open_gaps: number; lag_n: number; lag_median_s: number | null; last_error: string | null }[];
  wallet_gaps: { target: string; from: string; to: string }[];
  lag_cohorts: { cohort: string; n: number; median_s: number | null; p90_s: number | null; note: string }[];
  source_set_changes: { at: string; kind: string; detail: string }[];
  all_relevant_down: boolean; notes: string[];
}

// ── W2 observation targets ──
export interface ObservationTarget {
  id: string; name: string; kind: 'chokepoint' | 'port' | 'facility'; pinned: boolean;
  series: { id: string; title: string; unit: string; latest: { t: string; v: number } | null; previous: { t: string; v: number } | null; change_pct: number | null;
    change_basis: string; status: string; expected_lag: string; provider: string; definition: string;
    /** Server indicator baseline_28d (ind-1.0.0) when available; null when not applicable. */
    baseline_28d: { pct: number | null; mean: number | null; status: string; reason: string | null } | null }[];
  reports: { source_ref: string; title: string; source_name: string; published_at: string; time_precision: string }[];
  vessels: { status: 'unavailable'; reason: string };
  notes: string[];
}
