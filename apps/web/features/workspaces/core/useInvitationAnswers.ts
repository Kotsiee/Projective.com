import { type ReadonlySignal, useComputed, useSignal } from "@preact/signals";
import type { IncomingInvite } from "@projective/types/workspace";
import { WorkspaceService } from "./WorkspaceService.ts";
import {
	answerSentence,
	type InviteRefusal,
	inviteRefusal,
	type InviteRowActions,
	planInviteActions,
	withEntry,
	withId,
	withoutEntry,
	withoutId,
} from "./invitation-strip-model.ts";

/**
 * useInvitationAnswers — the state behind the roster's invitation strip: which invitations are still on
 * screen, the one-filled-Accept action plan over them, the refusal standing against a row, and the
 * sentence for the last answer that landed.
 *
 * **Optimistic, then honest.** Answering removes the row at once — a decision the reader has made
 * should not sit on screen waiting for a network — and the row comes back, with the refusal under it,
 * only if the server says no. On success the caller re-reads the roster (`onAnswered`), because
 * accepting adds an entity: the list itself went stale, not just the strip.
 *
 * Everything the strip renders is a computed signal over two pieces of state (the ids answered here,
 * the refusals by id), so the filled Accept moves to the next row on its own when the first resolves.
 */

// #region Contract
/** What the strip renders and the one thing it can do. */
export interface InvitationAnswers {
	/** The invitations still awaiting an answer: the server's list minus the ones answered here. */
	visible: ReadonlySignal<readonly IncomingInvite[]>;
	/** Each visible row's controls — exactly one tier-3 Accept, on the first row. */
	actions: ReadonlySignal<readonly InviteRowActions[]>;
	/** The refusal standing against a row since its last answer failed. */
	refusals: ReadonlySignal<ReadonlyMap<string, InviteRefusal>>;
	/** The last answer that landed, as a sentence for the strip's status line. */
	outcome: ReadonlySignal<string | null>;
	/** Whether anything was answered on this visit — keeps an emptied strip (and its heading) mounted. */
	answeredHere: ReadonlySignal<boolean>;
	/** Answer one invitation. Resolves `true` when the server accepted the answer. */
	respond: (invite: IncomingInvite, accept: boolean) => Promise<boolean>;
}
// #endregion

/**
 * Own the strip's answers over the roster's `invitations`. `onAnswered` runs after an answer lands
 * (the roster island re-reads itself there).
 */
export function useInvitationAnswers(
	invitations: ReadonlySignal<readonly IncomingInvite[]>,
	onAnswered: () => unknown,
): InvitationAnswers {
	// #region State
	/** Answered here (in flight or landed) — hidden at once, and guarded against a second answer. */
	const answered = useSignal<ReadonlySet<string>>(new Set());
	const refusals = useSignal<ReadonlyMap<string, InviteRefusal>>(new Map());
	const outcome = useSignal<string | null>(null);
	const answeredHere = useSignal(false);
	// #endregion

	// #region Derived
	const visible = useComputed(() =>
		invitations.value.filter((invite) => !answered.value.has(invite.id))
	);
	const actions = useComputed(() => planInviteActions(visible.value));
	// #endregion

	// #region Answering
	async function respond(invite: IncomingInvite, accept: boolean): Promise<boolean> {
		if (answered.peek().has(invite.id)) return false;
		outcome.value = null;
		refusals.value = withoutEntry(refusals.peek(), invite.id);
		answered.value = withId(answered.peek(), invite.id);
		answeredHere.value = true;

		const res = await WorkspaceService.respondInvite({ inviteId: invite.id, accept });
		if (!res.ok) {
			answered.value = withoutId(answered.peek(), invite.id);
			refusals.value = withEntry(refusals.peek(), invite.id, inviteRefusal(res, invite, accept));
			return false;
		}
		outcome.value = answerSentence(invite, accept);
		await onAnswered();
		return true;
	}
	// #endregion

	return { visible, actions, refusals, outcome, answeredHere, respond };
}
