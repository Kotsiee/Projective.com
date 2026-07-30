import type { UserContext } from "@projective/types/auth";
import type { MoneyView } from "@projective/types/finance";
import { formatMoney } from "@projective/types/finance";
import { isReservedHandle } from "@projective/types/profile";
import type {
	ActivityEntry,
	BusinessSpendPolicy,
	CreateWorkspaceInput,
	HandleCheck,
	IncomingInvite,
	InviteMemberInput,
	MembershipState,
	PoolEntry,
	SetupStep,
	SpendLimit,
	SpendRequest,
	SplitModel,
	SplitStake,
	TeamPayoutPolicy,
	UpdateMemberInput,
	UpdatePayoutInput,
	UpdateSpendInput,
	UpdateWorkspaceInput,
	UpsertRoleInput,
	VerificationState,
	WorkspaceCapability,
	WorkspaceDetail,
	WorkspaceFinance,
	WorkspaceInvite,
	WorkspaceKind,
	WorkspaceMember,
	WorkspaceProject,
	WorkspaceRole,
	WorkspaceRoleDef,
	WorkspaceRoster,
	WorkspaceSim,
	WorkspaceStat,
	WorkspaceStatus,
	WorkspaceSummary,
} from "@projective/types/workspace";
import {
	activeMembers,
	can,
	capabilitiesForKind,
	effectivePermissions,
	inviteTargetOf,
	isLastOwner,
	kindCopy,
	mayGrant,
	mayManageMember,
	presetCapabilities,
	roleLabel,
	setupProgress,
	simIsEmpty,
	splitDriftBp,
	walletHrefFor,
	workspaceHref,
} from "@projective/types/workspace";

/**
 * workspace fixtures — the fat {@link WorkspaceBackendService}'s in-memory answer for the `/teams` and
 * `/businesses` reads AND the stub write path (create · invite · role · member · payout · spend) while
 * `WORKSPACE_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §2/§10).
 *
 * **The mental model the whole corpus encodes:** a team is a freelancer with multiple members (seller
 * side), a business is a client with multiple members (buyer side). One seed shape, one materialiser and
 * one store serve both — the only divergence is the money policy (`payout` for a team, `spend` for a
 * business) and the capability columns {@link capabilitiesForKind} renders.
 *
 * Fully **deterministic**: a fixed reference clock, an unsigned `>>>` string hash and zero RNG/`Date.now()`,
 * so SSR and an island's refetch always agree and the same id always produces the same entity.
 *
 * Continuity is deliberate — `northwind` / `atlas-collective` (teams) and `monarch-labs` /
 * `verdant-studio` (businesses) reuse the ids, handles and avatars the global rail already shows
 * (`apps/web/features/shell/core/nav-fixtures.ts`) and the money cast of
 * `../finance/wallet-fixtures.ts`, so the same entity seen anywhere in the app is the same entity here.
 *
 * Writes mutate a module-level {@link STORE} seeded from these fixtures, so create→invite→promote→split
 * is fully exercisable with the gate off. It grants **no persistence** (per-process, cleared on restart);
 * the RLS-scoped `org.teams` / `org.business_profiles` / `org.*_members` / `org.*_roles` reads replace it
 * behind the same gate with zero shape churn — which is why **no migration accompanies this surface**.
 *
 * **Fixtures-only divergence (flagged, root CLAUDE.md §8):** the corpus is authored for one fixed acting
 * identity ({@link ACTING}, `@ahmed`) exactly like the catalogue seller and the wallet cast, so a
 * caller's own `UserContext` handle is NOT substituted into the roster — the context is read only to
 * resolve which entity the session is currently *acting as*. The live `org.*` path resolves the real
 * viewer.
 */

// #region Reference clock + deterministic helpers (declared before the store — it builds at module init)
/** Fixed reference "now" (no `Date.now()`), matching the sibling fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;

/** The currency and locale every fixture figure is denominated and formatted in, server-side. */
const CURRENCY = "GBP";
const LOCALE = "en-GB";

/** A tiny stable hash → non-negative int. Unsigned `>>>`: a signed `>>` goes negative → an empty slot. */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** An Unsplash face crop — the shared avatar convention (DESIGN_SYSTEM §C.4). */
function face(id: string): string {
	return `https://images.unsplash.com/${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;
}

/** An Unsplash landscape crop used as an entity banner (reused from the public profile presentation). */
function banner(id: string): string {
	return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1440&h=360&q=80`;
}

/**
 * Build a {@link MoneyView}. Every figure the surface renders is formatted **here**, server-side — the
 * client never totals, splits, converts or formats money (root CLAUDE.md §12 · Decision #55).
 */
function money(minor: number): MoneyView {
	return {
		minor,
		currency: CURRENCY,
		display: formatMoney(minor, CURRENCY, LOCALE),
		origin: null,
	};
}

/** Short British day label ("12 Aug") relative to nothing — an absolute date. */
function fmtDay(ms: number): string {
	return new Date(ms).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

/** A date span, collapsed when it sits inside one month ("20–24 July", else "28 Jul – 3 Aug"). */
function fmtRange(fromMs: number, toMs: number): string {
	const a = new Date(fromMs);
	const b = new Date(toMs);
	if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
		const month = a.toLocaleDateString(LOCALE, { month: "long" });
		return `${a.getUTCDate()}–${b.getUTCDate()} ${month}`;
	}
	return `${fmtDay(fromMs)} – ${fmtDay(toMs)}`;
}

/** `Today` / `Yesterday` / `4 days ago` / `12 Jun` relative to {@link NOW} (UTC day math, no client clock). */
function relLabel(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	if (diff < 7) return `${diff} days ago`;
	if (diff < 14) return "Last week";
	if (diff < 60) return `${Math.round(diff / 7)} weeks ago`;
	return fmtDay(ms);
}

/** A signed percentage delta for the stat-tile contract, derived from a stable seed. */
function delta(seed: string): string {
	const h = hash(seed);
	const magnitude = (h % 17) + 2;
	return h % 3 === 0 ? `-${magnitude}%` : `+${magnitude}%`;
}

/** Eight sparkline points in 0–1 for the stat-tile accent. */
function trend(seed: string): number[] {
	return Array.from({ length: 8 }, (_, i) => ((hash(`${seed}:t${i}`) % 78) + 18) / 100);
}

/** Clamp to 0–1 (the schemas bound every fraction field). */
function unit(n: number): number {
	return Math.max(0, Math.min(1, n));
}

/** Normalise a handle to its comparison key: strip a leading `@`, lower-case, trim. */
function normalise(handle: string): string {
	return handle.replace(/^@+/, "").trim().toLowerCase();
}
// #endregion

// #region The cast (ids / handles / avatars agree with nav-fixtures + wallet-fixtures)
/** One person in the shared cast. */
interface Person {
	userId: string;
	handle: string;
	name: string;
	avatar: string;
	email: string;
}

/** The acting identity every fixture is authored for (a fixed viewer, like the catalogue seller). */
const ACTING = { key: "ahmed", handle: "ahmed" };

const PEOPLE: Record<string, Person> = {
	ahmed: {
		userId: "u-ahmed",
		handle: "ahmed",
		name: "Ahmed K.",
		avatar: face("photo-1506794778202-cad84cf45f1d"),
		email: "ahmed@projective.test",
	},
	ravi: {
		userId: "u-ravi",
		handle: "ravi",
		name: "R. Achebe",
		avatar: face("photo-1531427186611-ecfd6d936c79"),
		email: "r.achebe@projective.test",
	},
	mara: {
		userId: "u-mara",
		handle: "maradv",
		name: "Mara D.",
		avatar: face("photo-1544005313-94ddf0286df2"),
		email: "mara@projective.test",
	},
	tomas: {
		userId: "u-tomas",
		handle: "tomasp",
		name: "Tomas P.",
		avatar: face("photo-1500648767791-00dcc994a43e"),
		email: "tomas@projective.test",
	},
	lena: {
		userId: "u-lena",
		handle: "lenak",
		name: "Lena K.",
		avatar: face("photo-1438761681033-6461ffad8d80"),
		email: "lena@projective.test",
	},
	sofia: {
		userId: "u-sofia",
		handle: "sofiar",
		name: "Sofia R.",
		avatar: face("photo-1487412720507-e7ab37603c6f"),
		email: "sofia@projective.test",
	},
	darius: {
		userId: "u-darius",
		handle: "dariusn",
		name: "Darius N.",
		avatar: face("photo-1633332755192-727a05c4013d"),
		email: "darius@projective.test",
	},
	daniel: {
		userId: "u-daniel",
		handle: "danielo",
		name: "Daniel Okafor",
		avatar: face("photo-1519085360753-af0119f7cbe7"),
		email: "daniel@projective.test",
	},
	priya: {
		userId: "u-priya",
		handle: "priyan",
		name: "Priya Nair",
		avatar: face("photo-1508214751196-bcfd4ca60f91"),
		email: "priya@projective.test",
	},
	ada: {
		userId: "u-ada",
		handle: "adaw",
		name: "Ada Whitfield",
		avatar: face("photo-1494790108377-be9c29b29330"),
		email: "ada@projective.test",
	},
	nadia: {
		userId: "u-nadia",
		handle: "nadiab",
		name: "Nadia B.",
		avatar: face("photo-1517841905240-472988babdf9"),
		email: "nadia@projective.test",
	},
	omar: {
		userId: "u-omar",
		handle: "omarh",
		name: "Omar H.",
		avatar: face("photo-1472099645785-5658abf4ff4e"),
		email: "omar@projective.test",
	},
	ines: {
		userId: "u-ines",
		handle: "inesf",
		name: "Inés F.",
		avatar: face("photo-1534528741775-53994a69daeb"),
		email: "ines@projective.test",
	},
	kofi: {
		userId: "u-kofi",
		handle: "kofim",
		name: "Kofi M.",
		avatar: face("photo-1507003211169-0a1dd7228f2d"),
		email: "kofi@projective.test",
	},
	elsie: {
		userId: "u-elsie",
		handle: "elsieg",
		name: "Elsie G.",
		avatar: face("photo-1489424731084-a5d8b219a5bb"),
		email: "elsie@projective.test",
	},
	theo: {
		userId: "u-theo",
		handle: "theom",
		name: "Theo Marsh",
		avatar: face("photo-1521119989659-a83eee488004"),
		email: "theo@projective.test",
	},
};

/** Every person handle — a person's handle can never be claimed by an entity. */
const PERSON_HANDLES: ReadonlySet<string> = new Set(
	Object.values(PEOPLE).map((p) => normalise(p.handle)),
);
// #endregion

// #region Seed shapes
/** A seeded membership row. */
interface MemberSeed {
	/** Key into {@link PEOPLE}. */
	key: string;
	/** The role id held — a {@link WorkspaceRole} preset value or a custom role slug. */
	roleId: string;
	/** The preset the role resolves to, for ranking + guard checks. */
	rolePreset: WorkspaceRole;
	state?: MembershipState;
	title?: string | null;
	workload?: number;
	availability?: WorkspaceMember["availability"];
	/** Per-member grants ON TOP of the role — renders as a `+` marker. */
	granted?: WorkspaceCapability[];
	/** Per-member revocations FROM the role — renders as a `−` marker. */
	revoked?: WorkspaceCapability[];
	/** Team — payout share in basis points. Stakes must sum to exactly 10 000. */
	shareBp?: number;
	/** Team — the share is held back from automatic distribution. */
	shareHeld?: boolean;
	/** Business — personal spend ceiling in minor units, `null` for unlimited. */
	spendLimitMinor?: number | null;
	/** Business — whether they may spend at all. */
	canSpend?: boolean;
	/** Business — per-transaction ceiling. */
	perTransactionMinor?: number | null;
	/** Business — spent within the current period. */
	spentMinor?: number;
	/** Business — lifetime contribution into the pool. */
	contributedMinor?: number;
	/** Org-chart edge — the {@link PEOPLE} key they report to. */
	reportsTo?: string | null;
	joinedDaysAgo?: number;
}

/** A seeded custom role. */
interface RoleSeed {
	id: string;
	name: string;
	summary: string;
	capabilities: WorkspaceCapability[];
}

/** A seeded pending invitation or inbound join request. */
interface InviteSeed {
	id: string;
	direction: WorkspaceInvite["direction"];
	/** Key into {@link PEOPLE}, or `null` for an email-only invite. */
	key: string | null;
	email?: string;
	roleId: string;
	note?: string;
	sentDaysAgo: number;
	viaLink?: boolean;
	expiresInDays?: number;
}

/** A seeded project the entity delivers (team) or commissioned (business). */
interface ProjectSeed {
	id: string;
	title: string;
	counterpartyKey: string;
	state: WorkspaceProject["state"];
	statusLabel: string;
	progress: number;
	/** Days from {@link NOW} the next milestone opens, or `null` for no date. */
	dueInDays: number | null;
	/** Length of the milestone window in days (collapses to a single day at 0). */
	dueSpanDays?: number;
}

/** A seeded pooled-wallet movement. */
interface LedgerSeed {
	id: string;
	kind: PoolEntry["kind"];
	key: string;
	amountMinor: number;
	reason: string;
	daysAgo: number;
	approvedByKey?: string;
}

/** A seeded spend request. */
interface RequestSeed {
	id: string;
	key: string;
	amountMinor: number;
	reason: string;
	state: SpendRequest["state"];
	raisedDaysAgo: number;
	approverKeys: string[];
	decidedByKey?: string;
	decidedDaysAgo?: number;
}

/** One entity in the corpus. */
interface WorkspaceSeed {
	id: string;
	kind: WorkspaceKind;
	name: string;
	handle: string;
	/** `""` falls back to the initial badge — the Draft-First state. */
	avatar: string;
	bannerImage: string;
	tagline: string;
	status: WorkspaceStatus;
	verification: VerificationState;
	verificationPrompt?: string | null;
	createdDaysAgo: number;
	members: MemberSeed[];
	roles?: RoleSeed[];
	invites?: InviteSeed[];
	projects?: ProjectSeed[];
	/** Balances in minor units. */
	availableMinor: number;
	lockedMinor: number;
	pendingMinor: number;
	/** Team — the gross release the split projection is priced against (fee deducted server-side). */
	grossReleaseMinor?: number;
	splitModel?: SplitModel;
	autoDistribute?: boolean;
	/** Business — the approval ladder's trigger, `null` disables it. */
	approvalThresholdMinor?: number | null;
	ledger?: LedgerSeed[];
	requests?: RequestSeed[];
	/** The headline 30-day money stat on the roster card. */
	periodMinor?: number;
	standing?: string | null;
	hasUpdate?: boolean;
}
// #endregion

// #region The corpus
/** The platform fee already deducted from a projected release (5% flat, Decision #2). */
const PLATFORM_FEE_BP = 500;

const SEEDS: WorkspaceSeed[] = [
	// — Teams ————————————————————————————————————————————————————————————————
	{
		id: "northwind",
		kind: "team",
		name: "Northwind Studio",
		handle: "northwind",
		avatar: face("photo-1500648767791-00dcc994a43e"),
		bannerImage: banner("photo-1517245386807-bb43f82c33c4"),
		tagline: "Six people, one delivery record — brand systems and product design.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 540,
		members: [
			{
				key: "daniel",
				roleId: "owner",
				rolePreset: "owner",
				title: "Studio principal",
				workload: 72,
				availability: "limited",
				shareBp: 2500,
				joinedDaysAgo: 540,
			},
			{
				key: "ahmed",
				roleId: "admin",
				rolePreset: "admin",
				title: "Design lead",
				workload: 64,
				availability: "available",
				shareBp: 2000,
				reportsTo: "daniel",
				joinedDaysAgo: 470,
			},
			{
				key: "sofia",
				roleId: "lead",
				rolePreset: "lead",
				title: "Delivery lead",
				workload: 88,
				availability: "limited",
				shareBp: 2000,
				reportsTo: "daniel",
				joinedDaysAgo: 400,
			},
			{
				key: "lena",
				roleId: "member",
				rolePreset: "member",
				title: "Motion designer",
				workload: 41,
				availability: "available",
				shareBp: 1500,
				reportsTo: "sofia",
				joinedDaysAgo: 260,
			},
			{
				key: "tomas",
				roleId: "member",
				rolePreset: "member",
				title: "Front-end engineer",
				workload: 55,
				availability: "available",
				shareBp: 1000,
				reportsTo: "sofia",
				joinedDaysAgo: 190,
			},
			{
				key: "mara",
				roleId: "member",
				rolePreset: "member",
				title: "Researcher",
				workload: 22,
				availability: "available",
				shareBp: 1000,
				reportsTo: "ahmed",
				joinedDaysAgo: 96,
			},
		],
		invites: [
			{ id: "iv-nw-1", direction: "invite", key: "theo", roleId: "member", sentDaysAgo: 3 },
		],
		projects: [
			{
				id: "aurora-rebrand",
				title: "Aurora rebrand",
				counterpartyKey: "priya",
				state: "active",
				statusLabel: "Stage 2",
				progress: 0.62,
				dueInDays: 3,
				dueSpanDays: 4,
			},
			{
				id: "helio-app",
				title: "Helio app design system",
				counterpartyKey: "theo",
				state: "active",
				statusLabel: "Stage 1",
				progress: 0.34,
				dueInDays: 11,
				dueSpanDays: 0,
			},
			{
				id: "gradient-motion-kit",
				title: "Gradient motion kit",
				counterpartyKey: "ada",
				state: "completed",
				statusLabel: "Delivered",
				progress: 1,
				dueInDays: null,
			},
		],
		availableMinor: 318_450,
		lockedMinor: 645_000,
		pendingMinor: 92_400,
		grossReleaseMinor: 1_250_000,
		splitModel: "custom",
		autoDistribute: true,
		periodMinor: 428_000,
		standing: "Trusted",
	},
	{
		id: "atlas-collective",
		kind: "team",
		name: "Atlas Collective",
		handle: "atlascollective",
		avatar: face("photo-1544005313-94ddf0286df2"),
		bannerImage: banner("photo-1451187580459-43490279c0fa"),
		tagline: "A twelve-strong collective for large, multi-discipline builds.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 820,
		members: [
			{
				key: "mara",
				roleId: "owner",
				rolePreset: "owner",
				title: "Founder",
				workload: 60,
				shareBp: 1000,
				joinedDaysAgo: 820,
			},
			{
				key: "omar",
				roleId: "admin",
				rolePreset: "admin",
				title: "Operations",
				workload: 70,
				shareBp: 1000,
				reportsTo: "mara",
				joinedDaysAgo: 790,
			},
			{
				key: "ines",
				roleId: "lead",
				rolePreset: "lead",
				title: "Engineering lead",
				workload: 84,
				availability: "limited",
				shareBp: 1000,
				reportsTo: "mara",
				joinedDaysAgo: 740,
			},
			{
				key: "kofi",
				roleId: "lead",
				rolePreset: "lead",
				title: "Data lead",
				workload: 66,
				shareBp: 1000,
				reportsTo: "mara",
				joinedDaysAgo: 700,
			},
			{
				key: "ahmed",
				roleId: "member",
				rolePreset: "member",
				title: "Interface design",
				workload: 38,
				shareBp: 900,
				reportsTo: "ines",
				joinedDaysAgo: 300,
			},
			{
				key: "sofia",
				roleId: "member",
				rolePreset: "member",
				title: "Service design",
				workload: 52,
				shareBp: 900,
				reportsTo: "ines",
				joinedDaysAgo: 285,
			},
			{
				key: "elsie",
				roleId: "member",
				rolePreset: "member",
				title: "Copy",
				workload: 30,
				shareBp: 800,
				reportsTo: "omar",
				joinedDaysAgo: 240,
			},
			{
				key: "theo",
				roleId: "member",
				rolePreset: "member",
				title: "Back-end",
				workload: 74,
				availability: "limited",
				shareBp: 800,
				reportsTo: "ines",
				joinedDaysAgo: 220,
			},
			{
				key: "nadia",
				roleId: "member",
				rolePreset: "member",
				title: "QA",
				workload: 44,
				shareBp: 700,
				reportsTo: "kofi",
				joinedDaysAgo: 180,
			},
			{
				key: "darius",
				roleId: "member",
				rolePreset: "member",
				title: "Infrastructure",
				workload: 58,
				shareBp: 700,
				reportsTo: "kofi",
				joinedDaysAgo: 150,
			},
			{
				key: "lena",
				roleId: "member",
				rolePreset: "member",
				title: "Motion",
				workload: 26,
				shareBp: 600,
				reportsTo: "ines",
				joinedDaysAgo: 120,
			},
			{
				key: "tomas",
				roleId: "member",
				rolePreset: "member",
				title: "Front-end",
				workload: 62,
				shareBp: 600,
				reportsTo: "ines",
				joinedDaysAgo: 90,
			},
		],
		projects: [
			{
				id: "meridian-grid-portal",
				title: "Meridian grid portal",
				counterpartyKey: "theo",
				state: "active",
				statusLabel: "Stage 4",
				progress: 0.78,
				dueInDays: 6,
				dueSpanDays: 3,
			},
			{
				id: "coastal-atlas",
				title: "Coastal atlas viewer",
				counterpartyKey: "nadia",
				state: "proposal",
				statusLabel: "Proposal",
				progress: 0,
				dueInDays: 21,
				dueSpanDays: 0,
			},
		],
		availableMinor: 1_204_800,
		lockedMinor: 2_310_000,
		pendingMinor: 458_000,
		grossReleaseMinor: 2_640_000,
		splitModel: "by_role",
		autoDistribute: true,
		periodMinor: 1_186_000,
		standing: "Expert",
	},
	{
		id: "northern-grid",
		kind: "team",
		name: "Northern grid collective",
		handle: "northern-grid",
		avatar: face("photo-1633332755192-727a05c4013d"),
		bannerImage: banner("photo-1466611653911-95081537e5b7"),
		tagline: "Grid modelling and network resilience work for regional operators.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 210,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: "Founder",
				workload: 68,
				shareBp: 3500,
				joinedDaysAgo: 210,
			},
			{
				key: "mara",
				roleId: "lead",
				rolePreset: "lead",
				title: "Modelling lead",
				workload: 80,
				availability: "limited",
				// A member who differs from their role baseline in BOTH directions, so the drawer's
				// `+` / `−` markers always have something honest to draw.
				granted: ["manage_finances"],
				revoked: ["publish_listings"],
				shareBp: 2500,
				shareHeld: true,
				reportsTo: "ahmed",
				joinedDaysAgo: 190,
			},
			{
				key: "ravi",
				roleId: "role-grid-engineer",
				rolePreset: "member",
				title: "Grid engineer",
				workload: 74,
				shareBp: 2000,
				reportsTo: "mara",
				joinedDaysAgo: 140,
			},
			{
				key: "darius",
				roleId: "member",
				rolePreset: "member",
				title: "Field survey",
				workload: 35,
				shareBp: 2000,
				reportsTo: "mara",
				joinedDaysAgo: 62,
			},
		],
		roles: [
			{
				id: "role-grid-engineer",
				name: "Grid engineer",
				summary: "Bids for seats and runs delivery, without touching the roster or the money.",
				capabilities: ["bind_seat", "manage_projects", "publish_listings", "view_analytics"],
			},
		],
		invites: [
			{
				id: "iv-ng-1",
				direction: "invite",
				key: "sofia",
				roleId: "member",
				note: "We could use your service-design eye on the Ashby bid.",
				sentDaysAgo: 2,
			},
			{
				id: "iv-ng-2",
				direction: "invite",
				key: null,
				email: "j.pike@ashbycouncil.gov.uk",
				roleId: "lead",
				sentDaysAgo: 5,
				viaLink: true,
				expiresInDays: 9,
			},
			{
				id: "iv-ng-3",
				direction: "request",
				key: "kofi",
				roleId: "member",
				note: "I have five years of substation modelling — happy to start on a single ticket.",
				sentDaysAgo: 1,
			},
		],
		projects: [
			{
				id: "ashby-substation-model",
				title: "Ashby substation model",
				counterpartyKey: "nadia",
				state: "active",
				statusLabel: "Stage 2",
				progress: 0.48,
				dueInDays: 4,
				dueSpanDays: 5,
			},
			{
				id: "pennine-load-study",
				title: "Pennine load study",
				counterpartyKey: "theo",
				state: "proposal",
				statusLabel: "Awaiting reply",
				progress: 0,
				dueInDays: 14,
				dueSpanDays: 0,
			},
		],
		availableMinor: 214_900,
		lockedMinor: 430_000,
		pendingMinor: 61_500,
		grossReleaseMinor: 860_000,
		splitModel: "custom",
		autoDistribute: false,
		periodMinor: 243_000,
		standing: "Established",
		hasUpdate: true,
	},
	{
		id: "coastal-modelling-guild",
		kind: "team",
		name: "Coastal modelling guild",
		handle: "coastal-modelling",
		// Draft-First: no mark, no bio — the checklist has real work to offer.
		avatar: "",
		bannerImage: "",
		tagline: "",
		status: "draft",
		verification: "unverified",
		verificationPrompt: "Verify your identity so the guild can receive payouts.",
		createdDaysAgo: 2,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: null,
				workload: 12,
				shareBp: 10_000,
				joinedDaysAgo: 2,
			},
		],
		availableMinor: 0,
		lockedMinor: 0,
		pendingMinor: 0,
		grossReleaseMinor: 0,
		splitModel: "equal",
		autoDistribute: true,
		periodMinor: 0,
		standing: null,
	},
	{
		id: "ashby-flood-partners",
		kind: "team",
		name: "Ashby flood partners",
		handle: "ashby-flood",
		avatar: face("photo-1489424731084-a5d8b219a5bb"),
		bannerImage: banner("photo-1470071459604-3b5ec3a7fe05"),
		tagline: "Flood-risk modelling partnership — dormant between funding rounds.",
		status: "archived",
		verification: "pending",
		verificationPrompt: "Two members still need to finish identity checks.",
		createdDaysAgo: 640,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: "Partner",
				workload: 4,
				availability: "unavailable",
				shareBp: 5000,
				joinedDaysAgo: 640,
			},
			{
				key: "ravi",
				roleId: "lead",
				rolePreset: "lead",
				title: "Hydrology",
				workload: 0,
				availability: "unavailable",
				shareBp: 3000,
				reportsTo: "ahmed",
				joinedDaysAgo: 620,
			},
			{
				key: "elsie",
				roleId: "member",
				rolePreset: "member",
				title: "Reporting",
				workload: 0,
				availability: "unavailable",
				shareBp: 2000,
				reportsTo: "ahmed",
				joinedDaysAgo: 540,
			},
		],
		projects: [
			{
				id: "ashby-flood-baseline",
				title: "Ashby flood baseline",
				counterpartyKey: "nadia",
				state: "completed",
				statusLabel: "Closed",
				progress: 1,
				dueInDays: null,
			},
		],
		availableMinor: 18_400,
		lockedMinor: 0,
		pendingMinor: 0,
		grossReleaseMinor: 0,
		splitModel: "custom",
		autoDistribute: false,
		periodMinor: 0,
		standing: "Established",
	},
	{
		// Invited-only: the viewer is NOT a member, so it never appears in the roster's items — it is the
		// source of an entry in the invitations strip instead.
		id: "harrow-makers",
		kind: "team",
		name: "Harrow makers union",
		handle: "harrow-makers",
		avatar: face("photo-1534528741775-53994a69daeb"),
		bannerImage: banner("photo-1523275335684-37898b6baf30"),
		tagline: "Fabrication and hardware prototyping, run as a union.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 380,
		members: [
			{ key: "ines", roleId: "owner", rolePreset: "owner", shareBp: 6000, joinedDaysAgo: 380 },
			{
				key: "nadia",
				roleId: "lead",
				rolePreset: "lead",
				shareBp: 4000,
				reportsTo: "ines",
				joinedDaysAgo: 300,
			},
		],
		invites: [
			{
				id: "iv-hm-1",
				direction: "invite",
				key: "ahmed",
				roleId: "lead",
				note: "We want someone to own the interface side of the workshop booking tool.",
				sentDaysAgo: 4,
			},
		],
		availableMinor: 96_000,
		lockedMinor: 140_000,
		pendingMinor: 0,
		grossReleaseMinor: 320_000,
		splitModel: "custom",
		autoDistribute: true,
		periodMinor: 88_000,
		standing: "Trusted",
	},

	// — Businesses ——————————————————————————————————————————————————————————
	{
		id: "monarch-labs",
		kind: "business",
		name: "Monarch Labs",
		handle: "monarchlabs",
		avatar: face("photo-1438761681033-6461ffad8d80"),
		bannerImage: banner("photo-1497366216548-37526070297c"),
		tagline: "Product research lab — commissions design and engineering work.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 610,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: "Managing director",
				workload: 58,
				spendLimitMinor: null,
				canSpend: true,
				perTransactionMinor: null,
				spentMinor: 412_000,
				contributedMinor: 1_450_000,
				joinedDaysAgo: 610,
			},
			{
				key: "tomas",
				roleId: "admin",
				rolePreset: "admin",
				title: "Head of delivery",
				workload: 71,
				// An admin whose approval authority was explicitly withdrawn — the `−` marker.
				revoked: ["approve_spend"],
				spendLimitMinor: 500_000,
				canSpend: true,
				perTransactionMinor: 250_000,
				spentMinor: 180_000,
				contributedMinor: 620_000,
				reportsTo: "ahmed",
				joinedDaysAgo: 520,
			},
			{
				key: "lena",
				roleId: "member",
				rolePreset: "member",
				title: "Programme coordinator",
				workload: 46,
				// A plain member handed two capabilities directly — the `+` markers.
				granted: ["spend_funds", "purchase"],
				spendLimitMinor: 120_000,
				canSpend: true,
				perTransactionMinor: 50_000,
				spentMinor: 95_000,
				contributedMinor: 80_000,
				reportsTo: "tomas",
				joinedDaysAgo: 300,
			},
			{
				key: "priya",
				roleId: "role-purchaser",
				rolePreset: "member",
				title: "Procurement",
				workload: 39,
				spendLimitMinor: 300_000,
				canSpend: true,
				perTransactionMinor: 150_000,
				spentMinor: 64_000,
				contributedMinor: 0,
				reportsTo: "ahmed",
				joinedDaysAgo: 240,
			},
			{
				key: "ravi",
				roleId: "member",
				rolePreset: "member",
				title: "Research",
				workload: 28,
				spendLimitMinor: 0,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 45_000,
				reportsTo: "tomas",
				joinedDaysAgo: 120,
			},
		],
		roles: [
			{
				id: "role-purchaser",
				name: "Purchaser",
				summary: "Buys and hires against the pooled wallet, inside a fixed envelope.",
				capabilities: [
					"purchase",
					"hire",
					"spend_funds",
					"contribute_funds",
					"view_analytics",
				],
			},
		],
		invites: [
			{
				id: "iv-ml-1",
				direction: "invite",
				key: null,
				email: "f.oyelaran@monarchlabs.test",
				roleId: "role-purchaser",
				sentDaysAgo: 6,
			},
		],
		projects: [
			{
				id: "aurora-rebrand",
				title: "Aurora rebrand",
				counterpartyKey: "daniel",
				state: "active",
				statusLabel: "Stage 2",
				progress: 0.62,
				dueInDays: 3,
				dueSpanDays: 4,
			},
			{
				id: "monarch-design-system",
				title: "Monarch design system",
				counterpartyKey: "mara",
				state: "active",
				statusLabel: "In review",
				progress: 0.81,
				dueInDays: 8,
				dueSpanDays: 0,
			},
		],
		availableMinor: 1_985_000,
		lockedMinor: 740_000,
		pendingMinor: 126_000,
		approvalThresholdMinor: 250_000,
		ledger: [
			{
				id: "pe-ml-1",
				kind: "contribution",
				key: "ahmed",
				amountMinor: 750_000,
				reason: "Quarterly funding round",
				daysAgo: 34,
			},
			{
				id: "pe-ml-2",
				kind: "contribution",
				key: "tomas",
				amountMinor: 320_000,
				reason: "Delivery budget top-up",
				daysAgo: 28,
			},
			{
				id: "pe-ml-3",
				kind: "spend",
				key: "tomas",
				amountMinor: 180_000,
				reason: "Aurora rebrand — stage 2",
				daysAgo: 12,
				approvedByKey: "ahmed",
			},
			{
				id: "pe-ml-4",
				kind: "spend",
				key: "lena",
				amountMinor: 95_000,
				reason: "Monarch design system — stage 1",
				daysAgo: 9,
				approvedByKey: "ahmed",
			},
			{
				id: "pe-ml-5",
				kind: "spend",
				key: "priya",
				amountMinor: 64_000,
				reason: "Icon library licence",
				daysAgo: 5,
			},
			{
				id: "pe-ml-6",
				kind: "contribution",
				key: "ravi",
				amountMinor: 45_000,
				reason: "Research grant transfer",
				daysAgo: 3,
			},
		],
		requests: [
			{
				// Over the £2,500 approval threshold — the pending decision the console must surface.
				id: "sr-ml-1",
				key: "tomas",
				amountMinor: 340_000,
				reason: "Fund stage 3 on Aurora rebrand",
				state: "pending",
				raisedDaysAgo: 1,
				approverKeys: ["ahmed"],
			},
			{
				id: "sr-ml-2",
				key: "lena",
				amountMinor: 96_000,
				reason: "Monarch design system — stage 1",
				state: "approved",
				raisedDaysAgo: 9,
				approverKeys: ["ahmed"],
				decidedByKey: "ahmed",
				decidedDaysAgo: 9,
			},
		],
		periodMinor: 339_000,
		hasUpdate: true,
	},
	{
		id: "verdant-studio",
		kind: "business",
		name: "Verdant Studio",
		handle: "verdantstudio",
		avatar: face("photo-1487412720507-e7ab37603c6f"),
		bannerImage: banner("photo-1441974231531-c6227db76b6e"),
		tagline: "Sustainability consultancy buying in brand and web work.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 430,
		members: [
			{
				key: "ada",
				roleId: "owner",
				rolePreset: "owner",
				title: "Founder",
				workload: 66,
				spendLimitMinor: null,
				canSpend: true,
				perTransactionMinor: null,
				spentMinor: 208_000,
				contributedMinor: 900_000,
				joinedDaysAgo: 430,
			},
			{
				key: "ahmed",
				roleId: "admin",
				rolePreset: "admin",
				title: "Design partner",
				workload: 44,
				spendLimitMinor: 400_000,
				canSpend: true,
				perTransactionMinor: 200_000,
				spentMinor: 132_000,
				contributedMinor: 150_000,
				reportsTo: "ada",
				joinedDaysAgo: 240,
			},
			{
				key: "sofia",
				roleId: "member",
				rolePreset: "member",
				title: "Reporting",
				workload: 33,
				spendLimitMinor: 60_000,
				canSpend: true,
				perTransactionMinor: 30_000,
				spentMinor: 21_000,
				contributedMinor: 0,
				reportsTo: "ada",
				joinedDaysAgo: 150,
			},
			{
				key: "omar",
				roleId: "member",
				rolePreset: "member",
				title: "Analysis",
				workload: 51,
				spendLimitMinor: 0,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "ada",
				joinedDaysAgo: 90,
			},
		],
		projects: [
			{
				id: "verdant-brand-refresh",
				title: "Verdant brand refresh",
				counterpartyKey: "daniel",
				state: "active",
				statusLabel: "Stage 1",
				progress: 0.28,
				dueInDays: 9,
				dueSpanDays: 4,
			},
		],
		availableMinor: 742_000,
		lockedMinor: 260_000,
		pendingMinor: 0,
		approvalThresholdMinor: 500_000,
		ledger: [
			{
				id: "pe-vs-1",
				kind: "contribution",
				key: "ada",
				amountMinor: 900_000,
				reason: "Annual marketing budget",
				daysAgo: 120,
			},
			{
				id: "pe-vs-2",
				kind: "contribution",
				key: "ahmed",
				amountMinor: 150_000,
				reason: "Partner contribution",
				daysAgo: 46,
			},
			{
				id: "pe-vs-3",
				kind: "spend",
				key: "ahmed",
				amountMinor: 132_000,
				reason: "Verdant brand refresh — stage 1",
				daysAgo: 18,
			},
		],
		requests: [
			{
				id: "sr-vs-1",
				key: "sofia",
				amountMinor: 88_000,
				reason: "Stock photography licence",
				state: "declined",
				raisedDaysAgo: 21,
				approverKeys: ["ada", "ahmed"],
				decidedByKey: "ada",
				decidedDaysAgo: 20,
			},
		],
		periodMinor: 132_000,
	},
	{
		id: "halliwell",
		kind: "business",
		name: "Halliwell Estates",
		handle: "halliwell",
		avatar: face("photo-1517841905240-472988babdf9"),
		bannerImage: banner("photo-1449844908441-8829872d2607"),
		tagline: "Estate management group commissioning digital work.",
		status: "active",
		// KYB in flight: the pooled wallet is locked, the policy editor stays usable.
		verification: "pending",
		verificationPrompt:
			"Upload Halliwell Estates' certificate of incorporation to finish KYB and unlock the pooled wallet.",
		createdDaysAgo: 26,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: "Director",
				workload: 30,
				spendLimitMinor: null,
				canSpend: true,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				joinedDaysAgo: 26,
			},
			{
				key: "nadia",
				roleId: "admin",
				rolePreset: "admin",
				title: "Finance",
				workload: 42,
				spendLimitMinor: 250_000,
				canSpend: true,
				perTransactionMinor: 100_000,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "ahmed",
				joinedDaysAgo: 20,
			},
			{
				key: "ines",
				roleId: "member",
				rolePreset: "member",
				title: "Property operations",
				workload: 18,
				spendLimitMinor: 50_000,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "nadia",
				joinedDaysAgo: 14,
			},
		],
		invites: [
			{ id: "iv-hw-1", direction: "request", key: "elsie", roleId: "member", sentDaysAgo: 2 },
		],
		availableMinor: 0,
		lockedMinor: 0,
		pendingMinor: 0,
		approvalThresholdMinor: 200_000,
		periodMinor: 0,
	},
	{
		id: "meridian-power",
		kind: "business",
		name: "Meridian Power",
		handle: "meridian-power",
		avatar: face("photo-1521119989659-a83eee488004"),
		bannerImage: banner("photo-1509391366360-2e959784a276"),
		tagline: "Regional generator buying modelling, software and design.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 900,
		members: [
			{
				key: "theo",
				roleId: "owner",
				rolePreset: "owner",
				title: "Chief operating officer",
				workload: 62,
				spendLimitMinor: null,
				canSpend: true,
				perTransactionMinor: null,
				spentMinor: 1_240_000,
				contributedMinor: 4_800_000,
				joinedDaysAgo: 900,
			},
			{
				key: "kofi",
				roleId: "admin",
				rolePreset: "admin",
				title: "Programme director",
				workload: 78,
				spendLimitMinor: 1_500_000,
				canSpend: true,
				perTransactionMinor: 600_000,
				spentMinor: 940_000,
				contributedMinor: 0,
				reportsTo: "theo",
				joinedDaysAgo: 820,
			},
			{
				key: "elsie",
				roleId: "role-controller",
				rolePreset: "member",
				title: "Financial controller",
				workload: 55,
				spendLimitMinor: 400_000,
				canSpend: true,
				perTransactionMinor: 200_000,
				spentMinor: 116_000,
				contributedMinor: 0,
				reportsTo: "theo",
				joinedDaysAgo: 700,
			},
			{
				// The viewer as a plain member: two capabilities, no money authority — the case that proves
				// a permissionless member still lands somewhere rather than being 404'd out.
				key: "ahmed",
				roleId: "member",
				rolePreset: "member",
				title: "Design consultant",
				workload: 24,
				spendLimitMinor: 0,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "kofi",
				joinedDaysAgo: 88,
			},
		],
		roles: [
			{
				id: "role-controller",
				name: "Controller",
				summary: "Owns the money view and the approval ladder, but never the roster.",
				capabilities: [
					"manage_finances",
					"approve_spend",
					"spend_funds",
					"view_analytics",
					"view_audit",
				],
			},
		],
		projects: [
			{
				id: "meridian-grid-portal",
				title: "Meridian grid portal",
				counterpartyKey: "mara",
				state: "active",
				statusLabel: "Stage 4",
				progress: 0.78,
				dueInDays: 6,
				dueSpanDays: 3,
			},
			{
				id: "meridian-load-forecast",
				title: "Load forecast tooling",
				counterpartyKey: "ines",
				state: "completed",
				statusLabel: "Delivered",
				progress: 1,
				dueInDays: null,
			},
		],
		availableMinor: 3_560_000,
		lockedMinor: 1_820_000,
		pendingMinor: 240_000,
		approvalThresholdMinor: 750_000,
		ledger: [
			{
				id: "pe-mp-1",
				kind: "contribution",
				key: "theo",
				amountMinor: 4_800_000,
				reason: "FY26 external delivery budget",
				daysAgo: 210,
			},
			{
				id: "pe-mp-2",
				kind: "spend",
				key: "kofi",
				amountMinor: 940_000,
				reason: "Meridian grid portal — stages 1–3",
				daysAgo: 60,
				approvedByKey: "theo",
			},
			{
				id: "pe-mp-3",
				kind: "spend",
				key: "elsie",
				amountMinor: 116_000,
				reason: "Load forecast tooling — closeout",
				daysAgo: 22,
			},
		],
		requests: [
			{
				id: "sr-mp-1",
				key: "kofi",
				amountMinor: 820_000,
				reason: "Meridian grid portal — stage 5",
				state: "pending",
				raisedDaysAgo: 2,
				approverKeys: ["theo", "elsie"],
			},
		],
		periodMinor: 1_056_000,
	},
	{
		id: "county-transport",
		kind: "business",
		name: "County transport",
		handle: "county-transport",
		avatar: face("photo-1472099645785-5658abf4ff4e"),
		bannerImage: banner("photo-1494522855154-9297ac14b55f"),
		tagline: "Passenger transport authority — new to commissioning digital work.",
		status: "draft",
		verification: "unverified",
		verificationPrompt: "Start KYB to unlock the pooled wallet and hire providers.",
		createdDaysAgo: 5,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: "Programme sponsor",
				workload: 16,
				spendLimitMinor: null,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				joinedDaysAgo: 5,
			},
			{
				key: "darius",
				roleId: "admin",
				rolePreset: "admin",
				title: "Operations",
				workload: 22,
				spendLimitMinor: 0,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "ahmed",
				joinedDaysAgo: 4,
			},
		],
		availableMinor: 0,
		lockedMinor: 0,
		pendingMinor: 0,
		// No ladder configured yet — the checklist's money step is genuinely outstanding.
		approvalThresholdMinor: null,
		periodMinor: 0,
	},
	{
		id: "ashby-holdings",
		kind: "business",
		name: "Ashby holdings",
		handle: "ashby-holdings",
		avatar: face("photo-1507003211169-0a1dd7228f2d"),
		bannerImage: banner("photo-1486406146926-c627a92ad1ab"),
		tagline: "Holding company, wound down after the estate sale.",
		status: "archived",
		verification: "verified",
		createdDaysAgo: 1_240,
		members: [
			{
				key: "ahmed",
				roleId: "owner",
				rolePreset: "owner",
				title: "Director",
				workload: 0,
				availability: "unavailable",
				spendLimitMinor: null,
				canSpend: true,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 620_000,
				joinedDaysAgo: 1_240,
			},
			{
				key: "elsie",
				roleId: "admin",
				rolePreset: "admin",
				title: "Company secretary",
				workload: 0,
				availability: "unavailable",
				spendLimitMinor: 100_000,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "ahmed",
				joinedDaysAgo: 1_100,
			},
			{
				key: "theo",
				roleId: "member",
				rolePreset: "member",
				title: null,
				workload: 0,
				availability: "unavailable",
				spendLimitMinor: 0,
				canSpend: false,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "elsie",
				joinedDaysAgo: 980,
			},
		],
		availableMinor: 4_200,
		lockedMinor: 0,
		pendingMinor: 0,
		approvalThresholdMinor: 100_000,
		ledger: [
			{
				id: "pe-ah-1",
				kind: "contribution",
				key: "ahmed",
				amountMinor: 620_000,
				reason: "Opening float",
				daysAgo: 900,
			},
		],
		periodMinor: 0,
	},
	{
		// Invited-only, buyer side.
		id: "fenwick-logistics",
		kind: "business",
		name: "Fenwick logistics",
		handle: "fenwick-logistics",
		avatar: face("photo-1508214751196-bcfd4ca60f91"),
		bannerImage: banner("photo-1519003722824-194d4455a60c"),
		tagline: "Freight operator digitising its depot tooling.",
		status: "active",
		verification: "verified",
		createdDaysAgo: 300,
		members: [
			{
				key: "priya",
				roleId: "owner",
				rolePreset: "owner",
				spendLimitMinor: null,
				canSpend: true,
				perTransactionMinor: null,
				spentMinor: 0,
				contributedMinor: 1_200_000,
				joinedDaysAgo: 300,
			},
			{
				key: "omar",
				roleId: "admin",
				rolePreset: "admin",
				spendLimitMinor: 300_000,
				canSpend: true,
				perTransactionMinor: 150_000,
				spentMinor: 0,
				contributedMinor: 0,
				reportsTo: "priya",
				joinedDaysAgo: 250,
			},
		],
		invites: [
			{
				id: "iv-fl-1",
				direction: "invite",
				key: "ahmed",
				roleId: "member",
				note: "We would like you to review the depot booking flow before we commission it.",
				sentDaysAgo: 8,
			},
		],
		availableMinor: 1_200_000,
		lockedMinor: 0,
		pendingMinor: 0,
		approvalThresholdMinor: 400_000,
		periodMinor: 0,
	},
];
// #endregion

// #region Materialisation — seed → WorkspaceDetail
/** The role table: every preset the kind offers, plus the entity's custom roles. */
function buildRoles(seed: WorkspaceSeed): WorkspaceRoleDef[] {
	const presets: WorkspaceRoleDef[] = (["owner", "admin", "lead", "member"] as WorkspaceRole[])
		.filter((r) => seed.kind === "team" || r !== "lead")
		.map((preset) => ({
			id: preset,
			name: roleLabel(preset),
			summary: PRESET_SUMMARY[preset],
			preset,
			capabilities: presetCapabilities(preset, seed.kind),
			memberCount: 0,
		}));
	const custom: WorkspaceRoleDef[] = (seed.roles ?? []).map((r) => ({
		id: r.id,
		name: r.name,
		summary: r.summary,
		preset: null,
		capabilities: r.capabilities.filter((c) => capabilitiesForKind(seed.kind).includes(c)),
		memberCount: 0,
	}));
	return [...presets, ...custom];
}

/** One-line remits for the read-only preset roles (a role picker should never show a bare name). */
const PRESET_SUMMARY: Record<WorkspaceRole, string> = {
	owner: "Full authority, including archiving and transferring ownership.",
	admin: "Runs the roster, the money and the settings — everything but archiving.",
	lead: "Binds the team to seats and runs delivery, without restructuring the roster.",
	member: "Does the work and sees how the entity is performing.",
};

/** Materialise the membership rows. */
function buildMembers(seed: WorkspaceSeed): WorkspaceMember[] {
	return seed.members.map((m, i) => {
		const p = PEOPLE[m.key];
		const joined = NOW - (m.joinedDaysAgo ?? 30 + i * 7) * DAY;
		return {
			id: `${seed.id}-m-${p.userId}`,
			handle: p.handle,
			name: p.name,
			avatar: p.avatar,
			email: p.email,
			roleId: m.roleId,
			rolePreset: m.rolePreset,
			state: m.state ?? "active",
			overrides: { granted: m.granted ?? [], revoked: m.revoked ?? [] },
			joinedAt: new Date(joined).toISOString(),
			title: m.title ?? null,
			workload: m.workload ?? 40,
			availability: m.availability ?? "available",
			isSelf: m.key === ACTING.key,
			spendLimitMinor: m.spendLimitMinor ?? null,
			contributedMinor: m.contributedMinor ?? 0,
			shareBp: m.shareBp ?? 0,
			shareHeld: m.shareHeld ?? false,
			reportsTo: m.reportsTo ? `${seed.id}-m-${PEOPLE[m.reportsTo].userId}` : null,
		};
	});
}

/** Materialise pending invitations and inbound join requests. */
function buildInvites(seed: WorkspaceSeed): WorkspaceInvite[] {
	return (seed.invites ?? []).map((iv) => {
		const p = iv.key ? PEOPLE[iv.key] : null;
		return {
			id: iv.id,
			direction: iv.direction,
			handle: p?.handle ?? "",
			name: p?.name ?? (iv.email ?? "Invited by link"),
			avatar: p?.avatar ?? "",
			email: iv.email ?? null,
			roleId: iv.roleId,
			note: iv.note ?? null,
			sentAt: relLabel(NOW - iv.sentDaysAgo * DAY),
			expiresAt: iv.expiresInDays != null
				? new Date(NOW + iv.expiresInDays * DAY).toISOString()
				: null,
			viaLink: iv.viaLink ?? false,
		};
	});
}

/**
 * Price a set of stakes against a release. Each stake's projected amount is computed **here** so the
 * split editor can show a consequence ("R. Achebe receives £163.40") the client never calculates.
 */
function priceStakes(
	stakes: readonly Omit<SplitStake, "projected">[],
	releaseMinor: number,
): SplitStake[] {
	return stakes.map((s) => ({
		...s,
		projected: money(Math.round((releaseMinor * s.shareBp) / 10_000)),
	}));
}

/**
 * Re-establish the 100% invariant across the UNHELD stakes after the roster changes (a member leaves,
 * a stake is dropped). Held stakes are immovable — that is the point of holding one — so the remainder
 * is absorbed proportionally by the rest, with any integer remainder pushed onto the largest absorber
 * so the total is exactly 10 000 and the bar can never render a phantom gap.
 */
function normaliseStakes(stakes: readonly SplitStake[]): SplitStake[] {
	if (stakes.length === 0) return [];
	const heldTotal = stakes.filter((s) => s.held).reduce((n, s) => n + s.shareBp, 0);
	const unheld = stakes.filter((s) => !s.held);
	if (unheld.length === 0) return [...stakes];
	const budget = Math.max(0, 10_000 - heldTotal);
	const unheldTotal = unheld.reduce((n, s) => n + s.shareBp, 0);
	const next = stakes.map((s) => {
		if (s.held) return { ...s };
		const share = unheldTotal > 0
			? Math.floor((s.shareBp / unheldTotal) * budget)
			: Math.floor(budget / unheld.length);
		return { ...s, shareBp: Math.max(0, share) };
	});
	const drift = splitDriftBp(next);
	if (drift !== 0) {
		let biggest = -1;
		for (let i = 0; i < next.length; i++) {
			if (next[i].held) continue;
			if (biggest < 0 || next[i].shareBp > next[biggest].shareBp) biggest = i;
		}
		if (biggest >= 0) next[biggest] = { ...next[biggest], shareBp: next[biggest].shareBp - drift };
	}
	return next;
}

/** The team's payout policy — the split editor's whole state, priced server-side. */
function buildPayout(seed: WorkspaceSeed, members: WorkspaceMember[]): TeamPayoutPolicy {
	const gross = seed.grossReleaseMinor ?? 0;
	const fee = Math.round((gross * PLATFORM_FEE_BP) / 10_000);
	const release = gross - fee;
	const bare = activeMembers(members).map((m) => ({
		memberId: m.id,
		handle: m.handle,
		name: m.name,
		avatar: m.avatar,
		shareBp: m.shareBp,
		held: m.shareHeld,
	}));
	const stakes = priceStakes(normaliseStakes(priceStakes(bare, release)), release);
	const approvers = members
		.filter((m) => m.state === "active" && (m.rolePreset === "owner" || m.rolePreset === "admin"))
		.map((m) => m.id);
	return {
		model: seed.splitModel ?? "custom",
		stakes,
		templates: [
			{
				id: `${seed.id}-tpl-current`,
				name: "Current split",
				model: seed.splitModel ?? "custom",
				stakes,
				isDefault: true,
			},
			{
				id: `${seed.id}-tpl-equal`,
				name: "Even split",
				model: "equal",
				stakes: priceStakes(
					bare.map((s) => ({
						...s,
						held: false,
						shareBp: Math.floor(10_000 / Math.max(1, bare.length)),
					})),
					release,
				),
				isDefault: false,
			},
		],
		projectedRelease: money(release),
		platformFee: money(fee),
		withdrawApprovers: approvers,
		autoDistribute: seed.autoDistribute ?? true,
	};
}

/** One member's spend envelope, with the consumed fraction computed server-side. */
function buildLimit(seed: MemberSeed, member: WorkspaceMember): SpendLimit {
	const limitMinor = seed.spendLimitMinor ?? null;
	const spent = seed.spentMinor ?? 0;
	return {
		memberId: member.id,
		handle: member.handle,
		name: member.name,
		avatar: member.avatar,
		canSpend: seed.canSpend ?? false,
		limitMinor,
		limit: limitMinor === null ? null : money(limitMinor),
		spent: money(spent),
		usedFraction: limitMinor && limitMinor > 0 ? unit(spent / limitMinor) : 0,
		perTransactionMinor: seed.perTransactionMinor ?? null,
	};
}

/** The business's pooled-wallet governance — limits, the approval ladder, and the attributable ledger. */
function buildSpend(seed: WorkspaceSeed, members: WorkspaceMember[]): BusinessSpendPolicy {
	const byKey = new Map(seed.members.map((m, i) => [m.key, { seed: m, member: members[i] }]));
	const idOf = (key: string) => byKey.get(key)?.member.id ?? "";
	const nameOf = (key: string) => PEOPLE[key]?.name ?? key;

	const entries: PoolEntry[] = (seed.ledger ?? []).map((e) => ({
		id: e.id,
		kind: e.kind,
		memberId: idOf(e.key),
		handle: PEOPLE[e.key].handle,
		name: PEOPLE[e.key].name,
		avatar: PEOPLE[e.key].avatar,
		amount: money(e.amountMinor),
		reason: e.reason,
		at: fmtDay(NOW - e.daysAgo * DAY),
		approvedBy: e.approvedByKey ? nameOf(e.approvedByKey) : null,
	}));

	const requests: SpendRequest[] = (seed.requests ?? []).map((r) => ({
		id: r.id,
		memberId: idOf(r.key),
		handle: PEOPLE[r.key].handle,
		name: PEOPLE[r.key].name,
		avatar: PEOPLE[r.key].avatar,
		amount: money(r.amountMinor),
		reason: r.reason,
		state: r.state,
		raisedAt: relLabel(NOW - r.raisedDaysAgo * DAY),
		approvers: r.approverKeys.map(nameOf),
		decidedBy: r.decidedByKey ? nameOf(r.decidedByKey) : null,
		decidedAt: r.decidedDaysAgo != null ? relLabel(NOW - r.decidedDaysAgo * DAY) : null,
	}));

	const threshold = seed.approvalThresholdMinor ?? null;
	return {
		approvalThresholdMinor: threshold,
		approvalThreshold: threshold === null ? null : money(threshold),
		approverIds: members
			.filter((m) => m.state === "active" && can(m, "approve_spend", "business"))
			.map((m) => m.id),
		limits: seed.members.map((m, i) => buildLimit(m, members[i])),
		// Pair each seed with its materialised row BEFORE filtering — filtering first then mapping by
		// index reads the wrong member (the indices shift).
		contributorIds: seed.members
			.map((m, i) => ({ seed: m, member: members[i] }))
			.filter((p) => (p.seed.contributedMinor ?? 0) > 0 || p.member.rolePreset !== "member")
			.map((p) => p.member.id),
		entries,
		requests,
		verification: seed.verification,
		verificationPrompt: seed.verification === "verified" ? null : seed.verificationPrompt ?? null,
	};
}

/** The money summary tiles + the `/wallet` hand-off. This surface never renders a second finance UI. */
function buildFinance(seed: WorkspaceSeed): WorkspaceFinance {
	return {
		available: money(seed.availableMinor),
		locked: money(seed.lockedMinor),
		pending: money(seed.pendingMinor),
		walletHref: walletHrefFor(seed.kind, seed.id),
		trend: trend(seed.id),
		delta: seed.status === "draft" ? null : delta(`${seed.id}:finance`),
	};
}

/** The entity's projects, with pre-formatted milestone dates. */
function buildProjects(seed: WorkspaceSeed): WorkspaceProject[] {
	return (seed.projects ?? []).map((p) => {
		const cp = PEOPLE[p.counterpartyKey];
		const due = p.dueInDays === null
			? null
			: (p.dueSpanDays ?? 0) > 0
			? fmtRange(NOW + p.dueInDays * DAY, NOW + (p.dueInDays + (p.dueSpanDays ?? 0)) * DAY)
			: fmtDay(NOW + p.dueInDays * DAY);
		return {
			id: p.id,
			title: p.title,
			href: `/projects/${p.id}`,
			counterparty: cp.name,
			counterpartyAvatar: cp.avatar,
			state: p.state,
			statusLabel: p.statusLabel,
			progress: unit(p.progress),
			due,
		};
	});
}

/**
 * The recent-activity feed, composed from the entity's own facts (who joined, what moved, what was
 * funded) rather than invented prose, so a line can always be traced to something the console shows.
 */
function buildActivity(
	seed: WorkspaceSeed,
	members: WorkspaceMember[],
	projects: WorkspaceProject[],
	payout: TeamPayoutPolicy | null,
	spend: BusinessSpendPolicy | null,
): ActivityEntry[] {
	const out: ActivityEntry[] = [];
	const push = (
		kind: ActivityEntry["kind"],
		text: string,
		actor: WorkspaceMember | null,
		daysAgo: number,
		href: string | null,
	) => {
		out.push({
			id: `${seed.id}-act-${out.length + 1}`,
			kind,
			text,
			actor: actor?.name ?? null,
			actorAvatar: actor?.avatar ?? null,
			at: relLabel(NOW - daysAgo * DAY),
			href,
		});
	};

	const active = activeMembers(members);
	const newest = [...active].sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))[0];
	if (newest) {
		const role = newest.roleId === newest.rolePreset
			? roleLabel(newest.rolePreset).toLowerCase()
			: newest.roleId.replace(/^role-/, "").replace(/-/g, " ");
		push("member", `Joined as ${role}.`, newest, 2, workspaceHref(seed.kind, seed.id, "members"));
	}
	const live = projects.find((p) => p.state === "active");
	if (live) push("project", `${live.title} moved to ${live.statusLabel}.`, null, 3, live.href);

	if (payout && payout.projectedRelease.minor > 0) {
		push(
			"money",
			`A stage release of ${payout.projectedRelease.display} is ready to distribute.`,
			null,
			4,
			workspaceHref(seed.kind, seed.id, "payouts"),
		);
	}
	if (spend) {
		const contribution = spend.entries.find((e) => e.kind === "contribution");
		if (contribution) {
			const actor = members.find((m) => m.id === contribution.memberId) ?? null;
			push(
				"money",
				`Added ${contribution.amount.display} to the pooled wallet.`,
				actor,
				5,
				workspaceHref(seed.kind, seed.id, "finance"),
			);
		}
		const pending = spend.requests.find((r) => r.state === "pending");
		if (pending) {
			const actor = members.find((m) => m.id === pending.memberId) ?? null;
			push(
				"money",
				`Requested ${pending.amount.display} — ${pending.reason}.`,
				actor,
				1,
				workspaceHref(seed.kind, seed.id, "spend"),
			);
		}
	}
	const overridden = active.find((m) =>
		m.overrides.granted.length > 0 || m.overrides.revoked.length > 0
	);
	if (overridden) {
		push(
			"role",
			"Permissions were adjusted away from the role baseline.",
			overridden,
			7,
			workspaceHref(seed.kind, seed.id, "roles"),
		);
	}
	if (seed.kind === "team" && seed.status === "active") {
		push("listing", "A shared listing went live on the catalogue.", null, 9, "/catalogue");
	}
	return out.slice(0, 6);
}

/**
 * The Draft-First checklist, DERIVED from live state rather than a stored flag — so completing a step
 * anywhere in the console ticks it off, and a mutation can never leave the checklist lying.
 */
function buildSetup(
	kind: WorkspaceKind,
	id: string,
	d: {
		avatar: string;
		tagline: string;
		verification: VerificationState;
		members: WorkspaceMember[];
		invites: WorkspaceInvite[];
		payout: TeamPayoutPolicy | null;
		spend: BusinessSpendPolicy | null;
	},
): SetupStep[] {
	const copy = kindCopy(kind);
	const moneyDone = kind === "team" ? !!d.payout && d.payout.stakes.length > 1 : !!d.spend &&
		(d.spend.approvalThresholdMinor !== null || d.spend.limits.some((l) => l.canSpend));
	return [
		{
			id: "logo",
			label: "Add a mark",
			note: `A logo makes the ${copy.noun} recognisable everywhere it appears.`,
			done: d.avatar.trim().length > 0,
			href: workspaceHref(kind, id, "settings"),
		},
		{
			id: "bio",
			label: "Say what you do",
			note: "One line clients can scan before they decide to talk to you.",
			done: d.tagline.trim().length > 0,
			href: workspaceHref(kind, id, "profile"),
		},
		{
			id: "invite",
			label: "Invite someone",
			note: kind === "team"
				? "Two active members unlocks proposals — a solo team cannot bid."
				: "Bring in the people who will approve and spend alongside you.",
			done: activeMembers(d.members).length > 1 || d.invites.some((i) => i.direction === "invite"),
			href: workspaceHref(kind, id, "invitations"),
		},
		{
			id: "money",
			label: kind === "team" ? "Set the split" : "Set spend limits",
			note: kind === "team"
				? "Decide how a release divides before the first one lands."
				: "Envelopes and an approval threshold keep the pool predictable.",
			done: moneyDone,
			href: workspaceHref(kind, id, kind === "team" ? "payouts" : "spend"),
		},
		{
			id: "verification",
			label: `Finish ${copy.verification}`,
			note: kind === "team"
				? "Verified members can be paid out — unverified ones cannot."
				: "Verification unlocks the pooled wallet so you can hire.",
			done: d.verification === "verified",
			href: workspaceHref(kind, id, "verification"),
		},
	];
}

/** Materialise a seed into its full console projection. */
function toDetail(seed: WorkspaceSeed): WorkspaceDetail {
	const roles = buildRoles(seed);
	const members = buildMembers(seed);
	const invites = buildInvites(seed);
	const payout = seed.kind === "team" ? buildPayout(seed, members) : null;
	const spend = seed.kind === "business" ? buildSpend(seed, members) : null;
	const projects = buildProjects(seed);
	const detail: WorkspaceDetail = {
		id: seed.id,
		kind: seed.kind,
		name: seed.name,
		handle: seed.handle,
		avatar: seed.avatar,
		banner: seed.bannerImage,
		tagline: seed.tagline,
		status: seed.status,
		verification: seed.verification,
		verificationPrompt: seed.verification === "verified" ? null : seed.verificationPrompt ?? null,
		createdAt: new Date(NOW - seed.createdDaysAgo * DAY).toISOString(),
		viewerRoleId: "",
		viewerMemberId: "",
		viewerCapabilities: [],
		isActing: false,
		members,
		roles,
		invites,
		payout,
		spend,
		finance: buildFinance(seed),
		projects,
		activity: buildActivity(seed, members, projects, payout, spend),
		setup: [],
		standing: seed.standing ?? null,
		canPropose: true,
	};
	return recompute(detail);
}

/**
 * Re-derive every field that depends on the membership/role/money state: role member counts, the
 * viewer's resolved capabilities, the proposal gate, the split invariant, envelope fractions and the
 * setup checklist. Every mutation ends here, so the projection can never drift from its own parts.
 */
function recompute(d: WorkspaceDetail): WorkspaceDetail {
	const roles = d.roles.map((r) => ({
		...r,
		memberCount: d.members.filter((m) => m.state === "active" && m.roleId === r.id).length,
	}));

	// The viewer's effective set is resolved by the SSOT's engine (role ∪ granted − revoked), never
	// recomputed here — the drawer, the matrix and this guard must agree exactly.
	const self = d.members.find((m) => m.isSelf && m.state === "active") ?? null;
	const viewerCapabilities = self ? effectivePermissions(self, d.kind, roles, self.roleId) : [];

	let payout = d.payout;
	if (payout) {
		const activeIds = new Set(activeMembers(d.members).map((m) => m.id));
		const kept = payout.stakes.filter((s) => activeIds.has(s.memberId));
		const release = payout.projectedRelease.minor;
		payout = {
			...payout,
			stakes: priceStakes(
				kept.length === payout.stakes.length ? kept : normaliseStakes(kept),
				release,
			),
			withdrawApprovers: d.members
				.filter((m) =>
					m.state === "active" && (m.rolePreset === "owner" || m.rolePreset === "admin")
				)
				.map((m) => m.id),
		};
	}

	let spend = d.spend;
	if (spend) {
		spend = {
			...spend,
			limits: spend.limits.map((l) => ({
				...l,
				usedFraction: l.limitMinor && l.limitMinor > 0 ? unit(l.spent.minor / l.limitMinor) : 0,
			})),
			approverIds: d.members
				.filter((m) => m.state === "active" && can(m, "approve_spend", d.kind, roles, m.roleId))
				.map((m) => m.id),
			verification: d.verification,
			verificationPrompt: d.verification === "verified" ? null : d.verificationPrompt,
		};
	}

	const setup = buildSetup(d.kind, d.id, {
		avatar: d.avatar,
		tagline: d.tagline,
		verification: d.verification,
		members: d.members,
		invites: d.invites,
		payout,
		spend,
	});

	return {
		...d,
		roles,
		payout,
		spend,
		setup,
		viewerMemberId: self?.id ?? "",
		viewerRoleId: self?.roleId ?? "",
		viewerCapabilities,
		// A one-person team is legal — it simply cannot bid. Surfaced as an honest pre-state.
		canPropose: d.kind === "business" || activeMembers(d.members).length >= 2,
	};
}
// #endregion

// #region The session store (seeded at module init — every helper above is already declared)
const STORE = new Map<string, WorkspaceDetail>();
const ORDER: string[] = [];
/** The 30-day money figure each roster card headlines with, keyed by entity id. */
const PERIOD = new Map<string, number>();

let seq = 0;

(function seedStore(): void {
	for (const seed of SEEDS) {
		STORE.set(seed.id, toDetail(seed));
		ORDER.push(seed.id);
		PERIOD.set(seed.id, seed.periodMinor ?? 0);
	}
})();

/** Whether an entity carries an unseen update — seeded per entity, kept out of the mutable detail. */
const HAS_UPDATE: ReadonlySet<string> = new Set(
	SEEDS.filter((s) => s.hasUpdate).map((s) => s.id),
);

/** Every entity of a kind, in stable insertion order (a created entity appends at the front). */
function allOfKind(kind: WorkspaceKind): WorkspaceDetail[] {
	return ORDER.map((id) => STORE.get(id)!).filter((d) => d && d.kind === kind);
}
// #endregion

// #region Read: roster · detail · handle availability
/**
 * A soft cap on how many entities of one kind the viewer may OWN — a fixtures-side stand-in for the
 * plan metering `finance.plan_entitlements` will own (Decision #58). Joining is never capped.
 */
const OWNED_CAP = 6;

/** Resolve the entity the session is currently acting AS, when it is one of this kind. */
function actingIdFor(kind: WorkspaceKind, viewer: UserContext): string | null {
	if (viewer.contextType !== kind) return null;
	const match = allOfKind(kind).find((d) => d.id === viewer.contextId);
	return match ? match.id : null;
}

/** Up to five faces for a roster card's avatar stack. */
function facesOf(d: WorkspaceDetail) {
	return activeMembers(d.members).slice(0, 5).map((m) => ({
		handle: m.handle,
		name: m.name,
		avatar: m.avatar,
	}));
}

/** The three live stats a roster card carries, chosen per kind so each number means something. */
function statsOf(d: WorkspaceDetail): WorkspaceStat[] {
	const count = activeMembers(d.members).length;
	const live = d.projects.filter((p) => p.state === "active").length;
	const period = money(PERIOD.get(d.id) ?? 0);
	if (d.kind === "team") {
		return [
			{ label: "Members", value: String(count), delta: null },
			{ label: "Active projects", value: String(live), delta: null },
			{
				label: "Earned 30d",
				value: period.display,
				delta: d.status === "active" ? delta(`${d.id}:earned`) : null,
			},
		];
	}
	return [
		{ label: "Members", value: String(count), delta: null },
		{ label: "Active hires", value: String(live), delta: null },
		{
			label: "Spent 30d",
			value: period.display,
			delta: d.status === "active" ? delta(`${d.id}:spent`) : null,
		},
	];
}

/** Project a stored detail down to its roster card. */
function toSummary(d: WorkspaceDetail, actingId: string | null): WorkspaceSummary {
	const self = d.members.find((m) => m.isSelf && m.state === "active");
	return {
		id: d.id,
		kind: d.kind,
		name: d.name,
		handle: d.handle,
		avatar: d.avatar,
		status: d.status,
		verification: d.verification,
		role: self?.rolePreset ?? "member",
		isOwner: self?.rolePreset === "owner",
		memberCount: activeMembers(d.members).length,
		faces: facesOf(d),
		stats: statsOf(d),
		hasUpdate: HAS_UPDATE.has(d.id),
		isActing: actingId === d.id,
		tagline: d.tagline,
		setupProgress: setupProgress(d.setup),
	};
}

/** The invitations addressed to the acting viewer, derived from the entities that hold them. */
function incomingFor(kind: WorkspaceKind): IncomingInvite[] {
	const out: IncomingInvite[] = [];
	for (const d of allOfKind(kind)) {
		if (d.members.some((m) => m.isSelf && m.state === "active")) continue;
		for (const iv of d.invites) {
			if (iv.direction !== "invite") continue;
			if (normalise(iv.handle) !== ACTING.handle) continue;
			const owner = d.members.find((m) => m.rolePreset === "owner") ?? d.members[0];
			const role = d.roles.find((r) => r.id === iv.roleId);
			out.push({
				id: iv.id,
				workspaceId: d.id,
				workspaceName: d.name,
				workspaceHandle: d.handle,
				workspaceAvatar: d.avatar,
				kind: d.kind,
				fromName: owner?.name ?? d.name,
				fromHandle: owner?.handle ?? d.handle,
				roleLabel: role?.name ?? iv.roleId,
				sentAt: iv.sentAt,
			});
		}
	}
	return out;
}

/** The roster page — the entities the viewer belongs to, plus the invitations awaiting them. */
export function buildRoster(kind: WorkspaceKind, viewer: UserContext): WorkspaceRoster {
	const actingId = actingIdFor(kind, viewer);
	const items = allOfKind(kind)
		.filter((d) => d.members.some((m) => m.isSelf && m.state === "active"))
		.map((d) => toSummary(d, actingId));
	const owned = items.filter((i) => i.isOwner).length;
	const copy = kindCopy(kind);
	return {
		kind,
		items,
		invitations: incomingFor(kind),
		actingId,
		canCreate: owned < OWNED_CAP,
		createBlockedReason: owned < OWNED_CAP
			? null
			: `You already own ${owned} ${copy.plural}. Archive one or upgrade to create another.`,
	};
}

/** One entity's full console projection, viewer-scoped. `null` when the id is unknown. */
export function findWorkspace(kind: WorkspaceKind, id: string): WorkspaceDetail | null {
	const d = STORE.get(id);
	return d && d.kind === kind ? d : null;
}

/** Stamp the acting flag onto a detail for the current session. */
function withActing(d: WorkspaceDetail, viewer: UserContext): WorkspaceDetail {
	return { ...d, isActing: actingIdFor(d.kind, viewer) === d.id };
}

/** Candidate alternatives offered when a handle is unavailable. */
function suggestionsFor(base: string): string[] {
	const stem = base.replace(/-+$/, "");
	return [`${stem}-studio`, `${stem}-collective`, `${stem}-hq`, `${stem}-2`]
		.filter((s) => s.length <= 40 && !isTakenHandle(s) && !isReservedHandle(s))
		.slice(0, 3);
}

/** Whether a handle is already claimed by an entity in the store or by a person in the cast. */
function isTakenHandle(handle: string): boolean {
	const key = normalise(handle);
	if (PERSON_HANDLES.has(key)) return true;
	for (const d of STORE.values()) if (normalise(d.handle) === key) return true;
	return false;
}

/** Probe a handle's availability — format, reserved words, then collisions. */
export function checkWorkspaceHandle(raw: string): HandleCheck {
	const handle = normalise(raw);
	if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(handle) || handle.length < 3 || handle.length > 40) {
		return {
			handle,
			available: false,
			reason: "Use 3–40 characters: lowercase letters, numbers and hyphens, ending in one.",
			suggestions: [],
		};
	}
	if (isReservedHandle(handle)) {
		return {
			handle,
			available: false,
			reason: "That word is reserved by the platform.",
			suggestions: suggestionsFor(handle),
		};
	}
	if (isTakenHandle(handle)) {
		return {
			handle,
			available: false,
			reason: `@${handle} is already taken.`,
			suggestions: suggestionsFor(handle),
		};
	}
	return { handle, available: true, reason: null, suggestions: [] };
}
// #endregion

// #region Write outcomes + shared guards
/**
 * A refusal — deliberately **not** parameterised by the success type, so one `resolve()` guard can be
 * returned from methods answering with a detail, a roster or a summary alike.
 */
export interface Refusal {
	ok: false;
	/** Suggested HTTP status the thin route echoes. */
	status: number;
	message: string;
	errors?: Record<string, string>;
}

/** A write's result: the refreshed projection, or a routable refusal. */
export type Outcome<T> = { ok: true; data: T; message?: string } | Refusal;

/** Build a refusal. */
function no(status: number, message: string, errors?: Record<string, string>): Refusal {
	return { ok: false, status, message, errors };
}

/** Build a success. */
function yes<T>(data: T, message?: string): Outcome<T> {
	return { ok: true, data, message };
}

/** The entity plus the acting member — the precondition every mutation shares. */
interface Acting {
	detail: WorkspaceDetail;
	actor: WorkspaceMember;
}

/** Resolve the entity + the acting member, refusing when either is missing. */
function resolve(workspaceId: string): Acting | Refusal {
	const detail = STORE.get(workspaceId);
	if (!detail) return no(404, "No such workspace.");
	const actor = detail.members.find((m) => m.isSelf && m.state === "active");
	if (!actor) return no(403, "You are not a member of this workspace.");
	return { detail, actor };
}

/** Narrow {@link resolve}'s union. */
function isRefusal<T extends object>(x: T | Refusal): x is Refusal {
	return "ok" in x && (x as Refusal).ok === false;
}

/** Commit a mutated projection back to the store, re-deriving everything that depends on it. */
function commit(next: WorkspaceDetail): WorkspaceDetail {
	const settled = recompute(next);
	STORE.set(settled.id, settled);
	return settled;
}

/**
 * Whether the actor may hand `capability` to somebody else — the "a member can never grant a permission
 * they do not hold" invariant.
 *
 * Delegates to the SSOT's {@link mayGrant} for a preset-role holder. A CUSTOM-role holder is checked
 * with the roles-aware {@link can} pair instead, because `mayGrant`'s signature takes no role table and
 * would otherwise evaluate a custom role against its base preset's bundle — under-granting silently.
 */
function actorMayGrant(
	detail: WorkspaceDetail,
	actor: WorkspaceMember,
	capability: WorkspaceCapability,
): boolean {
	const role = detail.roles.find((r) => r.id === actor.roleId);
	if (!role || role.preset !== null) return mayGrant(actor, capability, detail.kind);
	return can(actor, "manage_roles", detail.kind, detail.roles, actor.roleId) &&
		can(actor, capability, detail.kind, detail.roles, actor.roleId);
}

/** Whether the actor holds a capability, resolved against the entity's own role table. */
function actorCan(
	detail: WorkspaceDetail,
	actor: WorkspaceMember,
	capability: WorkspaceCapability,
): boolean {
	return can(actor, capability, detail.kind, detail.roles, actor.roleId);
}
// #endregion

// #region Write: create · update
/** Create a Draft-First entity from name + handle, with the viewer as its owner. */
export function createWorkspace(
	input: CreateWorkspaceInput,
	viewer: UserContext,
): Outcome<WorkspaceSummary> {
	const check = checkWorkspaceHandle(input.handle);
	if (!check.available) {
		return no(422, check.reason ?? "That handle is unavailable.", { handle: check.reason ?? "" });
	}
	const name = input.name.trim();
	if (name.length < 2) return no(422, "Give it a name.", { name: "Give it a name." });

	const owned =
		allOfKind(input.kind).filter((d) =>
			d.members.some((m) => m.isSelf && m.state === "active" && m.rolePreset === "owner")
		).length;
	if (owned >= OWNED_CAP) {
		const copy = kindCopy(input.kind);
		return no(
			403,
			`You already own ${owned} ${copy.plural}. Archive one or upgrade to create another.`,
		);
	}

	const id = `${check.handle}-${++seq}`;
	const seed: WorkspaceSeed = {
		id,
		kind: input.kind,
		name,
		handle: check.handle,
		avatar: input.avatar ?? "",
		bannerImage: "",
		tagline: "",
		status: "draft",
		verification: "unverified",
		verificationPrompt: input.kind === "team"
			? "Verify your identity so the team can receive payouts."
			: "Start KYB to unlock the pooled wallet and hire providers.",
		createdDaysAgo: 0,
		members: [{
			key: ACTING.key,
			roleId: "owner",
			rolePreset: "owner",
			workload: 0,
			shareBp: input.kind === "team" ? 10_000 : 0,
			spendLimitMinor: input.kind === "business" ? null : undefined,
			canSpend: input.kind === "business",
			joinedDaysAgo: 0,
		}],
		availableMinor: 0,
		lockedMinor: 0,
		pendingMinor: 0,
		grossReleaseMinor: 0,
		splitModel: "equal",
		autoDistribute: true,
		approvalThresholdMinor: null,
		periodMinor: 0,
		standing: null,
	};
	const detail = toDetail(seed);
	STORE.set(id, detail);
	ORDER.unshift(id);
	PERIOD.set(id, 0);
	const copy = kindCopy(input.kind);
	return yes(
		toSummary(detail, actingIdFor(input.kind, viewer)),
		`${copy.Noun} created — finish setting it up whenever you like.`,
	);
}

/** Patch the entity's identity / lifecycle state. */
export function updateWorkspace(input: UpdateWorkspaceInput): Outcome<WorkspaceDetail> {
	const found = resolve(input.id);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (input.status && input.status !== detail.status) {
		const needed: WorkspaceCapability = input.status === "archived"
			? "archive_entity"
			: "manage_settings";
		if (!actorCan(detail, actor, needed)) {
			return no(403, "You do not have permission to change this workspace's state.");
		}
	}
	const identity = input.name !== undefined || input.tagline !== undefined ||
		input.avatar !== undefined || input.banner !== undefined;
	if (identity && !actorCan(detail, actor, "edit_profile")) {
		return no(403, "You do not have permission to edit this workspace's profile.");
	}

	const next: WorkspaceDetail = {
		...detail,
		name: input.name?.trim() ?? detail.name,
		tagline: input.tagline ?? detail.tagline,
		avatar: input.avatar ?? detail.avatar,
		banner: input.banner ?? detail.banner,
		status: input.status ?? detail.status,
	};
	return yes(commit(next), "Saved.");
}
// #endregion

// #region Write: invitations
/** Invite somebody by handle or email, at a role the inviter themselves holds the authority for. */
export function inviteMember(input: InviteMemberInput): Outcome<WorkspaceDetail> {
	const found = resolve(input.workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (!actorCan(detail, actor, "invite_members")) {
		return no(403, "You do not have permission to invite people to this workspace.");
	}
	const target = inviteTargetOf(input);
	if (!target) {
		return no(422, "Add a handle or an email address.", {
			handle: "Add a handle or an email address.",
		});
	}
	const role = detail.roles.find((r) => r.id === input.roleId);
	if (!role) return no(422, "That role no longer exists.", { roleId: "Pick a role." });

	// A member can never grant a permission they do not hold — so they can never invite INTO one either.
	const overreach = role.capabilities.find((c) => !actorCan(detail, actor, c));
	if (overreach) {
		return no(403, `You cannot invite someone at a role that can ${labelOf(overreach)}.`);
	}

	const key = normalise(input.handle ?? "");
	if (key && detail.members.some((m) => m.state === "active" && normalise(m.handle) === key)) {
		return no(409, `@${key} is already a member.`);
	}
	const duplicate = detail.invites.some((iv) =>
		iv.direction === "invite" &&
		((key && normalise(iv.handle) === key) ||
			(input.email && iv.email?.toLowerCase() === input.email.toLowerCase()))
	);
	if (duplicate) return no(409, "They already have a pending invitation.");

	const person = Object.values(PEOPLE).find((p) => normalise(p.handle) === key) ?? null;
	const invite: WorkspaceInvite = {
		id: `iv-${detail.id}-${++seq}`,
		direction: "invite",
		handle: person?.handle ?? key,
		name: person?.name ?? (input.email ?? key),
		avatar: person?.avatar ?? "",
		email: input.email ?? person?.email ?? null,
		roleId: input.roleId,
		note: input.note ?? null,
		sentAt: "Just now",
		expiresAt: null,
		viaLink: false,
	};
	return yes(
		commit({ ...detail, invites: [invite, ...detail.invites] }),
		sentence(`Invitation sent to ${invite.name}`),
	);
}

/** Human label for a capability, for a refusal message. */
function labelOf(capability: WorkspaceCapability): string {
	return capability.replace(/_/g, " ");
}

/**
 * Terminate a sentence without doubling a full stop the subject already ends with — half the cast are
 * initialled ("Tomas P."), so a naive `${name}.` reads as "Tomas P..".
 */
function sentence(text: string): string {
	return text.endsWith(".") ? text : `${text}.`;
}

/**
 * Accept or decline an invitation addressed to the viewer. Accepting materialises the membership, so the
 * entity appears on the roster on the next read; declining simply drops the invitation.
 */
export function respondToInvite(
	inviteId: string,
	accept: boolean,
	viewer: UserContext,
): Outcome<WorkspaceRoster> {
	for (const id of ORDER) {
		const detail = STORE.get(id);
		if (!detail) continue;
		const invite = detail.invites.find((iv) =>
			iv.id === inviteId && iv.direction === "invite" && normalise(iv.handle) === ACTING.handle
		);
		if (!invite) continue;

		const invites = detail.invites.filter((iv) => iv.id !== inviteId);
		if (!accept) {
			commit({ ...detail, invites });
			return yes(buildRoster(detail.kind, viewer), "Invitation declined.");
		}
		const role = detail.roles.find((r) => r.id === invite.roleId);
		const person = PEOPLE[ACTING.key];
		const member: WorkspaceMember = {
			id: `${detail.id}-m-${person.userId}`,
			handle: person.handle,
			name: person.name,
			avatar: person.avatar,
			email: person.email,
			roleId: invite.roleId,
			rolePreset: role?.preset ?? "member",
			state: "active",
			overrides: { granted: [], revoked: [] },
			joinedAt: new Date(NOW).toISOString(),
			title: null,
			workload: 0,
			availability: "available",
			isSelf: true,
			spendLimitMinor: detail.kind === "business" ? 0 : null,
			contributedMinor: 0,
			// Joining never dilutes an existing split — a zero stake keeps the 100% invariant intact
			// until someone deliberately re-cuts it.
			shareBp: 0,
			shareHeld: false,
			reportsTo: null,
		};
		const next = commit({ ...detail, invites, members: [...detail.members, member] });
		return yes(
			buildRoster(next.kind, viewer),
			sentence(`You joined ${next.name}`),
		);
	}
	return no(404, "That invitation is no longer available.");
}
// #endregion

// #region Write: members
/** Change a member's role, their per-member overrides, their spend envelope, or remove them. */
export function updateMemberRow(input: UpdateMemberInput): Outcome<WorkspaceDetail> {
	const found = resolve(input.workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	const target = detail.members.find((m) => m.id === input.memberId);
	if (!target) return no(404, "No such member.");
	const isSelf = target.id === actor.id;

	if (input.remove) {
		if (isLastOwner(target, detail.members)) {
			return no(409, "Transfer ownership before removing the last owner.");
		}
		// Leaving is a member's own right; removing anybody else needs authority over them.
		if (!isSelf && !mayManageMember(actor, target, detail.kind)) {
			return no(403, "You do not have permission to remove this member.");
		}
		if (!isSelf && !actorCan(detail, actor, "remove_members")) {
			return no(403, "You do not have permission to remove members.");
		}
		const members = detail.members.map((m) =>
			m.id === target.id ? { ...m, state: "left" as MembershipState } : m
		);
		return yes(
			commit({ ...detail, members }),
			isSelf ? sentence(`You left ${detail.name}`) : `${target.name} was removed.`,
		);
	}

	const changesAuthority = input.roleId !== undefined || input.granted !== undefined ||
		input.revoked !== undefined;
	if (changesAuthority) {
		if (isSelf) return no(403, "You cannot change your own role or permissions.");
		if (!mayManageMember(actor, target, detail.kind)) {
			return no(403, "You do not have authority over this member.");
		}
	}

	let roleId = target.roleId;
	let rolePreset = target.rolePreset;
	if (input.roleId !== undefined && input.roleId !== target.roleId) {
		const role = detail.roles.find((r) => r.id === input.roleId);
		if (!role) return no(422, "That role no longer exists.", { roleId: "Pick a role." });
		if (isLastOwner(target, detail.members) && role.preset !== "owner") {
			return no(409, "Transfer ownership before demoting the last owner.");
		}
		const overreach = role.capabilities.find((c) => !actorMayGrant(detail, actor, c));
		if (overreach) {
			return no(403, `You cannot grant "${labelOf(overreach)}", so you cannot assign that role.`);
		}
		roleId = role.id;
		rolePreset = role.preset ?? "member";
	}

	const allowed = new Set(capabilitiesForKind(detail.kind));
	let granted = target.overrides.granted;
	if (input.granted !== undefined) {
		const next = input.granted.filter((c) => allowed.has(c));
		const overreach = next.find((c) =>
			!target.overrides.granted.includes(c) && !actorMayGrant(detail, actor, c)
		);
		if (overreach) return no(403, `You cannot grant "${labelOf(overreach)}" — you do not hold it.`);
		granted = next;
	}
	let revoked = target.overrides.revoked;
	if (input.revoked !== undefined) {
		if (!actorCan(detail, actor, "manage_roles")) {
			return no(403, "You do not have permission to change permissions.");
		}
		revoked = input.revoked.filter((c) => allowed.has(c));
	}

	if (
		(input.spendLimitMinor !== undefined || input.canSpend !== undefined)
	) {
		if (detail.kind !== "business") {
			return no(422, "Spend envelopes only apply to a business.");
		}
		if (!actorCan(detail, actor, "manage_finances")) {
			return no(403, "You do not have permission to change spend limits.");
		}
	}

	const spendLimitMinor = input.spendLimitMinor !== undefined
		? input.spendLimitMinor
		: target.spendLimitMinor;
	const members = detail.members.map((m) =>
		m.id === target.id
			? { ...m, roleId, rolePreset, overrides: { granted, revoked }, spendLimitMinor }
			: m
	);

	let spend = detail.spend;
	if (spend && (input.spendLimitMinor !== undefined || input.canSpend !== undefined)) {
		spend = {
			...spend,
			limits: spend.limits.map((l) =>
				l.memberId === target.id
					? {
						...l,
						canSpend: input.canSpend ?? l.canSpend,
						limitMinor: spendLimitMinor,
						limit: spendLimitMinor === null ? null : money(spendLimitMinor),
					}
					: l
			),
		};
	}
	return yes(commit({ ...detail, members, spend }), sentence(`${target.name} updated`));
}
// #endregion

// #region Write: roles
/** Create or edit a CUSTOM role. Presets are read-only — duplicating one is the escape hatch. */
export function upsertRoleDef(input: UpsertRoleInput): Outcome<WorkspaceDetail> {
	const found = resolve(input.workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (!actorCan(detail, actor, "manage_roles")) {
		return no(403, "You do not have permission to manage roles.");
	}
	const name = input.name.trim();
	if (name.length === 0) return no(422, "Name the role.", { name: "Name the role." });

	const allowed = new Set(capabilitiesForKind(detail.kind));
	const capabilities = input.capabilities.filter((c) => allowed.has(c));
	const overreach = capabilities.find((c) => !actorMayGrant(detail, actor, c));
	if (overreach) {
		return no(403, `You cannot grant "${labelOf(overreach)}", so a role cannot carry it.`);
	}

	if (input.roleId) {
		const existing = detail.roles.find((r) => r.id === input.roleId);
		if (!existing) return no(404, "No such role.");
		if (existing.preset !== null) {
			return no(422, "Preset roles cannot be edited. Duplicate it to a custom role instead.");
		}
		const roles = detail.roles.map((r) =>
			r.id === existing.id ? { ...r, name, summary: input.summary, capabilities } : r
		);
		return yes(commit({ ...detail, roles }), `${name} updated.`);
	}

	const base = `role-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
	let id = base || `role-${++seq}`;
	while (detail.roles.some((r) => r.id === id)) id = `${base}-${++seq}`;
	const role: WorkspaceRoleDef = {
		id,
		name,
		summary: input.summary,
		preset: null,
		capabilities,
		memberCount: 0,
	};
	return yes(commit({ ...detail, roles: [...detail.roles, role] }), `${name} created.`);
}

/** Delete a custom role. Refused while anybody still holds it — nobody is silently demoted. */
export function deleteRoleDef(workspaceId: string, roleId: string): Outcome<WorkspaceDetail> {
	const found = resolve(workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (!actorCan(detail, actor, "manage_roles")) {
		return no(403, "You do not have permission to manage roles.");
	}
	const role = detail.roles.find((r) => r.id === roleId);
	if (!role) return no(404, "No such role.");
	if (role.preset !== null) return no(422, "Preset roles cannot be deleted.");
	if (role.memberCount > 0) {
		return no(
			409,
			`Move the ${role.memberCount} ${
				role.memberCount === 1 ? "member" : "members"
			} holding ${role.name} to another role first.`,
		);
	}
	return yes(
		commit({ ...detail, roles: detail.roles.filter((r) => r.id !== roleId) }),
		`${role.name} deleted.`,
	);
}
// #endregion

// #region Write: money policy
/** Write a team's split policy. Refused unless the stakes sum to exactly 100%. */
export function updatePayoutPolicy(input: UpdatePayoutInput): Outcome<WorkspaceDetail> {
	const found = resolve(input.workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (detail.kind !== "team" || !detail.payout) {
		return no(422, "Only a team has a payout split.");
	}
	if (!actorCan(detail, actor, "manage_finances")) {
		return no(403, "You do not have permission to change the split.");
	}

	let payout = detail.payout;
	if (input.stakes) {
		const active = new Map(activeMembers(detail.members).map((m) => [m.id, m]));
		for (const s of input.stakes) {
			if (!active.has(s.memberId)) return no(422, "A stake names somebody who is not a member.");
		}
		const drift = splitDriftBp(input.stakes);
		if (drift !== 0) {
			const over = drift > 0;
			return no(
				422,
				`The split is ${over ? "over" : "under"} by ${
					Math.abs(drift) / 100
				}%. Shares must total 100%.`,
				{ stakes: "Shares must total exactly 100%." },
			);
		}
		const release = payout.projectedRelease.minor;
		payout = {
			...payout,
			stakes: priceStakes(
				input.stakes.map((s) => {
					const m = active.get(s.memberId)!;
					return {
						memberId: m.id,
						handle: m.handle,
						name: m.name,
						avatar: m.avatar,
						shareBp: s.shareBp,
						held: s.held,
					};
				}),
				release,
			),
		};
	}
	if (input.model) payout = { ...payout, model: input.model };
	if (input.autoDistribute !== undefined) {
		payout = { ...payout, autoDistribute: input.autoDistribute };
	}

	// Mirror the stakes back onto the roster so the member drawer and the bar cannot disagree.
	const stakeById = new Map(payout.stakes.map((s) => [s.memberId, s]));
	const members = detail.members.map((m) => {
		const s = stakeById.get(m.id);
		return s ? { ...m, shareBp: s.shareBp, shareHeld: s.held } : m;
	});
	return yes(commit({ ...detail, payout, members }), "Split saved.");
}

/** Write a business's pooled-wallet governance. */
export function updateSpendPolicy(input: UpdateSpendInput): Outcome<WorkspaceDetail> {
	const found = resolve(input.workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (detail.kind !== "business" || !detail.spend) {
		return no(422, "Only a business has a spend policy.");
	}
	if (!actorCan(detail, actor, "manage_finances")) {
		return no(403, "You do not have permission to change the spend policy.");
	}

	const active = new Set(activeMembers(detail.members).map((m) => m.id));
	const patches = input.limits;
	if (patches) {
		for (const l of patches) {
			if (!active.has(l.memberId)) return no(422, "A limit names somebody who is not a member.");
		}
	}

	let spend = detail.spend;
	const threshold = input.approvalThresholdMinor !== undefined
		? input.approvalThresholdMinor
		: spend.approvalThresholdMinor;
	spend = {
		...spend,
		approvalThresholdMinor: threshold,
		approvalThreshold: threshold === null ? null : money(threshold),
		contributorIds: input.contributorIds
			? input.contributorIds.filter((id) => active.has(id))
			: spend.contributorIds,
		limits: patches
			? spend.limits.map((l) => {
				const patch = patches.find((x) => x.memberId === l.memberId);
				if (!patch) return l;
				return {
					...l,
					canSpend: patch.canSpend,
					limitMinor: patch.limitMinor,
					limit: patch.limitMinor === null ? null : money(patch.limitMinor),
					perTransactionMinor: patch.perTransactionMinor,
				};
			})
			: spend.limits,
	};

	let members = detail.members;
	if (patches) {
		const byId = new Map(spend.limits.map((l) => [l.memberId, l]));
		members = members.map((m) => {
			const l = byId.get(m.id);
			return l ? { ...m, spendLimitMinor: l.limitMinor } : m;
		});
	}
	return yes(commit({ ...detail, spend, members }), "Spend policy saved.");
}

/**
 * Decide an outstanding spend request. An approval draws the amount from the pool and records an
 * attributable ledger line naming both the spender and the approver — a pooled wallet without
 * attribution is a dispute waiting to happen.
 */
export function decideSpendRequest(
	workspaceId: string,
	requestId: string,
	approve: boolean,
): Outcome<WorkspaceDetail> {
	const found = resolve(workspaceId);
	if (isRefusal(found)) return found;
	const { detail, actor } = found;

	if (detail.kind !== "business" || !detail.spend) {
		return no(422, "Only a business has spend requests.");
	}
	if (!actorCan(detail, actor, "approve_spend")) {
		return no(403, "You do not have permission to approve spend.");
	}
	const request = detail.spend.requests.find((r) => r.id === requestId);
	if (!request) return no(404, "No such request.");
	if (request.state !== "pending") return no(409, "That request has already been decided.");
	if (request.memberId === actor.id) return no(403, "You cannot approve your own request.");

	const decided: SpendRequest = {
		...request,
		state: approve ? "approved" : "declined",
		decidedBy: actor.name,
		decidedAt: "Today",
	};
	const requests = detail.spend.requests.map((r) => (r.id === requestId ? decided : r));

	let entries = detail.spend.entries;
	let limits = detail.spend.limits;
	let finance = detail.finance;
	if (approve) {
		const entry: PoolEntry = {
			id: `pe-${detail.id}-${++seq}`,
			kind: "spend",
			memberId: request.memberId,
			handle: request.handle,
			name: request.name,
			avatar: request.avatar,
			amount: request.amount,
			reason: request.reason,
			at: fmtDay(NOW),
			approvedBy: actor.name,
		};
		entries = [entry, ...entries];
		limits = limits.map((l) =>
			l.memberId === request.memberId
				? { ...l, spent: money(l.spent.minor + request.amount.minor) }
				: l
		);
		const available = Math.max(0, finance.available.minor - request.amount.minor);
		finance = {
			...finance,
			available: money(available),
			locked: money(finance.locked.minor + request.amount.minor),
		};
	}

	return yes(
		commit({ ...detail, spend: { ...detail.spend, requests, entries, limits }, finance }),
		approve
			? sentence(`Approved ${request.amount.display} for ${request.name}`)
			: "Request declined.",
	);
}
// #endregion

// #region Viewer-scoped read entry points
/** The viewer-scoped console projection, or a refusal when the entity is unknown / not theirs. */
export function readWorkspace(
	kind: WorkspaceKind,
	id: string,
	viewer: UserContext,
): Outcome<WorkspaceDetail> {
	const detail = findWorkspace(kind, id);
	if (!detail) return no(404, "No such workspace.");
	if (!detail.viewerMemberId) return no(403, "You are not a member of this workspace.");
	return yes(withActing(detail, viewer));
}

/** Re-stamp a mutated projection with the session's acting flag before it goes back over the wire. */
export function withViewer(detail: WorkspaceDetail, viewer: UserContext): WorkspaceDetail {
	return withActing(detail, viewer);
}
// #endregion

// #region Developer simulation overlay
/**
 * Apply a {@link WorkspaceSim} overlay to a resolved console projection.
 *
 * The Dev Context Switcher lives on the CLIENT (`<html data-dev-*>`), so a server-derived surface can
 * only be simulated by being told what to simulate — the axes arrive as query params on the read
 * (matching the `/wallet` precedent). This grants no access: it rewrites the answer to the developer's
 * own request, nothing else, and the live path never calls it.
 *
 * The role overlay recomputes `viewerCapabilities` through the SSOT's `effectivePermissions` rather than
 * hand-substituting a capability list, so a simulated Member is gated by exactly the same union the real
 * one would be — otherwise the simulation would prove nothing about the real gate.
 */
export function applyWorkspaceSim(
	detail: WorkspaceDetail,
	sim: WorkspaceSim | undefined,
): WorkspaceDetail {
	if (simIsEmpty(sim) || !sim) return detail;
	let next: WorkspaceDetail = { ...detail };

	if (sim.role !== undefined) {
		if (sim.role === "non_member") {
			// Not a member: no capabilities at all. The console's redirect invariant must then carry them
			// somewhere usable rather than dead-ending, which is the whole point of being able to reach it.
			next = { ...next, viewerCapabilities: [], viewerMemberId: "", viewerRoleId: "" };
		} else {
			const preset = sim.role;
			const roleId = next.roles.find((r) => r.preset === preset)?.id ?? preset;
			const self = next.members.find((m) => m.id === next.viewerMemberId) ?? next.members[0];
			const simulated = self ? { ...self, rolePreset: preset, roleId } : undefined;
			next = {
				...next,
				viewerRoleId: roleId,
				viewerCapabilities: simulated
					? effectivePermissions(simulated, next.kind, next.roles, roleId)
					: [],
				members: simulated
					? next.members.map((m) => (m.id === simulated.id ? simulated : m))
					: next.members,
			};
		}
	}

	if (sim.membership !== undefined && next.viewerMemberId) {
		next = {
			...next,
			members: next.members.map((m) =>
				m.id === next.viewerMemberId ? { ...m, state: sim.membership! } : m
			),
		};
	}

	if (sim.verification !== undefined) {
		next = {
			...next,
			verification: sim.verification,
			verificationPrompt: sim.verification === "verified" ? null : next.verificationPrompt,
			spend: next.spend
				? {
					...next.spend,
					verification: sim.verification,
					verificationPrompt: sim.verification === "verified"
						? null
						: next.spend.verificationPrompt,
				}
				: null,
		};
	}

	if (sim.acting !== undefined) next = { ...next, isActing: sim.acting };

	return next;
}

/** Apply the roster-shape overlay: the selling empty state, or a single one-person entity. */
export function applyRosterSim(
	roster: WorkspaceRoster,
	sim: WorkspaceSim | undefined,
): WorkspaceRoster {
	if (!sim?.roster || sim.roster === "populated") return roster;
	if (sim.roster === "empty") {
		return { ...roster, items: [], invitations: [], actingId: null };
	}
	// `single` keeps one entity and strips it to one member, so the one-person-team pre-state (legal, but
	// cannot propose) is reachable without editing fixtures.
	const first = roster.items[0];
	return {
		...roster,
		items: first ? [{ ...first, memberCount: 1, faces: first.faces.slice(0, 1) }] : [],
		invitations: [],
	};
}
// #endregion
