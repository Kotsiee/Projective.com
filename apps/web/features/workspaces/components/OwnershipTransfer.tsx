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
 * OwnershipTransfer — the way the owner hands the entity over.
 *
 * An entity has exactly one owner, and the owner's standing changes only by transfer: an ownerless
 * entity has nobody who can restore it. So rather than refuse the owner's "remove me" with an error,
 * this is the mechanism — pick a successor, confirm, and the handover (and, if asked, the departure)
 * happens as ONE server act. There is no moment with two owners or none, which two separate role edits
 * could never promise.
 *
 * Candidates are ACTIVE members only. Offering somebody who has not yet accepted an invitation would let
 * ownership land on a person who may never arrive — the same ownerless state by a slower route.
 */

export interface OwnershipTransferProps {
	workspace: WorkspaceDetail;
	/** The owner who is stepping back — always the viewer. */
	leaving: WorkspaceMember;
	onClose: () => void;
	/** The re-read detail, or `null` when the owner also left and so has no console to see. */
	onTransferred: (next: WorkspaceDetail | null) => void;
}

/** The successor picker + confirmation. */
export function OwnershipTransfer(props: OwnershipTransferProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const successorId = useSignal<string>("");
	const alsoLeave = useSignal(false);
	const working = useSignal(false);
	const error = useSignal<string | null>(null);

	/** Anyone active who is not the person stepping back. */
	const candidates = useComputed(() =>
		activeMembers(ws.members).filter((m) => m.id !== props.leaving.id)
	);
	const successor = useComputed(() =>
		candidates.value.find((m) => m.id === successorId.value) ?? null
	);

	async function transfer(): Promise<void> {
		if (!successor.value) {
			error.value = "Choose who takes ownership.";
			return;
		}
		working.value = true;
		error.value = null;
		const res = await WorkspaceService.transferOwnership({
			kind: ws.kind,
			workspaceId: ws.id,
			successorMemberId: successor.value.id,
			leave: alsoLeave.value,
		});
		working.value = false;
		if (!res.ok) {
			error.value = res.errors?.successorMemberId ?? res.errors?.owner ?? res.message ??
				"Could not transfer ownership.";
			return;
		}
		props.onTransferred(res.data ?? null);
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
						 * Destructive severity, deliberately. This hands the owner's control of the workspace to
						 * someone else and cannot be undone by the person clicking it.
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
				You own {ws.name}. Someone has to be able to restore this{" "}
				{copy.noun}, so ownership moves to another member before you can step back.
			</p>

			{candidates.value.length === 0
				? (
					<p class="wsp-inviteform__error">
						There is nobody else here yet. Invite someone and wait for them to join — then ownership
						can move to them.
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
								class="wsp-select"
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
								checked={alsoLeave.value}
								onChange={(e) => {
									alsoLeave.value = (e.target as HTMLInputElement).checked;
								}}
							/>{" "}
							Also leave this {copy.noun}
						</label>
						<p class="wsp-inviteform__hint">
							Leaving this unchecked keeps you here as an admin.
						</p>
					</>
				)}

			{error.value && <p class="wsp-inviteform__error" role="alert">{error.value}</p>}
		</Dialog>
	);
}
