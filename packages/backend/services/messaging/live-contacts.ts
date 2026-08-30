import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	partyOf,
	type PartyRow,
} from "../projects/live-support.ts";
import type {
	ContactList,
	ConversationRelation,
	MessagingContact,
	MessagingRole,
} from "@projective/types/messaging";

/**
 * live-contacts — the RLS-scoped Postgres read path for the contact picker
 * (`MessagingBackendService.contacts` → New Conversation / Add Members).
 *
 * ## There is no address book, so "contact" has to be derived
 *
 * Nothing in `comms`, `org` or `projects` stores a connection, a follow or a contact list. The only
 * durable evidence that two people know each other is that they already share a DM thread — so that
 * is what a contact IS here: somebody the viewer is in a conversation with. This is deliberately
 * NARROWER than the fixture corpus, which additionally seeds two people the viewer merely follows
 * (`EXTRA_CONTACTS`, labelled "Following" / "Connection"). Those have no live source at all, and
 * synthesising them would mean inventing a relationship rather than reporting one.
 *
 * The consequence is worth stating plainly because it is user-visible: on the live path the picker
 * cannot offer somebody the viewer has never messaged. Starting a FIRST conversation from the picker
 * is a flow this schema cannot support until a follow/connection table exists.
 *
 * ## Two queries, in this order, and neither is optional
 *
 *  1. The viewer's own `comms.dm_participants` rows — which threads am I in. The SELECT policy on
 *     that table is own-row-only, so this is the only shape of read it permits.
 *  2. `comms.dm_thread_roster(uuid[])` — who ELSE is in them. A second read of `dm_participants`
 *     keyed on `thread_id` would return nothing: the own-row-only policy exists precisely so a
 *     co-participant's private state (`is_muted`, `is_archived`, `deleted_at`, `last_read_at`)
 *     cannot be read, and RLS is row-level, so admitting the row admits every column on it. The
 *     definer function is the narrow answer — three columns, none of them state.
 *
 * Both are PRIMARY here and both throw on failure. That is a deliberate divergence from
 * `./live-queries.ts`, which degrades the same roster call to `[]`: there the roster annotates a
 * conversation list that has already resolved, so losing it costs a title; here it IS the answer, so
 * losing it would report "you know nobody" — a false statement the caller could not tell apart from
 * a true one.
 *
 * ## Identity is a separate query, never an embed
 *
 * `org.users_public` lives in a different schema, and PostgREST cross-schema embedding is
 * version-dependent and would additionally need the FK named to avoid `PGRST201`. {@link fetchParties}
 * issues the keyed `.in()` read instead — a fixed cost per chunk, not a per-row one.
 *
 * That table has none of the columns a display name suggests: no `display_name`, no `handle`, no
 * `avatar_url`. The real columns are `username` / `first_name` / `last_name` / `avatar_file_id`, and
 * the last is a FK into `files.items` rather than a URL — so every `avatar` this module returns is
 * `null` and the `Avatar` component draws its initials fallback. A guessed served path would render
 * as a broken image on every row.
 */

// #region Constants

/**
 * How many thread ids are handed to `comms.dm_thread_roster` in one call.
 *
 * The argument travels in the POST body, so this is not a URL-length bound — it bounds the function's
 * own scan. Note the harder ceiling underneath it: PostgREST applies `max_rows = 1000` to a
 * set-returning function too, and the roster has no `ORDER BY`, so past a thousand membership rows
 * the tail is truncated in whatever order the planner happened to produce. A viewer that deep is
 * beyond what a DERIVED contact list can serve honestly; the fix is a contacts source, not a bigger
 * number.
 */
const THREAD_ID_CAP = 400;

/**
 * How many distinct people are resolved into contacts.
 *
 * Applied to the candidate ids BEFORE the identity read and before the `q` filter, which means a
 * search can miss somebody past the cap. That ordering is forced rather than chosen: the roster
 * returns user ids and nothing else, so there is no name to filter on until the identity read has
 * happened. Filtering first would require narrowing `org.users_public` in SQL, which cannot be done
 * soundly for this predicate — see {@link fetchContacts}.
 */
const CANDIDATE_CAP = 500;

/**
 * Ids per `org.users_public` lookup.
 *
 * `.in()` is a GET filter, so every id is spelled out in the URL: a uuid plus its separator is 37
 * bytes, and {@link CANDIDATE_CAP} ids in one request would be an ~18KB request line that many
 * proxies reject outright. Chunking degrades gracefully where one oversized request does not, and
 * the chunks are issued together, so it costs concurrency rather than latency.
 */
const PARTY_CHUNK = 100;

/** `MessagingContact.id` is `max(80)`; a uuid is 36, so this only ever guards a malformed value. */
const ID_MAX = 80;

/** `MessagingContact.name` is `max(120)`; the underlying name columns are unbounded `text`. */
const NAME_MAX = 120;

/** `MessagingContact.handle` is `max(40)`; `org.users_public.username` is unbounded `text`. */
const HANDLE_MAX = 40;

/**
 * The relation every live contact carries.
 *
 * `ConversationRelation` has EIGHT members and `comms` has a column for none of them — not on
 * `dm_threads`, not on `dm_participants`, not anywhere. `dm` is the only one that is TRUE of a row
 * we have no engagement evidence for: its own definition is "a plain person-to-person thread with no
 * engagement context". Any other member would assert a commercial relationship (`client`,
 * `hired_freelancer`, `team_member`) from a thread that says nothing about one — and the picker
 * GROUPS by this field, so a wrong guess files a person under a heading that is itself a claim about
 * how the viewer knows them.
 *
 * `comms.dm_messages` does carry `project_id` and `service_id`, but both are FK-less and sit on the
 * MESSAGE rather than the thread, so deriving a relation from them would mean "this person is my
 * client because a project came up once".
 */
const NO_ENGAGEMENT_RELATION: ConversationRelation = "dm";

/**
 * The presence value every contact gets.
 *
 * There is no presence column in `org`, `projects` or `comms` — no `last_seen_at`, no `online` flag,
 * nothing. This is the same absence `NO_PRESENCE_SIGNAL` records for the roster projections, spelled
 * as the boolean this schema uses rather than the `MemberPresence` string, and `false` is the honest
 * reading of "we have no evidence this person is here".
 */
const NO_PRESENCE = false;

// #endregion

// #region Row shapes

/** One `comms.dm_participants` row, reduced to the membership fact this module needs. */
interface ViewerThreadRow {
	thread_id: string;
	deleted_at: string | null;
}

/**
 * One row of `comms.dm_thread_roster()` — identity only.
 *
 * Three columns, and none of them is per-viewer state. That is the whole point of reading through the
 * function rather than the table; see the module docblock.
 */
interface RosterRow {
	thread_id: string;
	user_id: string;
	joined_at: string;
}

// #endregion

// #region Mapping

/**
 * Map one roster user id plus its (possibly absent) profile row onto the picker projection.
 *
 * Two required fields have no live source and are returned NEUTRAL rather than guessed:
 *  - `relation` — see {@link NO_ENGAGEMENT_RELATION}.
 *  - `context` — the fixture fills it from a participant's `roleLabel` or the conversation's
 *    `entityName`, and neither exists as a column. `null` is the schema's "no context line", which is
 *    exactly what this is. Deriving one from the thread ("3 conversations") would be a fact about the
 *    inbox rather than about the person, which is not what the field is for.
 *
 * An UNRESOLVED party is kept, not dropped, and renders through `partyOf`'s "Unknown" placeholder.
 * The reasoning is specific rather than general: `comms.dm_participants.user_id` is a FK to
 * `org.users_public(user_id)`, and that table's SELECT policy admits any authenticated caller
 * unconditionally — it does not consult `visibility`. So a candidate's profile row provably EXISTS
 * and is provably READABLE, and a miss can only mean the identity read failed. An unnamed row says
 * something is wrong; deleting it would quietly remove a real person from the picker and look like a
 * correct, smaller answer.
 *
 * The handle is DROPPED rather than truncated when it exceeds the schema bound. Every other bounded
 * string here is clamped, but a handle is an ADDRESS: the first 40 characters of a longer username
 * resolve to a different profile or to none, so a truncated one is a link to the wrong person. `null`
 * is a supported value that renders the name without a link, which is the smaller loss.
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
		relation: NO_ENGAGEMENT_RELATION,
		online: NO_PRESENCE,
	};
}

/**
 * The picker's search predicate, matching the fixture's exactly.
 *
 * Name OR handle, case-insensitively, over the COMPOSED display name — which is why it cannot move
 * into SQL: `first_name || ' ' || last_name` is not a column, so there is nothing for an `ilike` to
 * test.
 */
function matchesNeedle(contact: MessagingContact, needle: string): boolean {
	return contact.name.toLowerCase().includes(needle) ||
		(contact.handle ?? "").toLowerCase().includes(needle);
}

// #endregion

// #region Queries

/**
 * The threads the viewer is currently a participant of.
 *
 * Soft-deleted participant rows are excluded, and that is not merely tidiness: the definer function
 * this feeds gates on `mine.deleted_at IS NULL`, so a thread the viewer removed from their inbox
 * returns NO roster rows at all. Including it would widen the argument array for nothing.
 *
 * It carries a real cost worth naming — deleting a conversation for yourself is not un-knowing the
 * person, but on this path it removes them from the picker, so that conversation cannot be restarted
 * from there. That is the schema's position, not a choice made here.
 */
async function fetchViewerThreadIds(
	actor: ReadActor & { accessToken: string },
): Promise<string[]> {
	const { data, error } = await commsDb(actor)
		.from("dm_participants")
		.select("thread_id, deleted_at")
		.eq("user_id", actor.userId)
		.is("deleted_at", null)
		.limit(THREAD_ID_CAP);

	if (error) throw new Error(`comms.dm_participants read failed: ${error.message}`);

	const ids = new Set<string>();
	for (const row of (data ?? []) as ViewerThreadRow[]) {
		if (row.thread_id) ids.add(row.thread_id);
	}
	return [...ids].slice(0, THREAD_ID_CAP);
}

/**
 * The other people in those threads, deduplicated, with the viewer removed.
 *
 * The viewer is excluded HERE rather than at the mapping boundary so that {@link CANDIDATE_CAP} is
 * spent entirely on people the picker can actually offer.
 *
 * A failure throws: this is the primary read, not an annotation. See the module docblock on why that
 * diverges from `./live-queries.ts`, which degrades the identical call.
 */
async function fetchRosterUserIds(
	actor: ReadActor & { accessToken: string },
	threadIds: readonly string[],
): Promise<string[]> {
	if (threadIds.length === 0) return [];

	const { data, error } = await commsDb(actor)
		.rpc("dm_thread_roster", { p_thread_ids: threadIds });

	if (error) throw new Error(`comms.dm_thread_roster read failed: ${error.message}`);

	const ids = new Set<string>();
	for (const row of (data ?? []) as RosterRow[]) {
		if (!row.user_id || row.user_id === actor.userId) continue;
		ids.add(row.user_id);
	}
	return [...ids].slice(0, CANDIDATE_CAP);
}

/**
 * Display parties for the candidate ids, in {@link PARTY_CHUNK}-sized reads.
 *
 * Wraps {@link fetchParties} rather than reimplementing it, so the degradation semantics stay in one
 * place: a failed or partial chunk contributes nothing and its ids fall through to the "Unknown"
 * placeholder. A chunk that fails therefore costs names, never the endpoint — the correct weighting
 * for a SECONDARY lookup, even though the FK and the policy make a miss impossible in a healthy
 * system (see {@link toContact}).
 */
async function resolveParties(
	actor: ReadActor & { accessToken: string },
	userIds: readonly string[],
): Promise<Map<string, PartyRow>> {
	const chunks: string[][] = [];
	for (let i = 0; i < userIds.length; i += PARTY_CHUNK) {
		chunks.push(userIds.slice(i, i + PARTY_CHUNK));
	}

	const resolved = await Promise.all(chunks.map((chunk) => fetchParties(actor, chunk)));

	const parties = new Map<string, PartyRow>();
	for (const map of resolved) {
		for (const [id, row] of map) parties.set(id, row);
	}
	return parties;
}

/**
 * The viewer's pickable contacts, optionally narrowed by a free-text needle.
 *
 * ## Why this never returns `null`
 *
 * Every sibling live read returns `null` for "no such subject". This one has no subject that could be
 * absent: it is keyed on the VIEWER, and a viewer who shares no threads has an EMPTY contact list,
 * which is a true answer rather than a missing one. Returning `null` would tell the caller to fall
 * back to a fabricated corpus and show a picker full of people the viewer has never met.
 *
 * ## Why `q` is filtered in TypeScript
 *
 * The brief for this file suggested narrowing on `username` in SQL and finishing in TS. That is
 * deliberately NOT applied, for a soundness reason rather than a preference:
 *
 *  - A SQL pre-filter may only ever be a SUPERSET of the final predicate, because the later TS pass
 *    can remove rows and cannot restore them. `ilike` on `username` alone is a SUBSET — it drops
 *    everyone whose NAME matches and whose username does not, which for a people-picker is most of
 *    them. A search for "Ivy Chen" would return nobody.
 *  - The composed display name is not a column, so no single `ilike` can test it. A sound superset
 *    needs the needle split on whitespace and OR-ed across three columns, which means interpolating
 *    user-supplied text into PostgREST's `or=(...)` filter grammar, where a comma, a dot and a
 *    parenthesis are all syntax rather than data.
 *  - It would not reduce work in any case. The candidate set is already bounded — by the viewer's own
 *    roster, then by {@link CANDIDATE_CAP} — and the identity rows have to be fetched to be named.
 *
 * The residual cost is recorded on {@link CANDIDATE_CAP}: a needle matching somebody past the cap
 * will not find them. That is a genuine limitation of deriving contacts from a roster, and it wants a
 * contacts table rather than a cleverer filter.
 *
 * ## Why `role` is ignored
 *
 * `MessagingRole` selects which RELATION buckets the picker groups by, and every live contact carries
 * the same neutral `dm` (see {@link NO_ENGAGEMENT_RELATION}). Filtering one value by a role view can
 * only return everything or nothing, so the parameter is accepted — keeping the signature identical
 * to the fixture's `findContacts`, so the day relations have a column no call site moves — and
 * deliberately not read. The leading underscore is the marker that this is intended.
 *
 * Ordering matches the fixture: by name, with the id as a tie-break so two people sharing a name do
 * not swap places between reads.
 */
export async function fetchContacts(
	actor: ReadActor & { accessToken: string },
	_role: MessagingRole | undefined,
	q: string | undefined,
): Promise<ContactList> {
	const threadIds = await fetchViewerThreadIds(actor);
	if (threadIds.length === 0) return { contacts: [], total: 0 };

	const userIds = await fetchRosterUserIds(actor, threadIds);
	if (userIds.length === 0) return { contacts: [], total: 0 };

	const parties = await resolveParties(actor, userIds);

	const needle = (q ?? "").trim().toLowerCase();
	const contacts: MessagingContact[] = [];
	for (const userId of userIds) {
		const contact = toContact(userId, parties.get(userId));
		if (!contact) continue;
		if (needle && !matchesNeedle(contact, needle)) continue;
		contacts.push(contact);
	}

	contacts.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

	// `ContactList` carries no cursor and no `hasMore`, so `total` is the size of what was returned —
	// the same identity the fixture keeps. Both caps are applied before this point, so the count and
	// the list cannot disagree.
	return { contacts, total: contacts.length };
}

// #endregion
