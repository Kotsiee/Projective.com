import type {
	AutoResponseRule,
	AutoResponseTrigger,
	MessagingRole,
	MessagingSettings,
	NotificationPreferences,
} from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { clamp, clampOr, commsDb } from "../projects/live-support.ts";

/**
 * live-settings — the RLS-scoped Postgres read path for `MessagingBackendService.settings`.
 *
 * Four tables, all in the `comms` schema profile, all read under the caller's own JWT via
 * {@link commsDb}: `auto_responses`, `notification_prefs`, `notification_category_prefs` and
 * `notification_type_mutes`. Every one of them is keyed on `user_id` and every policy on them is
 * `user_id = auth.uid()`, so this endpoint reads exactly one person's settings — their own — and
 * the explicit `.eq("user_id", …)` predicates below state that intent in the query rather than
 * leaving the policy as the only thing that expresses it.
 *
 * ## The shape mismatch this module exists to resolve
 *
 * `MessagingSettings.notifications` is a MESSAGING-surface projection: four per-event booleans
 * (`newMessage`, `mentions`, `groupActivity`, `serviceInquiries`) plus a sound cue, a master mute
 * and a quiet-hours pair. `comms.notification_prefs` is a PLATFORM-wide notification row: global
 * channel toggles (`in_app`, `push`, `email`, `sms`), a digest cadence, a snooze deadline. The two
 * do not line up field-for-field, and three of the gaps have to be decided rather than mapped.
 *
 * 1. **The per-event booleans live across two sparse tables.** The finest control the engine offers
 *    is `notification_type_mutes` (a mute on one catalog `type_key`), layered over
 *    `notification_category_prefs` (a nullable per-category override), layered over the global
 *    toggle. In both sparse tables a MISSING ROW and a NULL COLUMN mean the same thing — inherit
 *    the layer below — so the resolution chain here mirrors `comms.fn_resolve_channels` exactly:
 *    `type mute → COALESCE(category.in_app, prefs.in_app) → the column default`. Reproducing the
 *    engine's own chain is deliberate: a toggle that reports a different answer from the function
 *    that actually decides delivery is worse than no toggle at all.
 *
 * 2. **Two of the four events have no catalog key at all.** `message.new` and `message.mention` are
 *    real seeded types, so `newMessage` and `mentions` resolve through the mute layer.
 *    `groupActivity` and `serviceInquiries` are not: the catalog keys on EVENT TYPE while this
 *    modal keys on CONVERSATION SHAPE (a group thread rather than a 1-1) and COMMERCIAL INTENT (an
 *    inbound inquiry rather than a chat) — orthogonal axes. Both are therefore resolved from the
 *    `messages` category layer alone. Borrowing an adjacent key (`channel.invited`,
 *    `message.reaction`) would assert a correspondence the catalog does not make, and would let a
 *    user who muted reactions watch "group activity" go dark for a reason the interface never
 *    mentioned.
 *
 * 3. **`muteAll` is a boolean against a three-state timestamp.** See {@link muteAllFrom}.
 *
 * ## The superseded columns
 *
 * `notification_prefs` carries two pairs where a newer column supersedes an older one, both
 * retained under the Additive Rule:
 *
 *  - `digest boolean` is superseded by `digest_frequency`. NEITHER is selected here:
 *    `MessagingSettings` has no digest field, so reading one would be selecting a column with no
 *    destination. Recorded so that a future author adding a digest control reaches for
 *    `digest_frequency` rather than the boolean.
 *  - `quiet_hours tstzrange` is superseded by the recurring `quiet_hours_enabled` /
 *    `quiet_hours_start` / `quiet_hours_end` / `timezone` set. The recurring columns are preferred
 *    and are the only source for the projected `HH:MM` pair — an absolute instant range cannot be
 *    expressed as a recurring wall-clock window. The legacy range is still READ, because
 *    `comms.fn_is_quiet_hours` still honours it and returns true for any instant it contains
 *    regardless of `quiet_hours_enabled`; ignoring it would let the modal show quiet hours OFF
 *    while the engine is actively suppressing push. See {@link legacyQuietHoursActive}.
 *
 * ## What has no column, and is therefore returned neutral
 *
 * `AutoResponseRule.serviceName` and `.productName` are ALWAYS `null`. `auto_responses.service_id`
 * is an FK into `marketplace.service_blueprints`, and `marketplace` is not exposed to PostgREST at
 * all — it cannot be read, embedded or joined from here. `product_id` is worse: it carries no FK to
 * anything, so there is no table to resolve it against even in principle. The ids themselves are
 * returned verbatim, because they are real and a write path needs them to round-trip; the names are
 * absent rather than guessed.
 */

// #region Constants

/**
 * The `comms.notification_prefs` columns this projection needs.
 *
 * `digest` and `digest_frequency` are deliberately absent — see the module docblock. `timezone` is
 * absent too: it only matters for EVALUATING a quiet-hours window, which the engine does in SQL,
 * and this module projects the stored wall-clock strings rather than a decision about "now".
 */
const PREFS_COLUMNS = [
	"in_app",
	"sound",
	"muted_until",
	"quiet_hours_enabled",
	"quiet_hours_start",
	"quiet_hours_end",
	"quiet_hours",
	"read_receipts",
	"show_typing_indicator",
	"auto_responses_enabled",
].join(", ");

/** The `comms.auto_responses` columns one rule needs. `user_id` is implied by the predicate. */
const AUTO_RESPONSE_COLUMNS =
	"id, enabled, name, trigger, service_id, product_id, keyword, message, ai_assist, created_at";

/**
 * A hard ceiling on auto-response rules pulled for the modal.
 *
 * The Zod array is unbounded and the modal renders every rule, so without a bound a user with a
 * pathological rule count would serialise all of them into one settings response. PostgREST's own
 * `max_rows = 1000` would cap it anyway; stating it here makes the number visible to a reader
 * rather than leaving it a property of a config file three directories away.
 */
const AUTO_RESPONSE_CAP = 200;

/** The `comms.notification_category` member every messaging event belongs to. */
const MESSAGES_CATEGORY = "messages";

/** The `comms.notification_channel` member the modal's toggles actually govern — the inbox. */
const IN_APP_CHANNEL = "in_app";

/**
 * Catalog `type_key` for a plain inbound message. Seeded in
 * `00005010_seed_notification_catalog.sql`.
 */
const TYPE_KEY_NEW_MESSAGE = "message.new";

/** Catalog `type_key` for an @-mention. */
const TYPE_KEY_MENTION = "message.mention";

/**
 * The values a `comms.notification_prefs` row would have if it existed.
 *
 * They are the column DEFAULTs from `00000016_tables_comms.sql`, not invented preferences, and the
 * absent-row case is common rather than exceptional: no signup trigger seeds this table — only
 * `comms.fn_notify` inserts one, lazily, the first time an event is routed to the user. The engine
 * treats a missing row the same way (`fn_resolve_channels` returns the in-app default when its
 * SELECT finds nothing), so mirroring it keeps the modal and the router in agreement.
 */
const PREFS_DEFAULTS = {
	inApp: true,
	sound: true,
	readReceipts: true,
	showTypingIndicator: true,
	/** DEFAULT false. A user who has never opened this modal has automation off, not on. */
	autoResponsesEnabled: false,
} as const;

/**
 * The value returned for a quiet-hours bound that is not stored.
 *
 * `quietStart`/`quietEnd` are REQUIRED `z.string().max(5)` with no `min`, so the empty string is a
 * legal value and is the honest one: the CHECK constraint only forces the pair to be present when
 * `quiet_hours_enabled` is true, so NULL is a real, reachable state meaning "never configured".
 * Returning the fixtures' `"22:00"`/`"08:00"` here would be presenting a preference the user has
 * not expressed, and — because this projection is also what the modal's write path round-trips —
 * could persist it.
 */
const NO_CLOCK_TIME = "";

// #endregion

// #region Row shapes

/** One `comms.notification_prefs` row as selected by {@link PREFS_COLUMNS}. */
interface PrefsRow {
	in_app: boolean | null;
	sound: boolean | null;
	muted_until: string | null;
	quiet_hours_enabled: boolean | null;
	quiet_hours_start: string | null;
	quiet_hours_end: string | null;
	/**
	 * A `tstzrange`, rendered by PostgREST in its Postgres text form. See
	 * {@link legacyQuietHoursActive}.
	 */
	quiet_hours: string | null;
	read_receipts: boolean | null;
	show_typing_indicator: boolean | null;
	auto_responses_enabled: boolean | null;
}

/**
 * One `comms.notification_category_prefs` row.
 *
 * Every channel column is NULLABLE and a NULL means "inherit the global toggle" — the same thing an
 * absent row means. Only `in_app` is selected: it is the channel the modal's toggles govern.
 */
interface CategoryPrefRow {
	category: string;
	in_app: boolean | null;
}

/** One `comms.notification_type_mutes` row. */
interface TypeMuteRow {
	type_key: string;
	/**
	 * NULL = muted indefinitely; a past instant = a lapsed mute the engine ignores rather than
	 * deletes.
	 */
	muted_until: string | null;
	/** NULL or empty = every transport; otherwise the transports this mute suppresses. */
	channels: string[] | null;
}

/** One `comms.auto_responses` row as selected by {@link AUTO_RESPONSE_COLUMNS}. */
interface AutoResponseRow {
	id: string;
	enabled: boolean | null;
	name: string | null;
	trigger: string | null;
	service_id: string | null;
	product_id: string | null;
	keyword: string | null;
	message: string | null;
	ai_assist: boolean | null;
	created_at: string | null;
}

// #endregion

// #region Mapping — auto-responses

/**
 * `comms.auto_responses.trigger` → the Zod {@link AutoResponseTrigger}.
 *
 * The column is free `text` guarded by a CHECK listing exactly the four Zod members, so the two
 * vocabularies agree and this is a guard against an unparseable row rather than a translation. An
 * unrecognised value degrades to `any`, which is the least-scoped member and the one that same
 * CHECK pairs with three NULL scope columns — so a coerced rule can never claim a scope it does
 * not carry.
 */
function toTrigger(raw: string | null | undefined): AutoResponseTrigger {
	switch (raw) {
		case "service":
		case "product":
		case "keyword":
			return raw;
		default:
			return "any";
	}
}

/**
 * Map one `comms.auto_responses` row onto {@link AutoResponseRule}, or `null` to drop it.
 *
 * A row is dropped when its `id` or its `message` is empty. Both are `NOT NULL` columns, but `text`
 * `NOT NULL` still admits `''`, and both fields are `min(1)` in Zod. The alternative — substituting
 * a placeholder body — is the one substitution this module must not make: a rule's `message` is the
 * text SENT TO A CLIENT, and this projection is what the modal round-trips on save, so an invented
 * body is a value that could be persisted and then delivered. A rule with no body cannot fire in
 * any case, so dropping it hides nothing that was working.
 *
 * `name` DOES take a placeholder, and the distinction is deliberate: a name is a label the user
 * reads in a list, never something the platform says on their behalf.
 */
function toRule(row: AutoResponseRow): AutoResponseRule | null {
	const id = clamp(row.id, 80);
	if (id.length === 0) return null;
	const message = clamp(row.message, 2000).trim();
	if (message.length === 0) return null;

	return {
		id,
		enabled: row.enabled === true,
		name: clampOr(row.name, 120, "Untitled rule"),
		trigger: toTrigger(row.trigger),
		serviceId: row.service_id ? clamp(row.service_id, 80) : null,
		// Never resolvable: `marketplace` is not an exposed schema, so the blueprint this FK points at
		// cannot be read, embedded or joined from any PostgREST request this process can issue.
		serviceName: null,
		productId: row.product_id ? clamp(row.product_id, 80) : null,
		// Never resolvable, and for a stronger reason than the service: `product_id` carries no foreign
		// key at all, so there is no table to resolve it against even in principle.
		productName: null,
		keyword: row.keyword ? clamp(row.keyword, 80) : null,
		message,
		aiAssist: row.ai_assist === true,
	};
}

// #endregion

// #region Mapping — quiet hours

/**
 * A `time` column → the projection's `HH:MM` string.
 *
 * `quietStart`/`quietEnd` are `.max(5)` with NO regex, so a raw `"22:00:00"` would parse and then
 * render as an invalid value in an `<input type="time">`. This formats rather than truncates: it
 * reads the hour and minute the database stored and re-emits them zero-padded, so the result is
 * always exactly five characters or the empty string.
 *
 * There is no timezone arithmetic here, and there must not be. A Postgres `time` has no date and no
 * zone — it is a wall-clock reading, and `quiet_hours_start = 22:00` means ten in the evening
 * wherever `notification_prefs.timezone` says the user is. Constructing a `Date` from it, in UTC or
 * otherwise, would invent a day and could shift the value; the server and the client would then
 * disagree about a preference neither of them changed.
 */
function toClockTime(raw: string | null | undefined): string {
	if (!raw) return NO_CLOCK_TIME;
	const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
	if (!match) return NO_CLOCK_TIME;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) return NO_CLOCK_TIME;
	if (!Number.isInteger(minute) || minute < 0 || minute > 59) return NO_CLOCK_TIME;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Strip the optional double quotes Postgres wraps a range bound in when it contains a space. */
function unquoteBound(raw: string): string {
	const text = raw.trim();
	if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
		return text.slice(1, -1).trim();
	}
	return text;
}

/**
 * One `tstzrange` bound → epoch milliseconds, `null` for an unbounded side, or `"invalid"`.
 *
 * Postgres renders a `timestamptz` bound as `2026-01-01 22:00:00+00` — a space where ISO 8601 wants
 * `T`, and a two-digit offset where it wants `+HH:MM`. Both are normalised before `Date.parse`,
 * because engines disagree about how lenient to be with that form, and a parse that succeeds on one
 * runtime and returns `NaN` on another is the kind of difference that only shows up in production.
 */
function readRangeBound(raw: string): number | null | "invalid" {
	const text = unquoteBound(raw);
	if (text.length === 0 || text === "infinity" || text === "-infinity") return null;
	const iso = text.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? "invalid" : ms;
}

/** Split a range body on the bound separator, ignoring a comma inside a quoted bound. */
function splitRangeBounds(body: string): [string, string] | null {
	let quoted = false;
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (char === '"') quoted = !quoted;
		else if (char === "," && !quoted) return [body.slice(0, index), body.slice(index + 1)];
	}
	return null;
}

/**
 * Whether the LEGACY absolute `quiet_hours` range contains `nowMs`.
 *
 * This exists because `comms.fn_is_quiet_hours` checks `quiet_hours @> p_at` BEFORE it looks at
 * `quiet_hours_enabled` and returns true on a hit — so a row carrying only the legacy range is in
 * quiet hours as far as the engine is concerned while every recurring column says otherwise. A
 * modal that reported the toggle as off in that state would be describing a setting the platform is
 * not acting on.
 *
 * Bound inclusivity is honoured exactly (`[a,b)` contains x iff `a <= x < b`) because the
 * difference is a whole boundary instant and the engine does not round it off.
 *
 * Anything unreadable — a malformed range, an unparseable bound, the `empty` literal — returns
 * `false`. That is the fail-safe direction: it leaves the recurring columns as the sole authority
 * rather than flipping a suppression toggle on the strength of a string this code did not
 * understand.
 */
function legacyQuietHoursActive(raw: string | null | undefined, nowMs: number): boolean {
	if (!raw) return false;
	const text = raw.trim();
	if (text.length < 3 || text.toLowerCase() === "empty") return false;

	const open = text[0];
	const close = text[text.length - 1];
	if (open !== "[" && open !== "(") return false;
	if (close !== "]" && close !== ")") return false;

	const parts = splitRangeBounds(text.slice(1, -1));
	if (!parts) return false;

	const lower = readRangeBound(parts[0]);
	const upper = readRangeBound(parts[1]);
	if (lower === "invalid" || upper === "invalid") return false;

	if (lower !== null && (open === "[" ? nowMs < lower : nowMs <= lower)) return false;
	if (upper !== null && (close === "]" ? nowMs > upper : nowMs >= upper)) return false;
	return true;
}

// #endregion

// #region Mapping — notifications

/**
 * `comms.notification_prefs.muted_until` → the projection's `muteAll` boolean.
 *
 * One boolean against three states, resolved to match `fn_resolve_channels` exactly:
 *
 *  - `NULL` — never snoozed → `false`.
 *  - a FUTURE instant — the snooze is running → `true`.
 *  - a PAST instant — the snooze lapsed. The engine's predicate is `muted_until > now()`, so it is
 *    already delivering again; the row is ignored rather than deleted, and so is this → `false`.
 *
 * The projection is LOSSY in one direction that matters to the write path: a boolean cannot carry a
 * deadline, so a user who snoozed until Friday and then saves this modal has no way to express
 * Friday. That is a write-path concern rather than a read one, and it is recorded here because this
 * is where the information is dropped.
 */
function muteAllFrom(mutedUntil: string | null | undefined, nowMs: number): boolean {
	if (!mutedUntil) return false;
	const ms = Date.parse(mutedUntil);
	if (Number.isNaN(ms)) return false;
	return ms > nowMs;
}

/**
 * Whether one messaging event still reaches the inbox, resolved down the engine's own layer chain.
 *
 * `typeKeys` is the set of catalog keys the event corresponds to, and it is legitimately EMPTY for
 * `groupActivity` and `serviceInquiries` — see the module docblock. An empty set skips the mute
 * layer and resolves from the category, which is the honest answer for a control the engine has no
 * finer setting for.
 *
 * `categoryInApp` is `null` both when the category row is absent and when its `in_app` column is
 * NULL, because the engine's `COALESCE(v_cat.in_app, v_prefs.in_app)` treats those two identically.
 */
function eventEnabled(
	typeKeys: readonly string[],
	silencedKeys: ReadonlySet<string>,
	categoryInApp: boolean | null,
	globalInApp: boolean,
): boolean {
	for (const key of typeKeys) {
		if (silencedKeys.has(key)) return false;
	}
	return categoryInApp ?? globalInApp;
}

/** Assemble the notification half of the projection from the four reads. */
function toNotifications(
	prefs: PrefsRow | null,
	categoryInApp: boolean | null,
	silencedKeys: ReadonlySet<string>,
	nowMs: number,
): NotificationPreferences {
	const globalInApp = prefs?.in_app ?? PREFS_DEFAULTS.inApp;
	const recurringEnabled = prefs?.quiet_hours_enabled === true;

	return {
		newMessage: eventEnabled([TYPE_KEY_NEW_MESSAGE], silencedKeys, categoryInApp, globalInApp),
		mentions: eventEnabled([TYPE_KEY_MENTION], silencedKeys, categoryInApp, globalInApp),
		// No catalog key: the engine distinguishes event types, not conversation shapes.
		groupActivity: eventEnabled([], silencedKeys, categoryInApp, globalInApp),
		// No catalog key either: an inbound inquiry is emitted as an ordinary message event, and the
		// commercial intent behind it is not something the notification catalog models.
		serviceInquiries: eventEnabled([], silencedKeys, categoryInApp, globalInApp),
		sound: prefs?.sound ?? PREFS_DEFAULTS.sound,
		muteAll: muteAllFrom(prefs?.muted_until, nowMs),
		// The recurring toggle is authoritative; a currently-active legacy range flips it on anyway,
		// because the engine acts on that range regardless of this column.
		quietHoursEnabled: recurringEnabled || legacyQuietHoursActive(prefs?.quiet_hours, nowMs),
		// Sourced from the recurring columns ONLY. When quiet hours are on because of the legacy
		// absolute range, these stay empty: an instant range has no recurring wall-clock form, and
		// synthesising one would put a window on screen that the engine is not using.
		quietStart: toClockTime(prefs?.quiet_hours_start),
		quietEnd: toClockTime(prefs?.quiet_hours_end),
	};
}

// #endregion

// #region Queries

/**
 * The viewer's `comms.notification_prefs` row, or `null` when they have none.
 *
 * PRIMARY read: a genuine query failure throws, because every field on the notification half of the
 * projection would otherwise silently report a platform default as the user's own setting — a modal
 * showing "notifications on" to someone who turned them off is a lie the user acts on.
 *
 * A missing row is NOT a failure and is the ordinary state for an account that has never had an
 * event routed to it. `maybeSingle` keeps the two apart: `single` would turn "no row" into a thrown
 * PostgREST error indistinguishable from a broken connection.
 */
async function fetchPrefs(actor: ReadActor & { accessToken: string }): Promise<PrefsRow | null> {
	const { data, error } = await commsDb(actor)
		.from("notification_prefs")
		.select(PREFS_COLUMNS)
		.eq("user_id", actor.userId)
		.maybeSingle();

	if (error) throw new Error(`comms.notification_prefs read failed: ${error.message}`);
	return (data ?? null) as PrefsRow | null;
}

/**
 * The viewer's `in_app` override for the `messages` category, or `null` to inherit.
 *
 * SECONDARY read: a failure degrades to `null`, which is precisely what an absent row already
 * means, so the degradation costs nothing beyond an override the viewer may have set. Throwing
 * would take the whole modal down over one optional refinement.
 */
async function fetchCategoryInApp(
	actor: ReadActor & { accessToken: string },
): Promise<boolean | null> {
	const { data, error } = await commsDb(actor)
		.from("notification_category_prefs")
		.select("category, in_app")
		.eq("user_id", actor.userId)
		.eq("category", MESSAGES_CATEGORY)
		.maybeSingle();

	if (error) return null;
	const row = (data ?? null) as CategoryPrefRow | null;
	return row?.in_app ?? null;
}

/**
 * The catalog type keys whose in-app delivery the viewer has actively muted.
 *
 * The mute semantics are `fn_resolve_channels`'s, restated rather than approximated:
 *  - a mute is ACTIVE only while `muted_until IS NULL` (indefinite) or in the future;
 *  - `channels` NULL or empty means every transport, so the event is silenced;
 *  - a non-empty `channels` is transport-SCOPED — it suppresses only the transports it lists, so it
 *    silences this modal's toggles only when `in_app` is one of them.
 *
 * SECONDARY read: a failure degrades to an empty set. The direction is deliberate — an empty set is
 * what an unmuted account genuinely looks like, whereas assuming a mute would report an event as
 * off for someone who never turned it off.
 */
async function fetchSilencedTypeKeys(
	actor: ReadActor & { accessToken: string },
	nowMs: number,
): Promise<ReadonlySet<string>> {
	const silenced = new Set<string>();

	const { data, error } = await commsDb(actor)
		.from("notification_type_mutes")
		.select("type_key, muted_until, channels")
		.eq("user_id", actor.userId)
		.in("type_key", [TYPE_KEY_NEW_MESSAGE, TYPE_KEY_MENTION]);

	if (error) return silenced;

	for (const row of (data ?? []) as TypeMuteRow[]) {
		if (row.muted_until) {
			const until = Date.parse(row.muted_until);
			// An unparseable deadline is treated as lapsed rather than indefinite: a mute this code
			// cannot read must not silence a toggle the user can no longer explain.
			if (Number.isNaN(until) || until <= nowMs) continue;
		}
		const channels = row.channels ?? [];
		if (channels.length === 0 || channels.includes(IN_APP_CHANNEL)) silenced.add(row.type_key);
	}
	return silenced;
}

/**
 * The viewer's auto-response rules, oldest first.
 *
 * PRIMARY read, and deliberately not degraded to `[]` the way a party lookup degrades to "Unknown".
 * An empty rule list is indistinguishable from a real empty rule list, so a swallowed failure would
 * invite the user to re-create rules that already exist — and two copies of a greeting rule means
 * every inbound client message gets answered twice.
 *
 * Ordered on `created_at` with `id` as the tiebreaker, because the PK is a v4 uuid: two rules
 * written inside the same clock tick would otherwise reorder themselves between reads.
 */
async function fetchAutoResponses(
	actor: ReadActor & { accessToken: string },
): Promise<AutoResponseRule[]> {
	const { data, error } = await commsDb(actor)
		.from("auto_responses")
		.select(AUTO_RESPONSE_COLUMNS)
		.eq("user_id", actor.userId)
		.order("created_at", { ascending: true })
		.order("id", { ascending: true })
		.limit(AUTO_RESPONSE_CAP);

	if (error) throw new Error(`comms.auto_responses read failed: ${error.message}`);

	const rules: AutoResponseRule[] = [];
	for (const row of (data ?? []) as unknown as AutoResponseRow[]) {
		const rule = toRule(row);
		if (rule) rules.push(rule);
	}
	return rules;
}

/**
 * The viewer's Message Settings, or `null` when the actor carries no identity.
 *
 * `null` is returned for exactly one case: an actor with an empty `userId`. Every table here is
 * keyed on a user, so "nobody's settings" is not a row that can exist, and returning platform
 * defaults for an anonymous caller would present a blank slate as though it were theirs. Every
 * other absence — no `notification_prefs` row, no category override, no mutes, no rules — is a real
 * and ordinary state that resolves to the documented defaults rather than to `null`.
 *
 * A genuine query failure on either primary table throws with the table name; the calling service
 * catches it, logs it, and falls back to the fixture corpus.
 *
 * @param actor The RLS-scoped identity the read runs as.
 * @param _role Accepted for signature parity with the fixture path (`findSettings(role)`) and
 * deliberately NOT read. The fixtures use it to seed plausible rules per acting view; live, the
 * rules are the rows the user actually wrote, and branching on a chrome hint would hide a client's
 * own auto-response rule from them because the shell currently says "client".
 */
export async function fetchMessagingSettings(
	actor: ReadActor & { accessToken: string },
	_role?: MessagingRole,
): Promise<MessagingSettings | null> {
	if (!actor.userId) return null;

	// One clock for the whole projection. Three things here are time-dependent (`muteAll`, the legacy
	// quiet-hours window, and every mute deadline); sampling `Date.now()` separately in each would let
	// a read straddle a boundary instant and report a mute as both active and lapsed.
	const nowMs = Date.now();

	// Four independent reads over the same user. Issued together rather than in series: none depends
	// on another's result, and awaiting them sequentially would add all four latencies to a modal
	// open. The two secondary reads swallow their own errors, so a rejection here is always one of
	// the two primaries.
	const [prefs, autoResponses, categoryInApp, silencedKeys] = await Promise.all([
		fetchPrefs(actor),
		fetchAutoResponses(actor),
		fetchCategoryInApp(actor),
		fetchSilencedTypeKeys(actor, nowMs),
	]);

	return {
		autoResponsesEnabled: prefs?.auto_responses_enabled ?? PREFS_DEFAULTS.autoResponsesEnabled,
		autoResponses,
		notifications: toNotifications(prefs, categoryInApp, silencedKeys, nowMs),
		readReceipts: prefs?.read_receipts ?? PREFS_DEFAULTS.readReceipts,
		showTypingIndicator: prefs?.show_typing_indicator ?? PREFS_DEFAULTS.showTypingIndicator,
	};
}

// #endregion
