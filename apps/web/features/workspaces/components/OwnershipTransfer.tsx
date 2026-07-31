import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import {
	activeMembers,
	kindCopy,
	roleLabel,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";

/**
 * OwnershipTransfer — the way OUT of the last-owner guard.
 *
 * The rule is that the last owner cannot be demoted or removed, because an ownerless entity has nobody
 * who can restore it. The wrong way to enforce that is an error message: the user's intent (leave, hand
 * over, step back) is entirely legitimate, and only the mechanism they reached for was not. So this is
 * the mechanism — pick a successor, confirm, and the transfer and the departure happen as one act.
 *
 * Candidates are ACTIVE members only. Offering an invited-but-not-yet-joined person as a successor
 * would let ownership land on somebody who may never accept, which is the same ownerless state by a
 * slower route.
 */

export interface OwnershipTransferProps {
	workspace: WorkspaceDetail;
	/** The owner who is stepping back. */
	leaving: WorkspaceMember;
	onClose: () => void;
	onTransferred: (next: WorkspaceDetail) => void;
}

/** The successor picker + confirmation. */
export function OwnershipTransfer(props: OwnershipTransferProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const successorId = useSignal<string>("");
	const alsoRemove = useSignal(false);
	const working = useSignal(false);
	const error = useSignal<string | null>(null);

	/** Anyone active who is not the person stepping back. */
	const candidates = useComputed(() =>
		activeMembers(ws.members).filter((m) => m.id !== props.leaving.id)
	);
	const successor = useComputed(() =>
		candidates.value.find((m) => m.id === successorId.value) ?? null
	);

	const ownerRoleId = ws.roles.find((r) => r.preset === "owner")?.id ?? "owner";

	async function transfer(): Promise<void> {
		if (!successor.value) {
			error.value = "Choose who takes ownership.";
			return;
		}
		working.value = true;
		error.value = null;

		// Promote FIRST. If the promotion fails we have changed nothing; if we removed first and then
		// failed to promote, the entity would be ownerless — the exact state this guard exists to prevent.
		const promoted = await WorkspaceService.updateMember({
			workspaceId: ws.id,
			memberId: successor.value.id,
			roleId: ownerRoleId,
		});
		if (!promoted.ok || !promoted.data) {
			working.value = false;
			error.value = promoted.message ?? "Could not transfer ownership.";
			return;
		}

		let latest = promoted.data.workspace;
		if (alsoRemove.value) {
			const removed = await WorkspaceService.updateMember({
				workspaceId: ws.id,
				memberId: props.leaving.id,
				remove: true,
			});
			// A failed removal is not a failed transfer — ownership moved, so report the partial honestly
			// rather than rolling back a change that succeeded.
			if (removed.ok && removed.data) latest = removed.data.workspace;
			else {
				working.value = false;
				error.value = "Ownership moved, but they could not be removed. Try removing them again.";
				props.onTransferred(latest);
				return;
			}
		}

		working.value = false;
		props.onTransferred(latest);
	}

	return (
		<Dialog
			visible
			header="Transfer ownership"
			modal
			width="30rem"
			class="wsp-inviteform"
			onVisibleChange={(open) => {
				if (!open) props.onClose();
			}}
			footer={
				<div class="wsp-inviteform__actions">
					<Button variant="text" label="Cancel" onClick={props.onClose} />
					{
						/*
						 * Destructive severity, deliberately. This hands the last owner's control of the
						 * workspace to someone else and cannot be undone by the person clicking it — styling
						 * it identically to "Publish listing" made the most consequential action on the
						 * surface look like the safest. The vocabulary already existed and was simply not
						 * reached for here.
						 */
					}
					<Button
						variant="filled"
						severity="danger"
						label={working.value ? "Transferring…" : "Transfer ownership"}
						disabled={working.value || !successorId.value}
						onClick={transfer}
					/>
				</div>
			}
		>
			<p class="wsp-inviteform__hint">
				{props.leaving.name} is the last owner of {ws.name}. Someone has to be able to restore this
				{" "}
				{copy.noun}, so ownership moves before they can step back.
			</p>

			{candidates.value.length === 0
				? (
					<p class="wsp-inviteform__error">
						There is nobody else here yet. Invite someone and give them a role first — then
						ownership can move to them.
					</p>
				)
				: (
					<>
						<div class="wsp-inviteform__field">
							<label class="wsp-inviteform__label" for="wsp-transfer-to">
								New owner
							</label>
							<select
								id="wsp-transfer-to"
								class="wsp-people__view"
								value={successorId.value}
								onChange={(e) => {
									successorId.value = (e.target as HTMLSelectElement).value;
									error.value = null;
								}}
							>
								<option value="">Choose a member…</option>
								{candidates.value.map((m) => (
									<option key={m.id} value={m.id}>
										{m.name} — {roleLabel(m.rolePreset)}
									</option>
								))}
							</select>
						</div>

						{successor.value && (
							<div class="wsp-inviteform__preview">
								<Avatar
									image={successor.value.avatar}
									alt=""
									label={successor.value.name}
									shape="circle"
									size="md"
								/>
								<p class="wsp-inviteform__preview-caps">
									{successor.value.name} becomes owner and gains every permission in this{" "}
									{copy.noun}, including moving money and archiving it.
								</p>
							</div>
						)}

						<label class="wsp-inviteform__label">
							<input
								type="checkbox"
								checked={alsoRemove.value}
								onChange={(e) => {
									alsoRemove.value = (e.target as HTMLInputElement).checked;
								}}
							/>{" "}
							Also remove {props.leaving.name} from this {copy.noun}
						</label>
						<p class="wsp-inviteform__hint">
							Leaving this unchecked keeps them here as an admin.
						</p>
					</>
				)}

			{error.value && <p class="wsp-inviteform__error" role="alert">{error.value}</p>}
		</Dialog>
	);
}
