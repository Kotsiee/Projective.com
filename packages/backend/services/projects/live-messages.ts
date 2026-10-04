import type { SupabaseClient } from "supabaseClient";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	type PartyRow,
	projectsDb,
	senderOf,
} from "./live-support.ts";
import {
	type ChatMessage,
	type MessageAttachment,
	messageDeltaFor,
	type MessagePage,
	type MessagePageParams,
	type MessageReaction,
	type MessageReply,
	type MessageSender,
} from "@projective/types/projects";
import { resolveChannelRef, UUID_RE } from "./live-support.ts";
import { REPLY_ORIGINAL_COLUMNS, replyFromRow, type ReplyOriginalRow } from "./message-replies.ts";
import { fetchMessageAttachments } from "./message-attachments.ts";

/**
 * live-messages — the RLS-scoped Postgres read path for ONE project channel's conversation
 * (`/projects/[projectId]/[channelId]/chat`), backing `ProjectBackendService.messages`.
 *
 * Every query runs under the caller's own JWT via the schema-profile clients in
 * {@link ./live-support.ts}. Nothing here uses the service-role client, and nothing here filters for
 * tenancy by hand: `comms.project_messages` carries a real SELECT policy (`view_messages_if_member`
 * → `comms.has_channel_access`), so the channel gate is the security boundary and the predicates
 * below are about MEANING, not permission.
 *
 * ## What this module cannot resolve, and returns neutral rather than guessing
 *
 * Four fields on {@link ChatMessage} have no live source at all. They are listed here rather than
 * only at their call sites because each one looks like an omission:
 *
 * - **`audio` is always `null`.** `MessageAudioSchema` requires `durationMs`, a `m:ss`
 *   `durationLabel` and a `peaks` envelope of up to 512 normalised samples. There is no waveform
 *   column, no duration column and no envelope column anywhere in `comms`, so a voice memo cannot be
 *   projected — a player rendered over a zero-length track with a flat envelope would be a control
 *   that is offered and then does nothing. An audio file that arrived as a real
 *   `comms.message_attachments` row still surfaces, as an ordinary attachment tile.
 * - **`system` is always `null` and `type` is always `"user"`.** There is no system-message table and
 *   `comms.project_messages` has no `type`, `kind` or `activity` column, so
 *   `ChatMessageType === "system"` is unreachable from this schema. The lifecycle notices the
 *   fixtures interleave are a fixture-only affordance.
 * - **`MessageAttachment.width` / `height` are always `null`.** `files.items` records `mime_type` and
 *   `size_bytes` but no intrinsic pixel dimensions. `files.items.metadata` is an unconstrained
 *   `jsonb` that nothing in the migrations writes a `width`/`height` key into, so mining it would be
 *   reading a convention that does not exist. The single-row media layout falls back to a 1:1 ratio
 *   for a null pair, which is a layout compromise rather than a wrong claim.
 * - **`MessagePage.permissions.canPin`** is narrowed to project OWNERSHIP — see
 *   {@link resolveCanPin} for why that is the widest honest answer.
 *
 * ## The PII rewrite is invisible in this projection
 *
 * `comms.project_messages` carries `pii_masked` and `pii_categories`, written by
 * `trg_mask_message_pii` during a project's protected phase. The trigger rewrites `body` IN PLACE and
 * the original is not stored anywhere, so what this module reads may already be a redacted copy — and
 * {@link ChatMessage} has no field in which to say so. Nothing here attempts to reverse it (it is not
 * reversible) and nothing here signals it (there is nowhere to put the signal). A reader comparing a
 * masked bubble against what was typed should find that difference named here rather than discover
 * it.
 *
 * ## Two polymorphic vocabularies, one schema
 *
 * `comms.message_attachments`, `message_pins`, `message_reactions` and `message_favorites` all key on
 * the SCHEMA-QUALIFIED discriminator {@link PROJECT_MESSAGE_TABLE} (`"comms.project_messages"`),
 * while `comms.channel_files` keys the same concept on the BARE string `"project"`. Matching the
 * wrong one returns zero rows rather than erroring, which is why the literal is a named constant used
 * everywhere below instead of being retyped at four call sites.
 *
 * None of those four tables can be embedded: `message_id` carries NO foreign key (Postgres cannot
 * point one column at two parents), so PostgREST has no relationship to traverse. Each is a second
 * query keyed on the page's message ids, and the denormalised `has_attachments` / `is_audio` booleans
 * on the message row are advisory — **no trigger maintains them** — so they are never read as truth
 * about what a bubble renders. Their one reader is a reply quote's `media` label, which is a word on
 * a quote rather than a tile; `./message-replies.ts` states why that is the right trade.
 *
 * ## Formatting and replies
 *
 * `body_delta` is shown only when it spells exactly the text this module returns
 * (`messageDeltaFor`). The text is clamped and may be a PII rewrite, and in either case the Delta no
 * longer agrees and the bubble renders plain — formatting can be lost here, never words invented.
 *
 * `reply_to_id` is a self-reference, so the original is one more `comms.project_messages` row. An
 * original already on the page (or in the pinned set) is reused; only the ones scrolled out of the
 * window cost a read, issued once for the whole page ({@link fetchReplyOriginals}). That read is
 * SECONDARY like every other enrichment: a failure, an original RLS withholds, and a soft-deleted
 * original all resolve to the same `available: false` quote rather than failing the page.
 */

// #region Constants

/** Page size when the caller does not ask for one. Matches the fixture pager's own default. */
const DEFAULT_PAGE = 28;

/** Hard ceiling on a page. `MessagePageParamsSchema.limit` is `max(100)`; this restates it server-side. */
const MAX_PAGE = 100;

/** `ChatMessage.text` is `max(8000)` (the send cap); `comms.project_messages.body` is unbounded `text`. */
const MESSAGE_TEXT_MAX = 8000;

/** `MessageSender.name` is `min(1).max(120)` over three unbounded `org.users_public` columns. */
const SENDER_NAME_MAX = 120;

/** `MessageSender.handle` is `max(40)` over the unbounded, UNIQUE `org.users_public.username`. */
const SENDER_HANDLE_MAX = 40;

/** `MessagePageSchema.pinned` is `.max(3)` and THROWS — the banner set is truncated before return. */
const PINNED_MAX = 3;

/**
 * How many of the caller's readable pins are scanned to find this channel's.
 *
 * `comms.message_pins` has no `channel_id` and no FK to embed through, so there is no way to ask for
 * "the pins of THIS channel" in one query. The scan therefore takes the caller's most recent readable
 * project-message pins and narrows them to this channel in a second step, which has two consequences
 * worth stating rather than discovering:
 *
 *  1. A channel whose pins are all older than the caller's {@link PIN_SCAN_CAP} most recent pins
 *     across every project they can read will under-report its banner, and a page message pinned that
 *     long ago will render without its pin mark. A pin is a rare, deliberate act and the banner shows
 *     three, so the window is generous in practice — but it is a window, not a guarantee.
 *  2. The SELECT policy on that table is `comms.can_read_message(...)`, a `SECURITY DEFINER` function
 *     evaluated per candidate row BEFORE the limit applies, so this scan gets more expensive as the
 *     platform's pin table grows.
 *
 * The real fix is a `channel_id` column on the pin row (or a definer function that takes one), which
 * is a migration rather than a query.
 */
const PIN_SCAN_CAP = 100;

/** The polymorphic discriminator for a project-channel message. See the module docblock. */
const PROJECT_MESSAGE_TABLE = "comms.project_messages" as const;

/**
 * The `comms.project_messages` columns one bubble needs.
 *
 * A superset of `REPLY_ORIGINAL_COLUMNS`, so a message on the page can serve as the original of a
 * reply on the same page without being read twice — which is the common case, since people answer
 * what they can see.
 */
const MESSAGE_COLUMNS = [
	"id",
	"channel_id",
	"sender_user_id",
	"body",
	"body_delta",
	"reply_to_id",
	"has_attachments",
	"is_audio",
	"created_at",
	"deleted_at",
].join(", ");


// #endregion

// #region Row shapes

/** One `comms.project_channels` row, reduced to what this read needs. */
interface ChannelRow {
	id: string;
	project_id: string;
}

/** One `comms.project_messages` row as selected by {@link MESSAGE_COLUMNS}. */
interface MessageRow extends ReplyOriginalRow {
	channel_id: string;
	/** Raw `jsonb`; it reaches a bubble only through `messageDeltaFor`, which parses it. */
	body_delta: unknown;
	reply_to_id: string | null;
	created_at: string;
}

/** One `comms.message_reactions` row — a chip count is a fold over these, never a stored number. */
interface ReactionRow {
	message_id: string;
	user_id: string;
	emoji: string;
}

/** The `(created_at, id)` pair a keyset predicate needs, read back from the cursor's own row. */
interface CursorAnchor {
	createdAt: string;
	id: string;
}

/** The per-page facts no single message row carries, resolved once and shared by every bubble. */
interface MessageContext {
	parties: Map<string, PartyRow>;
	attachments: Map<string, MessageAttachment[]>;
	reactions: Map<string, MessageReaction[]>;
	pinnedIds: ReadonlySet<string>;
	favoritedIds: ReadonlySet<string>;
	/** The originals this page's replies quote, by id — on-page rows and fetched ones alike. */
	originals: ReadonlyMap<string, ReplyOriginalRow>;
	viewerId: string;
	now: number;
}

// #endregion

// #region Formatting

/**
 * A `h:mm AM` clock in UTC — `ChatMessage.timeLabel` is `max(20)`.
 *
 * UTC, not the server's zone, and deliberately not `Intl`: this label is produced on the server and
 * re-produced by the island on every refetch, so anything that reads a local zone or a locale makes
 * SSR and hydration disagree about what time a message was sent. The fixtures carry the same rule for
 * the same reason.
 */
function clockLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	const hh = d.getUTCHours();
	const h12 = hh % 12 === 0 ? 12 : hh % 12;
	return `${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** Weekday names for the date divider. Fixed English, matching the fixtures — never locale-derived. */
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Month names for the date divider. */
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One UTC day in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * A date-divider label in UTC — `ChatMessage.dayLabel` is `max(24)`.
 *
 * The day difference is CALENDAR days (`floor(now / DAY) - floor(at / DAY)`), matching
 * `messages-fixtures.ts` `fmtDay` — deliberately NOT the elapsed-24-hour form the DM twin uses. The
 * two disagree exactly where it matters: a message sent at 23:00 and read at 01:00 the next morning
 * is two hours old, so elapsed math labels it "Today" and files it under today's divider, while the
 * calendar form correctly calls it "Yesterday". A date divider is a statement about the DATE, and the
 * client's grouping renders whatever this string says.
 */
function dayLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const diff = Math.floor(now / DAY_MS) - Math.floor(at / DAY_MS);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(at);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * {@link senderOf} with the truncation contract applied.
 *
 * `senderOf` composes the display party but does not clamp it, and all three source columns
 * (`username`, `first_name`, `last_name`) are unbounded `text` with no CHECK — against `name`
 * `min(1).max(120)` and `handle` `max(40)`, both of which THROW rather than truncate. One long
 * profile row would therefore fail the entire page read.
 *
 * A `handle` that does not fit is dropped to `null` rather than truncated. A truncated handle is not
 * a shorter handle, it is a DIFFERENT one: `username` is UNIQUE, so `/@` plus the first forty
 * characters routes to somebody else's profile or to a 404. Null renders the name without a link,
 * which is the honest reading of "we cannot address this person from here".
 */
function messageSender(userId: string, row: PartyRow | undefined): MessageSender {
	const party = senderOf(userId, row);
	const handle = party.handle && party.handle.length <= SENDER_HANDLE_MAX ? party.handle : null;
	return {
		id: party.id,
		name: clampOr(party.name, SENDER_NAME_MAX, "Unknown"),
		avatar: party.avatar,
		handle,
	};
}

// #endregion

// #region Reactions, favourites, pins

/**
 * Reaction buckets per message id.
 *
 * A chip's `count` is a FOLD over `comms.message_reactions` rows, never a stored number — the table
 * has no counter column, and the UNIQUE `(message_table, message_id, user_id, emoji)` is what makes
 * `COUNT(*)` mean "how many people". `MessageReactionSchema.count` is `.min(1)`, so a zero bucket is
 * unrepresentable; building buckets from the rows themselves makes an empty one unreachable rather
 * than something to filter out afterwards.
 *
 * Buckets are ordered by count descending, then by the emoji's code points ascending.
 * `localeCompare` is deliberately avoided: it would order the chips by the SERVER's locale, and the
 * island re-renders this same list, so the two would disagree about chip order on hydration.
 */
async function fetchReactions(
	actor: ReadActor & { accessToken: string },
	messageIds: readonly string[],
	viewerId: string,
): Promise<Map<string, MessageReaction[]>> {
	const out = new Map<string, MessageReaction[]>();
	if (messageIds.length === 0) return out;

	const { data, error } = await commsDb(actor)
		.from("message_reactions")
		.select("message_id, user_id, emoji")
		.eq("message_table", PROJECT_MESSAGE_TABLE)
		.in("message_id", messageIds as string[]);

	if (error) return out;

	const buckets = new Map<string, Map<string, { count: number; mine: boolean }>>();
	for (const row of (data ?? []) as unknown as ReactionRow[]) {
		const byEmoji = buckets.get(row.message_id) ??
			new Map<string, { count: number; mine: boolean }>();
		const entry = byEmoji.get(row.emoji) ?? { count: 0, mine: false };
		entry.count += 1;
		if (row.user_id === viewerId) entry.mine = true;
		byEmoji.set(row.emoji, entry);
		buckets.set(row.message_id, byEmoji);
	}

	for (const [messageId, byEmoji] of buckets) {
		const list: MessageReaction[] = [...byEmoji.entries()]
			.map(([emoji, entry]) => ({ emoji, count: entry.count, mine: entry.mine }))
			.sort((a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0));
		out.set(messageId, list);
	}
	return out;
}

/**
 * The subset of the given messages the VIEWER has favourited.
 *
 * Keyed on `user_id` as well as the message ids even though the SELECT policy on
 * `comms.message_favorites` is already own-row-only. The predicate is not redundant defence, it is
 * the MEANING of the field: `ChatMessage.favorited` is "did I star this", and a read that is correct
 * only because a policy happens to be narrow becomes wrong the day that policy widens.
 */
async function fetchFavorited(
	actor: ReadActor & { accessToken: string },
	messageIds: readonly string[],
): Promise<Set<string>> {
	const out = new Set<string>();
	if (messageIds.length === 0 || !actor.userId) return out;

	const { data, error } = await commsDb(actor)
		.from("message_favorites")
		.select("message_id")
		.eq("message_table", PROJECT_MESSAGE_TABLE)
		.eq("user_id", actor.userId)
		.in("message_id", messageIds as string[]);

	if (error) return out;
	for (const row of (data ?? []) as unknown as { message_id: string }[]) out.add(row.message_id);
	return out;
}

/**
 * The message ids the caller can see a pin on, most recently pinned first.
 *
 * Platform-wide within what RLS admits, because the pin row names no channel — see
 * {@link PIN_SCAN_CAP} for the window this imposes and why it exists. A failure degrades to an empty
 * set: a channel with no banner and no pin marks is a visibly reduced page, whereas throwing would
 * take down a conversation that otherwise read fine.
 */
async function fetchPinnedIds(actor: ReadActor & { accessToken: string }): Promise<Set<string>> {
	const out = new Set<string>();
	const { data, error } = await commsDb(actor)
		.from("message_pins")
		.select("message_id, created_at")
		.eq("message_table", PROJECT_MESSAGE_TABLE)
		.order("created_at", { ascending: false })
		.limit(PIN_SCAN_CAP);

	if (error) return out;
	for (const row of (data ?? []) as unknown as { message_id: string }[]) out.add(row.message_id);
	return out;
}

/**
 * The channel's pinned messages for the sticky banner — the {@link PINNED_MAX} most recent, newest
 * first.
 *
 * Ordered by the MESSAGE's `created_at`, not the pin's: the banner is a set of messages and the
 * schema calls the order "most-recent first", which a reader reads as the most recent conversation
 * rather than the most recent act of pinning. Matches the fixture pager, which takes the tail of the
 * message pool and reverses it.
 */
async function fetchPinnedRows(
	actor: ReadActor & { accessToken: string },
	channelId: string,
	pinnedIds: ReadonlySet<string>,
): Promise<MessageRow[]> {
	if (pinnedIds.size === 0) return [];
	const { data, error } = await commsDb(actor)
		.from("project_messages")
		.select(MESSAGE_COLUMNS)
		.eq("channel_id", channelId)
		.is("deleted_at", null)
		.in("id", [...pinnedIds])
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(PINNED_MAX);

	if (error) return [];
	return (data ?? []) as unknown as MessageRow[];
}

// #endregion

// #region Replies

/**
 * The originals the given replies quote, keyed by id — rows already in hand first, the rest read in
 * ONE query.
 *
 * `in hand` is the page plus the pinned set: they were selected with every column a quote needs, and
 * a reply usually answers something still on screen, so most pages issue no read here at all.
 *
 * Scoped to `channel_id` although `comms.tg_guard_message_reply` already keeps every reply inside its
 * own channel. The predicate is the MEANING of the quote, not a second guard: a quote from another
 * room would show this channel's readers words they may not be cleared for, and a read that is only
 * correct because a trigger elsewhere held is the kind that goes wrong silently. Soft-deleted rows are
 * deliberately NOT filtered: what a deleted original looks like is decided once, in the quote mapper
 * (`replyFromRow`), and a read that dropped them here would be making that decision a second time.
 *
 * Secondary, like every enrichment: a failed read costs the quotes their content (they read as
 * unavailable), never the page.
 */
async function fetchReplyOriginals(
	actor: ReadActor & { accessToken: string },
	channelId: string,
	replyIds: readonly string[],
	inHand: readonly MessageRow[],
): Promise<Map<string, ReplyOriginalRow>> {
	const out = new Map<string, ReplyOriginalRow>();
	const wanted = new Set(replyIds);
	if (wanted.size === 0) return out;

	for (const row of inHand) if (wanted.has(row.id)) out.set(row.id, row);
	const missing = [...wanted].filter((id) => !out.has(id));
	if (missing.length === 0) return out;

	const { data, error } = await commsDb(actor)
		.from("project_messages")
		.select(REPLY_ORIGINAL_COLUMNS)
		.eq("channel_id", channelId)
		.in("id", missing);

	if (error) return out;
	for (const row of (data ?? []) as unknown as ReplyOriginalRow[]) out.set(row.id, row);
	return out;
}

/** The quote a reply renders. An original that did not resolve reads as unavailable. */
function replyOf(replyToId: string, ctx: MessageContext): MessageReply {
	const original = ctx.originals.get(replyToId);
	const name = original
		? messageSender(original.sender_user_id, ctx.parties.get(original.sender_user_id)).name
		: "";
	return replyFromRow(replyToId, original, name, ctx.viewerId);
}

// #endregion

// #region Channel resolution

/**
 * The channel row, or `null` when it does not exist or `comms.has_channel_access` withheld it.
 *
 * `maybeSingle` rather than `single`: a channel that matches nothing is an ordinary 404 on this
 * route, and `single` turns it into a thrown PostgREST error the caller would have to unwrap to tell
 * "no such channel" from "the database is down".
 */
async function fetchChannel(
	actor: ReadActor & { accessToken: string },
	channelId: string,
): Promise<ChannelRow | null> {
	const { data, error } = await commsDb(actor)
		.from("project_channels")
		.select("id, project_id")
		.eq("id", channelId)
		.maybeSingle();

	if (error) throw new Error(`comms.project_channels read failed: ${error.message}`);
	if (!data) return null;
	return data as unknown as ChannelRow;
}

/**
 * The project uuid the route asked for, or `null` when it cannot be established.
 *
 * `MessagePageParams.projectId` is an opaque string that may be a uuid or a slug, so a uuid passes
 * through and anything else is looked up by slug. `null` is returned for BOTH "not found" and "read
 * failed", and the caller treats it as "unconstrained" rather than as a refusal — which matters,
 * because the two are routinely indistinguishable here: the SELECT policies on `projects.projects`
 * are owner-or-public, so a hired freelancer can hold channel access through
 * `comms.has_channel_access` while the project row itself is withheld from them. Refusing the read on
 * an unresolvable project would 404 exactly the people the channel gate just admitted.
 */
async function resolveProjectId(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<string | null> {
	const { data, error } = await projectsDb(actor)
		.from("projects")
		.select("id")
		.eq("slug", projectId)
		.maybeSingle();
	if (error || !data) return null;
	return (data as unknown as { id: string }).id;
}

/**
 * Whether the viewer may pin in this channel — narrowed to project OWNERSHIP.
 *
 * The product rule is "anyone in a DM; in a project or team channel, only a viewer the project owner
 * granted permission" (`ChannelPermissionsSchema`). This is never a DM, and **no column records that
 * grant** — the RLS policy on `comms.message_pins` says exactly that in its own comment and settles
 * for channel access, leaving the narrower gate to the app layer.
 *
 * So the widest thing the schema can honestly assert is that the caller owns the project, which is a
 * strict SUBSET of the product rule (an owner has trivially granted themselves) and therefore never
 * over-grants. It under-grants for a delegated pinner, which is the safe direction and the only one
 * available: `canPin` decides whether the Pin affordance is drawn at all, and drawing a control that
 * a write policy will then refuse is worse than not drawing it.
 *
 * A withheld or failed project read resolves to `false`, which is correct on its own terms — the
 * owner-or-public policy means an owner can always read their own project row, so an unreadable row
 * is positive evidence the caller is not the owner.
 */
async function resolveCanPin(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<boolean> {
	if (!actor.userId) return false;
	const { data, error } = await projectsDb(actor)
		.from("projects")
		.select("owner_user_id")
		.eq("id", projectId)
		.maybeSingle();
	if (error || !data) return false;
	return (data as unknown as { owner_user_id: string }).owner_user_id === actor.userId;
}

// #endregion

// #region Paging

/**
 * Resolve a cursor id into the `(created_at, id)` anchor the keyset predicate needs.
 *
 * The cursor is the MESSAGE ID verbatim, and the instant is read back off the row rather than encoded
 * into it — the same decision the DM twin records at length. Encoding it truncates a MICROSECOND
 * `timestamptz` to the millisecond a `Date` can represent, so `created_at = cursor` then matches
 * nothing, the `id` tie-break can never fire, and every message sharing the boundary millisecond with
 * the page edge is skipped permanently and silently.
 *
 * A cursor naming a row that no longer exists — deleted, or never in this channel — resolves to
 * `null` and the read starts from the newest page. That fail-open matches the fixture pager, which
 * falls back to the tail when `before` finds no index, so the two halves behave identically instead
 * of one erroring where the other repeats.
 */
async function resolveCursorAnchor(
	db: SupabaseClient,
	channelId: string,
	cursorId: string | null | undefined,
): Promise<CursorAnchor | null> {
	if (!cursorId || !UUID_RE.test(cursorId)) return null;
	const { data, error } = await db
		.from("project_messages")
		.select("id, created_at")
		.eq("channel_id", channelId)
		.eq("id", cursorId)
		.maybeSingle();
	if (error || !data) return null;
	const row = data as unknown as { id: string; created_at: string };
	return { createdAt: row.created_at, id: row.id };
}

/**
 * The channel's true message count, or `null` when it could not be measured.
 *
 * `head: true` with `count: "exact"` transfers no rows — PostgREST answers in a `Content-Range`
 * header that supabase-js surfaces as `count` — so an honest total costs one round trip issued
 * alongside the others rather than a scan the caller waits on. That is affordable here in a way it is
 * not in the DM inbox, which would pay it once per thread and therefore reports a floor instead.
 *
 * `null` on failure, deliberately distinct from `0`: a `MessagePage.total` of zero triggers the EMPTY
 * STATE, and telling someone their channel has no messages because a count query failed is a lie the
 * reader has no way to detect. The caller falls back to a floor derived from the page it did read.
 */
async function countChannelMessages(
	db: SupabaseClient,
	channelId: string,
): Promise<number | null> {
	const { count, error } = await db
		.from("project_messages")
		.select("id", { count: "exact", head: true })
		.eq("channel_id", channelId)
		.is("deleted_at", null);
	if (error || count === null || count === undefined) return null;
	return count;
}

// #endregion

// #region Mapping

/**
 * Map one `comms.project_messages` row onto the feed's {@link ChatMessage} projection.
 *
 * `text` is CLAMPED, not passed through: `body` is unbounded `text`, the field is `max(8000)`, and
 * Zod throws rather than truncating — so a single long message would fail the whole page. It may also
 * already be a PII-masked rewrite; see the module docblock. The Delta is checked against THIS text,
 * so a clamped or rewritten body renders plain.
 */
function toChatMessage(row: MessageRow, ctx: MessageContext): ChatMessage {
	const text = clamp(row.body, MESSAGE_TEXT_MAX);
	return {
		id: row.id,
		// Always `user`. There is no system-message source in this schema — see the module docblock.
		type: "user",
		createdAt: row.created_at,
		timeLabel: clockLabel(row.created_at),
		dayLabel: dayLabel(row.created_at, ctx.now),
		sender: messageSender(row.sender_user_id, ctx.parties.get(row.sender_user_id)),
		isOwn: row.sender_user_id === ctx.viewerId,
		text,
		delta: messageDeltaFor(row.body_delta, text),
		replyTo: row.reply_to_id ? replyOf(row.reply_to_id, ctx) : null,
		attachments: ctx.attachments.get(row.id) ?? [],
		audio: null,
		system: null,
		reactions: ctx.reactions.get(row.id) ?? [],
		pinned: ctx.pinnedIds.has(row.id),
		favorited: ctx.favoritedIds.has(row.id),
	};
}

// #endregion

// #region Public read

/**
 * One page of a project channel's conversation, oldest-last, paging BACKWARD.
 *
 * Returns `null` when the subject does not exist or is not visible — a channel id that is not a uuid,
 * a channel row `comms.has_channel_access` withheld, or a channel belonging to a different project
 * than the route named. All three are a 404 to the caller and none is distinguishable from the others
 * by design: telling an outsider that a channel exists but is not theirs is itself a disclosure.
 *
 * THROWS only on a genuine query failure of a PRIMARY read (the channel row, the message page), with
 * the table named, so the calling service can log it and fall back to fixtures. Every SECONDARY
 * lookup — parties, attachments, reactions, favourites, pins, the total, the pin capability —
 * degrades to a neutral value instead, so one withheld join cannot take down a conversation that
 * otherwise resolved.
 *
 * ## Direction
 *
 * The feed renders oldest at the top and opens at the newest message, so the first request omits the
 * cursor and yields the LATEST page while scrolling up asks for strictly older. The query therefore
 * orders DESCENDING to take the newest `limit` rows, and the result is reversed before returning. The
 * keyset predicate is `created_at < anchor OR (created_at = anchor AND id < anchor.id)`, expressed
 * through PostgREST's `.or()`; an `OFFSET` would drift under concurrent inserts, so a message
 * arriving mid-scroll would shift every subsequent page by one and the reader would see a duplicate.
 *
 * One extra row is requested so `hasMore` is answered by the data rather than by comparing the page
 * length to the limit, which cannot tell a full last page from a full middle one.
 */
export async function fetchChannelMessagePage(
	actor: ReadActor & { accessToken: string },
	params: MessagePageParams,
	now: number = Date.now(),
): Promise<MessagePage | null> {
	const db = commsDb(actor);

	// The route's project segment has to resolve FIRST here, unlike the reads below: a stage is
	// addressed by its slug, and resolving that slug to a room is scoped by project id. A DM or general
	// channel still carries its own id and passes straight through.
	const requestedProjectId = await resolveProjectId(actor, params.projectId);
	const channelId = requestedProjectId
		? await resolveChannelRef(actor, requestedProjectId, params.channelId)
		: (UUID_RE.test(params.channelId) ? params.channelId : null);
	if (!channelId) return null;

	const channel = await fetchChannel(actor, channelId);
	if (!channel) return null;
	// A project id we positively resolved and that disagrees is a mismatched route, not a permission
	// question. An UNRESOLVED one constrains nothing — see {@link resolveProjectId}.
	if (requestedProjectId && requestedProjectId !== channel.project_id) return null;

	const size = Math.min(Math.max(params.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);

	const [anchor, total, pinnedIds, canPin] = await Promise.all([
		resolveCursorAnchor(db, channel.id, params.before),
		countChannelMessages(db, channel.id),
		fetchPinnedIds(actor),
		resolveCanPin(actor, channel.project_id),
	]);

	let query = db
		.from("project_messages")
		.select(MESSAGE_COLUMNS)
		.eq("channel_id", channel.id)
		// Explicit. Nothing in the schema hides a soft-deleted message for you — there is no view and
		// no partial index — so a missing predicate silently resurrects deleted messages into a feed.
		.is("deleted_at", null);

	if (anchor) {
		// `anchor.createdAt` is the value Postgres itself returned for that row, at full microsecond
		// precision, so `created_at.eq` genuinely matches and the `id` tie-break can fire.
		//
		// DOUBLE-QUOTED because PostgREST's `or=` grammar is `column.operator.value` with `,` `.` `:`
		// `(` `)` reserved as structure, and a timestamptz literal is made of exactly those
		// characters. Unquoted it happens to parse, which is leaning on the parser's leniency.
		const at = `"${anchor.createdAt}"`;
		query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${anchor.id})`);
	}

	const [pageRes, pinnedRows] = await Promise.all([
		query
			.order("created_at", { ascending: false })
			.order("id", { ascending: false })
			.limit(size + 1),
		fetchPinnedRows(actor, channel.id, pinnedIds),
	]);

	if (pageRes.error) {
		throw new Error(`comms.project_messages read failed: ${pageRes.error.message}`);
	}

	const fetched = (pageRes.data ?? []) as unknown as MessageRow[];
	const hasMore = fetched.length > size;
	const rows = (hasMore ? fetched.slice(0, size) : fetched).reverse();

	// The banner rows are shaped by the same mapper as the page, so a pinned message reads identically
	// wherever it appears — which means their senders, attachments, reactions and favourites have to
	// be resolved too. They are folded into the SAME keyed lookups rather than fetched separately: at
	// most three extra ids, and one code path that cannot drift from the other.
	const subjects = [...rows, ...pinnedRows];
	const subjectIds = [...new Set(subjects.map((row) => row.id))];

	// The originals come before the parties because their authors have to be named too. This is the
	// one dependent step a reply adds, and only when an original is off the page.
	const replyIds = subjects
		.map((row) => row.reply_to_id)
		.filter((id): id is string => id !== null);
	const originals = await fetchReplyOriginals(actor, channel.id, replyIds, subjects);
	const senderIds = [
		...subjects.map((row) => row.sender_user_id),
		...[...originals.values()].map((row) => row.sender_user_id),
	];

	const [parties, attachments, reactions, favoritedIds] = await Promise.all([
		fetchParties(actor, senderIds),
		fetchMessageAttachments(actor, PROJECT_MESSAGE_TABLE, subjectIds),
		fetchReactions(actor, subjectIds, actor.userId),
		fetchFavorited(actor, subjectIds),
	]);

	const ctx: MessageContext = {
		parties,
		attachments,
		reactions,
		pinnedIds,
		favoritedIds,
		originals,
		viewerId: actor.userId,
		now,
	};

	const messages = rows.map((row) => toChatMessage(row, ctx));
	// `pinned` already arrives newest-first and already capped by its own LIMIT. The slice restates
	// the cap here because `MessagePageSchema.pinned` is `.max(3)` and THROWS, so the bound has to
	// hold at the boundary rather than depend on a `.limit()` three functions away.
	const pinned = pinnedRows.slice(0, PINNED_MAX).map((row) => toChatMessage(row, ctx));

	// The fallback for an unmeasurable total, assembled so it can never fabricate a zero: this page's
	// rows, plus one for the older page `hasMore` proved exists, plus one for the cursor's own message
	// when there was a cursor — that message is strictly NEWER than this page, so it is real, counted
	// nowhere else, and it is what keeps an older page that happens to come back empty from reporting
	// an empty channel and triggering the empty state.
	const totalFloor = messages.length + (hasMore ? 1 : 0) + (anchor ? 1 : 0);

	return {
		channelId: channel.id,
		messages,
		hasMore,
		// The cursor names the OLDEST row on the page, because this feed pages backwards.
		nextCursor: hasMore && rows.length > 0 ? rows[0].id : null,
		pinned,
		permissions: { canPin },
		// The measured count when there is one; otherwise the floor above. See
		// {@link countChannelMessages} for why a failed count must not resolve to `0`.
		total: total ?? totalFloor,
	};
}

// #endregion
