import type {
	DmChannel,
	ProjectChannel,
	ProjectDetail,
	ProjectMember,
	ProjectParty,
	ProjectSummary,
	ProjectViewerRole,
	StageChannel,
	TeamChannel,
} from "@projective/types/projects";
import { allProjects } from "./fixtures.ts";
import { mockAvatar, mockCover } from "../../mocks/assets.ts";

/**
 * projects detail fixtures — the fat {@link ProjectBackendService}'s in-memory answer for the deep
 * single-engagement read behind the Project Details sidebar, while `PROJECTS_BACKEND_LIVE` is off
 * (thin-frontend pattern, root CLAUDE.md §10). Rather than hand-author a second parallel corpus, this
 * DERIVES the rich {@link ProjectDetail} deterministically from the same {@link ProjectSummary} rows
 * the feed uses — so the detail view always agrees with the card that linked to it, and the live path
 * (RLS-scoped `projects.*` + `projects.channels` + assigned `org.team_members` reads) replaces this
 * builder behind the same gate with zero shape churn (the projection is already the SSOT
 * {@link ProjectDetailSchema}). No RNG — a small slug hash gives stable per-engagement variation.
 */

// #region Avatars & supporting cast (Unsplash crops — open registry, DESIGN_SYSTEM.md §C.4)
const FACE = (id: string) =>
	mockAvatar(id);
const SCENE = (id: string) =>
	mockCover(id, 640, 280);

/** A rotating supporting cast for members / DMs (beyond the row's owner + counterparty). */
const CAST: readonly ProjectParty[] = [
	{ name: "Ivy Chen", avatar: FACE("photo-1487412720507-e7ab37603c6f"), handle: "ivy" },
	{ name: "Marcus Lee", avatar: FACE("photo-1519085360753-af0119f7cbe7"), handle: "marcus" },
	{ name: "Aria Novak", avatar: FACE("photo-1524504388940-b1c1722653e1"), handle: "aria" },
	{ name: "Ravi Menon", avatar: FACE("photo-1508214751196-bcfd4ca60f91"), handle: "ravi" },
];

/** Service banner scenes, chosen by slug hash so a given service is always the same. */
const BANNERS: readonly string[] = [
	SCENE("photo-1618005182384-a83a8bd57fbe"),
	SCENE("photo-1550684848-fac1c5b4e853"),
	SCENE("photo-1558655146-9f40138edfeb"),
	SCENE("photo-1620121692029-d088224ddc74"),
];
// #endregion

// #region Deterministic helpers
/** A tiny stable hash of a slug → non-negative int (no RNG; SSR/resume stable). */
function hash(slug: string): number {
	let h = 0;
	for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
	return h;
}

/** Pick `n` distinct entries from `pool`, offset by the slug hash (stable, wraps). */
function pick<T>(pool: readonly T[], n: number, seed: number): T[] {
	const out: T[] = [];
	for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(seed + i) % pool.length]);
	return out;
}

/** The canonical stage vocabulary, sliced to the engagement's stage count. */
const STAGE_NAMES = [
	"Discovery",
	"Concepts",
	"Design",
	"Build",
	"Review",
	"Launch",
	"Handover",
];
// #endregion

// #region Type labels
/** A friendly type badge derived from the engagement's provider service or its kind/format. */
function typeLabelFor(row: ProjectSummary): string {
	const byService: Record<string, string> = {
		s_brand_identity: "Brand Identity",
		s_webapp_build: "Web App",
		s_motion_system: "Motion System",
	};
	if (row.serviceId && byService[row.serviceId]) return byService[row.serviceId];
	if (row.format === "session") return "Coaching";
	if (row.format === "one_off") return "One-off Project";
	return row.kind === "service" ? "Service" : "Project";
}

/** A templated description (stands in for the real `projects.description` column). */
function describe(row: ProjectSummary): string {
	const other = row.counterparty?.name ?? "an internal team";
	const noun = row.kind === "service" ? "service engagement" : "project";
	return `${row.title} is a ${row.format.replace("_", "-")} ${noun} with ${other}, ` +
		`scoped under ${row.scopeLabel}. This workspace tracks every stage, submission, and ` +
		`conversation for the engagement — from kickoff through delivery — with escrow-backed ` +
		`milestones released as each stage is accepted. Open the full page for the complete brief, ` +
		`budget breakdown, and the live board.`;
}
// #endregion

// #region Channel builders
/** The always-present General group. */
function generalChannels(row: ProjectSummary): ProjectChannel[] {
	return [
		{
			id: "general",
			chatId: `chan-${row.slug}-general`,
			name: "General",
			kind: "general",
			unread: row.unread,
		},
		{
			id: "announcements",
			chatId: `chan-${row.slug}-announce`,
			name: "Announcements",
			kind: "general",
			unread: false,
		},
	];
}

/**
 * The stage's icon-only activity signal, assigned deterministically so a couple of stages on an
 * active engagement demonstrate each state (new ticket / revision requested / stage-join invite).
 */
function stageActivityFor(
	row: ProjectSummary,
	index: number,
	status: string,
): "new_ticket" | "revision_requested" | "stage_invite" | null {
	if (status === "completed" || status === "cancelled") return null;
	const wheel = ["new_ticket", "revision_requested", "stage_invite"] as const;
	// The active stage always carries the row's headline pressure; a later draft stage may carry an
	// invite. Deterministic off the slug hash — no RNG.
	if (status === "active") return wheel[hash(row.slug) % wheel.length];
	if (status === "draft" && index === (row.completedStages ?? 0) + 1) return "stage_invite";
	return null;
}

/** One stage + its stage-scoped channel per stage, statuses derived from progress. */
function stageChannels(row: ProjectSummary): StageChannel[] {
	const total = Math.min(
		STAGE_NAMES.length,
		Math.max(2, row.totalStages ?? (row.format === "session" ? 3 : 4)),
	);
	const done = Math.max(0, Math.min(total, row.completedStages ?? 0));
	const out: StageChannel[] = [];
	for (let i = 0; i < total; i++) {
		const status = i < done ? "completed" : i === done ? "active" : "draft";
		const name = STAGE_NAMES[i] ?? `Stage ${i + 1}`;
		out.push({
			id: `stage-${i}`,
			name,
			order: i,
			status,
			activity: stageActivityFor(row, i, status),
			channel: {
				id: `stage-${i}`,
				chatId: `chan-${row.slug}-stage-${i}`,
				name,
				kind: "stage",
				// The live stage is the one likely to carry unseen chatter.
				unread: row.unread && status === "active",
			},
		});
	}
	return out;
}

/**
 * The teams the viewer belongs to within the engagement. Covers the two shapes the sidebar must
 * render cleanly: a single team assigned to several stages (organisation/team scope), and several
 * teams each on a stage (business scope). Personal/freelancer work has no assigned teams.
 */
function teamChannels(row: ProjectSummary, stages: StageChannel[]): TeamChannel[] {
	if (row.scopeType === "personal") return [];
	const seed = hash(row.slug);
	const stageName = (i: number) => stages[Math.min(i, stages.length - 1)]?.name ?? `Stage ${i + 1}`;

	const chan = (team: string, stageIdx: number): ProjectChannel => ({
		id: `team-${team}-${stageIdx}`,
		chatId: `chan-${row.slug}-team-${team}-${stageIdx}`,
		name: `${stageName(stageIdx)} Team`,
		kind: "team",
		sublabel: stageName(stageIdx),
		unread: row.unread && stageIdx === Math.min(row.completedStages ?? 0, stages.length - 1),
	});

	if (row.scopeType === "business") {
		// Multiple teams, each assigned to one stage.
		return [
			{
				teamId: `${row.slug}-team-design`,
				teamName: "Design Guild",
				avatar: CAST[seed % CAST.length].avatar,
				assignedStages: [stageName(1)],
				channels: [chan("design", 1)],
			},
			{
				teamId: `${row.slug}-team-eng`,
				teamName: "Platform Team",
				avatar: CAST[(seed + 1) % CAST.length].avatar,
				assignedStages: [stageName(2)],
				channels: [chan("eng", 2)],
			},
		];
	}

	// team / organisation scope: one team assigned to multiple stages.
	return [
		{
			teamId: row.scopeId,
			teamName: row.scopeLabel,
			avatar: row.owner.avatar ?? CAST[seed % CAST.length].avatar,
			assignedStages: [stageName(0), stageName(1)],
			channels: [chan("core", 0), chan("core", 1)],
		},
	];
}

/**
 * The viewer's DM threads with people in the engagement. `chatId` is the unified `dm-{handle}` id —
 * identical to the same person's thread on the global messages page — so history is shared.
 */
function dmChannels(row: ProjectSummary): DmChannel[] {
	const seed = hash(row.slug);
	const people: ProjectParty[] = [];
	if (row.counterparty) people.push(row.counterparty);
	for (const p of pick(CAST, 2, seed)) people.push(p);

	return people.map((party, i) => ({
		chatId: `dm-${party.handle ?? party.name.toLowerCase().replace(/\s+/g, "-")}`,
		party,
		unread: row.unread && i === 0,
		// The counterparty and the first teammate already have project-scoped messages.
		hasProjectContext: i < 2,
	}));
}
// #endregion

// #region Members
/** Participants of the engagement — owner + counterparty + a small supporting cast. */
function membersOf(row: ProjectSummary): ProjectMember[] {
	const seed = hash(row.slug);
	const out: ProjectMember[] = [
		{ id: `${row.slug}-m-owner`, party: row.owner, role: "owner" },
	];
	if (row.counterparty) {
		const counterRole: ProjectViewerRole = row.kind === "service" ? "client" : "freelancer";
		out.push({ id: `${row.slug}-m-counter`, party: row.counterparty, role: counterRole });
	}
	pick(CAST, 2, seed + 1).forEach((party, i) =>
		out.push({ id: `${row.slug}-m-${i}`, party, role: "member" })
	);
	return out;
}
// #endregion

// #region Viewer capability
/**
 * Whether the acting user is the client/creator — gates the client-only "Create New Stage" action.
 * On a client-architected **project** the owner/admin/client seats are the client side; on a
 * provider-side **service** only an explicit `client` seat is (the actor is usually the provider).
 */
function viewerIsClient(row: ProjectSummary): boolean {
	if (row.kind === "project") {
		return row.viewerRole === "owner" || row.viewerRole === "admin" || row.viewerRole === "client";
	}
	return row.viewerRole === "client";
}
// #endregion

// #region Public builder
/** Build the full {@link ProjectDetail} for a summary row (the stub read path). */
function buildDetail(row: ProjectSummary): ProjectDetail {
	const stages = stageChannels(row);
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		kind: row.kind,
		format: row.format,
		status: row.status,
		typeLabel: typeLabelFor(row),
		description: describe(row),
		viewerRole: row.viewerRole,
		viewerIsClient: viewerIsClient(row),
		scopeType: row.scopeType,
		scopeLabel: row.scopeLabel,
		starred: row.starred,
		owner: row.owner,
		client: row.counterparty,
		bannerImage: row.kind === "service" ? BANNERS[hash(row.slug) % BANNERS.length] : null,
		members: membersOf(row),
		channels: {
			general: generalChannels(row),
			stages,
			teams: teamChannels(row, stages),
			dms: dmChannels(row),
		},
	};
}

/** Resolve the deep detail projection for a slug, or `undefined` when no such engagement. */
export function findProjectDetail(slug: string): ProjectDetail | undefined {
	const row = allProjects().find((p) => p.slug === slug);
	return row ? buildDetail(row) : undefined;
}
// #endregion
