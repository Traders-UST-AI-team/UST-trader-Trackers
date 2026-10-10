/**
 * The view registry: the one place that knows which destinations exist.
 *
 * The same list used to be restated in six places — the `View` union in a component, the hash
 * validator, the header nav, the shortcut table, the shortcut key map, the render list in App and
 * the client test — and the invariants that spanned them ("every view is renderable", "every key
 * maps to a real view") were asserted nowhere. The test had already drifted: it omitted `telegram`
 * and `reviews` while the app offered both. Readers now derive from here.
 */

export type View = 'dashboard' | 'feed' | 'telegram' | 'wallets' | 'alerts' | 'research' | 'sources' | 'reviews';

/** The two products sharing this shell. A view belongs to exactly one. */
export type WorkspaceId = 'dashboard' | 'reviews';

export interface WorkspaceSpec {
  id: WorkspaceId;
  label: string;
}

export const WORKSPACES: WorkspaceSpec[] = [
  { id: 'dashboard', label: 'Traders Tracker' },
  { id: 'reviews', label: 'Customer Reviews' },
];

export interface ViewSpec {
  id: View;
  workspace: WorkspaceId;
  /** Shown in the workspace's header nav. null when the view is only reachable from a sub-nav. */
  navLabel: string | null;
  /** Hover text for the nav button. */
  title: string;
  /** Keyboard key that opens it, if any. Keys 6 and 7 remain aliases for one release. */
  key?: string;
}

export const VIEWS: ViewSpec[] = [
  { id: 'dashboard', workspace: 'dashboard', navLabel: 'Monitor', title: 'Items → contracts → price → save (1)', key: '1' },
  { id: 'feed', workspace: 'dashboard', navLabel: 'Feed', title: 'All sources, including Telegram (2)', key: '2' },
  { id: 'telegram', workspace: 'dashboard', navLabel: null, title: 'Telegram analysis (reached from Feed)' },
  { id: 'wallets', workspace: 'dashboard', navLabel: 'Markets', title: 'Pilot markets, large trades, watched wallets (3)', key: '3' },
  { id: 'research', workspace: 'dashboard', navLabel: 'Research', title: 'Briefing, dossiers, hypotheses (4)', key: '4' },
  { id: 'sources', workspace: 'dashboard', navLabel: 'Sources', title: 'Collection health and alerts (5)', key: '5' },
  { id: 'alerts', workspace: 'dashboard', navLabel: null, title: 'In-app alerts (reached from Sources)' },
  { id: 'reviews', workspace: 'reviews', navLabel: null, title: 'Customer review tone pilot' },
];

export const VIEW_IDS: View[] = VIEWS.map((v) => v.id);

const BY_ID = new Map<string, ViewSpec>(VIEWS.map((v) => [v.id, v]));

export const isView = (value: string): value is View => BY_ID.has(value);

export const viewSpec = (id: View): ViewSpec => BY_ID.get(id)!;

/** The header nav for one workspace, in order. */
export const navItemsFor = (workspace: WorkspaceId): ViewSpec[] =>
  VIEWS.filter((v) => v.workspace === workspace && v.navLabel !== null);

/** Which workspace a view belongs to — the shell switches product on this. */
export const workspaceOf = (id: View): WorkspaceId => viewSpec(id).workspace;

/** Key → view, derived from the registry so the two can never disagree. */
export const viewByKey = (key: string): View | undefined => VIEWS.find((v) => v.key === key)?.id;

/** Keys 6 and 7 stay as aliases for one release (they used to open Research and Sources). */
export const LEGACY_VIEW_ALIASES: Record<string, View> = { '6': 'research', '7': 'sources' };

/** Every key a view can be opened with, including aliases. Used by the shortcut table and handler. */
export const VIEW_KEY_MAP: Record<string, View> = {
  ...Object.fromEntries(VIEWS.filter((v) => v.key).map((v) => [v.key as string, v.id])),
  ...LEGACY_VIEW_ALIASES,
};
