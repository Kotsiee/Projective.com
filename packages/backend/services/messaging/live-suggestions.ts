import {
	type CollaborationEvidence,
	type ContactEvidence,
	contactMatches,
	type ContactSuggestionParams,
	deriveContactRank,
	emptyEvidence,
	interactionLabel,
	type MessagingContact,
	type RankedContact,
	type RankedContactList,
	type SharedEntityEvidence,
	type SharedEntityKind,
	sortRankedContacts,
} from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	fetchParties,
	orgDb,
	PARTY_COLUMNS,
	partyOf,
	type PartyRow,
	projectsDb,
} from "../projects/live-support.ts";
import { fetchConversations } from "./live-queries.ts";

/**
 * live-suggestions — the RLS-scoped Postgres read path for the RANKED people picker
 * (`MessagingBackendService.suggestions` → New message · New group · Add members · Share with…).
 *
 * ## The schema does carry a relationship graph — `./live-contacts.ts` predates it
 *
 * That module records, correctly for its day, that "nothing in `comms`, `org` or `projects` stores
 * a connection, a follow or a contact list". Four tables now do, each readable under the caller's
 * own row-level policy, and each is exactly one tier of the picker's ladder:
 *
 *  - `org.team_members` · `org.business_members` · `org.organisation_members` — a SHARED WORKSPACE.
 *    A member reads the whole roster of a team or business they are active in; an organisation's
 *    roster is admin-readable only, so a plain member's organisation contributes nobody (a true
 *    answer, not a failure).
 *  - `org.profile_follows` — FOLLOWS, in both directions, keyed on `target_entity_type = 'user'`.
 *    Read as a public, counted edge (the table's own comment) under the policy added with this
 *    reader; nothing private is on the row.
 *  - `projects.project_participants` + `projects.projects` — COLLABORATION. Two shapes, because
 *    the participants policy is owner-or-public: the freelancers on a project the viewer OWNS are
 *    read directly, while the owners of projects the viewer was HIRED onto are found through the
 *    project rows `projects.has_project_access` admits. A public active project the viewer is on
 *    surfaces its participant row too, so both directions are covered without ever reading the
 *    public marketplace as if it were a collaboration (the #82 trap).
 *  - `comms.dm_threads` via {@link fetchConversations} — a CONVERSATION, the weakest tier, and the
 *    only one the previous reader knew.
 *
 * ## Evidence here, the decision elsewhere
 *
 * Every read produces EVIDENCE and hands it to the SSOT's `deriveContactRank`; this module never
 * decides a tier. The fixtures feed the identical function, so the two paths rank by one rule.
 *
 * ## What degrades and what throws
 *
 * The four evidence reads are ANNOTATIONS on a candidate set, not the set itself, so each degrades
 * to "no evidence" on failure — a broken follows read must not empty the picker. The identity read
 * for the resulting candidates is the one primary read and throws, because a picker that cannot
 * name anybody is not a picker.
 *
 * ## The directory search is bounded in SQL, and that is sound here
 *
 * `./live-contacts.ts` explains why a search over a SMALL derived set must not be narrowed in SQL.
 * A directory search has no bounded set — it is the whole of `org.users_public` — so it MUST be
 * narrowed there. It is made sound rather than merely fast by tokenising the needle to
 * `[letters·digits]` only before it touches PostgREST's `or=(…)` grammar (a comma, a dot and a
 * parenthesis are syntax there), and by matching the FIRST token in SQL as a superset (any of
 * username · first name · last name) and the full needle in TypeScript over the composed name.
 */

// #region Constants
/** Ids per membership / participant lookup — bounds each `.in()` URL the way `live-contacts` does. */
const LOOKUP_CHUNK = 100;

/** Rows read per evidence table. Past this the picker is a search box, not a suggestion list. */
const EVIDENCE_CAP = 400;

/** How many candidates are ranked and offered without a query. */
const SUGGESTION_LIMIT = 40;

/** How many directory hits a typed search may add. */
const SEARCH_LIMIT = 25;

/** `MessagingContact` string bounds (the schema's, restated once). */
const ID_MAX = 80;
const NAME_MAX = 120;
const HANDLE_MAX = 40;

/** What a workspace is called when its name row was withheld — the kind, never a guess at a name. */
const DEFAULT_ENTITY_NAME: Readonly<Record<SharedEntityKind, string>> = {
	team: "Team",
	business: "Business",
	organisation: "Organisation",
};

/**
 * The instant a follow with no readable `created_at` is dated to. The column is `NOT NULL DEFAULT
 * now()`, so this is unreachable on a healthy row; it exists because the SSOT reads a follow's
 * presence from its instant (a null means "does not follow"), and an unreadable date must not turn
 * a real follow into no follow. The epoch sorts it after every dated row, which is the honest place
 * for "we do not know when".
 */
const UNDATED = "1970-01-01T00:00:00Z";
// #endregion

// #region Row shapes (column names verified against the migrations)
interface MembershipRow {
	user_id: string;
	joined_at: string | null;
}

interface NamedEntityRow {
	id: string;
	name: string | null;
}

interface OrganisationRow {
	id: string;
	trading_name: string | null;
	legal_name: string | null;
}

interface FollowOutRow {
	target_entity_id: string;
	created_at: string | null;
}

interface FollowInRow {
	follower_user_id: string;
	created_at: string | null;
}

interface ProjectRow {
	id: string;
	title: string | null;
	status: string | null;
	updated_at: string | null;
	owner_user_id: string;
}

interface ParticipantRow {
	project_id: string;
	profile_type: string;
	profile_id: string;
	created_at: string | null;
}
// #endregion

// #region Evidence assembly
type Actor = ReadActor & { accessToken: string };

/** The evidence gathered so far about every candidate user id. */
type EvidenceMap = Map<string, ContactEvidence>;

function evidenceFor(map: EvidenceMap, userId: string): ContactEvidence {
	const existing = map.get(userId);
	if (existing) return existing;
	const fresh = emptyEvidence();
	map.set(userId, fresh);
	return fresh;
}

/** Later of two ISO instants (a null loses to anything). */
function later(a: string | null, b: string | null): string | null {
	if (!a) return b;
	if (!b) return a;
	return Date.parse(b) > Date.parse(a) ? b : a;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Shared workspaces — for each kind, the viewer's active memberships, then the rosters of those
 * workspaces, then the workspaces' names. The organisation read degrades to nothing for a plain
 * member (admin-only roster policy) rather than erroring.
 */
async function gatherSharedEntities(actor: Actor, map: EvidenceMap): Promise<void> {
	const db = orgDb(actor);

	type Spec = {
		kind: SharedEntityKind;
		table: string;
		fk: string;
		entityTable: string;
		nameOf: (row: NamedEntityRow & OrganisationRow) => string;
	};
	const specs: Spec[] = [
		{
			kind: "team",
			table: "team_members",
			fk: "team_id",
			entityTable: "teams",
			nameOf: (r) => r.name ?? "Team",
		},
		{
			kind: "business",
			table: "business_members",
			fk: "business_id",
			entityTable: "business_profiles",
			nameOf: (r) => r.name ?? "Business",
		},
		{
			kind: "organisation",
			table: "organisation_members",
			fk: "organisation_id",
			entityTable: "organisations",
			nameOf: (r) => r.trading_name ?? r.legal_name ?? "Organisation",
		},
	];

	await Promise.all(specs.map(async (spec) => {
		const mine = await db
			.from(spec.table)
			.select(`${spec.fk}`)
			.eq("user_id", actor.userId)
			.eq("status", "active")
			.limit(EVIDENCE_CAP);
		if (mine.error) return; // an annotation, not the answer
		const entityIds = [
			...new Set(
				((mine.data ?? []) as unknown as Record<string, string>[]).map((r) => r[spec.fk]).filter(
					Boolean,
				),
			),
		];
		if (entityIds.length === 0) return;

		const nameCols = spec.kind === "organisation" ? "id, trading_name, legal_name" : "id, name";
		const [rosters, names] = await Promise.all([
			Promise.all(
				chunked(entityIds, LOOKUP_CHUNK).map((ids) =>
					db.from(spec.table)
						.select(`${spec.fk}, user_id, joined_at`)
						.in(spec.fk, ids)
						.eq("status", "active")
						.neq("user_id", actor.userId)
						.limit(EVIDENCE_CAP)
				),
			),
			Promise.all(
				chunked(entityIds, LOOKUP_CHUNK).map((ids) =>
					db.from(spec.entityTable).select(nameCols).in("id", ids)
				),
			),
		]);

		const nameById = new Map<string, string>();
		for (const res of names) {
			if (res.error) continue;
			for (const row of (res.data ?? []) as unknown as (NamedEntityRow & OrganisationRow)[]) {
				nameById.set(row.id, spec.nameOf(row));
			}
		}

		for (const res of rosters) {
			if (res.error) continue;
			for (const row of (res.data ?? []) as unknown as (MembershipRow & Record<string, string>)[]) {
				const entityId = row[spec.fk];
				if (!row.user_id || !entityId) continue;
				const ev = evidenceFor(map, row.user_id);
				if (ev.sharedEntities.some((e) => e.id === entityId)) continue;
				const entry: SharedEntityEvidence = {
					kind: spec.kind,
					id: entityId,
					name: nameById.get(entityId) ?? DEFAULT_ENTITY_NAME[spec.kind],
					since: row.joined_at,
				};
				ev.sharedEntities = [...ev.sharedEntities, entry];
			}
		}
	}));
}

/** Follows, both directions, `user` targets only (a followed team is not a person to message). */
async function gatherFollows(actor: Actor, map: EvidenceMap): Promise<void> {
	const db = orgDb(actor);
	const [out, incoming] = await Promise.all([
		db.from("profile_follows")
			.select("target_entity_id, created_at")
			.eq("follower_user_id", actor.userId)
			.eq("target_entity_type", "user")
			.limit(EVIDENCE_CAP),
		db.from("profile_follows")
			.select("follower_user_id, created_at")
			.eq("target_entity_id", actor.userId)
			.eq("target_entity_type", "user")
			.limit(EVIDENCE_CAP),
	]);
	if (!out.error) {
		for (const row of (out.data ?? []) as FollowOutRow[]) {
			if (!row.target_entity_id || row.target_entity_id === actor.userId) continue;
			evidenceFor(map, row.target_entity_id).followsThem = row.created_at ?? UNDATED;
		}
	}
	if (!incoming.error) {
		for (const row of (incoming.data ?? []) as FollowInRow[]) {
			if (!row.follower_user_id || row.follower_user_id === actor.userId) continue;
			evidenceFor(map, row.follower_user_id).followsMe = row.created_at ?? UNDATED;
		}
	}
}

/**
 * Collaboration — see the module docblock for why this is two shapes. Only FREELANCER participants
 * are people; a `business` participant is an entity id and is skipped rather than mis-ranked.
 */
async function gatherCollaborations(actor: Actor, map: EvidenceMap): Promise<void> {
	const db = projectsDb(actor);

	// Shape 1: projects the viewer owns → the people hired onto them.
	const owned = await db
		.from("projects")
		.select("id, title, status, updated_at, owner_user_id")
		.eq("owner_user_id", actor.userId)
		.limit(EVIDENCE_CAP);
	const ownedRows = owned.error ? [] : ((owned.data ?? []) as ProjectRow[]);
	const ownedById = new Map(ownedRows.map((p) => [p.id, p]));

	if (ownedById.size > 0) {
		const parts = await Promise.all(
			chunked([...ownedById.keys()], LOOKUP_CHUNK).map((ids) =>
				db.from("project_participants")
					.select("project_id, profile_type, profile_id, created_at")
					.in("project_id", ids)
					.eq("profile_type", "freelancer")
					.limit(EVIDENCE_CAP)
			),
		);
		for (const res of parts) {
			if (res.error) continue;
			for (const row of (res.data ?? []) as ParticipantRow[]) {
				const project = ownedById.get(row.project_id);
				if (!project || !row.profile_id || row.profile_id === actor.userId) continue;
				addCollaboration(map, row.profile_id, project, row.created_at);
			}
		}
	}

	// Shape 2: projects the viewer was hired onto → their owners.
	const [myParts, accessible] = await Promise.all([
		db.from("project_participants")
			.select("project_id, profile_type, profile_id, created_at")
			.eq("profile_id", actor.userId)
			.eq("profile_type", "freelancer")
			.limit(EVIDENCE_CAP),
		// Rows RLS admits that are NOT the public marketplace can only be ones the viewer has
		// access to as a participant (or through a team assignment) — see `has_project_access`.
		db.from("projects")
			.select("id, title, status, updated_at, owner_user_id")
			.neq("owner_user_id", actor.userId)
			.or("status.neq.active,visibility.neq.public")
			.limit(EVIDENCE_CAP),
	]);

	const hiredProjectIds = new Set<string>();
	if (!myParts.error) {
		for (const row of (myParts.data ?? []) as ParticipantRow[]) {
			if (row.project_id) hiredProjectIds.add(row.project_id);
		}
	}
	const hiredRows: ProjectRow[] = accessible.error ? [] : ((accessible.data ?? []) as ProjectRow[]);
	const known = new Set(hiredRows.map((p) => p.id));
	const missing = [...hiredProjectIds].filter((id) => !known.has(id) && !ownedById.has(id));
	if (missing.length > 0) {
		const extra = await Promise.all(
			chunked(missing, LOOKUP_CHUNK).map((ids) =>
				db.from("projects").select("id, title, status, updated_at, owner_user_id").in("id", ids)
			),
		);
		for (const res of extra) {
			if (res.error) continue;
			hiredRows.push(...((res.data ?? []) as ProjectRow[]));
		}
	}
	for (const project of hiredRows) {
		if (!project.owner_user_id || project.owner_user_id === actor.userId) continue;
		addCollaboration(map, project.owner_user_id, project, project.updated_at);
	}
}

function addCollaboration(
	map: EvidenceMap,
	userId: string,
	project: ProjectRow,
	at: string | null,
): void {
	const ev = evidenceFor(map, userId);
	if (ev.collaborations.some((c) => c.projectId === project.id)) return;
	const entry: CollaborationEvidence = {
		projectId: project.id,
		title: clampOr(project.title, 120, "a project"),
		completed: project.status === "completed",
		at: later(at, project.updated_at),
	};
	ev.collaborations = [...ev.collaborations, entry];
}

/** Conversations → the weakest tier, plus a real recency for everyone the viewer has messaged. */
async function gatherConversations(
	actor: Actor,
	map: EvidenceMap,
	now: number,
): Promise<void> {
	let summaries;
	try {
		summaries = await fetchConversations(actor, now);
	} catch {
		return; // an annotation — the picker must not empty because the inbox read failed
	}
	for (const c of summaries) {
		if (c.messageCount === 0) continue;
		for (const p of c.participants) {
			if (!p.id || p.id === actor.userId) continue;
			const ev = evidenceFor(map, p.id);
			ev.lastMessageAt = later(ev.lastMessageAt, c.updatedAt);
		}
	}
}
// #endregion

// #region Mapping
/**
 * A picker row for a user id and its (possibly absent) profile row.
 *
 * `avatar` is always null — `org.users_public.avatar_file_id` is a file id, not a URL (see
 * `live-contacts`). The handle is DROPPED rather than truncated past the schema bound: it is an
 * address, and a shortened one points at somebody else.
 */
function toContact(userId: string, row: PartyRow | undefined): MessagingContact | null {
	const id = clamp(userId, ID_MAX);
	if (!id) return null;
	const party = partyOf(row);
	const handle = party.handle?.trim() ?? "";
	return {
		id,
		name: clampOr(party.name, NAME_MAX, "Unknown"),
		avatar: null,
		handle: handle.length > 0 && handle.length <= HANDLE_MAX ? handle : null,
		context: null,
		relation: "dm",
		online: false,
	};
}

function toRanked(
	contact: MessagingContact,
	evidence: ContactEvidence,
	now: number,
): RankedContact {
	const rank = deriveContactRank(evidence);
	return {
		...contact,
		context: rank.reason,
		tier: rank.tier,
		reason: rank.reason,
		lastInteractionAt: rank.lastInteractionAt,
		lastInteractionLabel: interactionLabel(rank.lastInteractionAt, now),
	};
}
// #endregion

// #region Directory search
/** The first `[letters·digits]` run of a needle — the only thing allowed into the PostgREST filter. */
function sqlToken(q: string): string | null {
	const match = q.replace(/^@/, "").match(/[\p{L}\p{N}]+/u);
	return match ? match[0].toLowerCase() : null;
}

/**
 * People in the directory matching the needle, excluding ids already ranked and the viewer.
 * A read failure returns `[]`: the directory tail is an addition to the ranked answer, not the answer.
 */
async function searchDirectory(
	actor: Actor,
	q: string,
	exclude: ReadonlySet<string>,
): Promise<MessagingContact[]> {
	const token = sqlToken(q);
	if (!token) return [];
	const { data, error } = await orgDb(actor)
		.from("users_public")
		.select(PARTY_COLUMNS)
		.or(`username.ilike.*${token}*,first_name.ilike.*${token}*,last_name.ilike.*${token}*`)
		.neq("user_id", actor.userId)
		.limit(SEARCH_LIMIT * 2);
	if (error) return [];
	const out: MessagingContact[] = [];
	for (const row of (data ?? []) as PartyRow[]) {
		if (exclude.has(row.user_id)) continue;
		const contact = toContact(row.user_id, row);
		if (!contact || !contactMatches(contact, q)) continue;
		out.push(contact);
	}
	return out;
}
// #endregion

// #region Public read
/**
 * The ranked picker answer, or the search result when `q` is set. Never `null`: a viewer with no
 * relationships has an EMPTY list, which is a true answer (the brand-new-account null state).
 */
export async function fetchRankedContacts(
	actor: Actor,
	params: ContactSuggestionParams,
	now: number,
): Promise<RankedContactList> {
	const map: EvidenceMap = new Map();
	await Promise.all([
		gatherSharedEntities(actor, map),
		gatherFollows(actor, map),
		gatherCollaborations(actor, map),
		gatherConversations(actor, map, now),
	]);

	const exclude = new Set(params.exclude ?? []);
	exclude.add(actor.userId);
	const candidateIds = [...map.keys()].filter((id) => !exclude.has(id));

	// The one primary read: names for the candidates. Chunked like every other `.in()` here.
	const parties = new Map<string, PartyRow>();
	for (const chunk of chunked(candidateIds, LOOKUP_CHUNK)) {
		const part = await fetchParties(actor, chunk);
		for (const [id, row] of part) parties.set(id, row);
	}

	const ranked: RankedContact[] = [];
	for (const id of candidateIds) {
		const contact = toContact(id, parties.get(id));
		if (!contact) continue;
		ranked.push(toRanked(contact, map.get(id) ?? emptyEvidence(), now));
	}

	const q = (params.q ?? "").trim();
	if (!q) {
		const suggestions = sortRankedContacts(ranked.filter((c) => c.tier !== "none"))
			.slice(0, params.limit ?? SUGGESTION_LIMIT);
		return { contacts: suggestions, total: suggestions.length, query: null, searched: false };
	}

	const known = ranked.filter((c) => contactMatches(c, q));
	const knownIds = new Set([...exclude, ...known.map((c) => c.id), ...ranked.map((c) => c.id)]);
	const directory = (await searchDirectory(actor, q, knownIds)).map((c): RankedContact => ({
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
