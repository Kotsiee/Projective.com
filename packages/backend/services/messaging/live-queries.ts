import type { SupabaseClient } from "supabaseClient";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import type {
	ConversationKind,
	ConversationRelation,
	ConversationSummary,
} from "@projective/types/messaging";
import type { ChatMessage, MessagePage } from "@projective/types/projects";

/**
 * live-queries — the RLS-scoped Postgres read path for the global inbox (`/messages`).
 *
 * Every query runs under the caller's own JWT via {@link getUserClient} on the `comms` schema
 * profile, which `supabase/config.toml` exposes. Nothing here uses the service-role client.
 *
 * ## Read this before trusting anything this module returns
 *
 * Three properties of the schema shape everything below, and two of them are defects in the
 * database rather than in this code:
 *
 * 1. **The DM stack was default-denied.** `comms.dm_threads`, `dm_participants`, `dm_messages`,
 *    `channel_files` and `project_channel_participants` had RLS ENABLED and ZERO policies, which as
 *    `authenticated` returns `200 []` — never an error, never a hint. This module is unusable
 *    without the SELECT policies added to `00002012_policies_comms.sql` alongside it; if those are
 *    reverted, every function here silently returns an empty inbox for a user who has one.
 *
 * 2. **There is no monotonic column to page on.** Every messaging PK is `uuid DEFAULT
 *    gen_random_uuid()` — v4, random, NOT time-ordered — and there is no `seq`, no identity and no
 *    ordinal on any `comms` table. So the keyset predicate has to order on the `(created_at, id)`
 *    pair. The CURSOR is still just the row id — see the Cursors region for why encoding the instant
 *    into it truncated `timestamptz` to milliseconds and silently skipped every message sharing the
 *    boundary millisecond.
 *
 * 3. **`dm_threads` carries almost nothing `ConversationSummary` needs.** No `updated_at`, no
 *    `last_message_at`, no `message_count`, no `preview`, and no column anywhere for `relation`,
 *    `productId`/`productName` or `entityId`/`entityName`. The activity timestamp, the preview and
 *    the count are all aggregates over `dm_messages`; the rest are returned as their neutral values
 *    rather than being invented. See {@link toConversationSummary}.
 *
 * ## The unified-chatId contract does not survive the trip to Postgres
 *
 * `ConversationSummary.id` and a project channel's `chatId` must be the SAME string for a DM opened
 * inside a project and from the inbox to be one continuous record (Decisions #21/#22/#49). The
 * fixtures achieve that by minting `dm-{handle}` on both sides. Live, `comms.dm_threads.id` is a v4
 * uuid and `comms.project_channels` has no `chatId` column at all, so the two cannot agree. This
 * module returns the thread's real uuid — the honest answer for a row that exists — and the
 * reconciliation is flagged for a human rather than papered over with a synthesised `dm-{username}`
 * that would not round-trip to a primary key.
 */

// #region Constants

/** Page size when the caller does not ask for one. */
const DEFAULT_PAGE = 30;

/** Hard ceiling on a page, so a hostile `limit` cannot ask for the whole table. */
const MAX_PAGE = 100;

/** `ConversationSummary.preview` is `max(200)`; the column is unbounded `text`. */
const PREVIEW_MAX = 200;

/** `ChatMessage.text` is `max(4000)`; the column is unbounded `text`. */
export const MESSAGE_TEXT_MAX = 4000;

/**
 * The polymorphic discriminator for a DM message.
 *
 * Named once because `comms` carries TWO vocabularies for the same idea: the interaction tables
 * (`message_attachments`, `message_reactions`, `message_pins`, `message_favorites`) use the
 * schema-qualified `'comms.dm_messages'`, while `comms.channel_files` uses the bare `'dm'`. Matching
 * the wrong one returns no rows rather than erroring.
 */
const DM_MESSAGE_TABLE = "comms.dm_messages";

/** `MessagePage.pinned` is `.max(3)` and THROWS rather than truncating. */
const MAX_PINNED = 3;

// #endregion

// #region Row shapes

/** One `comms.dm_threads` row. */
interface ThreadRow {
	id: string;
	kind: string;
	title: string | null;
	created_by_user_id: string;
	created_at: string;
}

/** One `comms.dm_participants` row — where all per-viewer conversation state lives. */
interface ParticipantRow {
	thread_id: string;
	user_id: string;
	last_read_at: string | null;
	is_starred: boolean;
	is_archived: boolean;
	is_muted: boolean;
	deleted_at: string | null;
}

/**
 * One row of `comms.dm_thread_roster()` — identity only.
 *
 * Deliberately NOT `ParticipantRow`: the roster function returns three columns and none of them is
 * per-viewer state, which is the whole point of reading through it rather than through the table.
 */
interface RosterRow {
	thread_id: string;
	user_id: string;
	joined_at: string;
}

/** One `comms.dm_messages` row. */
interface DmMessageRow {
	id: string;
	thread_id: string;
	sender_user_id: string;
	body: string;
	has_attachments: boolean;
	is_audio: boolean;
	created_at: string;
	deleted_at: string | null;
}

/** One `comms.message_reactions` row. */
interface ReactionRow {
	message_id: string;
	user_id: string;
	emoji: string;
}

/** An `org.users_public` row. Column names verified against `00000011_tables_org.sql`. */
interface PartyRow {
	user_id: string;
	username: string;
	first_name: string | null;
	last_name: string | null;
}

// #endregion

// #region Cursors

/**
 * The page cursor is the MESSAGE ID, verbatim.
 *
 * An earlier version encoded `(created_at, id)` as base64url with the instant as epoch MILLIS, to
 * make the keyset predicate self-contained. That silently loses precision: `created_at` is
 * `timestamptz`, which Postgres stores to the MICROSECOND, and `Date.parse` / `new Date(ms)` round
 * to the millisecond. The predicate then compares a truncated `.789Z` against a stored `.789432`,
 * so `created_at = cursor` matches nothing and the `AND id < …` tie-break — the entire reason the
 * id was in the cursor — can never fire. Every message sharing the boundary millisecond with the
 * page edge is skipped, permanently and silently. That is exactly the tie the docblock claimed to
 * be handling.
 *
 * So the cursor names the row and the server reads its real timestamp back at full precision
 * ({@link resolveCursorRow}). A uuid is already URL-safe and 36 characters, comfortably inside
 * `max(80)`, so it needs no encoding — and it matches the fixture pager's own convention, where the
 * cursor is a raw row id.
 *
 * The cost is one extra round trip per page. That is the right trade against a paging bug that
 * loses messages and leaves no trace.
 */
export type MessagingCursor = string;

/** The `(created_at, id)` pair a keyset predicate needs, read back from the cursor's own row. */
interface CursorAnchor {
	createdAt: string;
	id: string;
}

// #endregion

// #region Formatting

/**
 * Pre-format an activity label, in UTC.
 *
 * UTC is not laziness — it is the same rule the fixtures follow, with the same reason written on
 * them: the label is produced on the server and rendered on the client, and any timezone-dependent
 * formatting makes those two disagree on the first render. `ConversationSummary.lastActivityLabel`
 * is `max(24)`, which every branch here satisfies.
 */
export function activityLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const days = Math.floor((now - at) / 86_400_000);
	const d = new Date(at);
	const hh = d.getUTCHours();
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	const suffix = hh < 12 ? "AM" : "PM";
	const h12 = hh % 12 === 0 ? 12 : hh % 12;
	if (days <= 0) return `${h12}:${mm} ${suffix}`;
	if (days === 1) return "Yesterday";
	const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	if (days < 7) return WD[d.getUTCDay()];
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Clamp a string to a Zod `.max()` bound.
 *
 * Called on every free-text column that reaches a bounded field. This is not defensive style: the
 * columns are unbounded `text` and the schemas throw rather than truncate, so a single long message
 * body would 500 the whole conversation read. Truncation happens HERE, at the boundary, rather than
 * in each caller, so a new consumer cannot forget it.
 */
export function clamp(value: string | null | undefined, max: number): string {
	if (!value) return "";
	return value.length <= max ? value : value.slice(0, max);
}

/** A display name from a party row, honouring `min(1)` on every name field in these schemas. */
export function partyName(row: PartyRow | undefined): string {
	if (!row) return "Unknown";
	const composed = [row.first_name, row.last_name]
		.map((p) => p?.trim() ?? "")
		.filter((p) => p.length > 0)
		.join(" ");
	return composed || row.username.trim() || "Unknown";
}

// #endregion

// #region Clients

/** An RLS-scoped client on the `comms` schema profile. */
function commsClient(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("comms") as unknown as SupabaseClient;
}

/** An RLS-scoped client on the `org` schema profile. */
function orgClient(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("org") as unknown as SupabaseClient;
}

/** Resolve display parties for a set of user ids; a miss degrades to the "Unknown" placeholder. */
async function fetchParties(
	actor: ReadActor & { accessToken: string },
	userIds: readonly string[],
): Promise<Map<string, PartyRow>> {
	const out = new Map<string, PartyRow>();
	const unique = [...new Set(userIds)].filter((id) => id.length > 0);
	if (unique.length === 0) return out;
	const { data, error } = await orgClient(actor)
		.from("users_public")
		.select("user_id, username, first_name, last_name")
		.in("user_id", unique);
	if (error) return out;
	for (const row of (data ?? []) as PartyRow[]) out.set(row.user_id, row);
	return out;
}

// #endregion

// #region Mapping

/** Everything {@link toConversationSummary} needs that a thread row does not carry. */
export interface ConversationContext {
	/** The viewer's own participant row — the source of every per-viewer flag. */
	viewer: ParticipantRow | undefined;
	/** The other participants' user ids. */
	otherIds: readonly string[];
	/** Display parties by user id. */
	parties: Map<string, PartyRow>;
	/** The newest non-deleted message, if any. */
	last: DmMessageRow | undefined;
	/** How many non-deleted messages the thread holds — the visibility gate. */
	messageCount: number;
	/** Wall clock for the activity label. */
	now: number;
	/** The viewer's own user id, for the "You: " preview prefix. */
	viewerId: string;
}

/**
 * Map a thread onto the inbox row projection.
 *
 * Four required fields have no live source and are returned neutral rather than guessed:
 * `relation` is pinned to `"dm"` (the member that means "a plain person-to-person thread with no
 * engagement context" — the only one that is TRUE of a row we have no engagement evidence for),
 * and `productId`/`productName`/`entityId`/`entityName` are `null`. `comms.dm_messages` does carry
 * `project_id` and `service_id`, but both are FK-less and sit on the MESSAGE rather than the thread,
 * so deriving a thread-level relation from them would mean "this conversation is about the service
 * someone mentioned once".
 *
 * `avatar` is `null` throughout: `org.users_public.avatar_file_id` is a file id, not a URL.
 */
export function toConversationSummary(
	row: ThreadRow,
	ctx: ConversationContext,
): ConversationSummary {
	const kind: ConversationKind = row.kind === "group" || row.kind === "service_inquiry"
		? row.kind
		: "dm";

	const others = ctx.otherIds.map((id) => ({
		id,
		name: partyName(ctx.parties.get(id)),
		avatar: null,
		handle: ctx.parties.get(id)?.username ?? null,
		roleLabel: null,
		// No presence column exists in either schema. `online` is required, so it is false — the
		// honest reading of "we have no evidence this person is here".
		online: false,
	}));

	const lastAt = ctx.last?.created_at ?? row.created_at;
	const readAt = ctx.viewer?.last_read_at;
	const preview = ctx.last
		? clamp(
			ctx.last.sender_user_id === ctx.viewerId ? `You: ${ctx.last.body}` : ctx.last.body,
			PREVIEW_MAX,
		)
		: "";

	return {
		id: row.id,
		kind,
		relation: "dm" as ConversationRelation,
		// A group's own name; a DM's title is the counterparty, because storing a copy of their name
		// on the thread would go stale the moment they renamed themselves (the column's own comment).
		title: clamp(row.title, 160) || others[0]?.name || "Conversation",
		avatar: null,
		participants: others,
		preview,
		lastActivityLabel: activityLabel(lastAt, ctx.now),
		updatedAt: lastAt,
		// NULL `last_read_at` means never opened, which is deliberately distinct from "opened and read
		// nothing" — so a thread with any message in it is unread until the watermark exists.
		unread: ctx.messageCount > 0 &&
			(!readAt || Date.parse(lastAt) > Date.parse(readAt)),
		starred: ctx.viewer?.is_starred ?? false,
		archived: ctx.viewer?.is_archived ?? false,
		muted: ctx.viewer?.is_muted ?? false,
		messageCount: ctx.messageCount,
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		entityId: null,
		entityName: null,
	};
}

// #endregion

// #region Queries

/**
 * Every conversation the viewer participates in, mapped to the inbox projection.
 *
 * The shape of this is dictated by what `dm_threads` does not carry. There is no activity
 * timestamp, no message count and no preview on the thread, so the read is:
 *
 *   1. the viewer's own `dm_participants` rows (which is also the membership filter),
 *   2. the threads they name,
 *   3. the identity-only roster for those threads (`comms.dm_thread_roster`),
 *   4. a bounded tail PER THREAD, folded into that thread's count + newest message.
 *
 * Step 4 is the honest cost of the schema: with no `message_count` and no `last_message_at` there is
 * no way to order or gate the list without touching the message rows. It is one request per thread,
 * issued together — deliberately not one global window, because a window ordered ACROSS threads is
 * filled by whichever conversations are busiest and reports zero for the rest, which the visibility
 * rule then deletes from the inbox. A `last_message_at` column maintained by a trigger is the real
 * fix, and it is a migration rather than a query.
 *
 * Deleted rows are excluded explicitly. Nothing in the schema does it for you — there is no view
 * that hides them and no partial index — so a missing `.is("deleted_at", null)` silently resurrects
 * soft-deleted messages into a preview.
 */
export async function fetchConversations(
	actor: ReadActor & { accessToken: string },
	now: number,
): Promise<ConversationSummary[]> {
	const db = commsClient(actor);

	const { data: mine, error: mineErr } = await db
		.from("dm_participants")
		.select("thread_id, user_id, last_read_at, is_starred, is_archived, is_muted, deleted_at")
		.eq("user_id", actor.userId)
		.is("deleted_at", null);

	if (mineErr) throw new Error(`comms.dm_participants read failed: ${mineErr.message}`);
	const viewerRows = (mine ?? []) as ParticipantRow[];
	if (viewerRows.length === 0) return [];

	const threadIds = viewerRows.map((r) => r.thread_id);

	const [threadsRes, rosterRes, tailRes] = await Promise.all([
		db.from("dm_threads")
			.select("id, kind, title, created_by_user_id, created_at")
			.in("id", threadIds),
		// Identity only. The SELECT policy on `comms.dm_participants` is own-row-only precisely so a
		// co-participant's private state (`is_muted`, `is_archived`, `deleted_at`, `last_read_at`)
		// cannot be read; this definer function answers the roster question without it.
		db.rpc("dm_thread_roster", { p_thread_ids: threadIds }),
		// One bounded tail PER THREAD, not one global window. A single
		// `.in(threadIds).order(created_at desc).limit(N)` is ordered ACROSS threads, so a handful of
		// busy conversations fill the window and every quieter thread comes back with zero rows —
		// which this function then reads as `messageCount: 0` and the visibility rule removes from the
		// inbox entirely. The user would open `/messages` and see three of their forty conversations.
		Promise.all(threadIds.map((id) => fetchThreadTail(db, id))),
	]);

	if (threadsRes.error) {
		throw new Error(`comms.dm_threads read failed: ${threadsRes.error.message}`);
	}

	const threads = (threadsRes.data ?? []) as unknown as ThreadRow[];
	const roster = (rosterRes.error ? [] : (rosterRes.data ?? [])) as RosterRow[];

	const others = new Map<string, string[]>();
	for (const row of roster) {
		if (row.user_id === actor.userId) continue;
		const list = others.get(row.thread_id) ?? [];
		list.push(row.user_id);
		others.set(row.thread_id, list);
	}

	const newest = new Map<string, DmMessageRow>();
	const counts = new Map<string, number>();
	const unmeasured = new Set<string>();
	for (const tail of tailRes) {
		if (!tail) continue;
		if (tail.newest) newest.set(tail.threadId, tail.newest);
		counts.set(tail.threadId, tail.count);
		if (!tail.measured) unmeasured.add(tail.threadId);
	}

	const viewerByThread = new Map(viewerRows.map((r) => [r.thread_id, r]));
	const parties = await fetchParties(actor, [...others.values()].flat());

	return threads
		.map((row) =>
			toConversationSummary(row, {
				viewer: viewerByThread.get(row.id),
				otherIds: others.get(row.id) ?? [],
				parties,
				last: newest.get(row.id),
				messageCount: counts.get(row.id) ?? 0,
				now,
				viewerId: actor.userId,
			})
		)
		// The visibility rule (`messageCount > 0`) applied at the source, exactly where the fixture
		// path applies it — before any partition, filter or sort — so an empty thread never surfaces.
		// A thread whose tail could not be READ is exempt: we do not know it is empty, and a transient
		// failure must not silently delete a conversation from someone's inbox.
		.filter((c) => c.messageCount > 0 || unmeasured.has(c.id));
}

/**
 * The per-message interaction state a page of messages carries.
 *
 * Assembled once for the whole page rather than per message: these are three keyed reads against
 * tables with no indexes, and doing them per row would turn a thirty-message page into ninety-one
 * round trips.
 */
export interface MessageInteractions {
	/** Reaction buckets by message id, already collapsed to (emoji, count, mine). */
	reactions: Map<string, { emoji: string; count: number; mine: boolean }[]>;
	/** Message ids that are pinned. A pin is channel-wide — the UNIQUE carries no user_id. */
	pinned: Set<string>;
	/** Message ids the VIEWER has favourited. Private per user. */
	favorited: Set<string>;
}

/** An empty interaction set, for the degraded path and for callers that do not need one. */
export const NO_INTERACTIONS: MessageInteractions = {
	reactions: new Map(),
	pinned: new Set(),
	favorited: new Set(),
};

/**
 * Read reactions, pins and favourites for a page of DM messages.
 *
 * These three tables had RLS switched off entirely while the schema granted `ALL ... TO
 * authenticated`; they now carry policies keyed on `comms.can_read_message()`, so this read is both
 * possible and bounded — the policy re-checks message access per row, so a caller cannot enumerate
 * reactions on a conversation they are not in by guessing message ids.
 *
 * The discriminator is the SCHEMA-QUALIFIED `'comms.dm_messages'`, which is what the CHECK
 * constraints on these tables use. `comms.channel_files` uses the bare `'dm'` for the same concept;
 * matching the wrong vocabulary returns zero rows rather than erroring, which is why it is written
 * as a named constant rather than inline three times.
 *
 * Every failure degrades to empty. A missing reaction bucket costs a pill; a thrown read costs the
 * whole conversation.
 */
export async function fetchMessageInteractions(
	actor: ReadActor & { accessToken: string },
	messageIds: readonly string[],
): Promise<MessageInteractions> {
	if (messageIds.length === 0) return NO_INTERACTIONS;
	const db = commsClient(actor);
	const ids = [...messageIds];

	const [reactionsRes, pinsRes, favesRes] = await Promise.all([
		db.from("message_reactions")
			.select("message_id, user_id, emoji")
			.eq("message_table", DM_MESSAGE_TABLE)
			.in("message_id", ids),
		db.from("message_pins")
			.select("message_id")
			.eq("message_table", DM_MESSAGE_TABLE)
			.in("message_id", ids),
		db.from("message_favorites")
			.select("message_id")
			.eq("message_table", DM_MESSAGE_TABLE)
			.eq("user_id", actor.userId)
			.in("message_id", ids),
	]);

	const reactions = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
	if (!reactionsRes.error) {
		// Collapse (message, emoji) into buckets. `MessageReaction.count` is `.min(1)`, so a bucket
		// only exists once something is in it — a zero-count bucket is omitted, never stored as 0.
		const byMessage = new Map<string, Map<string, { count: number; mine: boolean }>>();
		for (const row of (reactionsRes.data ?? []) as ReactionRow[]) {
			const buckets = byMessage.get(row.message_id) ?? new Map();
			const bucket = buckets.get(row.emoji) ?? { count: 0, mine: false };
			bucket.count += 1;
			if (row.user_id === actor.userId) bucket.mine = true;
			buckets.set(row.emoji, bucket);
			byMessage.set(row.message_id, buckets);
		}
		for (const [messageId, buckets] of byMessage) {
			reactions.set(
				messageId,
				[...buckets.entries()].map(([emoji, b]) => ({ emoji, count: b.count, mine: b.mine })),
			);
		}
	}

	const pinned = new Set<string>();
	if (!pinsRes.error) {
		for (const row of (pinsRes.data ?? []) as { message_id: string }[]) pinned.add(row.message_id);
	}

	const favorited = new Set<string>();
	if (!favesRes.error) {
		for (const row of (favesRes.data ?? []) as { message_id: string }[]) {
			favorited.add(row.message_id);
		}
	}

	return { reactions, pinned, favorited };
}

/**
 * Map one `comms.dm_messages` row onto the chat feed's {@link ChatMessage} projection.
 *
 * Four fields are structurally unavailable and are returned empty rather than guessed, each for a
 * reason worth stating because each looks like an omission:
 *
 * - `attachments` — `comms.message_attachments` is POLYMORPHIC on `(message_table, message_id)` with
 *   **no foreign key on `message_id`** (Postgres cannot point one column at two parents), so
 *   PostgREST cannot embed it. It needs a second query keyed on the page's message ids; the flag
 *   `has_attachments` on the row is a denormalised boolean that **no trigger maintains**, so it is
 *   advisory and is not treated as truth here.
 * - `audio` — there is no waveform column anywhere. `MessageAudio.peaks` is `max(512)` with each
 *   element bounded `0..1`, and nothing in the schema can produce it. `is_audio` has the same
 *   unmaintained-flag problem as `has_attachments`.
 * - `reactions` / `pinned` / `favorited` are POPULATED, via {@link fetchMessageInteractions}. These
 *   three tables had RLS switched off entirely while the schema granted `ALL ... TO authenticated`;
 *   they now carry policies keyed on `comms.can_read_message()`, so the read is both possible and
 *   bounded. They arrive as a page-level lookup rather than per message: three keyed reads against
 *   unindexed tables, once, instead of three per row.
 * - `system` — there is no system-message table and `dm_messages` has no `type` column, so
 *   `ChatMessageType === "system"` is unreachable on this path.
 *
 * `text` is CLAMPED, not passed through: the column is unbounded `text` and the field is `max(4000)`,
 * and Zod throws rather than truncating — so one long message would fail the whole page.
 */
export function toChatMessage(
	row: DmMessageRow,
	parties: Map<string, PartyRow>,
	viewerId: string,
	now: number,
	interactions: MessageInteractions = NO_INTERACTIONS,
): ChatMessage {
	const party = parties.get(row.sender_user_id);
	return {
		id: row.id,
		type: "user",
		createdAt: row.created_at,
		timeLabel: clockLabel(row.created_at),
		dayLabel: dayLabel(row.created_at, now),
		sender: {
			id: row.sender_user_id,
			name: partyName(party),
			avatar: null,
			handle: party?.username ?? null,
		},
		isOwn: row.sender_user_id === viewerId,
		text: clamp(row.body, MESSAGE_TEXT_MAX),
		attachments: [],
		audio: null,
		system: null,
		reactions: interactions.reactions.get(row.id) ?? [],
		pinned: interactions.pinned.has(row.id),
		favorited: interactions.favorited.has(row.id),
	};
}

/** A `h:mm AM` clock in UTC — `ChatMessage.timeLabel` is `max(20)`. */
function clockLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	const hh = d.getUTCHours();
	const h12 = hh % 12 === 0 ? 12 : hh % 12;
	return `${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** A date-divider label in UTC — `ChatMessage.dayLabel` is `max(24)`. */
function dayLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const days = Math.floor((now - at) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	const d = new Date(at);
	const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Assemble a {@link MessagePage} for one DM thread.
 *
 * `total` is reported as the number of messages ON THIS PAGE plus whatever is known to precede it,
 * which is NOT the thread's true total — there is no `message_count` column and counting every row
 * to render one page would be a full scan per navigation. The field drives an empty state (`0`), and
 * a non-zero under-count reaches no other reader, so the cheap answer is the honest one here; a
 * maintained counter column would be the real fix.
 */
export function toMessagePage(
	threadId: string,
	rows: DmMessageRow[],
	parties: Map<string, PartyRow>,
	viewerId: string,
	hasMore: boolean,
	now: number,
	interactions: MessageInteractions = NO_INTERACTIONS,
): MessagePage {
	const messages = rows.map((row) => toChatMessage(row, parties, viewerId, now, interactions));
	const oldest = rows[0];
	return {
		channelId: threadId,
		messages,
		hasMore,
		// The cursor names the OLDEST row on the page, because this feed pages backwards.
		nextCursor: hasMore && oldest ? oldest.id : null,
		// `.max(3)` and it THROWS, so the truncation happens here rather than being left to a schema
		// that would reject the whole page. Most-recent-first, matching the sticky banner's own order:
		// `messages` is oldest-first, so the tail is the newest.
		pinned: messages.filter((m) => m.pinned).slice(-MAX_PINNED).reverse(),
		// A DM participant may pin — the policy on `comms.message_pins` allows anyone who can read the
		// message. In a project channel the product narrows this to an owner-granted capability, which
		// no column records; that narrower gate lives in the app layer.
		permissions: { canPin: true },
		total: messages.length + (hasMore ? 1 : 0),
	};
}

/**
 * How many messages of ONE thread are counted before `messageCount` becomes a floor.
 *
 * The count exists to drive the visibility rule (`> 0`) and nothing else renders it, so an exact
 * total on a ten-thousand-message thread would be paid for on every inbox render and read by nobody.
 * What matters is that the bound is PER THREAD: the previous global cap meant a few busy
 * conversations could consume the entire window and every quieter thread reported zero, which the
 * visibility rule then removed from the inbox altogether.
 */
const THREAD_COUNT_CAP = 200;

/** A thread's newest message and how many it holds (up to {@link THREAD_COUNT_CAP}). */
interface ThreadTail {
	threadId: string;
	newest: DmMessageRow | undefined;
	count: number;
	/**
	 * Whether the count is a MEASUREMENT or merely the absence of one.
	 *
	 * The two must not be conflated, because the visibility rule deletes a conversation whose count is
	 * zero. A thread we failed to read is not an empty thread, and hiding it would make a transient
	 * broker error look exactly like a conversation the user never had.
	 */
	measured: boolean;
}

/**
 * Read one thread's newest message and a bounded count.
 *
 * `head: true` with `count: "exact"` would give a true total in one round trip, but PostgREST
 * returns it in a `Content-Range` header that supabase-js surfaces only as `count` — and it is a
 * second query either way. Taking a bounded page and measuring it keeps the newest row and the
 * count in ONE request per thread, which is what the inbox actually needs.
 */
async function fetchThreadTail(db: SupabaseClient, threadId: string): Promise<ThreadTail> {
	const { data, error } = await db
		.from("dm_messages")
		.select(
			"id, thread_id, sender_user_id, body, has_attachments, is_audio, created_at, deleted_at",
		)
		.eq("thread_id", threadId)
		.is("deleted_at", null)
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(THREAD_COUNT_CAP);

	// A per-thread failure costs that thread's PREVIEW, not its existence: the other threads resolved
	// fine, and `measured: false` keeps the visibility rule from mistaking an unread count for an
	// empty conversation.
	if (error) return { threadId, newest: undefined, count: 0, measured: false };
	const rows = (data ?? []) as unknown as DmMessageRow[];
	return { threadId, newest: rows[0], count: rows.length, measured: true };
}

/** One conversation by thread id, or `null` when the viewer is not a participant. */
export async function fetchConversation(
	actor: ReadActor & { accessToken: string },
	threadId: string,
	now: number,
): Promise<ConversationSummary | null> {
	const all = await fetchConversations(actor, now);
	return all.find((c) => c.id === threadId) ?? null;
}

/**
 * Resolve a cursor id into the `(created_at, id)` anchor the keyset predicate needs.
 *
 * The timestamp is read from the row itself rather than carried in the cursor, so it arrives at the
 * column's real microsecond precision. That is the whole reason the cursor is an id: any encoding
 * that round-tripped the instant through `Date` would truncate it to milliseconds and quietly break
 * the equality half of the keyset.
 *
 * A cursor naming a row that no longer exists (deleted, or never in this thread) resolves to `null`
 * and the read starts from the newest page — the same fail-open the fixture pager has, matched
 * deliberately so the two halves behave identically rather than one erroring where the other repeats.
 */
async function resolveCursorAnchor(
	db: SupabaseClient,
	threadId: string,
	cursorId: string | null | undefined,
): Promise<CursorAnchor | null> {
	if (!cursorId) return null;
	const { data, error } = await db
		.from("dm_messages")
		.select("id, created_at")
		.eq("thread_id", threadId)
		.eq("id", cursorId)
		.maybeSingle();
	if (error || !data) return null;
	const row = data as unknown as { id: string; created_at: string };
	return { createdAt: row.created_at, id: row.id };
}

/**
 * One page of a thread's messages, newest-last, paging BACKWARD.
 *
 * The direction matches the chat feed's contract: the first request omits the cursor and yields the
 * LATEST page, and scrolling up asks for strictly older. So the query orders DESCENDING (to take the
 * newest `limit` rows) and the result is reversed before returning, because the feed renders oldest
 * at the top.
 *
 * The keyset predicate is `created_at < cursor.createdAt OR (created_at = … AND id < …)`, expressed
 * through PostgREST's `.or()`. An `OFFSET` would drift under concurrent inserts — a message arriving
 * mid-scroll shifts every subsequent page by one and the reader sees a duplicate.
 */
export async function fetchThreadMessages(
	actor: ReadActor & { accessToken: string },
	threadId: string,
	before: string | null | undefined,
	limit?: number,
): Promise<{ rows: DmMessageRow[]; parties: Map<string, PartyRow>; hasMore: boolean }> {
	const db = commsClient(actor);
	const size = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
	const cursor = await resolveCursorAnchor(db, threadId, before);

	let query = db
		.from("dm_messages")
		.select(
			"id, thread_id, sender_user_id, body, has_attachments, is_audio, created_at, deleted_at",
		)
		.eq("thread_id", threadId)
		.is("deleted_at", null);

	if (cursor) {
		// `cursor.createdAt` is the value Postgres itself returned for that row, at full microsecond
		// precision — never a re-parsed or re-rendered one — so `created_at.eq` genuinely matches the
		// anchor and the `id` tie-break can fire.
		//
		// DOUBLE-QUOTED because PostgREST's `or=` grammar is `column.operator.value` with `,` `.` `:`
		// `(` `)` reserved as structure, and a timestamptz literal is full of them. Unquoted it
		// happens to parse (the split takes only the first two dots), but that is leaning on the
		// parser's leniency for a value made of the characters the grammar reserves.
		const at = `"${cursor.createdAt}"`;
		query = query.or(
			`created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`,
		);
	}

	// One extra row is requested so "is there an older page" is answered by the data rather than by
	// comparing the page size to the limit, which cannot tell a full last page from a full middle one.
	const { data, error } = await query
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(size + 1);

	if (error) throw new Error(`comms.dm_messages read failed: ${error.message}`);

	const fetched = (data ?? []) as unknown as DmMessageRow[];
	const hasMore = fetched.length > size;
	const rows = (hasMore ? fetched.slice(0, size) : fetched).reverse();
	const parties = await fetchParties(actor, rows.map((r) => r.sender_user_id));
	return { rows, parties, hasMore };
}

// #endregion
