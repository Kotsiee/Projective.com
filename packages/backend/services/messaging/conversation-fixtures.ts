import type {
	ContactList,
	ConversationDetail,
	ConversationListPage,
	ConversationListParams,
	ConversationParticipant,
	ConversationRelation,
	ConversationSummary,
	MessagingContact,
} from "@projective/types/messaging";

/**
 * messaging conversation fixtures — the fat {@link MessagingBackendService}'s in-memory answer for the
 * global inbox (`/messages`) conversation LIST + single-conversation metadata + contact picker, while
 * `MESSAGING_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10). DERIVED from the same
 * multi-tenant cast the `/projects` feed uses (owner "Ahmed K." / `@ahmed` as the acting viewer; the
 * client/team/business counterparties as the other parties) so the inbox agrees with the projects a
 * conversation belongs to, and the `dm-{handle}` ids match the project DM `chatId`s (unified messaging,
 * PRODUCT_SPEC §Unified Messaging). No RNG — the corpus is a fixed table; when the live path lands the
 * RLS-scoped `messages.*` reads replace it behind the same gate with zero shape churn.
 */

// #region Avatars (same Unsplash face crops as the projects corpus — identities stay consistent)
const FACE = (id: string) =>
	`https://images.unsplash.com/${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;

const MARA = FACE("photo-1494790108377-be9c29b29330");
const DANIEL = FACE("photo-1500648767791-00dcc994a43e");
const PRIYA = FACE("photo-1438761681033-6461ffad8d80");
const THEO = FACE("photo-1507003211169-0a1dd7228f2d");
const LENA = FACE("photo-1544005313-94ddf0286df2");
const OMAR = FACE("photo-1506794778202-cad84cf45f1d");
const SOFIA = FACE("photo-1534528741775-53994a69daeb");
const NOAH = FACE("photo-1531427186611-ecfd6d936c79");
const GROUP =
	"https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=96&h=96&q=80";

/** Entity ids shared with the projects corpus (`fixtures.ts`). */
const TEAM_NORTHWIND = "t_northwind";
const BUSINESS_MONARCH = "b_monarch";

/** Provider service ids shared with the projects corpus. */
const SVC_BRAND = "s_brand_identity";
const SVC_WEBAPP = "s_webapp_build";
const SVC_MOTION = "s_motion_system";
/** Product id (new — the projects corpus has none; the inbox demonstrates a product inquiry). */
const PRD_UI_KIT = "p_ui_kit";
// #endregion

// #region Deterministic activity label (declared before the corpus — `ALL` uses it at module init)
/** Fixed reference "now" (shared with the messaging message fixtures) — no `Date.now()`. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2:30 PM` for today, else `Yesterday`, else `Mon, Jul 14` — UTC components (tz-independent). */
function fmtActivity(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) {
		const d = new Date(ms);
		let h = d.getUTCHours();
		const m = d.getUTCMinutes();
		const ampm = h < 12 ? "AM" : "PM";
		h = h % 12;
		if (h === 0) h = 12;
		return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
	}
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
// #endregion

// #region Participant helper
function person(
	id: string,
	name: string,
	avatar: string | null,
	handle: string | null,
	roleLabel: string | null,
	online = false,
): ConversationParticipant {
	return { id, name, avatar, handle, roleLabel, online };
}

/** The acting viewer — never listed among a summary's `participants` (they are implicit). */
export const VIEWER: ConversationParticipant = person(
	"you",
	"Ahmed K.",
	FACE("photo-1531123897727-8f129e1688ce"),
	"ahmed",
	"You",
	true,
);
// #endregion

// #region Conversation corpus
/** A dense seed for one conversation; materialised into a {@link ConversationSummary} below. */
interface Seed {
	id: string;
	kind: ConversationSummary["kind"];
	relation: ConversationRelation;
	title: string;
	avatar: string | null;
	participants: ConversationParticipant[];
	preview: string;
	updatedAt: string;
	unread?: boolean;
	starred?: boolean;
	archived?: boolean;
	muted?: boolean;
	messageCount: number;
	serviceId?: string;
	serviceName?: string;
	productId?: string;
	productName?: string;
	entityId?: string;
	entityName?: string;
}

const SEEDS: readonly Seed[] = [
	// —— Clients (freelancer view: people who hired the viewer) ————————————————————————
	{
		id: "dm-mara",
		kind: "dm",
		relation: "client",
		title: "Mara Ellison",
		avatar: MARA,
		participants: [person("mara", "Mara Ellison", MARA, "mara", "Client", true)],
		preview: "You: Final direction locked ✅ great work!",
		updatedAt: "2026-07-17T15:10:00Z",
		unread: true,
		starred: true,
		messageCount: 54,
		serviceId: SVC_BRAND,
		serviceName: "Brand Identity Sprint",
	},
	{
		id: "dm-theo",
		kind: "dm",
		relation: "client",
		title: "Theo Marsh",
		avatar: THEO,
		participants: [person("theo", "Theo Marsh", THEO, "theo", "Client")],
		preview: "Theo: Can you share the latest build?",
		updatedAt: "2026-07-17T11:42:00Z",
		unread: true,
		messageCount: 38,
		serviceId: SVC_WEBAPP,
		serviceName: "Web App Build",
	},
	{
		id: "dm-sofia",
		kind: "dm",
		relation: "client",
		title: "Sofia Marin",
		avatar: SOFIA,
		participants: [person("sofia", "Sofia Marin", SOFIA, "sofia", "Client", true)],
		preview: "You: Booked our next session for Thursday.",
		updatedAt: "2026-07-16T18:05:00Z",
		messageCount: 21,
		serviceId: SVC_MOTION,
		serviceName: "Motion System",
	},
	// —— Service / product inquiries (inbound prospective clients) ————————————————————
	{
		id: "dm-omar",
		kind: "service_inquiry",
		relation: "client",
		title: "Omar Haddad",
		avatar: OMAR,
		participants: [person("omar", "Omar Haddad", OMAR, "omar", "Prospective client")],
		preview: "Omar: Hi! Interested in your Brand Identity Sprint…",
		updatedAt: "2026-07-17T09:20:00Z",
		unread: true,
		messageCount: 4,
		serviceId: SVC_BRAND,
		serviceName: "Brand Identity Sprint",
	},
	{
		id: "dm-noah",
		kind: "service_inquiry",
		relation: "client",
		title: "Noah Bennett",
		avatar: NOAH,
		participants: [person("noah", "Noah Bennett", NOAH, "noah", "Prospective client")],
		preview: "Noah: Is the UI Kit available for a team licence?",
		updatedAt: "2026-07-15T14:30:00Z",
		messageCount: 6,
		productId: PRD_UI_KIT,
		productName: "Aurora UI Kit",
	},
	// —— Co-freelancer (a peer collaborating with the viewer) —————————————————————————
	{
		id: "dm-priya",
		kind: "dm",
		relation: "co_freelancer",
		title: "Priya Nair",
		avatar: PRIYA,
		participants: [person("priya", "Priya Nair", PRIYA, "priya", "Freelancer", true)],
		preview: "Priya: I'll take the illustration pass this week.",
		updatedAt: "2026-07-16T10:15:00Z",
		messageCount: 27,
	},
	// —— Team (a group chat for the viewer's team) + a team member DM ————————————————
	{
		id: "grp-northwind",
		kind: "group",
		relation: "team",
		title: "Northwind Studio",
		avatar: GROUP,
		participants: [
			person("daniel", "Daniel Okafor", DANIEL, "daniel", "Team lead", true),
			person("lena", "Lena Fischer", LENA, "lena", "Team member"),
			person("priya", "Priya Nair", PRIYA, "priya", "Team member"),
		],
		preview: "Daniel: Standup notes are in the thread 👇",
		updatedAt: "2026-07-17T08:00:00Z",
		unread: true,
		starred: true,
		messageCount: 142,
		entityId: TEAM_NORTHWIND,
		entityName: "Northwind Studio",
	},
	{
		id: "dm-lena",
		kind: "dm",
		relation: "team_member",
		title: "Lena Fischer",
		avatar: LENA,
		participants: [person("lena", "Lena Fischer", LENA, "lena", "Team member")],
		preview: "You: Nice — that reads much cleaner.",
		updatedAt: "2026-07-15T16:48:00Z",
		messageCount: 33,
		entityId: TEAM_NORTHWIND,
		entityName: "Northwind Studio",
	},
	{
		id: "dm-daniel",
		kind: "dm",
		relation: "team_member",
		title: "Daniel Okafor",
		avatar: DANIEL,
		participants: [person("daniel", "Daniel Okafor", DANIEL, "daniel", "Team lead", true)],
		preview: "Daniel: Let's sync on the Atlas portal tomorrow.",
		updatedAt: "2026-07-14T12:30:00Z",
		messageCount: 61,
		entityId: TEAM_NORTHWIND,
		entityName: "Northwind Studio",
	},
	// —— Client view: a hired freelancer + a business group + a business member ————————
	{
		id: "grp-monarch",
		kind: "group",
		relation: "business",
		title: "Monarch Labs",
		avatar: GROUP,
		participants: [
			person("priya", "Priya Nair", PRIYA, "priya", "Business admin", true),
			person("noah", "Noah Bennett", NOAH, "noah", "Business member"),
		],
		preview: "Priya: Design system review moved to Friday.",
		updatedAt: "2026-07-16T13:12:00Z",
		messageCount: 88,
		entityId: BUSINESS_MONARCH,
		entityName: "Monarch Labs",
	},
	{
		id: "dm-priya-monarch",
		kind: "dm",
		relation: "business_member",
		title: "Priya Nair",
		avatar: PRIYA,
		participants: [person("priya", "Priya Nair", PRIYA, "priya", "Business admin", true)],
		preview: "You: Sent over the maintenance quote.",
		updatedAt: "2026-07-13T09:45:00Z",
		messageCount: 19,
		entityId: BUSINESS_MONARCH,
		entityName: "Monarch Labs",
	},
	{
		id: "dm-daniel-hired",
		kind: "dm",
		relation: "hired_freelancer",
		title: "Daniel Okafor",
		avatar: DANIEL,
		participants: [person("daniel", "Daniel Okafor", DANIEL, "daniel", "Hired freelancer", true)],
		preview: "Daniel: Kicking off the design system build 🚀",
		updatedAt: "2026-07-17T07:30:00Z",
		unread: true,
		messageCount: 44,
	},
	// —— Plain DMs (no engagement context — shown in every view) ——————————————————————
	{
		id: "dm-lena-friend",
		kind: "dm",
		relation: "dm",
		title: "Lena Fischer",
		avatar: LENA,
		participants: [person("lena", "Lena Fischer", LENA, "lena", null)],
		preview: "Lena: Coffee before the conference?",
		updatedAt: "2026-07-12T19:00:00Z",
		messageCount: 12,
	},
	{
		id: "dm-theo-archived",
		kind: "dm",
		relation: "dm",
		title: "Theo Marsh",
		avatar: THEO,
		participants: [person("theo", "Theo Marsh", THEO, "theo", null)],
		preview: "You: Thanks, closing this out for now.",
		updatedAt: "2026-06-30T10:00:00Z",
		archived: true,
		messageCount: 9,
	},
	// —— An empty thread (never surfaces — proves the messageCount>0 visibility rule) ——
	{
		id: "dm-sofia-empty",
		kind: "dm",
		relation: "dm",
		title: "Sofia Marin",
		avatar: SOFIA,
		participants: [person("sofia", "Sofia Marin", SOFIA, "sofia", null)],
		preview: "",
		updatedAt: "2026-05-01T10:00:00Z",
		messageCount: 0,
	},
];

/** Materialise a seed into a full {@link ConversationSummary}. */
function toSummary(seed: Seed): ConversationSummary {
	return {
		id: seed.id,
		kind: seed.kind,
		relation: seed.relation,
		title: seed.title,
		avatar: seed.avatar,
		participants: seed.participants,
		preview: seed.preview,
		lastActivityLabel: fmtActivity(Date.parse(seed.updatedAt)),
		updatedAt: seed.updatedAt,
		unread: seed.unread ?? false,
		starred: seed.starred ?? false,
		archived: seed.archived ?? false,
		muted: seed.muted ?? false,
		messageCount: seed.messageCount,
		serviceId: seed.serviceId ?? null,
		serviceName: seed.serviceName ?? null,
		productId: seed.productId ?? null,
		productName: seed.productName ?? null,
		entityId: seed.entityId ?? null,
		entityName: seed.entityName ?? null,
	};
}

const ALL: readonly ConversationSummary[] = SEEDS.map(toSummary);
// #endregion

// #region Filtering + reads
function matchesQuery(c: ConversationSummary, q: string): boolean {
	const needle = q.trim().toLowerCase();
	if (!needle) return true;
	if (c.title.toLowerCase().includes(needle)) return true;
	if (c.preview.toLowerCase().includes(needle)) return true;
	return c.participants.some((p) =>
		p.name.toLowerCase().includes(needle) || (p.handle ?? "").toLowerCase().includes(needle)
	);
}

function passesFilter(c: ConversationSummary, params: ConversationListParams): boolean {
	const f = params.filter;
	if (f) {
		if (f.relations && f.relations.length > 0 && !f.relations.includes(c.relation)) return false;
		if (
			f.serviceIds && f.serviceIds.length > 0 &&
			!(c.serviceId && f.serviceIds.includes(c.serviceId))
		) {
			return false;
		}
		if (
			f.productIds && f.productIds.length > 0 &&
			!(c.productId && f.productIds.includes(c.productId))
		) {
			return false;
		}
		if (
			f.entityIds && f.entityIds.length > 0 && !(c.entityId && f.entityIds.includes(c.entityId))
		) {
			return false;
		}
		if (f.memberIds && f.memberIds.length > 0) {
			const hit = c.participants.some((p) =>
				f.memberIds!.includes(p.id) || (p.handle ? f.memberIds!.includes(p.handle) : false)
			);
			if (!hit) return false;
		}
	}
	return true;
}

const DEFAULT_LIMIT = 30;

/**
 * Resolve a filtered, paged, most-recently-active-first page of conversations. Enforces the visibility
 * rule (`messageCount > 0`), the archived/starred partition, unread + free-text + advanced filters, and
 * simple id-cursor paging.
 */
export function findConversations(params: ConversationListParams): ConversationListPage {
	let list = ALL.filter((c) => c.messageCount > 0);

	// Partition: an explicit view scopes to it; when omitted the FULL set is returned (incl. archived) so
	// the client can overlay its local star/archive prefs + view partitioning without a refetch (the
	// sidebar owns those optimistically until the backend does — task §2A).
	if (params.view === "archived") list = list.filter((c) => c.archived);
	else if (params.view === "starred") list = list.filter((c) => c.starred && !c.archived);
	else if (params.view === "inbox") list = list.filter((c) => !c.archived);

	if (params.unread) list = list.filter((c) => c.unread);
	if (params.q) list = list.filter((c) => matchesQuery(c, params.q!));
	list = list.filter((c) => passesFilter(c, params));

	// Most-recent first.
	const sorted = [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	const total = sorted.length;

	// Cursor paging: start strictly after the cursor id.
	let start = 0;
	if (params.cursor) {
		const idx = sorted.findIndex((c) => c.id === params.cursor);
		start = idx === -1 ? 0 : idx + 1;
	}
	const limit = Math.min(100, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	const conversations = sorted.slice(start, start + limit);
	const hasMore = start + limit < total;

	return {
		conversations,
		hasMore,
		nextCursor: hasMore && conversations.length > 0
			? conversations[conversations.length - 1].id
			: null,
		total,
	};
}

/**
 * The raw summary for one conversation id, or `null`. Falls back to SYNTHESISING a fresh, empty DM for
 * an unknown `dm-{handle}` id when a matching contact exists — so a conversation just started from the
 * New Conversation / profile Message flow resolves end-to-end (empty stream + composer) instead of
 * 404-ing before its first message lands (task §2B / §3).
 */
export function findConversationSummary(id: string): ConversationSummary | null {
	const existing = ALL.find((c) => c.id === id);
	if (existing) return existing;
	if (id.startsWith("dm-")) {
		const contact = findContact(id.slice(3));
		if (contact) return synthesizeDm(id, contact);
	}
	if (id.startsWith("grp-new-")) return synthesizeGroup(id);
	return null;
}

/** Find a known person by handle/id across the corpus participants + the extra connections. */
function findContact(handleOrId: string): MessagingContact | null {
	const all = findContacts().contacts;
	return all.find((c) => c.handle === handleOrId || c.id === handleOrId) ?? null;
}

/** Build a fresh, empty DM summary for a just-started conversation with a known contact. */
function synthesizeDm(id: string, contact: MessagingContact): ConversationSummary {
	return {
		id,
		kind: "dm",
		relation: contact.relation,
		title: contact.name,
		avatar: contact.avatar,
		participants: [
			person(
				contact.id,
				contact.name,
				contact.avatar,
				contact.handle,
				contact.context,
				contact.online,
			),
		],
		preview: "",
		lastActivityLabel: "Now",
		updatedAt: new Date(NOW).toISOString(),
		unread: false,
		starred: false,
		archived: false,
		muted: false,
		messageCount: 0,
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		entityId: null,
		entityName: null,
	};
}

/** Build a fresh, empty GROUP summary for a just-started group conversation. */
function synthesizeGroup(id: string): ConversationSummary {
	return {
		id,
		kind: "group",
		relation: "dm",
		title: "New group",
		avatar: GROUP,
		participants: [],
		preview: "",
		lastActivityLabel: "Now",
		updatedAt: new Date(NOW).toISOString(),
		unread: false,
		starred: false,
		archived: false,
		muted: false,
		messageCount: 0,
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		entityId: null,
		entityName: null,
	};
}

/** The single-conversation metadata for the conversation view header + Members tab, or `null`. */
export function findConversationDetail(id: string): ConversationDetail | null {
	const c = findConversationSummary(id);
	if (!c) return null;
	const memberCount = c.participants.length + 1; // + the viewer
	const sub = c.kind === "group"
		? `${memberCount} members`
		: c.participants[0]?.handle
		? `@${c.participants[0].handle}`
		: c.title;
	return {
		id: c.id,
		kind: c.kind,
		relation: c.relation,
		title: c.title,
		avatar: c.avatar,
		sub,
		participants: c.participants,
		starred: c.starred,
		muted: c.muted,
		archived: c.archived,
		// Anyone may add members to a group; either party of a DM may spin one up (task §2B).
		canAddMembers: true,
		serviceId: c.serviceId,
		serviceName: c.serviceName,
	};
}
// #endregion

// #region Contact picker
/** Unique people across the corpus, plus a couple of connections without an active thread. */
const EXTRA_CONTACTS: readonly MessagingContact[] = [
	{
		id: "ivy",
		name: "Ivy Chen",
		avatar: FACE("photo-1524504388940-b1c1722653e1"),
		handle: "ivy",
		context: "Following",
		relation: "dm",
		online: true,
	},
	{
		id: "marcus",
		name: "Marcus Reed",
		avatar: FACE("photo-1519085360753-af0119f7cbe7"),
		handle: "marcus",
		context: "Connection",
		relation: "dm",
		online: false,
	},
];

/** Build the contact list for the picker — every distinct party in the corpus + a few connections. */
export function findContacts(_role?: ConversationListParams["role"], q?: string): ContactList {
	const seen = new Set<string>();
	const out: MessagingContact[] = [];
	for (const c of ALL) {
		for (const p of c.participants) {
			if (seen.has(p.id)) continue;
			seen.add(p.id);
			out.push({
				id: p.id,
				name: p.name,
				avatar: p.avatar,
				handle: p.handle,
				context: p.roleLabel ?? (c.entityName ?? null),
				relation: c.relation,
				online: p.online,
			});
		}
	}
	for (const e of EXTRA_CONTACTS) {
		if (!seen.has(e.id)) {
			seen.add(e.id);
			out.push(e);
		}
	}
	const needle = (q ?? "").trim().toLowerCase();
	const filtered = needle
		? out.filter((c) =>
			c.name.toLowerCase().includes(needle) || (c.handle ?? "").toLowerCase().includes(needle)
		)
		: out;
	filtered.sort((a, b) => a.name.localeCompare(b.name));
	return { contacts: filtered, total: filtered.length };
}
// #endregion
