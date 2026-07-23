import type {
	MemberInvite,
	MemberRole,
	MemberRosterPage,
	MemberRosterParams,
	MemberStageRef,
	MemberViewerCaps,
	ProjectDetail,
	ProjectFormat,
	ProjectMemberRow,
	ProjectParty,
	StageAssignment,
} from "@projective/types/projects";
import { findProjectDetail } from "./detail-fixtures.ts";

/**
 * projects members fixtures — the fat {@link ProjectBackendService}'s in-memory answer for the Members
 * roster read (`/projects/[projectId]/members` + the channel-scoped variant), while
 * `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10). Rather than author a second
 * corpus this DERIVES the rich {@link MemberRosterPage} deterministically from the same
 * {@link ProjectDetail} the sidebar uses — so the roster always agrees with the engagement that linked
 * to it — and the live path (RLS-scoped `projects.project_participants` + `org.*_members` +
 * `projects.invitations`) replaces this builder behind the same gate with zero shape churn. No RNG: a
 * small slug/id hash gives stable per-engagement variation, and a fixed reference clock keeps join dates
 * / invite ages identical across SSR and the client refetch.
 *
 * It also honours the DEV-ONLY simulation hints ({@link MemberRosterParams.simViewer} /
 * `simProjectType` / `simPendingInvites`) the Dev Tools Context Switcher passes, so the surface can be
 * exercised across every role, project type, and invite state — the live path ignores them.
 */

// #region Reference clock + avatars
/** A fixed reference "now" so derived join dates / invite ages are SSR==client stable (no `Date.now`). */
const NOW = Date.parse("2026-07-17T16:20:00.000Z");
const DAY = 86_400_000;

const FACE = (id: string) =>
	`https://images.unsplash.com/${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;

/**
 * A supporting cast that fills the roster out so EVERY role badge is demonstrable on any engagement
 * (the derived `detail.members` only ever carries owner / client-or-freelancer / plain member seats).
 * Each carries the role it joins as.
 */
const EXTRA_CAST: ReadonlyArray<{ party: ProjectParty; role: MemberRole }> = [
	{
		party: {
			name: "Sol Nakamura",
			avatar: FACE("photo-1531123897727-8f129e1688ce"),
			handle: "sol",
		},
		role: "admin",
	},
	{
		party: { name: "Dara Okafor", avatar: FACE("photo-1544005313-94ddf0286df2"), handle: "dara" },
		role: "manager",
	},
	{
		party: { name: "Theo Marsh", avatar: FACE("photo-1500648767791-00dcc994a43e"), handle: "theo" },
		role: "freelancer",
	},
	{
		party: {
			name: "Priya Raman",
			avatar: FACE("photo-1438761681033-6461ffad8d80"),
			handle: "priya",
		},
		role: "member",
	},
	{
		party: { name: "Jonah Reed", avatar: null, handle: "jonah-guest" },
		role: "guest",
	},
];
// #endregion

// #region Deterministic helpers
/** A tiny stable hash of a string → non-negative int (no RNG; SSR/resume stable). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** A contact email for a party — the handle when present, else a slugified name. */
function emailOf(party: ProjectParty): string {
	const local = (party.handle ?? party.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")).replace(
		/^\.+|\.+$/g,
		"",
	);
	return `${local || "member"}@projective.app`;
}

/** Deterministic presence off an id hash. */
function presenceOf(id: string): "online" | "away" | "offline" {
	const wheel = ["online", "away", "offline"] as const;
	return wheel[hash(id) % 3];
}

/** A pre-formatted absolute join date ("Jul 14, 2026") from a UTC ms — SSR==client stable. */
function dateLabel(ms: number): string {
	const d = new Date(ms);
	const MONTHS = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** A pre-formatted relative age ("2 days ago") from a UTC ms. */
function agoLabel(ms: number): string {
	const diff = Math.max(0, NOW - ms);
	const days = Math.round(diff / DAY);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days} days ago`;
	const weeks = Math.round(days / 7);
	return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}
// #endregion

// #region Effective stages / format
/**
 * The effective stage set for the roster, honouring a dev project-type override. A pipeline exposes its
 * multi-stage list; a one-off collapses to a single "Full delivery" milestone; a session engagement has
 * no delivery stages (assignment is session-based). Non-overridden, it mirrors the detail's own stages.
 */
function effectiveStages(detail: ProjectDetail, format: ProjectFormat): MemberStageRef[] {
	if (format === "session") return [];
	if (format === "one_off") return [{ id: "stage-0", name: "Full delivery" }];
	const stages = detail.channels.stages.map((s) => ({ id: s.id, name: s.name }));
	return stages.length > 0 ? stages : [{ id: "stage-0", name: "Delivery" }];
}
// #endregion

// #region Viewer role / capabilities
/** The management gate for a role — Client · Owner · Admin · Manager oversee; everyone else does not. */
function capsFor(role: MemberRole): MemberViewerCaps {
	const manages = role === "client" || role === "owner" || role === "admin" || role === "manager";
	// A manager can assign + edit + remove + invite (task §3/§2), same as owner/admin; only the
	// authority TIER differs, which the live path will refine (e.g. a manager cannot demote an owner).
	return {
		canManage: manages,
		canInvite: manages,
		canAssign: manages,
		canEditRoles: manages,
		canRemove: manages,
	};
}

/** Map the thin detail viewer role onto the richer roster role vocabulary. */
function roleFromViewer(detail: ProjectDetail): MemberRole {
	// `detail.viewerRole` is `owner|admin|freelancer|client|member` — all valid MemberRole values.
	return detail.viewerRole as MemberRole;
}

interface ViewerResolution {
	role: MemberRole;
	caps: MemberViewerCaps;
	/** Whether the (freelancer) viewer is assigned to the routed stage/channel — drives visibility. */
	assigned: boolean;
	/** A dev simulation is in effect — inject a distinct "You" row rather than marking an existing one. */
	simulated: boolean;
}

/** Resolve the acting viewer's effective role + caps, honouring the dev `simViewer` override. */
function resolveViewer(
	detail: ProjectDetail,
	sim: MemberRosterParams["simViewer"],
): ViewerResolution {
	switch (sim) {
		case "owner_admin":
			return { role: "admin", caps: capsFor("admin"), assigned: true, simulated: true };
		case "manager":
			return { role: "manager", caps: capsFor("manager"), assigned: true, simulated: true };
		case "freelancer_assigned":
			return { role: "freelancer", caps: capsFor("freelancer"), assigned: true, simulated: true };
		case "freelancer_unassigned":
			return { role: "freelancer", caps: capsFor("freelancer"), assigned: false, simulated: true };
		default: {
			const role = roleFromViewer(detail);
			const caps = capsFor(role);
			// A real freelancer viewer is assigned when the engagement is one they contribute to; the
			// detail's viewerIsClient already tells the client side apart. Treat a non-managing viewer as
			// assigned by default (they were routed into this channel), so they see co-assigned collaborators.
			return { role, caps, assigned: true, simulated: false };
		}
	}
}
// #endregion

// #region Member rows
/** The full participant list, deterministically enriched from the detail + supporting cast. */
function baseRows(detail: ProjectDetail, stages: MemberStageRef[]): ProjectMemberRow[] {
	const seed = hash(detail.slug);
	const stageName = (i: number) => stages[i % Math.max(1, stages.length)]?.name;

	// The derived detail members (owner + counterparty + a couple of plain seats) …
	const seen = new Set<string>();
	const parties: Array<{ party: ProjectParty; role: MemberRole }> = [];
	for (const m of detail.members) {
		const key = m.party.handle ?? m.party.name;
		if (seen.has(key)) continue;
		seen.add(key);
		parties.push({ party: m.party, role: m.role as MemberRole });
	}
	// … augmented so every badge (admin · manager · freelancer · member · guest) is demonstrable.
	for (const extra of EXTRA_CAST) {
		const key = extra.party.handle ?? extra.party.name;
		if (seen.has(key)) continue;
		seen.add(key);
		parties.push(extra);
	}

	return parties.map((p, i) => {
		const id = `${detail.slug}-mem-${p.party.handle ?? i}`;
		// Contributors deliver on 1–2 stages; observers/leadership carry none. Deterministic off the seed.
		const isContributor = p.role === "freelancer" || p.role === "member";
		const assigned: string[] = [];
		if (isContributor && stages.length > 0) {
			assigned.push(stageName(seed + i)!);
			if ((seed + i) % 2 === 0 && stages.length > 1) assigned.push(stageName(seed + i + 1)!);
		}
		const openTickets = isContributor ? (seed + i * 7) % 5 : 0;
		const joinedMs = NOW - ((seed % 40) + i * 6 + 3) * DAY;
		return {
			id,
			party: p.party,
			email: emailOf(p.party),
			role: p.role,
			assignment: null, // resolved per-channel in `scopeRows`
			presence: presenceOf(id),
			assignedStages: [...new Set(assigned)],
			openTickets,
			ticketsLabel: openTickets > 0 ? `${openTickets} open` : "—",
			joinedAt: new Date(joinedMs).toISOString(),
			joinedLabel: dateLabel(joinedMs),
			isViewer: false,
		};
	});
}

/**
 * Resolve each row's channel/stage `assignment` (contributor vs observer) for channel scope. Only a
 * STAGE channel carries the distinction; on a general/team/DM channel — a "public" surface — assignment
 * stays null (everyone is a plain participant). In project scope assignment is likewise null (the
 * per-stage relationship is summarised by `assignedStages` instead).
 */
function withAssignment(
	rows: ProjectMemberRow[],
	scope: "channel" | "project",
	isStageChannel: boolean,
): ProjectMemberRow[] {
	if (scope === "project" || !isStageChannel) return rows;
	return rows.map((r) => {
		let assignment: StageAssignment | null;
		if (r.role === "freelancer" || r.role === "member") assignment = "contributor";
		else if (r.role === "guest") assignment = "observer";
		else assignment = "observer"; // client/owner/admin/manager oversee this stage as observers
		return { ...r, assignment };
	});
}

/** Prepend a distinct simulated "You" row (dev sim), or mark the best-fit existing row as the viewer. */
function markViewer(
	rows: ProjectMemberRow[],
	viewer: ViewerResolution,
	stages: MemberStageRef[],
	scope: "channel" | "project",
	isStageChannel: boolean,
): { rows: ProjectMemberRow[]; viewerId: string } {
	if (viewer.simulated) {
		const you: ProjectMemberRow = {
			id: "you",
			party: {
				name: "You (simulated)",
				avatar: FACE("photo-1527980965255-d3b416303d12"),
				handle: "you",
			},
			email: "you@projective.app",
			role: viewer.role,
			assignment: scope === "channel" && isStageChannel
				? (viewer.assigned ? "contributor" : "observer")
				: null,
			presence: "online",
			assignedStages: viewer.assigned && viewer.role === "freelancer" && stages.length > 0
				? [stages[0].name]
				: [],
			openTickets: viewer.role === "freelancer" && viewer.assigned ? 2 : 0,
			ticketsLabel: viewer.role === "freelancer" && viewer.assigned ? "2 open" : "—",
			joinedAt: new Date(NOW - 12 * DAY).toISOString(),
			joinedLabel: dateLabel(NOW - 12 * DAY),
			isViewer: true,
		};
		return { rows: [you, ...rows], viewerId: "you" };
	}
	// Real session: mark the leadership seat (owner/client) as the acting viewer, else the first row.
	const idx = rows.findIndex((r) => r.role === "owner" || r.role === "client");
	const at = idx >= 0 ? idx : 0;
	const marked = rows.map((r, i) => (i === at ? { ...r, isViewer: true } : r));
	return { rows: marked, viewerId: rows[at]?.id ?? "viewer" };
}

/**
 * Apply the access-visibility rule (task §1): oversight roles (client/owner/admin/manager) see EVERY
 * participant; a freelancer/member/guest sees only leadership plus the collaborators they share the
 * routed stage / public channel with (an ASSIGNED freelancer), or just leadership + themselves (an
 * UNASSIGNED one).
 */
function visibleTo(
	rows: ProjectMemberRow[],
	viewer: ViewerResolution,
	scope: "channel" | "project",
	isStageChannel: boolean,
	viewerStages: string[],
): ProjectMemberRow[] {
	if (viewer.caps.canManage) return rows; // oversight — full roster
	const LEADERSHIP: MemberRole[] = ["client", "owner", "admin", "manager"];
	const publicChannel = scope === "channel" && !isStageChannel;
	return rows.filter((r) => {
		if (r.isViewer) return true;
		if (LEADERSHIP.includes(r.role)) return true;
		if (!viewer.assigned) return false; // an unassigned freelancer sees only leadership + self
		if (publicChannel) return true; // a public channel is visible to any assigned contributor
		if (scope === "channel") return r.assignment !== null; // co-assigned on this stage
		return r.assignedStages.some((s) => viewerStages.includes(s)); // shares an assigned stage
	});
}
// #endregion

// #region Invitations
/** A deterministic pending-invitation queue (only surfaced to a managing viewer). */
function buildInvites(detail: ProjectDetail, stages: MemberStageRef[]): MemberInvite[] {
	const seed = hash(detail.slug);
	const inviter = detail.owner.name;
	const seeds: ReadonlyArray<
		{ email: string; role: MemberRole; withStage: boolean; ageDays: number }
	> = [
		{ email: "casey.wong@studio.co", role: "freelancer", withStage: true, ageDays: 2 },
		{ email: "m.alvarez@agency.io", role: "member", withStage: true, ageDays: 5 },
		{ email: "riley.finance@corp.com", role: "manager", withStage: false, ageDays: 9 },
	];
	return seeds.map((s, i) => {
		const stage = s.withStage && stages.length > 0 ? stages[(seed + i) % stages.length] : null;
		const at = NOW - s.ageDays * DAY;
		return {
			id: `${detail.slug}-inv-${i}`,
			email: s.email,
			role: s.role,
			stageId: stage?.id ?? null,
			stageName: stage?.name ?? null,
			invitedBy: inviter,
			invitedAt: new Date(at).toISOString(),
			invitedLabel: agoLabel(at),
			status: s.ageDays > 7 ? "expired" : "pending",
		};
	});
}
// #endregion

// #region Public builder
/** Resolve the routed channel's identity (name + kind + whether it is a stage), or null in project scope. */
function channelIdentity(
	detail: ProjectDetail,
	channelId: string | null,
): { name: string | null; kind: MemberRosterPage["channelKind"]; isStage: boolean } {
	if (!channelId) return { name: null, kind: null, isStage: false };
	const { general, stages, teams, dms } = detail.channels;
	for (const c of general) {
		if (c.id === channelId) return { name: c.name, kind: "general", isStage: false };
	}
	for (const s of stages) {
		if (s.id === channelId) return { name: s.name, kind: "stage", isStage: true };
	}
	for (const t of teams) {
		for (const c of t.channels) {
			if (c.id === channelId) return { name: c.name, kind: "team", isStage: false };
		}
	}
	for (const d of dms) {
		if (d.chatId === channelId) return { name: d.party.name, kind: "dm", isStage: false };
	}
	// An unknown segment (e.g. the roster reached via `/projects/{slug}/members`) — treat as project scope.
	return { name: null, kind: null, isStage: false };
}

/** Build the full {@link MemberRosterPage} for the request (the stub read path). */
export function findMemberRoster(params: MemberRosterParams): MemberRosterPage | undefined {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return undefined;

	const channelId = params.channelId ?? null;
	const identity = channelIdentity(detail, channelId);
	// A `/projects/{slug}/members` (or an unresolved channel) is project scope.
	const scope: "channel" | "project" = channelId && identity.kind ? "channel" : "project";

	const format: ProjectFormat = params.simProjectType ?? detail.format;
	const stages = effectiveStages(detail, format);
	const viewer = resolveViewer(detail, params.simViewer);

	let rows = baseRows(detail, stages);
	rows = withAssignment(rows, scope, identity.isStage);
	const marked = markViewer(rows, viewer, stages, scope, identity.isStage);
	const viewerStages = marked.rows.find((r) => r.id === marked.viewerId)?.assignedStages ?? [];
	const visible = visibleTo(marked.rows, viewer, scope, identity.isStage, viewerStages);

	// The pending queue is a management concern — only a managing viewer sees it, and the dev toggle can
	// force it off/on. Total counts the full participant list (independent of the viewer's visibility).
	const includeInvites = viewer.caps.canInvite && (params.simPendingInvites ?? true);
	const invites = includeInvites ? buildInvites(detail, stages) : [];

	return {
		scope,
		projectId: params.projectId,
		channelId: scope === "channel" ? channelId : null,
		channelName: scope === "channel" ? identity.name : null,
		channelKind: scope === "channel" ? identity.kind : null,
		projectTitle: detail.title,
		format,
		members: visible,
		invites,
		stages,
		viewerId: marked.viewerId,
		viewerRole: viewer.role,
		viewerCaps: viewer.caps,
		total: marked.rows.length,
	};
}
// #endregion
