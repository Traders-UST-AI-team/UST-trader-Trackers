// Client-visible maritime (K1) contracts. Positions are always unavailable until an authorized AIS feed exists (K2).
export interface VesselView {
  id: string; display_name: string; notes: string; watched: boolean; created_at: string; version: number;
  current: Record<string, string | null>;
  identifiers: { kind: string; value: string; valid_from: string | null; valid_to: string | null; source_url: string; source_note: string | null; recorded_at: string }[];
  attributes: { attr: string; value: string; source_url: string; as_of: string | null; recorded_at: string }[];
  mentions: { id: string; source_ref: string; basis: string; evidence: string; status: string; reviewer: string | null; reviewed_at: string | null; note: string | null }[];
  position: { status: 'unavailable'; reason: string };
}
