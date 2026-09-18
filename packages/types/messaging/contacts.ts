import { z } from "zod";
import { ConversationKind, MessagingContactSchema } from "./conversations.ts";

/**
 * messaging.contacts — the Zod SSOT for the RANKED people picker (New message · New group · Add
 * members · Share with…) and for the two conversation WRITES it feeds (create a conversation, add
 * members to one).
 *
 * ## One ranking, computed once
 *
 * The picker orders candidates by how the viewer knows them, then by how recently the two of them
 * interacted. That rule is a claim the product makes about the reader's own relationships, so it is
 * implemented exactly once — {@link deriveContactRank} over a {@link ContactEvidence} record — and
 * every source of candidates (the fixture corpus, the RLS-scoped live reads, a test) produces
 * EVIDENCE and hands it here rather than deciding a tier itself. Two implementations of "is this a
 * mutual follow" is one that will disagree about somebody.
 *
 * The tiers, in descending weight (PRODUCT_SPEC §Unified Messaging):
 *  1. `shared_entity`  — a team, business or organisation both people belong to.
 *  2. `mutual_follow`  — each follows the other.
 *  3. `follows`        — the viewer follows them (not back).
 *  4. `collaborated`   — they were both on a project (a completed one ranks as the same tier; the
 *                        reason line names the project so the reader can tell).
 *  5. `conversed`      — a thread already exists between them. Not in the brief's four, and kept
 *                        deliberately BELOW them: it is the weakest evidence of a relationship, but
 *                        on the live path today it is the only durable one, and dropping it would
 *                        empty the picker for most accounts.
 *  6. `none`           — no evidence at all: a directory hit for a typed search, or a brand-new
 *                        account's whole universe. Sorted by name, because there is nothing else.
 *
 * Within a tier the sort is by the most recent interaction, newest first. A candidate with no
 * instant at all sorts after every candidate with one, then by name — a date is never invented.
 */

// #region Tiers
export const ContactTier = z.enum([
	"shared_entity",
	"mutual_follow",
	"follows",
	"collaborated",
	"conversed",
	"none",
]);
export type ContactTier = z.infer<typeof ContactTier>;

/** Tier weight — higher sorts first. Spelled out so the ORDER is data, not enum position. */
export const TIER_WEIGHT: Readonly<Record<ContactTier, number>> = {
	shared_entity: 5,
	mutual_follow: 4,
	follows: 3,
	collaborated: 2,
	conversed: 1,
	none: 0,
};

/** Every tier, descending weight — the group order a picker renders. */
export const TIER_ORDER: readonly ContactTier[] = [
	"shared_entity",
	"mutual_follow",
	"follows",
	"collaborated",
	"conversed",
	"none",
];

/** The heading a picker prints above each tier's group. */
export const TIER_LABEL: Readonly<Record<ContactTier, string>> = {
	shared_entity: "Your teams & businesses",
	mutual_follow: "Follow each other",
	follows: "You follow",
	collaborated: "Worked together",
	conversed: "Recent conversations",
	none: "More people",
};
// #endregion

// #region Evidence → rank (the one derivation)
/** The kind of shared workspace an affiliation is through. */
export type SharedEntityKind = "team" | "business" | "organisation";

/** One shared affiliation. `since` is when the CANDIDATE joined, or null when unknown. */
export interface SharedEntityEvidence {
	kind: SharedEntityKind;
	id: string;
	name: string;
	since: string | null;
}

/** One project both people were on. `at` is the most recent instant of that engagement known. */
export interface CollaborationEvidence {
	projectId: string;
	title: string;
	completed: boolean;
	at: string | null;
}

/**
 * Everything the ranking may consult about ONE candidate. Every field is optional-by-emptiness so
 * that a source which knows nothing about an axis (the live path has no "collaborated" read for a
 * project the viewer only participates in) simply leaves it empty, and a brand-new account with
 * zero interactions produces a record of empties that ranks — correctly — as `none`.
 */
export interface ContactEvidence {
	sharedEntities: readonly SharedEntityEvidence[];
	/** ISO instant the viewer followed the candidate, or null when they do not. */
	followsThem: string | null;
	/** ISO instant the candidate followed the viewer, or null when they do not. */
	followsMe: string | null;
	collaborations: readonly CollaborationEvidence[];
	/** ISO instant of the newest message either of them sent the other, or null. */
	lastMessageAt: string | null;
}

/** The empty record — what a source starts from before adding what it knows. */
export function emptyEvidence(): ContactEvidence {
	return {
		sharedEntities: [],
		followsThem: null,
		followsMe: null,
		collaborations: [],
		lastMessageAt: null,
	};
}

/** What the ranking decides about a candidate. */
export interface ContactRank {
	tier: ContactTier;
	/** A short, human reason the candidate is offered (the picker's context line); null for `none`. */
	reason: string | null;
	/** The newest instant across every piece of evidence — the within-tier sort key. */
	lastInteractionAt: string | null;
}

const ENTITY_KIND_LABEL: Readonly<Record<SharedEntityKind, string>> = {
	team: "team",
	business: "business",
	organisation: "organisation",
};

/** Parse an ISO instant defensively; an unparseable value counts as no instant. */
function instantOf(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : null;
}

/** The newest of several optional instants, as ISO, or null when none parses. */
function newest(...isos: (string | null | undefined)[]): string | null {
	let best: number | null = null;
	let bestIso: string | null = null;
	for (const iso of isos) {
		const ms = instantOf(iso);
		if (ms === null) continue;
		if (best === null || ms > best) {
			best = ms;
			bestIso = iso ?? null;
		}
	}
	return bestIso;
}

/**
 * Derive a candidate's tier, reason and recency from the evidence about them.
 *
 * Total and pure: every input shape yields a rank, and the same evidence always yields the same
 * rank. The first tier whose evidence is present wins; the recency is the newest instant across ALL
 * evidence, not only the winning tier's — a teammate the viewer messaged yesterday is more recent
 * than one they joined a team with last year, whichever tier placed them.
 */
export function deriveContactRank(evidence: ContactEvidence): ContactRank {
	const lastInteractionAt = newest(
		evidence.lastMessageAt,
		evidence.followsThem,
		evidence.followsMe,
		...evidence.sharedEntities.map((e) => e.since),
		...evidence.collaborations.map((c) => c.at),
	);

	if (evidence.sharedEntities.length > 0) {
		// Name the most recently joined affiliation; count the rest rather than listing them.
		const sorted = [...evidence.sharedEntities].sort((a, b) =>
			(instantOf(b.since) ?? -1) - (instantOf(a.since) ?? -1)
		);
		const lead = sorted[0];
		const more = sorted.length - 1;
		const reason = `${lead.name} · ${ENTITY_KIND_LABEL[lead.kind]}${more > 0 ? ` +${more}` : ""}`;
		return { tier: "shared_entity", reason, lastInteractionAt };
	}

	if (evidence.followsThem && evidence.followsMe) {
		return { tier: "mutual_follow", reason: "You follow each other", lastInteractionAt };
	}

	if (evidence.followsThem) {
		return { tier: "follows", reason: "You follow them", lastInteractionAt };
	}

	if (evidence.collaborations.length > 0) {
		// A completed engagement is the stronger claim; among equals, the most recent.
		const sorted = [...evidence.collaborations].sort((a, b) =>
			Number(b.completed) - Number(a.completed) ||
			(instantOf(b.at) ?? -1) - (instantOf(a.at) ?? -1)
		);
		const lead = sorted[0];
		const more = sorted.length - 1;
		const reason = `Worked together · ${lead.title}${more > 0 ? ` +${more}` : ""}`;
		return { tier: "collaborated", reason, lastInteractionAt };
	}

	if (evidence.lastMessageAt) {
		return { tier: "conversed", reason: "Recent conversation", lastInteractionAt };
	}

	// A candidate who follows the viewer without being followed back is evidence about THEM, not a
	// relationship the viewer chose; it is recorded in the recency but earns no tier of its own.
	return { tier: "none", reason: null, lastInteractionAt };
}
// #endregion

// #region Ranked contact projection
/**
 * One ranked picker row: the plain {@link MessagingContactSchema} plus what the ranking decided.
 *
 * `lastInteractionLabel` is PRE-FORMATTED by the server (the corpus's own clock on the stub path,
 * the wall clock on the live path) so the row never formats a date client-side — the same rule
 * `ConversationSummary.lastActivityLabel` follows, and for the same reason.
 */
export const RankedContactSchema = MessagingContactSchema.extend({
	tier: ContactTier,
	reason: z.string().max(160).nullable(),
	lastInteractionAt: z.string().nullable(),
	lastInteractionLabel: z.string().max(24).nullable(),
});
export type RankedContact = z.infer<typeof RankedContactSchema>;

/**
 * The picker's answer. `searched` says whether `contacts` is the ranked SUGGESTION set (no query —
 * relationship candidates only) or a SEARCH result (the same candidates narrowed, plus directory
 * hits at tier `none`). The picker groups the first by tier and lists the second flat.
 */
export const RankedContactListSchema = z.object({
	contacts: z.array(RankedContactSchema),
	total: z.number().int().min(0),
	/** The query that produced this list, echoed so a stale response can be told from a live one. */
	query: z.string().max(200).nullable(),
	searched: z.boolean(),
});
export type RankedContactList = z.infer<typeof RankedContactListSchema>;

/** Query params for the suggestion / search read. */
export const ContactSuggestionParamsSchema = z.object({
	/** Free-text search by name or `@handle`. Absent → the ranked suggestions. */
	q: z.string().max(200).optional(),
	/** Ids to leave out (people already in the conversation being extended). */
	exclude: z.array(z.string().max(80)).max(200).optional(),
	/** Cap on the result size (default resolved server-side). */
	limit: z.number().int().min(1).max(100).optional(),
});
export type ContactSuggestionParams = z.infer<typeof ContactSuggestionParamsSchema>;

/**
 * The picker's order: tier weight, then most recent interaction, then name, then id.
 *
 * A candidate with no instant sorts after every candidate with one WITHIN the tier — a blank is not
 * a date, so it cannot be "older than" anything; it simply comes after the dated rows.
 */
export function compareRankedContacts(a: RankedContact, b: RankedContact): number {
	const weight = TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier];
	if (weight !== 0) return weight;
	const at = instantOf(a.lastInteractionAt);
	const bt = instantOf(b.lastInteractionAt);
	if (at !== null || bt !== null) {
		if (at === null) return 1;
		if (bt === null) return -1;
		if (bt !== at) return bt - at;
	}
	return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** A sorted copy — never mutates the input. */
export function sortRankedContacts(list: readonly RankedContact[]): RankedContact[] {
	return [...list].sort(compareRankedContacts);
}

/** One tier's rows, in order, with its heading. */
export interface ContactTierGroup {
	tier: ContactTier;
	label: string;
	contacts: RankedContact[];
}

/**
 * Group a ranked list by tier in {@link TIER_ORDER}, omitting empty tiers. The input is re-sorted so
 * a caller cannot hand in an unsorted list and get out-of-order rows within a group.
 */
export function groupContactsByTier(list: readonly RankedContact[]): ContactTierGroup[] {
	const sorted = sortRankedContacts(list);
	const groups: ContactTierGroup[] = [];
	for (const tier of TIER_ORDER) {
		const contacts = sorted.filter((c) => c.tier === tier);
		if (contacts.length === 0) continue;
		groups.push({ tier, label: TIER_LABEL[tier], contacts });
	}
	return groups;
}

/** The picker's search predicate — name or handle, case-insensitive, `@` tolerated. */
export function contactMatches(
	contact: { name: string; handle: string | null },
	q: string,
): boolean {
	const needle = q.trim().replace(/^@/, "").toLowerCase();
	if (!needle) return true;
	return contact.name.toLowerCase().includes(needle) ||
		(contact.handle ?? "").toLowerCase().includes(needle);
}

/**
 * A compact recency label for the picker row: `Just now` · `5m` · `3h` · `2d` · `3w` · `Jul 14`.
 *
 * Takes `now` explicitly so the stub path can format against the corpus's pinned clock and a test
 * can pin the output; a label that read the wall clock would print "2y" over fixture data.
 */
export function interactionLabel(iso: string | null, now: number): string | null {
	const ms = instantOf(iso);
	if (ms === null) return null;
	const diff = Math.max(0, now - ms);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (diff < minute) return "Just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m`;
	if (diff < day) return `${Math.floor(diff / hour)}h`;
	if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
	if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w`;
	const d = new Date(ms);
	const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
// #endregion

// #region Conversation writes (create · add members)
/**
 * `POST /api/messaging/conversations` — start a conversation from picked contacts.
 *
 * ONE contact starts (or reopens) a DM; several start a group. `groupName` is honoured only for a
 * group — a DM is titled after its counterparty, and storing a name against it would go stale the
 * moment they renamed themselves (the `comms.dm_threads.title` comment). `message` is an OPENING
 * message posted in the same act (Decision #79): a create that succeeds and a send that fails would
 * leave an empty thread and a lost question, which is what carrying it here prevents.
 */
export const CreateConversationSchema = z.object({
	contactIds: z.array(z.string().min(1).max(80)).min(1).max(50),
	groupName: z.string().trim().max(80).optional(),
	message: z.string().trim().max(4000).optional(),
});
export type CreateConversation = z.infer<typeof CreateConversationSchema>;

/** `POST /api/messaging/conversations/members` — add people to an existing conversation. */
export const AddConversationMembersSchema = z.object({
	/** The conversation's id — a unified `dm-{handle}` / `grp-…` id, or a `comms.dm_threads` uuid. */
	conversationId: z.string().min(1).max(120),
	contactIds: z.array(z.string().min(1).max(80)).min(1).max(50),
});
export type AddConversationMembers = z.infer<typeof AddConversationMembersSchema>;

/**
 * What a create returns. `created` is false when the DM already existed and was REOPENED rather
 * than minted — the honest answer for the idempotent single-contact case. `messageAccepted` says
 * whether an opening message was posted; a caller that sent one and reads `false` knows the thread
 * exists but the question did not land.
 */
export const CreatedConversationSchema = z.object({
	id: z.string().min(1).max(120),
	kind: ConversationKind,
	created: z.boolean(),
	messageAccepted: z.boolean(),
});
export type CreatedConversation = z.infer<typeof CreatedConversationSchema>;

/** What an add-members returns: the conversation the members were added to (its kind may have changed). */
export const ConversationMembersAddedSchema = z.object({
	id: z.string().min(1).max(120),
	kind: ConversationKind,
	/** How many of the requested contacts were actually added (already-present ones are skipped). */
	added: z.number().int().min(0),
});
export type ConversationMembersAdded = z.infer<typeof ConversationMembersAddedSchema>;

/** Unique, order-preserving ids — a picker that let somebody be ticked twice must not add them twice. */
export function uniqueContactIds(ids: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		const key = id.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}
// #endregion
