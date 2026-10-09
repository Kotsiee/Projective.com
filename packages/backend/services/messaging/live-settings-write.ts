import { NotificationChannel } from "@projective/types/comms";
import type {
	AutoResponseRule,
	MessagingSettings,
	NotificationPreferences,
} from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import type { WriteRefusal } from "../projects/live-writes.ts";
import { commsDb, UUID_RE } from "../projects/live-support.ts";
import {
	AUTO_RESPONSE_CAP,
	type AutoResponseRow,
	autoResponseWindow,
	IN_APP_CHANNEL,
	legacyQuietHoursActive,
	MESSAGES_CATEGORY,
	muteActive,
	muteAllFrom,
	PREFS_DEFAULTS,
	silencesInApp,
	toRule,
	TYPE_KEY_MENTION,
	TYPE_KEY_NEW_MESSAGE,
	type TypeMuteRow,
} from "./live-settings.ts";

/**
 * live-settings-write — the RLS-scoped Postgres write path for `MessagingBackendService.saveSettings`.
 *
 * It is the INVERSE of `live-settings.ts`, and it is held to that literally: every column written
 * here is one the reader decodes, through the reader's own exported predicates, so a save followed
 * by a read returns what was saved. Where the reader's mapping is many-to-one — four toggles over
 * three switches, a boolean over a deadline — the inverse has to choose, and each choice below is
 * made in one direction: **a save never silences anything the person left on.**
 *
 * ## The mapping
 *
 * | Setting                     | Written to                                                       |
 * | :-------------------------- | :--------------------------------------------------------------- |
 * | `sound`                     | `notification_prefs.sound`                                       |
 * | `readReceipts`              | `notification_prefs.read_receipts`                               |
 * | `showTypingIndicator`       | `notification_prefs.show_typing_indicator`                       |
 * | `autoResponsesEnabled`      | `notification_prefs.auto_responses_enabled`                      |
 * | `muteAll`                   | `notification_prefs.muted_until` (see {@link planPrefs})         |
 * | `quietHours*`               | `notification_prefs.quiet_hours_enabled/_start/_end` (+ legacy)  |
 * | the four event toggles      | `notification_category_prefs(messages).in_app` (see below)       |
 * | `newMessage` / `mentions`   | `notification_type_mutes(message.new / message.mention)`        |
 * | `autoResponses[]`           | `comms.auto_responses`, replace-set over the modal's window      |
 *
 * `notification_prefs.in_app` — the platform-wide inbox toggle — is never written. It belongs to the
 * notification centre; this modal governs the `messages` category over it.
 *
 * ## The event toggles
 *
 * The reader resolves `groupActivity` and `serviceInquiries` from the `messages` category layer
 * alone, and `newMessage` / `mentions` from that layer AND a per-type mute. So the category is ON
 * whenever ANY of the four is on ({@link categoryTarget}), and the two catalog-keyed toggles that are
 * off become `in_app` mutes. Two consequences, both deliberate:
 *
 *  - `groupActivity` and `serviceInquiries` cannot differ in storage. A save with one on and one off
 *    keeps the category on, and both read back on. Turning the category OFF instead would silence new
 *    messages and mentions the person had left on — the one outcome this module refuses.
 *  - The toggles govern the inbox only (`in_app`), because that is all the reader reports. A mute
 *    written here leaves push/email for the same event where they were.
 *
 * ## Not atomic
 *
 * One save is several PostgREST requests, not one transaction (there is no RPC for it). They are
 * ordered so a failure part-way loses nothing: preferences first, then mutes, then rule updates and
 * inserts, and rule deletions LAST — a failure never removes a rule before its replacements landed.
 * The caller invalidates the read cache on every outcome, so the next read shows what did land.
 */

// #region Constants

/**
 * What `muteAll: true` writes when no snooze is already running — a FINITE far-future instant.
 *
 * Not `'infinity'`: Postgres accepts it, but PostgREST renders it as the string `infinity`, which
 * `Date.parse` cannot read, so the reader's `muteAllFrom` would decode it as "not muted" and the
 * toggle would snap back off on the very save that turned it on.
 */
export const INDEFINITE_SNOOZE_UNTIL = "9999-12-31T23:59:59.000Z";

/**
 * Every transport, in enum order. A mute with `channels` NULL or empty covers ALL of these (the
 * router returns no channels at all), so lifting `in_app` out of such a mute has to list the rest
 * explicitly — writing an empty array instead would mean "every transport" again.
 */
const ALL_CHANNELS: readonly string[] = NotificationChannel.options;

/** The two catalog keys the modal reaches through the mute layer, and the toggle each one inverts. */
const EVENT_TYPE_KEYS = [
	{ typeKey: TYPE_KEY_NEW_MESSAGE, field: "newMessage" },
	{ typeKey: TYPE_KEY_MENTION, field: "mentions" },
] as const;

/** The CHECK that keeps an enabled recurring quiet-hours window complete. */
const QUIET_HOURS_CONSTRAINT = "notification_prefs_quiet_hours_complete";

/** The sentence for a quiet-hours bound that is not a clock time. */
const CLOCK_SENTENCE = "Enter a time as HH:MM.";

// #endregion

// #region Plan shapes

/** The `comms.notification_prefs` columns a write is planned against. */
export interface StoredPrefs {
	in_app: boolean | null;
	muted_until: string | null;
	/** The legacy absolute `tstzrange`, in Postgres text form. */
	quiet_hours: string | null;
}

/** Everything the plan depends on, read under the caller's JWT just before writing. */
export interface StoredSettings {
	/** `null` when the person has no `notification_prefs` row. */
	prefs: StoredPrefs | null;
	/** The `messages` category's `in_app`; `null` for an absent row or a NULL column alike. */
	categoryInApp: boolean | null;
	/** The person's mutes on `message.new` / `message.mention`, lapsed ones included. */
	mutes: readonly TypeMuteRow[];
	/** The rows of the reader's auto-response window, unfiltered. */
	rules: readonly AutoResponseRow[];
}

/** What happens to the `messages` category row. `inherit` writes NULL (follow the global toggle). */
export type CategoryWrite =
	| { kind: "keep" }
	| { kind: "inherit" }
	| { kind: "set"; inApp: boolean };

/** What happens to one `notification_type_mutes` row. */
export type MuteWrite =
	| { kind: "keep" }
	| { kind: "delete" }
	| { kind: "upsert"; mutedUntil: string | null; channels: string[] };

/** One `comms.auto_responses` row's writable columns. */
export interface AutoResponseColumns {
	enabled: boolean;
	name: string;
	trigger: AutoResponseRule["trigger"];
	service_id: string | null;
	product_id: string | null;
	keyword: string | null;
	status_condition: AutoResponseRule["statusCondition"];
	starts_at: string | null;
	ends_at: string | null;
	message: string;
	ai_assist: boolean;
}

/** The rule writes, in the order they are applied (updates, inserts, then removals). */
export interface RulesWrite {
	update: { id: string; columns: AutoResponseColumns }[];
	insert: AutoResponseColumns[];
	remove: string[];
}

/** Every write one save expands to. `prefs` is always upserted; `mutes` lists only real changes. */
export interface SettingsWritePlan {
	prefs: Record<string, unknown>;
	category: CategoryWrite;
	mutes: { typeKey: string; write: MuteWrite }[];
	rules: RulesWrite;
}

/** A plan, or the field errors (keyed by request path) that stop one being made. */
export type SettingsPlanResult =
	| { plan: SettingsWritePlan }
	| { errors: Record<string, string> };

// #endregion

// #region Planning — notification_prefs

/**
 * A quiet-hours bound → the `HH:MM` stored in a `time` column, `null` for the empty string, or
 * `"invalid"`.
 *
 * The empty string is the reader's encoding of a NULL bound (`NO_CLOCK_TIME`), so it writes NULL.
 * The accepted form is the reader's own (`H:MM` or `HH:MM`) re-emitted zero-padded, so what is
 * stored reads back as exactly this string.
 */
export function parseClockTime(raw: string): string | null | "invalid" {
	const text = raw.trim();
	if (text.length === 0) return null;
	const match = /^(\d{1,2}):(\d{2})$/.exec(text);
	if (!match) return "invalid";
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return "invalid";
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * The `comms.notification_prefs` columns one save sets.
 *
 * **`muteAll`** inverts `muteAllFrom` (`muted_until > now`). Turning it on when a snooze is ALREADY
 * running leaves that deadline alone — a person who snoozed until Friday elsewhere and saves this
 * modal keeps Friday — and otherwise writes {@link INDEFINITE_SNOOZE_UNTIL}. Turning it off clears
 * a running snooze; a lapsed one already reads as off and is left as the router leaves it.
 *
 * **Quiet hours** write the recurring columns, and the CHECK `notification_prefs_quiet_hours_complete`
 * is enforced here as a 422 before Postgres sees it: an enabled window needs both bounds. Two cases
 * involve the LEGACY absolute `quiet_hours` range, which the reader ORs into `quietHoursEnabled`:
 *
 *  - off → the legacy range is cleared too, or it would keep the toggle (and the router) on;
 *  - on with no bounds while a legacy range is active → that is exactly the state the reader
 *    projects for a legacy-only row, so it is written back as it was rather than refused.
 */
export function planPrefs(
	settings: MessagingSettings,
	stored: StoredPrefs | null,
	nowMs: number,
	errors: Record<string, string>,
): Record<string, unknown> {
	const n = settings.notifications;
	const columns: Record<string, unknown> = {
		sound: n.sound,
		read_receipts: settings.readReceipts,
		show_typing_indicator: settings.showTypingIndicator,
		auto_responses_enabled: settings.autoResponsesEnabled,
	};

	const snoozing = muteAllFrom(stored?.muted_until, nowMs);
	if (n.muteAll && !snoozing) columns.muted_until = INDEFINITE_SNOOZE_UNTIL;
	if (!n.muteAll && snoozing) columns.muted_until = null;

	const start = parseClockTime(n.quietStart);
	const end = parseClockTime(n.quietEnd);
	if (start === "invalid") errors["notifications.quietStart"] = CLOCK_SENTENCE;
	if (end === "invalid") errors["notifications.quietEnd"] = CLOCK_SENTENCE;
	if (start === "invalid" || end === "invalid") return columns;

	if (!n.quietHoursEnabled) {
		columns.quiet_hours_enabled = false;
		columns.quiet_hours_start = start;
		columns.quiet_hours_end = end;
		columns.quiet_hours = null;
	} else if (start !== null && end !== null) {
		columns.quiet_hours_enabled = true;
		columns.quiet_hours_start = start;
		columns.quiet_hours_end = end;
	} else if (
		start === null && end === null && legacyQuietHoursActive(stored?.quiet_hours, nowMs)
	) {
		columns.quiet_hours_enabled = false;
		columns.quiet_hours_start = null;
		columns.quiet_hours_end = null;
	} else {
		if (start === null) errors["notifications.quietStart"] = "Choose when quiet hours start.";
		if (end === null) errors["notifications.quietEnd"] = "Choose when quiet hours end.";
	}
	return columns;
}

// #endregion

// #region Planning — the event toggles

/** Whether the `messages` category must deliver to the inbox: on while ANY event toggle is on. */
export function categoryTarget(n: NotificationPreferences): boolean {
	return n.newMessage || n.mentions || n.groupActivity || n.serviceInquiries;
}

/**
 * The `messages` category write that makes its effective `in_app` equal `target`.
 *
 * Nothing is written when it already resolves there (`COALESCE(category, global)`). Otherwise the
 * row follows the global toggle (NULL) when that gives `target`, and overrides it only when it must
 * — so a later change to the global inbox toggle still reaches messages unless this modal disagreed.
 */
export function planCategory(
	target: boolean,
	categoryInApp: boolean | null,
	globalInApp: boolean,
): CategoryWrite {
	if ((categoryInApp ?? globalInApp) === target) return { kind: "keep" };
	return target === globalInApp ? { kind: "inherit" } : { kind: "set", inApp: target };
}

/**
 * The write that makes one catalog key's inbox delivery `wantEnabled`, touching only `in_app`.
 *
 *  - Enabling a silenced key lifts `in_app` out of its mute and keeps every other transport and the
 *    deadline; a mute left covering nothing is deleted (an EMPTY `channels` would mean "all").
 *  - Disabling adds `in_app` to an active transport-scoped mute, deadline kept; with no active mute
 *    it writes an indefinite in-app-only one. A lapsed row is overwritten rather than revived.
 */
export function planMute(
	existing: TypeMuteRow | undefined,
	wantEnabled: boolean,
	nowMs: number,
): MuteWrite {
	const silenced = existing !== undefined && silencesInApp(existing, nowMs);
	if (wantEnabled) {
		if (!silenced) return { kind: "keep" };
		const listed = existing.channels ?? [];
		const covered = listed.length === 0 ? ALL_CHANNELS : listed;
		const remaining = covered.filter((channel) => channel !== IN_APP_CHANNEL);
		if (remaining.length === 0) return { kind: "delete" };
		return { kind: "upsert", mutedUntil: existing.muted_until, channels: remaining };
	}
	if (silenced) return { kind: "keep" };
	if (existing !== undefined && muteActive(existing, nowMs)) {
		return {
			kind: "upsert",
			mutedUntil: existing.muted_until,
			channels: [...(existing.channels ?? []), IN_APP_CHANNEL],
		};
	}
	return { kind: "upsert", mutedUntil: null, channels: [IN_APP_CHANNEL] };
}

// #endregion

// #region Planning — auto-responses

/**
 * One rule → its row columns, or `null` with field errors recorded under `path`.
 *
 * The inverse of the reader's `toRule`, with its normalisation applied up front so the stored value
 * reads back unchanged: `name`, `message` and `keyword` are trimmed, a uuid is lower-cased. Only the
 * scope column the trigger names is written — `auto_responses_scope_check` makes every other
 * combination unrepresentable — so a stray `serviceId` on an `any` rule is dropped, not refused.
 * `serviceName` / `productName` have no column and are not written; the reader returns them null.
 *
 * A body that is only whitespace is refused rather than stored: the reader drops a rule with no
 * body, so saving one would lose the rule silently.
 */
export function ruleColumns(
	rule: AutoResponseRule,
	path: string,
	errors: Record<string, string>,
): AutoResponseColumns | null {
	const before = Object.keys(errors).length;
	const name = rule.name.trim();
	const message = rule.message.trim();
	if (name.length === 0) errors[`${path}.name`] = "Give this rule a name.";
	if (message.length === 0) errors[`${path}.message`] = "Write the reply this rule sends.";

	let serviceId: string | null = null;
	let productId: string | null = null;
	let keyword: string | null = null;
	let statusCondition: AutoResponseRule["statusCondition"] = null;
	switch (rule.trigger) {
		case "service":
			if (rule.serviceId && UUID_RE.test(rule.serviceId)) serviceId = rule.serviceId.toLowerCase();
			else if (rule.serviceId) errors[`${path}.serviceId`] = "Choose one of your services.";
			break;
		case "product":
			if (rule.productId && UUID_RE.test(rule.productId)) productId = rule.productId.toLowerCase();
			else if (rule.productId) errors[`${path}.productId`] = "Choose one of your products.";
			break;
		case "keyword": {
			const text = rule.keyword?.trim() ?? "";
			if (text.length > 0) keyword = text;
			else errors[`${path}.keyword`] = "Enter the keyword this rule listens for.";
			break;
		}
		case "status":
			if (rule.statusCondition) statusCondition = rule.statusCondition;
			else errors[`${path}.statusCondition`] = "Choose when this reply is sent.";
			break;
		case "project_invitation":
		case "any":
			break;
	}

	const startsAt = instantOrNull(rule.startsAt);
	const endsAt = instantOrNull(rule.endsAt);
	if (rule.startsAt && startsAt === null) errors[`${path}.startsAt`] = "Enter a valid start date.";
	if (rule.endsAt && endsAt === null) errors[`${path}.endsAt`] = "Enter a valid end date.";
	if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
		errors[`${path}.endsAt`] = "End after it starts.";
	}
	if (statusCondition === "holiday" && (!startsAt || !endsAt)) {
		errors[`${path}.startsAt`] = "A holiday reply needs its first and last day.";
	}

	if (Object.keys(errors).length > before) return null;
	return {
		enabled: rule.enabled,
		name,
		trigger: rule.trigger,
		service_id: serviceId,
		product_id: productId,
		keyword,
		status_condition: statusCondition,
		starts_at: startsAt,
		ends_at: endsAt,
		message,
		ai_assist: rule.aiAssist,
	};
}

/** An ISO instant normalised to `toISOString()`, or `null` for an empty or unparseable value. */
function instantOrNull(value: string | null): string | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Two instants that are the same moment, however each was written (or both absent). */
function sameInstant(stored: string | null | undefined, next: string | null): boolean {
	if (!stored || !next) return !stored && !next;
	return Date.parse(stored) === Date.parse(next);
}

/** Whether a stored row already holds exactly these columns (an unchanged rule is not rewritten). */
function sameColumns(row: AutoResponseRow, columns: AutoResponseColumns): boolean {
	return row.enabled === columns.enabled &&
		row.name === columns.name &&
		row.trigger === columns.trigger &&
		(row.service_id ?? null) === columns.service_id &&
		(row.product_id ?? null) === columns.product_id &&
		(row.keyword ?? null) === columns.keyword &&
		(row.status_condition ?? null) === columns.status_condition &&
		sameInstant(row.starts_at, columns.starts_at) &&
		sameInstant(row.ends_at, columns.ends_at) &&
		row.message === columns.message &&
		row.ai_assist === columns.ai_assist;
}

/**
 * Replace-set the rules against the WINDOW the modal was shown — the reader's capped query, after
 * its drop rule. A rule whose id is in the window updates that row (only if it changed); any other
 * id — the editor's `ar-custom-N`, or a uuid that is not one of the window's rows — inserts a new
 * row with a database-minted id; a window row the save no longer lists is deleted.
 *
 * Rows OUTSIDE the window (past the cap, or with an empty body the reader drops) are never deleted:
 * their absence from the save says nothing about them, because the person was never shown them.
 */
export function planRules(
	rules: readonly AutoResponseRule[],
	storedRows: readonly AutoResponseRow[],
	errors: Record<string, string>,
): RulesWrite {
	const write: RulesWrite = { update: [], insert: [], remove: [] };
	if (rules.length > AUTO_RESPONSE_CAP) {
		errors.autoResponses = `Keep it to ${AUTO_RESPONSE_CAP} auto-responses or fewer.`;
		return write;
	}

	const shownRows = new Map<string, AutoResponseRow>();
	for (const row of storedRows) {
		const shown = toRule(row);
		if (shown) shownRows.set(shown.id, row);
	}

	const listed = new Set<string>();
	rules.forEach((rule, index) => {
		const path = `autoResponses.${index}`;
		if (listed.has(rule.id)) {
			errors[`${path}.id`] = "This rule appears twice.";
			return;
		}
		listed.add(rule.id);
		const columns = ruleColumns(rule, path, errors);
		if (!columns) return;
		const row = shownRows.get(rule.id);
		if (!row) write.insert.push(columns);
		else if (!sameColumns(row, columns)) write.update.push({ id: row.id, columns });
	});

	for (const [id, row] of shownRows) {
		if (!listed.has(id)) write.remove.push(row.id);
	}
	return write;
}

// #endregion

// #region Planning — the whole save

/** Expand one save into its {@link SettingsWritePlan}, or the field errors that refuse it. */
export function planSettingsWrite(
	settings: MessagingSettings,
	stored: StoredSettings,
	nowMs: number,
): SettingsPlanResult {
	const errors: Record<string, string> = {};
	const prefs = planPrefs(settings, stored.prefs, nowMs, errors);

	const target = categoryTarget(settings.notifications);
	const globalInApp = stored.prefs?.in_app ?? PREFS_DEFAULTS.inApp;
	const category = planCategory(target, stored.categoryInApp, globalInApp);

	// With the category off every event reads off whatever the mutes say, so they are left exactly as
	// they are — a later "category on" from the notification centre then restores what was there.
	const mutes = target
		? EVENT_TYPE_KEYS
			.map(({ typeKey, field }) => ({
				typeKey,
				write: planMute(
					stored.mutes.find((row) => row.type_key === typeKey),
					settings.notifications[field],
					nowMs,
				),
			}))
			.filter((entry) => entry.write.kind !== "keep")
		: [];

	const rules = planRules(settings.autoResponses, stored.rules, errors);

	if (Object.keys(errors).length > 0) return { errors };
	return { plan: { prefs, category, mutes, rules } };
}

// #endregion

// #region Write errors

/** The parts of a PostgREST error the mapping reads. */
interface WriteError {
	code?: string;
	message?: string;
	details?: string | null;
}

/**
 * Map a failed write to the refusal the person sees, or throw for an outage (the service turns a
 * throw into a 502). An expired session is a 401 so the client's `apiFetch` refreshes and retries.
 */
function refusalOrThrow(error: WriteError, table: string): WriteRefusal {
	const text = `${error.message ?? ""} ${error.details ?? ""}`;
	if (error.code === "23514" && text.includes(QUIET_HOURS_CONSTRAINT)) {
		const sentence = "Quiet hours need a start and an end.";
		return { status: 422, message: sentence, errors: { "notifications.quietStart": sentence } };
	}
	if (error.code === "23503" && table === "auto_responses") {
		const sentence = "An auto-response names a service that no longer exists.";
		return { status: 422, message: sentence, errors: { autoResponses: sentence } };
	}
	if (
		error.code === "23514" || error.code === "23502" || error.code === "22P02" ||
		error.code === "22007" || error.code === "22008"
	) {
		return { status: 422, message: "Those settings can't be saved together." };
	}
	if (error.code === "42501") {
		return { status: 403, message: "You can only change your own settings." };
	}
	if (error.code === "PGRST301" || error.code === "PGRST303") {
		return { status: 401, message: "Your session has expired. Please sign in again." };
	}
	throw new Error(`comms.${table} write failed: ${error.message ?? "unknown error"}`);
}

// #endregion

// #region Queries

/**
 * Read everything {@link planSettingsWrite} needs. Every failure THROWS: planning against a state
 * that could not be read would write over it blind — upserting a mute whose transports were never
 * seen, or deleting rules that were.
 */
async function fetchStoredSettings(
	actor: ReadActor & { accessToken: string },
): Promise<StoredSettings> {
	const db = commsDb(actor);
	const [prefs, category, mutes, rules] = await Promise.all([
		db.from("notification_prefs")
			.select("in_app, muted_until, quiet_hours")
			.eq("user_id", actor.userId)
			.maybeSingle(),
		db.from("notification_category_prefs")
			.select("in_app")
			.eq("user_id", actor.userId)
			.eq("category", MESSAGES_CATEGORY)
			.maybeSingle(),
		db.from("notification_type_mutes")
			.select("type_key, muted_until, channels")
			.eq("user_id", actor.userId)
			.in("type_key", [TYPE_KEY_NEW_MESSAGE, TYPE_KEY_MENTION]),
		autoResponseWindow(actor),
	]);

	if (prefs.error) throw new Error(`comms.notification_prefs read failed: ${prefs.error.message}`);
	if (category.error) {
		throw new Error(`comms.notification_category_prefs read failed: ${category.error.message}`);
	}
	if (mutes.error) {
		throw new Error(`comms.notification_type_mutes read failed: ${mutes.error.message}`);
	}
	if (rules.error) throw new Error(`comms.auto_responses read failed: ${rules.error.message}`);

	const categoryRow = (category.data ?? null) as { in_app: boolean | null } | null;
	return {
		prefs: (prefs.data ?? null) as StoredPrefs | null,
		categoryInApp: categoryRow?.in_app ?? null,
		mutes: (mutes.data ?? []) as TypeMuteRow[],
		rules: (rules.data ?? []) as unknown as AutoResponseRow[],
	};
}

/** Apply a plan, in the order the module docblock gives. `null` = every write landed. */
async function applyPlan(
	actor: ReadActor & { accessToken: string },
	plan: SettingsWritePlan,
	nowMs: number,
): Promise<WriteRefusal | null> {
	const db = commsDb(actor);
	const userId = actor.userId;

	const prefs = await db.from("notification_prefs")
		.upsert({ user_id: userId, ...plan.prefs }, { onConflict: "user_id" });
	if (prefs.error) return refusalOrThrow(prefs.error, "notification_prefs");

	if (plan.category.kind !== "keep") {
		const { error } = plan.category.kind === "set"
			? await db.from("notification_category_prefs").upsert(
				{ user_id: userId, category: MESSAGES_CATEGORY, in_app: plan.category.inApp },
				{ onConflict: "user_id,category" },
			)
			: await db.from("notification_category_prefs")
				.update({ in_app: null })
				.eq("user_id", userId)
				.eq("category", MESSAGES_CATEGORY);
		if (error) return refusalOrThrow(error, "notification_category_prefs");
	}

	for (const { typeKey, write } of plan.mutes) {
		if (write.kind === "keep") continue;
		const { error } = write.kind === "delete"
			? await db.from("notification_type_mutes")
				.delete()
				.eq("user_id", userId)
				.eq("type_key", typeKey)
			: await db.from("notification_type_mutes").upsert(
				{
					user_id: userId,
					type_key: typeKey,
					muted_until: write.mutedUntil,
					channels: write.channels,
				},
				{ onConflict: "user_id,type_key" },
			);
		if (error) return refusalOrThrow(error, "notification_type_mutes");
	}

	// `comms.auto_responses` has no touch trigger, so an update stamps `updated_at` itself.
	const updatedAt = new Date(nowMs).toISOString();
	for (const { id, columns } of plan.rules.update) {
		const { error } = await db.from("auto_responses")
			.update({ ...columns, updated_at: updatedAt })
			.eq("user_id", userId)
			.eq("id", id);
		if (error) return refusalOrThrow(error, "auto_responses");
	}

	if (plan.rules.insert.length > 0) {
		const { error } = await db.from("auto_responses")
			.insert(plan.rules.insert.map((columns) => ({ user_id: userId, ...columns })));
		if (error) return refusalOrThrow(error, "auto_responses");
	}

	if (plan.rules.remove.length > 0) {
		const { error } = await db.from("auto_responses")
			.delete()
			.eq("user_id", userId)
			.in("id", plan.rules.remove);
		if (error) return refusalOrThrow(error, "auto_responses");
	}

	return null;
}

/**
 * Persist the viewer's Message Settings under their own JWT.
 *
 * Returns `null` when every write landed, or the refusal that stopped it: a 422 with field errors
 * (keyed by request path, e.g. `notifications.quietStart`, `autoResponses.2.message`) for a save the
 * schema accepts but the tables cannot hold, a 401/403 for a session or policy refusal. An outage
 * THROWS. The caller re-reads through `fetchMessagingSettings` to return what is now stored.
 *
 * @param actor The RLS-scoped identity; every row written carries its `userId`, and every policy on
 * these tables is `user_id = auth.uid()`, so a token for anyone else writes nothing.
 * @param settings The full projection, already parsed by `MessagingSettingsSchema`.
 */
export async function saveLiveSettings(
	actor: ReadActor & { accessToken: string },
	settings: MessagingSettings,
): Promise<WriteRefusal | null> {
	// One clock for planning and stamping, as the reader samples one clock per projection.
	const nowMs = Date.now();
	const stored = await fetchStoredSettings(actor);
	const planned = planSettingsWrite(settings, stored, nowMs);
	if ("errors" in planned) {
		return { status: 422, message: "Check the highlighted settings.", errors: planned.errors };
	}
	return await applyPlan(actor, planned.plan, nowMs);
}

// #endregion
