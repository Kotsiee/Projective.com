import { type ReadonlySignal, useSignal } from "@preact/signals";
import type { RankedContact } from "@projective/types/messaging";
import type { AssignableMemberRole, MemberInvite } from "../types/projects-types.ts";
import { normaliseHandle, type PersonActionState } from "@features/share/core/people-picker.ts";

/**
 * useInviteActions — the per-person invite state behind the invite modal's Quick Add rail and search
 * (Decision #145). Each address (`@handle` or an email) is sent on its own through the roster's
 * `onInvite`, so one refusal never holds the others back and each row shows its own outcome.
 *
 * A person already holding an OPEN invitation to the chosen stage (or to the whole project, when no
 * stage is chosen) is `blocked` — shown "Invited", never offered a duplicate the database would
 * refuse (`uq_project_invitations_open_seat`).
 */
export interface InviteActions {
	stateOfPerson: (person: RankedContact) => PersonActionState;
	stateOfEmail: (email: string) => PersonActionState;
	invitePerson: (person: RankedContact) => Promise<void>;
	inviteEmail: (email: string) => Promise<void>;
	/** The last refusal, naming whom it was about. */
	error: ReadonlySignal<string | null>;
}

export interface InviteActionsOptions {
	invites: readonly MemberInvite[];
	role: ReadonlySignal<AssignableMemberRole>;
	stageId: ReadonlySignal<string | null>;
	onInvite: (
		addresses: string[],
		role: AssignableMemberRole,
		stageId: string | null,
	) => Promise<string | null>;
}

export function useInviteActions(options: InviteActionsOptions): InviteActions {
	const local = useSignal<Record<string, PersonActionState>>({});
	const error = useSignal<string | null>(null);

	/** Local state is per (address, stage): an invitation to one stage says nothing about another. */
	function keyOf(address: string): string {
		return `${options.stageId.value ?? ""}|${address}`;
	}

	function openInviteTo(address: string): boolean {
		const stage = options.stageId.value;
		const handle = address.startsWith("@") ? normaliseHandle(address) : null;
		return options.invites.some((invite) =>
			invite.status === "pending" && !invite.dismissedAt && invite.stageId === stage &&
			(handle ? normaliseHandle(invite.handle) === handle : invite.email.toLowerCase() === address)
		);
	}

	function stateOf(address: string): PersonActionState {
		const mine = local.value[keyOf(address)];
		if (mine === "busy" || mine === "done") return mine;
		return openInviteTo(address) ? "blocked" : "idle";
	}

	async function send(address: string, name: string): Promise<void> {
		if (stateOf(address) !== "idle") return;
		const key = keyOf(address);
		local.value = { ...local.value, [key]: "busy" };
		error.value = null;
		const refusal = await options.onInvite(
			[address],
			options.role.peek(),
			options.stageId.peek(),
		);
		local.value = { ...local.value, [key]: refusal ? "idle" : "done" };
		if (refusal) error.value = `${name}: ${refusal}`;
	}

	return {
		stateOfPerson: (person) => {
			const handle = normaliseHandle(person.handle);
			return handle ? stateOf(`@${handle}`) : "blocked";
		},
		stateOfEmail: (email) => stateOf(email),
		invitePerson: async (person) => {
			const handle = normaliseHandle(person.handle);
			if (handle) await send(`@${handle}`, person.name);
		},
		inviteEmail: (email) => send(email, email),
		error,
	};
}
