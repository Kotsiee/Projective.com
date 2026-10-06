import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { InviteLinkAction, StageInviteLink } from "../types/projects-types.ts";
import { MembersService } from "../core/MembersService.ts";

/**
 * useStageInviteLink — a stage's shareable invite link for the invite modal (Decision #145): read on
 * open and whenever the stage changes, then created, reset or turned off by an explicit act. Reading
 * never mints a link, so opening the modal after turning the link off does not quietly turn it back on.
 */
export interface StageInviteLinkState {
	link: ReadonlySignal<StageInviteLink | null>;
	/** A read or an act is in flight. */
	busy: ReadonlySignal<boolean>;
	/** The last refusal, in the server's words. */
	error: ReadonlySignal<string | null>;
	/** The last act's confirmation ("Invite link turned off."). */
	notice: ReadonlySignal<string | null>;
	act: (action: InviteLinkAction) => Promise<void>;
}

export function useStageInviteLink(
	projectId: string,
	stageId: string | null,
	active: boolean,
): StageInviteLinkState {
	const link = useSignal<StageInviteLink | null>(null);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const notice = useSignal<string | null>(null);
	const request = useRef(0);

	useEffect(() => {
		link.value = null;
		error.value = null;
		notice.value = null;
		if (!active || !stageId) return;
		const id = ++request.current;
		busy.value = true;
		void MembersService.inviteLink(projectId, stageId).then((res) => {
			if (id !== request.current) return;
			busy.value = false;
			if (res.ok && res.data) link.value = res.data.link;
			else error.value = res.message ?? "The invite link could not be loaded.";
		});
	}, [projectId, stageId, active]);

	async function act(action: InviteLinkAction): Promise<void> {
		if (!stageId || busy.peek()) return;
		const id = ++request.current;
		busy.value = true;
		error.value = null;
		notice.value = null;
		const res = await MembersService.inviteLinkAction(projectId, stageId, action);
		if (id !== request.current) return;
		busy.value = false;
		if (res.ok && res.data) {
			link.value = res.data.link;
			notice.value = action === "ensure" ? null : res.message ?? null;
		} else {
			error.value = res.message ?? "That change to the invite link could not be saved.";
		}
	}

	return { link, busy, error, notice, act };
}
