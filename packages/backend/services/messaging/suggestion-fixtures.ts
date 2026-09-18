import {
	type ContactEvidence,
	contactMatches,
	type ContactSuggestionParams,
	deriveContactRank,
	emptyEvidence,
	interactionLabel,
	type MessagingContact,
	type RankedContact,
	type RankedContactList,
	type SharedEntityKind,
	sortRankedContacts,
} from "@projective/types/messaging";
import { findContacts, findConversations, VIEWER } from "./conversation-fixtures.ts";
import { allProjects } from "../projects/fixtures.ts";
import { FREELANCERS, USERS } from "../explore/fixtures.ts";

/**
 * messaging suggestion fixtures — the fat {@link MessagingBackendService.suggestions} answer while
 * `MESSAGING_BACKEND_LIVE` is off: the RANKED people picker (New message · New group · Add members ·
 * Share with…).
 *
 * The corpus produces EVIDENCE, never a tier. Every candidate's record is assembled from the same
 * fixture casts the rest of the app renders — the inbox's conversations (`conversation-fixtures`),
 * the engagements on `/projects` (`projects/fixtures`) and the discovery directory
 * (`explore/fixtures`) — and handed to the SSOT's {@link deriveContactRank}, which is the one place
 * "how does the viewer know this person" is decided. The live path (`./live-suggestions.ts`) feeds
 * the identical function from RLS-scoped reads, so the two answer with one rule.
 *
 * The follow graph has no fixture corpus of its own anywhere in the app, so a small one is declared
 * here: who the acting viewer (`@ahmed`) follows and who follows them back. It is deliberately
 * asymmetric so every tier of the ladder is reachable from the stub — a mutual pair, a one-way
 * follow, and a follower the viewer never followed back (who earns NO tier, by the SSOT's rule).
 *
 * No RNG, fixed reference clock — the same `2026-07-17T16:20:00Z` the messaging corpus keeps — so a
 * recency label reads "2d" against the corpus rather than "2y" against the wall clock.
 */

// #region Reference clock
/** The messaging corpus's pinned "now" — labels are formatted against it, never `Date.now()`. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
// #endregion

// #region The follow graph (fixture-only — there is no follow corpus elsewhere)
/** Handles the acting viewer follows, with the instant they pressed Follow. */
const VIEWER_FOLLOWS: Readonly<Record<string, string>> = {
	ivy: "2026-06-02T09:00:00Z",
	marcus: "2026-05-20T14:30:00Z",
	mara: "2026-03-11T10:15:00Z",
	sofia: "2026-04-08T17:45:00Z",
	priya: "2026-01-19T08:00:00Z",
	maris: "2026-06-28T11:20:00Z",
};

/** Handles that follow the acting viewer, with the instant they did. */
const FOLLOWS_VIEWER: Readonly<Record<string, string>> = {
	ivy: "2026-06-03T12:00:00Z",
	priya: "2026-01-20T09:30:00Z",
	daniel: "2026-02-14T16:00:00Z",
	theo: "2026-07-01T08:45:00Z",
	noor: "2026-06-15T10:00:00Z",
};
// #endregion

// #region Workspace membership dates (when each person joined the shared entity)
/** `entityId → handle → joined`, so an affiliation carries a real `since` for the recency sort. */
const MEMBERSHIP_SINCE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	t_northwind: {
		daniel: "2025-09-01T09:00:00Z",
		lena: "2026-02-10T09:00:00Z",
		priya: "2026-04-22T09:00:00Z",
	},
	b_monarch: {
		priya: "2025-11-05T09:00:00Z",
		noah: "2026-05-30T09:00:00Z",
	},
};

/** The workspace kind an inbox relation implies. */
function entityKindOf(relation: MessagingContact["relation"]): SharedEntityKind | null {
	if (relation === "team" || relation === "team_member") return "team";
	if (relation === "business" || relation === "business_member") return "business";
	return null;
}
// #endregion

// #region Candidate assembly
/** A candidate under construction: identity + the evidence gathered so far. */
interface Candidate {
	contact: MessagingContact;
	evidence: ContactEvidence;
}

/** The newer of two optional ISO instants. */
function later(a: string | null, b: string | null): string | null {
	if (!a) return b;
	if (!b) return a;
	return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Gather every candidate the corpus knows and the evidence about each.
 *
 * Identity comes from the inbox's own contact list (every distinct party across the conversations
 * plus the two seeded connections), so a candidate here is exactly somebody the picker already knew
 * how to draw. Evidence is layered on from three casts in turn; a person the casts disagree about
 * (a different avatar, say) keeps the inbox's identity, because the inbox is where the picker lives.
 */
function assembleCandidates(): Map<string, Candidate> {
	const byId = new Map<string, Candidate>();
	const ensure = (contact: MessagingContact): Candidate => {
		const existing = byId.get(contact.id);
		if (existing) return existing;
		const fresh: Candidate = { contact, evidence: emptyEvidence() };
		byId.set(contact.id, fresh);
		return fresh;
	};

	// 1. Identity — every pickable contact.
	for (const contact of findContacts().contacts) ensure(contact);

	// 2. Conversations → `conversed` + shared workspaces (a team/business thread names both).
	for (const c of findConversations({}).conversations) {
		const kind = entityKindOf(c.relation);
		for (const p of c.participants) {
			const candidate = byId.get(p.id);
			if (!candidate) continue;
			const ev = candidate.evidence;
			ev.lastMessageAt = later(ev.lastMessageAt, c.updatedAt);
			if (kind && c.entityId && c.entityName) {
				if (!ev.sharedEntities.some((e) => e.id === c.entityId)) {
					ev.sharedEntities = [...ev.sharedEntities, {
						kind,
						id: c.entityId,
						name: c.entityName,
						since: MEMBERSHIP_SINCE[c.entityId]?.[p.id] ?? null,
					}];
				}
			}
		}
	}

	// 3. The follow graph, in both directions.
	for (const candidate of byId.values()) {
		const handle = candidate.contact.handle ?? candidate.contact.id;
		candidate.evidence.followsThem = VIEWER_FOLLOWS[handle] ?? null;
		candidate.evidence.followsMe = FOLLOWS_VIEWER[handle] ?? null;
	}

	// 4. Engagements → `collaborated`: whoever sat across the table from the viewer on a project.
	for (const project of allProjects()) {
		const viewerHandle = VIEWER.handle;
		const other = project.owner.handle === viewerHandle ? project.counterparty : project.owner;
		if (!other?.handle || other.handle === viewerHandle) continue;
		const candidate = byId.get(other.handle);
		if (!candidate) continue;
		const ev = candidate.evidence;
		if (ev.collaborations.some((col) => col.projectId === project.id)) continue;
		ev.collaborations = [...ev.collaborations, {
			projectId: project.id,
			title: project.title,
			completed: project.status === "completed",
			at: project.updatedAt,
		}];
	}

	return byId;
}

/** Rank one assembled candidate into the picker projection. */
function toRanked(candidate: Candidate): RankedContact {
	const rank = deriveContactRank(candidate.evidence);
	return {
		...candidate.contact,
		tier: rank.tier,
		reason: rank.reason,
		lastInteractionAt: rank.lastInteractionAt,
		lastInteractionLabel: interactionLabel(rank.lastInteractionAt, NOW),
	};
}
// #endregion

// #region Directory (the "search globally" tail)
/**
 * People the discovery corpus knows who are NOT already candidates — a typed search reaches them at
 * tier `none`. Teams and businesses are left out on purpose: a conversation is between people.
 */
function directoryPeople(): MessagingContact[] {
	const out: MessagingContact[] = [];
	const seen = new Set<string>();
	for (const item of [...FREELANCERS, ...USERS]) {
		const handle = item.owner.handle.replace(/^@/, "");
		if (!handle || handle === VIEWER.handle || seen.has(handle)) continue;
		seen.add(handle);
		out.push({
			id: handle,
			name: item.owner.name,
			avatar: item.owner.avatar || null,
			handle,
			context: item.craft || null,
			relation: "dm",
			online: false,
		});
	}
	return out;
}
// #endregion

// #region Public read
const SUGGESTION_LIMIT = 40;
const SEARCH_LIMIT = 25;

/**
 * The ranked picker answer.
 *
 * No query → the SUGGESTIONS: every candidate with at least one piece of evidence, ranked. A
 * candidate the corpus knows only by name (tier `none`) is withheld here — a suggestion is a claim
 * that the viewer knows this person, and "we have a row for them" is not that claim.
 *
 * A query → the SEARCH: the same candidates narrowed by name/handle (keeping their rank), followed by
 * directory hits at tier `none`. Sorting puts the known people first by construction.
 *
 * `exclude` removes people already in the conversation being extended, and the viewer is never a
 * candidate anywhere — one cannot start a conversation with oneself.
 */
export function findRankedContacts(params: ContactSuggestionParams): RankedContactList {
	const exclude = new Set(params.exclude ?? []);
	exclude.add(VIEWER.id);
	if (VIEWER.handle) exclude.add(VIEWER.handle);

	const ranked = [...assembleCandidates().values()]
		.map(toRanked)
		.filter((c) => !exclude.has(c.id) && !(c.handle && exclude.has(c.handle)));

	const q = (params.q ?? "").trim();
	if (!q) {
		const suggestions = sortRankedContacts(ranked.filter((c) => c.tier !== "none"))
			.slice(0, params.limit ?? SUGGESTION_LIMIT);
		return { contacts: suggestions, total: suggestions.length, query: null, searched: false };
	}

	const known = ranked.filter((c) => contactMatches(c, q));
	const knownIds = new Set(known.map((c) => c.handle ?? c.id));
	const directory = directoryPeople()
		.filter((c) => contactMatches(c, q))
		.filter((c) => !knownIds.has(c.handle ?? c.id))
		.filter((c) => !exclude.has(c.id) && !(c.handle && exclude.has(c.handle)))
		.map((c): RankedContact => ({
			...c,
			tier: "none",
			reason: null,
			lastInteractionAt: null,
			lastInteractionLabel: null,
		}));

	const results = sortRankedContacts([...known, ...directory]).slice(
		0,
		params.limit ?? SEARCH_LIMIT,
	);
	return { contacts: results, total: results.length, query: q, searched: true };
}
// #endregion
