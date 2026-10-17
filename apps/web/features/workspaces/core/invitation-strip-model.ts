import {
	type IncomingInvite,
	kindCopy,
	readTeamPersonaDetails,
	readTeamSeatCapDetails,
	TEAM_FULL_REFUSAL,
	TEAM_PERSONA_REFUSAL,
} from "@projective/types/workspace";
import {
	PAYOUT_NOT_READY_REFUSAL,
	PAYOUT_SETUP_ACTION,
	PAYOUT_SETUP_HREF,
	readPayoutGateDetails,
} from "@projective/types/finance";

/**
 * invitation-strip-model — the pure rules of the `/teams` · `/businesses` invitation strip: which
 * control each row gets, where focus goes after an answer, what a row says about itself, what a refused
 * answer tells the reader, and when the strip is on screen at all.
 *
 * The strip is ONE decision region (DESIGN_SYSTEM §B.8.1), so it may carry exactly one filled button:
 * the first row's Accept is the tier-3 workflow commit and every other Accept is the tier-4 neutral
 * outlined utility; Decline is tier 5 (text) on every row. Answering the first row hands the fill to the
 * next — the plan is recomputed from the rows still on screen, never patched.
 *
 * Free of `preact`, CSS and the network, so `deno test` reads it directly.
 */

// #region The action model
/** The Button Interaction Matrix tiers a strip row uses (§B.8.1). */
export type InviteAcceptTier = 3 | 4;

/** One row's controls. */
export interface InviteRowActions {
	/** The invitation's id. */
	id: string;
	/** `3` — filled primary, the strip's one commit (first row only) · `4` — neutral outlined. */
	accept: InviteAcceptTier;
	/** Always tier 5: a text button, because declining is an ordinary answer, not damage. */
	decline: 5;
}

/**
 * The controls for every row still awaiting an answer, in display order: exactly one tier-3 Accept
 * (the first row's) whenever there is a row at all.
 */
export function planInviteActions(rows: readonly { id: string }[]): InviteRowActions[] {
	return rows.map((row, index) => ({ id: row.id, accept: index === 0 ? 3 : 4, decline: 5 }));
}

/** How many filled buttons a plan draws — the merge gate is "at most one per region". */
export function filledAcceptCount(plan: readonly InviteRowActions[]): number {
	return plan.filter((row) => row.accept === 3).length;
}
// #endregion

// #region Focus
/**
 * Where focus goes once `resolvedId` leaves the strip: the next row's Accept, else the previous row's
 * (the reader answered the last one), else `null` — the strip heading, because the strip is empty.
 */
export function focusAfterResolving(ids: readonly string[], resolvedId: string): string | null {
	const at = ids.indexOf(resolvedId);
	if (at < 0) return ids[0] ?? null;
	return ids[at + 1] ?? ids[at - 1] ?? null;
}
// #endregion

// #region Row copy
/** A MetaLine fact (structurally `@projective/ui/display`'s `MetaLineEntry`, kept CSS-free here). */
export type InviteMetaEntry = string | { text: string; tabular?: boolean };

const DAY_MS = 86_400_000;

/** Whole days until an ISO expiry, rounded up (anything under a day is 1); `null` when none or unreadable. */
export function daysLeft(expiresAt: string | null | undefined, nowMs: number): number | null {
	if (!expiresAt) return null;
	const at = Date.parse(expiresAt);
	if (Number.isNaN(at)) return null;
	return Math.ceil((at - nowMs) / DAY_MS);
}

/** "expires in 5 days" · "expires in 1 day" · "expired"; `null` for an invitation that never lapses. */
export function expiryLabel(expiresAt: string | null | undefined, nowMs: number): string | null {
	const days = daysLeft(expiresAt, nowMs);
	if (days === null) return null;
	if (days <= 0) return "expired";
	return days === 1 ? "expires in 1 day" : `expires in ${days} days`;
}

/**
 * A row's facts in reading order — the kind, the role offered, who sent it, how long it stays open —
 * as plain meta text (§B.11): the kind is a word, never a chip, and the day count is tabular.
 */
export function inviteMeta(
	invite: Pick<IncomingInvite, "kind" | "roleLabel" | "fromHandle" | "fromName" | "expiresAt">,
	nowMs: number,
): InviteMetaEntry[] {
	const entries: InviteMetaEntry[] = [
		kindCopy(invite.kind).Noun,
		`as ${invite.roleLabel}`,
		invite.fromHandle ? `from @${invite.fromHandle}` : `from ${invite.fromName}`,
	];
	const expiry = expiryLabel(invite.expiresAt, nowMs);
	if (expiry) entries.push({ text: expiry, tabular: true });
	return entries;
}

/** The status line after an answer landed. */
export function answerSentence(
	invite: Pick<IncomingInvite, "workspaceName">,
	accept: boolean,
): string {
	return accept
		? `You joined ${invite.workspaceName}.`
		: `You declined the invitation from ${invite.workspaceName}.`;
}
// #endregion

// #region Refusals
/** Which gate refused an answer. */
export type InviteRefusalCode = "payout" | "persona" | "seat" | "other";

/** A refused answer, as the row shows it: one InlineNotice sentence and, when the reader can fix it, the fix. */
export interface InviteRefusal {
	code: InviteRefusalCode;
	/** The notice's sentence. */
	text: string;
	/** The tier-4 link to the fix, when the reader can make it themselves. */
	fix: { href: string; label: string } | null;
}

/**
 * Read a refused answer's envelope by its typed `details.reason` (never by its wording):
 * `payout_not_ready` → the earning gate's sentence with the Settings → Verification link (Decision
 * #196) · `persona` → "Teams are for freelancer accounts." (Decision #228 (A)) · `seat_cap` → "This
 * team is full." · anything else → the server's own sentence, or a fallback naming the entity.
 */
export function inviteRefusal(
	result: { message?: string; details?: unknown },
	invite: Pick<IncomingInvite, "workspaceName">,
	accept: boolean,
): InviteRefusal {
	const payout = readPayoutGateDetails(result.details);
	if (payout) {
		const href = payout.href ?? (payout.actor === "self" ? PAYOUT_SETUP_HREF : null);
		return {
			code: "payout",
			text: result.message || PAYOUT_NOT_READY_REFUSAL,
			fix: href ? { href, label: PAYOUT_SETUP_ACTION } : null,
		};
	}
	if (readTeamPersonaDetails(result.details)) {
		return { code: "persona", text: TEAM_PERSONA_REFUSAL, fix: null };
	}
	if (readTeamSeatCapDetails(result.details)) {
		return { code: "seat", text: TEAM_FULL_REFUSAL, fix: null };
	}
	return {
		code: "other",
		text: result.message ||
			`Couldn't ${accept ? "accept" : "decline"} the invitation from ${invite.workspaceName}.`,
		fix: null,
	};
}
// #endregion

// #region Visibility
/**
 * Whether the strip is on screen. It needs something to show — a waiting invitation, or an answer given
 * on this visit (the emptied strip keeps its heading so focus has somewhere to land and the outcome a
 * place to be read). Dismissing hides it everywhere except the Invitations tab, which IS the list.
 */
export function invitationStripShown(state: {
	waiting: number;
	answeredHere: boolean;
	dismissed: boolean;
	onInvitationsTab: boolean;
}): boolean {
	if (state.waiting === 0 && !state.answeredHere) return false;
	return state.onInvitationsTab || !state.dismissed;
}
// #endregion

// #region Immutable collections
/**
 * Sets and maps are replaced rather than mutated: a signal holding a mutated collection never notifies,
 * because its identity did not change.
 */
export function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
	const next = new Set(set);
	next.add(id);
	return next;
}

/** `set` without `id`, as a new set. */
export function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
	const next = new Set(set);
	next.delete(id);
	return next;
}

/** `map` with `id` → `value`, as a new map. */
export function withEntry<V>(
	map: ReadonlyMap<string, V>,
	id: string,
	value: V,
): ReadonlyMap<string, V> {
	const next = new Map(map);
	next.set(id, value);
	return next;
}

/** `map` without `id`, as a new map (the same map when it had no such key). */
export function withoutEntry<V>(map: ReadonlyMap<string, V>, id: string): ReadonlyMap<string, V> {
	if (!map.has(id)) return map;
	const next = new Map(map);
	next.delete(id);
	return next;
}
// #endregion
