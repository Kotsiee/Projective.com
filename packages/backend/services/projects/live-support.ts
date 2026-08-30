import type { SupabaseClient } from "supabaseClient";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import type { ProjectStatus } from "@projective/types/projects";

/**
 * live-support — the plumbing every live read in this domain shares, and the single place each
 * schema/contract contradiction is resolved.
 *
 * ## Why the contradictions live here rather than at their call sites
 *
 * Ten endpoints project overlapping slices of the same tables, and every one of them hits the same
 * handful of disagreements between the Postgres enums and the Zod SSOT. Resolving them per-endpoint
 * would mean ten chances to spell `revisions_requested` the way Zod does rather than the way the
 * database does — and that particular mistake does not fail loudly. It fails as a Zod parse error on
 * the first row of a state the fixtures never produce, or, worse, as a value that parses and means
 * something else.
 *
 * So each mapping below is written once, next to the evidence for it, and named after the question
 * it answers rather than the table it came from.
 *
 * ## The truncation contract
 *
 * Every free-text column in this schema is unbounded `text`; almost every Zod field that carries one
 * is bounded and THROWS rather than truncating. A single long description therefore fails an entire
 * page read. {@link clamp} is applied at the mapping boundary — not at the call site — so a new
 * consumer inherits it instead of having to remember it.
 */

// #region Clients

/** An RLS-scoped client on the `projects` schema profile. */
export function projectsDb(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("projects") as unknown as SupabaseClient;
}

/** An RLS-scoped client on the `org` schema profile. */
export function orgDb(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("org") as unknown as SupabaseClient;
}

/** An RLS-scoped client on the `comms` schema profile. */
export function commsDb(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("comms") as unknown as SupabaseClient;
}

/** An RLS-scoped client on the `files` schema profile. */
export function filesDb(actor: ReadActor & { accessToken: string }): SupabaseClient {
	return getUserClient(actor.accessToken).schema("files") as unknown as SupabaseClient;
}

// #endregion

// #region Text

/**
 * Clamp a string to a Zod `.max()` bound, tolerating null.
 *
 * Returns `""` for absent input. Callers that need `min(1)` must supply their own fallback — an
 * empty string is a legitimate value for an optional field and a parse failure for a required one,
 * and this function cannot know which it is looking at.
 */
export function clamp(value: string | null | undefined, max: number): string {
	if (!value) return "";
	return value.length <= max ? value : value.slice(0, max);
}

/** Clamp, falling back to `fallback` when the result would be empty. For `min(1)` fields. */
export function clampOr(value: string | null | undefined, max: number, fallback: string): string {
	const out = clamp(value, max).trim();
	return out.length > 0 ? out : fallback;
}

// #endregion

// #region Parties

/** An `org.users_public` row. Column names verified against `00000011_tables_org.sql`. */
export interface PartyRow {
	user_id: string;
	username: string;
	first_name: string | null;
	last_name: string | null;
}

/** The `org.users_public` columns a display party needs. There is no `display_name` or `avatar_url`. */
export const PARTY_COLUMNS = "user_id, username, first_name, last_name";

/**
 * A display name from a party row.
 *
 * Falls through composed → username → `"Unknown"` because every name field in these projections is
 * `min(1)`: an empty string is not a value they can carry, so the absence has to be spelled. That
 * absence is a real state — RLS can withhold a public profile row from a viewer who can still see
 * the project the person is working on.
 */
export function partyName(row: PartyRow | undefined | null): string {
	if (!row) return "Unknown";
	const composed = [row.first_name, row.last_name]
		.map((part) => part?.trim() ?? "")
		.filter((part) => part.length > 0)
		.join(" ");
	return composed || row.username.trim() || "Unknown";
}

/**
 * The shape shared by `ProjectParty`, `MessageSender` and `AssetActor` — three near-identical person
 * projections that differ only in whether they carry an `id`.
 *
 * `avatar` is always `null`. `org.users_public.avatar_file_id` is a FK into `files.items`, not a
 * URL, and composing a served path from it belongs to the files domain behind its own gate. A
 * guessed path renders as a broken image on every row, which is worse than the initials fallback
 * the `Avatar` component already draws.
 */
export function partyOf(row: PartyRow | undefined | null): {
	name: string;
	avatar: null;
	handle: string | null;
} {
	return { name: partyName(row), avatar: null, handle: row?.username ?? null };
}

/** {@link partyOf} plus the `id` that `MessageSender` and `AssetActor` additionally require. */
export function senderOf(userId: string, row: PartyRow | undefined | null): {
	id: string;
	name: string;
	avatar: null;
	handle: string | null;
} {
	return { id: userId, ...partyOf(row) };
}

/**
 * Resolve display parties for a set of user ids.
 *
 * A failure or a partial result is NOT an error: every consumer degrades a missing id to the
 * "Unknown" placeholder, and a page that renders with one unnamed person is strictly better than a
 * page that 500s because one public profile row was withheld.
 */
export async function fetchParties(
	actor: ReadActor & { accessToken: string },
	userIds: readonly (string | null | undefined)[],
): Promise<Map<string, PartyRow>> {
	const out = new Map<string, PartyRow>();
	const unique = [...new Set(userIds.filter((id): id is string => !!id && id.length > 0))];
	if (unique.length === 0) return out;
	const { data, error } = await orgDb(actor)
		.from("users_public")
		.select(PARTY_COLUMNS)
		.in("user_id", unique);
	if (error) return out;
	for (const row of (data ?? []) as PartyRow[]) out.set(row.user_id, row);
	return out;
}

// #endregion

// #region Enum reconciliation

/**
 * `projects.stage_submissions.status` → the Zod `SubmissionStatus`.
 *
 * **The database spells it `revisions_requested`; the Zod enum spells it `revision_requested`.**
 * Singular against plural, one character apart, and nothing in either file points at the other. On
 * the live path every revision row would fail `SubmissionStatusSchema.parse` — which is a thrown
 * page read, not a missing badge.
 *
 * Compounding it, the column is NULLABLE and a SQL CHECK is NULL-tolerant, so an explicit NULL is
 * storable, satisfies the constraint, and fails the required Zod field. A NULL is mapped to `draft`:
 * a submission with no recorded status has not been sent for review, which is what draft means.
 *
 * Both spellings are accepted on the way in. The DB one is what exists today; the Zod one is what
 * the column would hold if the two were ever reconciled in the other direction, and accepting it
 * costs nothing while making this function survive that change.
 */
export function toSubmissionStatus(
	raw: string | null | undefined,
): "draft" | "pending_review" | "revision_requested" | "accepted" {
	switch (raw) {
		case "pending_review":
			return "pending_review";
		case "accepted":
			return "accepted";
		case "revisions_requested":
		case "revision_requested":
			return "revision_requested";
		case "draft":
		case null:
		case undefined:
			return "draft";
		default:
			return "draft";
	}
}

/**
 * `projects.project_stages.status` (`stage_status`) → the Zod `ProjectStatus` those projections reuse.
 *
 * These two enums share exactly ONE member. The column is
 * `('open','assigned','in_progress','submitted','approved','revisions','paid','cancelled')`; the
 * projection is `('draft','active','on_hold','completed','cancelled')`. Only `cancelled` overlaps,
 * so without a deliberate mapping every live stage lands on a value the projection cannot express.
 *
 * The mapping is about what a stage MEANS to a reader, not about matching names:
 *  - `open` is a stage nobody has been assigned to yet — the projection's `draft`, and the value
 *    `stageLocked()` tests for, which is why getting this one wrong quietly unlocks every stage.
 *  - `assigned`, `in_progress`, `submitted` and `revisions` are all work in flight — `active`.
 *    `submitted` is deliberately NOT `completed`: awaiting review is not done.
 *  - `approved` and `paid` are both terminal — `completed`.
 *  - `cancelled` maps to itself.
 *
 * There is no `stage_status` value that means "paused", so `on_hold` is unreachable from this
 * direction. That is a real asymmetry rather than an omission: the schema has no way to say it.
 */
export function toStageProjectStatus(raw: string | null | undefined): ProjectStatus {
	switch (raw) {
		case "open":
			return "draft";
		case "assigned":
		case "in_progress":
		case "submitted":
		case "revisions":
			return "active";
		case "approved":
		case "paid":
			return "completed";
		case "cancelled":
			return "cancelled";
		default:
			// An unknown member is treated as work in flight. `draft` would unlock a stage that may be
			// mid-delivery, which is the more damaging way to be wrong.
			return "active";
	}
}

/** The `stage_status` members that mean the work is delivered. See {@link toStageProjectStatus}. */
export const DELIVERED_STAGE_STATUS: ReadonlySet<string> = new Set(["approved", "paid"]);

/**
 * `projects.project_invitations.status` → the Zod `InviteStatus`.
 *
 * The CHECK allows `('pending','accepted','expired','revoked')`; the Zod enum has only
 * `('pending','expired')`. Two storable values have no representation at all, so a naive read fails
 * to parse on any invitation that was ever answered.
 *
 * Returning `null` for those two is deliberate rather than coercing them into `expired`: an accepted
 * invitation is not an expired one, and the queue this feeds is the PENDING queue. A caller filters
 * a `null` out rather than displaying a lie.
 */
export function toInviteStatus(raw: string | null | undefined): "pending" | "expired" | null {
	if (raw === "pending") return "pending";
	if (raw === "expired") return "expired";
	// 'accepted' and 'revoked' are resolved states; they leave the pending queue rather than
	// appearing in it under a borrowed label.
	return null;
}

/**
 * `projects.project_participants.role` → the Zod `MemberRole`.
 *
 * The column is unconstrained free text with no CHECK and no default, and the only value any
 * migration writes is `'assignee'` — which is not a member of `MemberRole` at all. So the mapping
 * has to name that value explicitly or every hired freelancer reads as a bare `member`.
 *
 * A happy accident worth relying on: `MemberRole`'s seven members match the CHECK list on
 * `projects.project_invitations.role` exactly, so an invited-then-accepted member's role survives
 * the round trip unchanged.
 */
export function toMemberRole(
	raw: string | null | undefined,
): "client" | "owner" | "admin" | "manager" | "freelancer" | "member" | "guest" {
	switch (raw) {
		case "client":
		case "owner":
		case "admin":
		case "manager":
		case "freelancer":
		case "guest":
			return raw;
		case "assignee":
			// The only role the staffing RPC writes. An assignee is the person doing the work.
			return "freelancer";
		default:
			return "member";
	}
}

/**
 * `projects.tickets.status` (`ticket_status`) → the Zod `TicketStatus`.
 *
 * The two vocabularies agree today, so this is a guard against a future member reaching a client as
 * an unparseable row rather than a translation. `backlog` is the default and the safe landing place:
 * an unknown status is work nobody has started, which is the reading that misleads least.
 */
export function toTicketStatus(raw: string | null | undefined): string {
	const known = new Set([
		"backlog",
		"todo",
		"claimed",
		"in_progress",
		"in_review",
		"completed",
		"cancelled",
		"reported_hidden",
	]);
	return raw && known.has(raw) ? raw : "backlog";
}

// #endregion

// #region Presence and per-viewer state

/**
 * The presence value every roster row gets.
 *
 * There is no presence column in `org`, `projects` or `comms` — not a `last_seen_at`, not an
 * `online` flag, nothing. `MemberPresence` is a REQUIRED field, so the absence has to resolve to
 * something, and `offline` is the honest reading of "we have no evidence this person is here".
 *
 * Exported as a named constant rather than inlined at each call site so that the day a presence
 * source exists there is one place to change, and so a reader grepping for why everyone is offline
 * finds this explanation rather than four scattered literals.
 */
export const NO_PRESENCE_SIGNAL = "offline" as const;

/**
 * Whether a project channel can report an unread state. It cannot.
 *
 * `comms.project_channel_participants` is keyed by `(profile_type, profile_id)` — a PROFILE, not a
 * user — carries no `user_id` and no `last_read_at`, and is consulted by no RLS policy. The DM side
 * has all four columns on `dm_participants`; the project side has none of them. So
 * `ProjectChannel.unread`, `StageChannel.channel.unread` and `ProjectSummary.unread` have no backing
 * and are returned `false`.
 *
 * `false` rather than a synthesised value: deriving it from `last_activity_at` would put a pulsing
 * unread dot on every channel the viewer simply had not opened today. A missing signal that reads as
 * "nothing awaiting you" is wrong quietly; an invented one is wrong in the direction people act on.
 */
export const NO_UNREAD_SIGNAL = false;

// #endregion

// #region Ordering

/**
 * Compare two possibly-null ISO timestamps, newest first, with nulls last.
 *
 * Written once because `Date.parse(null)` is `NaN` and `NaN` comparisons are all false, which makes
 * a null silently sort wherever the engine happens to leave it — stable in one runtime and not in
 * another.
 */
export function byNewest(a: string | null | undefined, b: string | null | undefined): number {
	const ta = a ? Date.parse(a) : NaN;
	const tb = b ? Date.parse(b) : NaN;
	if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
	if (Number.isNaN(ta)) return 1;
	if (Number.isNaN(tb)) return -1;
	return tb - ta;
}

// #endregion
