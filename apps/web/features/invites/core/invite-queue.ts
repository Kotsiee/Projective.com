import {
	INVITE_RECIPIENTS_MAX,
	type InviteRecipient,
	type InviteRecipientRefusal,
	type ParsedRecipient,
	parseInviteInput,
	recipientAddress,
	recipientKey,
} from "@projective/types/invites";

/**
 * invite-queue — the Universal Invite modal's model, as pure functions over an immutable list
 * (Decisions #318, #405).
 *
 * The invite bar reads every address in its one field as a batch at the bar's role
 * ({@link draftBatch}); Invite sends that batch. A refusal never unsends the others: what the server
 * or the surface refused goes back into the field ({@link leftoverDraft}) with the first reason in
 * the bar's message slot, and everything that went out leaves it.
 *
 * Nothing here knows which surface it serves — a project, a team and a business all pass their own
 * roles, their own local refusals (already a member, the entity's own handle) and their own seat
 * picture.
 */

// #region Shapes
/** A role on offer, as the modal renders it: a plain label, no description. */
export interface InviteRoleOption {
	id: string;
	name: string;
}

/** One staged person. */
export interface QueuedRecipient extends ParsedRecipient {
	/** {@link recipientKey} — the row's identity. */
	key: string;
	roleId: string;
	/** A display name when the row came from a suggestion; `null` for a typed address. */
	name: string | null;
	/** An avatar URL when the row came from a suggestion. */
	avatar: string | null;
	/** The server's (or the surface's) refusal for this row, or `null` while it is fine. */
	error: string | null;
}

/** Why an address was not staged. */
export interface SkippedRecipient {
	address: string;
	reason: string;
}

/** What {@link stageRecipients} did. */
export interface StageResult {
	queue: QueuedRecipient[];
	skipped: SkippedRecipient[];
}

/** A team's seats as the modal reads them: `limit` is `null` when unlimited. */
export interface InviteSeats {
	used: number;
	limit: number | null;
}

/** The surface's answer to a send. */
export interface InviteSendOutcome {
	/** Addresses ({@link recipientAddress}) the server refused, with its own sentence. */
	refused: readonly InviteRecipientRefusal[];
	/** A refusal of the whole send (nothing went out), or `null`. */
	error: string | null;
	/** What to say about the send, e.g. "3 invitations sent." */
	message: string | null;
}
// #endregion

// #region Staging
/** Optional extras a suggestion carries onto its row. */
export interface StageMeta {
	name?: string | null;
	avatar?: string | null;
}

/**
 * Add parsed recipients at `roleId`. Skipped, in order: one already staged (silently — it is already
 * there), one the surface refuses (`refuse`, e.g. "Already a member"), and anything past
 * {@link INVITE_RECIPIENTS_MAX}.
 */
export function stageRecipients(
	queue: readonly QueuedRecipient[],
	parsed: readonly ParsedRecipient[],
	roleId: string,
	refuse: (r: ParsedRecipient) => string | null = () => null,
	meta: StageMeta = {},
): StageResult {
	const next = [...queue];
	const skipped: SkippedRecipient[] = [];
	const keys = new Set(next.map((r) => r.key));
	for (const r of parsed) {
		const key = recipientKey(r);
		if (keys.has(key)) continue;
		const reason = refuse(r);
		if (reason) {
			skipped.push({ address: recipientAddress(r), reason });
			continue;
		}
		if (next.length >= INVITE_RECIPIENTS_MAX) {
			skipped.push({
				address: recipientAddress(r),
				reason: `Invite up to ${INVITE_RECIPIENTS_MAX} people at a time.`,
			});
			continue;
		}
		keys.add(key);
		next.push({
			...r,
			key,
			roleId,
			name: meta.name ?? null,
			avatar: meta.avatar ?? null,
			error: null,
		});
	}
	return { queue: next, skipped };
}

/** The batch a send carries. */
export function toRecipients(queue: readonly QueuedRecipient[]): InviteRecipient[] {
	return queue.map((r) => ({ type: r.type, value: r.value, roleId: r.roleId }));
}

/**
 * Fold a send's answer back into the list: a refused row stays with the server's sentence, every
 * other row went out and leaves. A whole-send refusal (`outcome.error`) leaves the list untouched.
 */
export function applyOutcome(
	queue: readonly QueuedRecipient[],
	outcome: InviteSendOutcome,
): QueuedRecipient[] {
	if (outcome.error) return [...queue];
	const refused = new Map(outcome.refused.map((r) => [r.address.toLowerCase(), r.message]));
	return queue
		.filter((r) => refused.has(recipientAddress(r)))
		.map((r) => ({ ...r, error: refused.get(recipientAddress(r)) ?? null }));
}
// #endregion

// #region The invite bar
/** What one Invite press would carry, read from the bar's field. */
export interface DraftBatch {
	/** Every readable address, at the bar's role, within {@link INVITE_RECIPIENTS_MAX}. */
	queue: QueuedRecipient[];
	/** Addresses the surface refused or that were past the batch cap, with the reason. */
	skipped: SkippedRecipient[];
	/** Text no address could be read from. */
	invalid: string[];
}

/** Read the field as a batch at `roleId`, honouring the surface's refusals. */
export function draftBatch(
	draft: string,
	roleId: string,
	refuse: (r: ParsedRecipient) => string | null = () => null,
): DraftBatch {
	const parsed = parseInviteInput(draft);
	const { queue, skipped } = stageRecipients([], parsed.recipients, roleId, refuse);
	return { queue, skipped, invalid: parsed.invalid };
}

/** Why part of the field cannot be sent, in one sentence, or `null` when all of it can. */
export function batchProblem(batch: DraftBatch): string | null {
	const unreadable = invalidInputMessage(batch.invalid);
	if (unreadable) return unreadable;
	const first = batch.skipped[0];
	return first ? `${first.address}: ${first.reason}` : null;
}

/**
 * The field after a send: what still needs fixing, comma-separated — the rows the server refused,
 * then anything that was never sendable. Empty once everything went out.
 */
export function leftoverDraft(
	refused: readonly QueuedRecipient[],
	batch: Pick<DraftBatch, "skipped" | "invalid">,
): string {
	return [
		...refused.map((r) => recipientAddress(r)),
		...batch.skipped.map((s) => s.address),
		...batch.invalid,
	].join(", ");
}

/** The field with a picked suggestion in place of the fragment being typed, ready for the next. */
export function withPicked(draft: string, handle: string): string {
	return `${draft.replace(/[^\s,;]*$/, "")}@${handle}, `;
}

/** The fragment being typed at the end of the field, without a leading `@`. */
export function typedFragment(draft: string): string {
	return (draft.match(/[^\s,;]*$/)?.[0] ?? "").replace(/^@+/, "");
}
// #endregion

// #region Seats & copy
/** Seats still free, or `null` when the plan has no cap (or the surface has no seats). */
export function freeSeats(seats: InviteSeats | null | undefined): number | null {
	if (!seats || seats.limit === null) return null;
	return Math.max(0, seats.limit - seats.used);
}

/** The header caption: "3 of 4 seats available", or `null` with no cap. */
export function seatCaption(seats: InviteSeats | null | undefined): string | null {
	const free = freeSeats(seats);
	if (free === null || !seats || seats.limit === null) return null;
	return `${free} of ${seats.limit} ${seats.limit === 1 ? "seat" : "seats"} available`;
}

/** How many addresses in a batch are past the free seats (0 when they all fit or there is no cap). */
export function seatOverflow(seats: InviteSeats | null | undefined, staged: number): number {
	const free = freeSeats(seats);
	return free === null ? 0 : Math.max(0, staged - free);
}

/** The seat refusal for a batch past the plan, or `null` when it fits. */
export function seatProblem(seats: InviteSeats | null | undefined, staged: number): string | null {
	const over = seatOverflow(seats, staged);
	if (over === 0) return null;
	const free = staged - over;
	return free === 0
		? "No seats are free."
		: `Only ${free} ${free === 1 ? "seat is" : "seats are"} free.`;
}

/** What to say when the field held text no address could be read from. */
export function invalidInputMessage(invalid: readonly string[]): string | null {
	if (invalid.length === 0) return null;
	const first = invalid[0];
	return invalid.length === 1
		? `"${first}" isn't an email address or an @handle.`
		: `${invalid.length} entries aren't email addresses or @handles, starting with "${first}".`;
}
// #endregion
