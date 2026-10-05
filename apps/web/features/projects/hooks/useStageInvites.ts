import { type Signal, useSignal } from "@preact/signals";
import type { MemberInvite, ProjectMemberRow } from "../types/projects-types.ts";
import { MembersService } from "../core/MembersService.ts";

/** What the roster needs from {@link useStageInvites}. */
export interface StageInvitesApi {
	/** Member ids with a stage invitation in flight. */
	sending: Signal<ReadonlySet<string>>;
	invite: (member: ProjectMemberRow, stageIds: string[]) => Promise<void>;
}

/**
 * Send stage invitations to members already on the roster. Not optimistic: the new records join
 * `invites` only once the server has issued them, so a refusal (cooldown, unpriced stage, duplicate)
 * leaves nothing to roll back and is reported through `say`.
 */
export function useStageInvites(
	projectId: string,
	invites: Signal<MemberInvite[]>,
	say: (severity: "success" | "danger", summary: string) => void,
): StageInvitesApi {
	const sending = useSignal<ReadonlySet<string>>(new Set());

	function mark(id: string, on: boolean): void {
		const next = new Set(sending.value);
		if (on) next.add(id);
		else next.delete(id);
		sending.value = next;
	}

	async function invite(member: ProjectMemberRow, stageIds: string[]): Promise<void> {
		const handle = member.party.handle;
		if (!handle || stageIds.length === 0 || sending.value.has(member.id)) return;
		mark(member.id, true);
		const res = await MembersService.inviteToStages({ projectId, handle, stageIds });
		mark(member.id, false);
		if (!res.ok || !res.data) {
			say("danger", res.message ?? "The stage invitation could not be sent.");
			return;
		}
		invites.value = [...res.data.invites, ...invites.value];
		say("success", res.message ?? "Stage invitation sent.");
	}

	return { sending, invite };
}
