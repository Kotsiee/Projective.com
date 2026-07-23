import type { Severity } from "@projective/ui/fields";
import type {
	MemberPresence,
	MemberRole,
	ProjectMemberRow,
	StageAssignment,
} from "../types/projects-types.ts";

/**
 * member-model — the pure, DOM-free model behind the Members roster. It owns the role/presence/
 * assignment vocabulary the badges + filters read, the assignable-role option lists the invite/edit
 * surfaces render, and the bounded client-side filter/sort pass the island applies over the roster
 * (a small participant list refines in place — no round-trip, unlike the virtualized File Explorer).
 * Side-effect-free so any island/component derives identical results.
 */

// #region Role metadata
/** Presentation metadata for a member role — the badge label, tint, and a one-line access summary. */
export interface RoleMeta {
	label: string;
	severity: Severity;
	/** A short description of the role's access, shown in the badge tooltip + the role filter. */
	blurb: string;
	/** Sort weight so leadership rises to the top of the roster (lower = higher). */
	weight: number;
}

/** The role → badge/tint/description map (task §1.2 badge vocabulary). */
export const ROLE_META: Record<MemberRole, RoleMeta> = {
	client: {
		label: "Client",
		severity: "warning",
		blurb: "Owns the engagement — full oversight of members and stages.",
		weight: 0,
	},
	owner: {
		label: "Owner",
		severity: "warning",
		blurb: "Workspace owner — full oversight of members and stages.",
		weight: 1,
	},
	admin: {
		label: "Admin",
		severity: "help",
		blurb: "Delegated oversight — can manage members, roles, and assignments.",
		weight: 2,
	},
	manager: {
		label: "Manager",
		severity: "info",
		blurb: "Manages members and stage assignments across the engagement.",
		weight: 3,
	},
	freelancer: {
		label: "Freelancer",
		severity: "primary",
		blurb: "Hired contributor — delivers on assigned stages.",
		weight: 4,
	},
	member: {
		label: "Team Member",
		severity: "secondary",
		blurb: "Team seat contributing to the engagement.",
		weight: 5,
	},
	guest: {
		label: "Guest",
		severity: "secondary",
		blurb: "External observer with view-only access.",
		weight: 6,
	},
};

/** The role's badge metadata, falling back to a neutral member for an unknown value. */
export function roleMeta(role: MemberRole): RoleMeta {
	return ROLE_META[role] ?? ROLE_META.member;
}
// #endregion

// #region Presence & assignment metadata
/** Presence dot metadata — the tonal token + the (hover-only, never inline) label. */
export const PRESENCE_META: Record<MemberPresence, { label: string; token: string }> = {
	online: { label: "Online", token: "var(--success)" },
	away: { label: "Away", token: "var(--warning)" },
	offline: { label: "Offline", token: "var(--text-secondary)" },
};

/** Stage-assignment metadata (Assigned Contributor vs Observer, task §1.2). */
export const ASSIGNMENT_META: Record<StageAssignment, { label: string; severity: Severity }> = {
	contributor: { label: "Assigned Contributor", severity: "success" },
	observer: { label: "Observer", severity: "secondary" },
};
// #endregion

// #region Filter options
/** The role filter options, in roster display order. */
export const ROLE_FILTER_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string }> = (
	Object.keys(ROLE_META) as MemberRole[]
).map((role) => ({ value: role, label: ROLE_META[role].label }));

/**
 * The roles a manager/owner can assign to a new or existing member. Owner/client are the engagement
 * authority tier and are not hand-assignable here (they are established when the engagement is created /
 * transferred), so the picker offers the delegated + worker + guest roles.
 */
export const ASSIGNABLE_ROLES: ReadonlyArray<{ value: MemberRole; label: string }> = [
	{ value: "admin", label: "Admin" },
	{ value: "manager", label: "Manager" },
	{ value: "freelancer", label: "Freelancer" },
	{ value: "member", label: "Team Member" },
	{ value: "guest", label: "Guest" },
];
// #endregion

// #region Client-side filter + sort
/** The property the roster sorts on. */
export type MemberSortKey = "name" | "role" | "joined" | "tickets";

/** The active client-side refinement over the bounded roster. */
export interface MemberFilter {
	query: string;
	roles: MemberRole[];
	/** A stage name to restrict to (the stage filter), or "" for all. */
	stage: string;
}

/** Whether a row matches the free-text query (name · handle · email). */
function matchesQuery(row: ProjectMemberRow, q: string): boolean {
	if (!q) return true;
	const needle = q.trim().toLowerCase();
	return (
		row.party.name.toLowerCase().includes(needle) ||
		(row.party.handle ?? "").toLowerCase().includes(needle) ||
		row.email.toLowerCase().includes(needle)
	);
}

/** Filter the roster by search, role set, and assigned stage — a pure pass over the bounded list. */
export function filterMembers(rows: ProjectMemberRow[], f: MemberFilter): ProjectMemberRow[] {
	return rows.filter((r) => {
		if (!matchesQuery(r, f.query)) return false;
		if (f.roles.length > 0 && !f.roles.includes(r.role)) return false;
		if (f.stage && !r.assignedStages.includes(f.stage)) return false;
		return true;
	});
}

/** Sort a filtered roster. `name`/`role`/`tickets`/`joined`, ascending or descending. */
export function sortMembers(
	rows: ProjectMemberRow[],
	key: MemberSortKey,
	dir: "asc" | "desc",
): ProjectMemberRow[] {
	const sign = dir === "asc" ? 1 : -1;
	const out = [...rows];
	out.sort((a, b) => {
		let d = 0;
		switch (key) {
			case "role":
				d = roleMeta(a.role).weight - roleMeta(b.role).weight;
				break;
			case "joined":
				d = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
				break;
			case "tickets":
				d = a.openTickets - b.openTickets;
				break;
			case "name":
			default:
				d = a.party.name.localeCompare(b.party.name);
				break;
		}
		if (d === 0) d = a.party.name.localeCompare(b.party.name);
		return d * sign;
	});
	return out;
}

/** How many refinements are active (drives the toolbar filter dot). */
export function activeFilterCount(f: MemberFilter): number {
	return (f.query ? 1 : 0) + (f.roles.length > 0 ? 1 : 0) + (f.stage ? 1 : 0);
}
// #endregion
