import type { LaneTabOption } from "@projective/ui/navigation";
import {
	kindCopy,
	kindFromPath,
	roleRank,
	type WorkspaceInvite,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceProject,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { isModuleKey, type ModuleKey } from "./module-registry.tsx";

/**
 * workspace-model — the pure, presentation-agnostic helpers the `/teams` and `/businesses` islands
 * share: URL parsing, roster and roster-tab filtering, member filtering and sorting, the per-module
 * header tab sets, entity-badge initials, and the small formatters the surface needs.
 *
 * Everything here is a **total function of its arguments**: no state, no signals, no DOM, no fetch. That
 * is what lets a server-side slot resolver and a client island call the same helper and agree, which is
 * the only way the first painted byte can match what hydration then re-renders.
 *
 * **Money is conspicuously absent.** Nothing in this file totals, splits, converts or fee-adjusts a
 * figure — every monetary string on the surface is a server-computed `MoneyView.display` (root CLAUDE.md
 * §12 · Decision #55). Shares are integer basis points, resolved server-side; the split editor's local
 * arithmetic is the SSOT's own `rebalanceSplit`, not a helper invented here.
 */

// #region Path parsing
/**
 * The entity id a workspace URL addresses, or `null` on the roster index.
 *
 * `/teams` → `null` · `/teams/acme` → `"acme"` · `/teams/acme/members` → `"acme"`.
 */
export function workspaceIdOf(pathname: string): string | null {
	const segments = pathname.split("/").filter(Boolean);
	if (kindFromPath(pathname) === null) return null;
	return segments[1] ?? null;
}

/**
 * The module a workspace URL addresses.
 *
 * An entity URL with no module segment resolves to `overview`, because a bare `/teams/acme` IS the
 * overview rather than an incomplete address. An unrecognised segment resolves to `null` so the route
 * can 404 it honestly instead of silently showing the overview and leaving the reader to wonder why
 * their link went somewhere else. The roster index (`/teams`) also returns `null` — it has no module.
 */
export function activeModuleOf(pathname: string): ModuleKey | null {
	const segments = pathname.split("/").filter(Boolean);
	if (kindFromPath(pathname) === null) return null;
	if (segments.length < 2) return null;
	const raw = segments[2];
	if (raw === undefined) return "overview";
	return isModuleKey(raw) ? raw : null;
}

/** The entity kind a path addresses (`/teams` → `team`), or `null` off the workspace surface. */
export { kindFromPath };
// #endregion

// #region Roster tabs
/**
 * The roster index's partitions. `invitations` is a genuinely different list (invitations addressed to
 * the VIEWER, not entities they belong to), which is why it is a tab rather than a filter — collapsing
 * it into `all` would put rows the viewer must answer beside rows they merely own.
 */
export type RosterTab = "all" | "owned" | "member" | "invitations" | "archived";

/** The roster tab strip. Counts are appended by the caller so this stays a pure vocabulary. */
export const ROSTER_TABS: readonly LaneTabOption<RosterTab>[] = [
	{ value: "all", label: "All" },
	{ value: "owned", label: "Owned" },
	{ value: "member", label: "Member of" },
	{ value: "invitations", label: "Invitations" },
	{ value: "archived", label: "Archived" },
];

/** Coerce a raw query value to a roster tab, else `all`. */
export function toRosterTab(raw: string | null): RosterTab {
	const tabs: RosterTab[] = ["all", "owned", "member", "invitations", "archived"];
	return tabs.includes(raw as RosterTab) ? (raw as RosterTab) : "all";
}

/**
 * Filter the roster for a tab and an optional search term.
 *
 * Archived entities are excluded from every tab except `archived`: nothing is ever hard-deleted, so an
 * archived entity must remain reachable — but leaving it in the default list would make a tidied roster
 * look untidied. The `invitations` tab shows no entities at all (its rows are the incoming invites the
 * caller renders separately), so it returns empty rather than the full list.
 */
export function filterRoster(
	items: readonly WorkspaceSummary[],
	tab: RosterTab,
	search = "",
): WorkspaceSummary[] {
	const needle = search.trim().toLowerCase();
	return items.filter((item) => {
		if (tab === "invitations") return false;
		if (tab === "archived") {
			if (item.status !== "archived") return false;
		} else if (item.status === "archived") return false;
		if (tab === "owned" && !item.isOwner) return false;
		if (tab === "member" && item.isOwner) return false;
		if (!needle) return true;
		return item.name.toLowerCase().includes(needle) ||
			item.handle.toLowerCase().includes(needle) ||
			item.tagline.toLowerCase().includes(needle);
	});
}

/** How many rows each roster tab would show — the strip's counts, computed once from one pass. */
export function rosterTabCounts(
	items: readonly WorkspaceSummary[],
	invitations: readonly { id: string }[],
): Record<RosterTab, number> {
	const live = items.filter((i) => i.status !== "archived");
	return {
		all: live.length,
		owned: live.filter((i) => i.isOwner).length,
		member: live.filter((i) => !i.isOwner).length,
		invitations: invitations.length,
		archived: items.filter((i) => i.status === "archived").length,
	};
}
// #endregion

// #region Header tab sets
/** A header band tab — an underlined text link, never a pill (§B.4 / the visual contract). */
export interface ModuleTab {
	/** URL-safe value; the module reads it from `?view=`. */
	value: string;
	label: string;
}

/**
 * The header band's tabs for a module, or an empty array when the module has a single view.
 *
 * Sub-views live in the HEADER, not the body: the body's remit is viewing and selecting data, so a
 * module that partitions its content advertises those partitions in the chrome where every other
 * navigation on the surface already lives. A module absent from this table simply has one view — an
 * empty array is a legitimate answer, not a gap.
 */
export function moduleTabsFor(module: ModuleKey, kind: WorkspaceKind): ModuleTab[] {
	switch (module) {
		case "members":
			return [
				{ value: "all", label: "All" },
				{ value: "pending", label: "Pending" },
				{ value: "roles", label: "Roles" },
			];
		case "projects":
			return [
				{ value: "active", label: "Active" },
				{ value: "proposals", label: "Proposals" },
				{ value: "completed", label: "Completed" },
			];
		case "invitations":
			return [
				{ value: "sent", label: "Sent" },
				{ value: "requests", label: "Requests" },
				{ value: "links", label: "Links" },
			];
		case "finance":
			return kind === "team"
				? [
					{ value: "summary", label: "Summary" },
					{ value: "earnings", label: "Earnings" },
					{ value: "distributions", label: "Distributions" },
				]
				: [
					{ value: "summary", label: "Summary" },
					{ value: "contributions", label: "Contributions" },
					{ value: "spending", label: "Spending" },
				];
		case "spend":
			return [
				{ value: "limits", label: "Limits" },
				{ value: "requests", label: "Requests" },
				{ value: "ledger", label: "Ledger" },
			];
		case "payouts":
			return [
				{ value: "split", label: "Split" },
				{ value: "templates", label: "Templates" },
				{ value: "history", label: "History" },
			];
		case "roles":
			return [
				{ value: "matrix", label: "Matrix" },
				{ value: "list", label: "Roles" },
			];
		case "talent":
			return [
				{ value: "bench", label: "Bench" },
				{ value: "past", label: "Past" },
			];
		default:
			return [];
	}
}

/** The first tab of a module's set — the view a bare module URL resolves to. */
export function defaultModuleTab(module: ModuleKey, kind: WorkspaceKind): string | null {
	return moduleTabsFor(module, kind)[0]?.value ?? null;
}

/** Coerce a raw `?view=` value against a module's tab set, falling back to its default. */
export function toModuleTab(
	module: ModuleKey,
	kind: WorkspaceKind,
	raw: string | null,
): string | null {
	const tabs = moduleTabsFor(module, kind);
	if (tabs.length === 0) return null;
	return tabs.some((t) => t.value === raw) ? raw : tabs[0].value;
}
// #endregion

// #region Member filtering & sorting
/** How the roster orders its people. */
export type MemberSort = "role" | "name" | "workload" | "joined";

/** The member sort options (feeds a `SortControl` / `Select`). */
export const MEMBER_SORTS: readonly ModuleTab[] = [
	{ value: "role", label: "Role" },
	{ value: "name", label: "Name" },
	{ value: "workload", label: "Workload" },
	{ value: "joined", label: "Joined" },
];

/** The member-list filter state. Every field is optional — an unset field filters nothing. */
export interface MemberFilter {
	/** Free text over name, handle and title. */
	search?: string;
	/** Restrict to one membership state (`active` · `invited` · `requested` · `left`). */
	state?: WorkspaceMember["state"];
	/** Restrict to holders of one role id. */
	roleId?: string;
	/** Restrict to one availability signal. */
	availability?: WorkspaceMember["availability"];
}

/**
 * Filter a member list. Departed members (`left`) are excluded unless explicitly asked for, because a
 * soft-removed person is retained for audit, not for the roster — showing them by default would make an
 * entity look larger than it is.
 */
export function filterMembers(
	members: readonly WorkspaceMember[],
	filter: MemberFilter = {},
): WorkspaceMember[] {
	const needle = (filter.search ?? "").trim().toLowerCase();
	return members.filter((m) => {
		if (filter.state ? m.state !== filter.state : m.state === "left") return false;
		if (filter.roleId && m.roleId !== filter.roleId) return false;
		if (filter.availability && m.availability !== filter.availability) return false;
		if (!needle) return true;
		return m.name.toLowerCase().includes(needle) ||
			m.handle.toLowerCase().includes(needle) ||
			(m.title ?? "").toLowerCase().includes(needle);
	});
}

/**
 * Sort a member list. Returns a NEW array — mutating a prop array is how a signal-driven list starts
 * re-rendering with an order the server never sent.
 *
 * `role` (the default) is authority-descending with name as the tie-break, so the people who can change
 * things sit where a reader looks first. `workload` is descending because "who is most loaded" is the
 * question a workload column is actually asked.
 */
export function sortMembers(
	members: readonly WorkspaceMember[],
	sort: MemberSort = "role",
	dir: "asc" | "desc" = sort === "name" || sort === "joined" ? "asc" : "desc",
): WorkspaceMember[] {
	const sign = dir === "asc" ? 1 : -1;
	const byName = (a: WorkspaceMember, b: WorkspaceMember) => a.name.localeCompare(b.name, "en-GB");
	const out = [...members];
	out.sort((a, b) => {
		switch (sort) {
			case "name":
				return sign * byName(a, b);
			case "workload":
				return sign * (a.workload - b.workload) || byName(a, b);
			case "joined":
				return sign * a.joinedAt.localeCompare(b.joinedAt) || byName(a, b);
			case "role":
				return sign * (roleRank(a.rolePreset) - roleRank(b.rolePreset)) || byName(a, b);
		}
	});
	return out;
}

/** Pending decisions on the entity — invitations sent and join requests received, in one queue. */
export function pendingMembers(members: readonly WorkspaceMember[]): WorkspaceMember[] {
	return members.filter((m) => m.state === "invited" || m.state === "requested");
}

/** Split an invite list into the two directions the queue renders with opposite actions. */
export function partitionInvites(invites: readonly WorkspaceInvite[]): {
	sent: WorkspaceInvite[];
	requests: WorkspaceInvite[];
	links: WorkspaceInvite[];
} {
	return {
		sent: invites.filter((i) => i.direction === "invite" && !i.viaLink),
		requests: invites.filter((i) => i.direction === "request"),
		links: invites.filter((i) => i.viaLink),
	};
}
// #endregion

// #region Projects
/** Filter the console's project list to a header tab (`active` · `proposals` · `completed`). */
export function filterProjects(
	projects: readonly WorkspaceProject[],
	view: string,
): WorkspaceProject[] {
	const state = view === "proposals" ? "proposal" : view === "completed" ? "completed" : "active";
	return projects.filter((p) => p.state === state);
}
// #endregion

// #region Presentation helpers
/**
 * Initials for the entity's rounded-square mark — up to two letters, from the first and last
 * significant words, so "Atlas Collective" reads `AC` and "Northwind" reads `N`.
 *
 * Falls back to the handle, then to a single `·`, so the badge is never blank: an empty mark reads as a
 * broken image rather than as an entity that simply has no logo yet.
 */
export function initialsOf(name: string, handle = ""): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		const h = handle.replace(/[^a-z0-9]/gi, "");
		return h ? h.slice(0, 2).toUpperCase() : "·";
	}
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A short British date from an ISO timestamp — `"12 Aug"`, gaining a year when it falls outside
 * `referenceYear` (`"12 Aug 2025"`).
 *
 * Pass `referenceYear` explicitly from a server-resolved value wherever SSR and hydration must agree
 * byte-for-byte; the default reads the local clock, which is fine for anything rendered client-side but
 * would differ across a New Year boundary between server and client.
 */
export function shortDate(iso: string, referenceYear = new Date().getFullYear()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
	return date.getFullYear() === referenceYear ? day : `${day} ${date.getFullYear()}`;
}

/**
 * The tonal key for an availability signal, consumed as `data-availability` in CSS so the colour lives
 * in the stylesheet's tokens rather than in a component (§4 — token-only, no inline styles).
 */
export function availabilityTone(
	availability: WorkspaceMember["availability"],
): "success" | "warning" | "muted" {
	if (availability === "available") return "success";
	if (availability === "limited") return "warning";
	return "muted";
}

/** Sentence-case label for a membership state, for a status chip's tooltip. */
export function membershipLabel(state: WorkspaceMember["state"]): string {
	switch (state) {
		case "active":
			return "Active member";
		case "invited":
			return "Invitation sent";
		case "requested":
			return "Asked to join";
		case "left":
			return "No longer a member";
	}
}

/**
 * The plural noun for a count, kind-aware — `1 team` / `3 teams`. Uses the SSOT's per-kind copy table
 * so a screen never inlines the word "team" and then has to be found again when a kind is renamed.
 */
export function countLabel(kind: WorkspaceKind, count: number): string {
	const copy = kindCopy(kind);
	return `${count} ${count === 1 ? copy.noun : copy.plural}`;
}
// #endregion
