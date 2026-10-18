import type { JSX } from "preact";
import { batch, useComputed, useSignal } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, Checkbox, FormControl, Select } from "@projective/ui/fields";
import { kindCopy, type WorkspaceDetail, type WorkspaceMember } from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	membersTierProps,
	roleText,
	transferCandidates,
	transferConsequences,
	transferFooter,
	transferRefusal,
} from "../core/members-model.ts";

/**
 * OwnershipTransfer — the way the owner hands the entity over.
 *
 * An entity has exactly one owner, and the owner's standing changes only by transfer: an ownerless
 * entity has nobody who can restore it. So rather than refuse the owner's "remove me", this is the
 * mechanism — pick a successor, read what moves, confirm — and the handover (and, if asked, the
 * departure) happens as ONE server act (`org.transfer_workspace_ownership`). There is no moment with
 * two owners or none.
 *
 * The successor is a `Select` of ACTIVE members other than the owner, inside a `FormControl`; leaving
 * in the same act is a `Checkbox`. What the transfer does is a required disclosure, so it is an
 * `InlineNotice` naming the successor — on a team the vault's withdrawals follow the owner and the
 * successor must be payout-ready (Decision #196). The confirm keeps the destructive ramp; Cancel is
 * tier 5. A refusal — the successor not payout-ready, not a freelancer account — is an `InlineNotice`
 * that names them. Every rule here is `core/members-model.ts`'s.
 */

export interface OwnershipTransferProps {
	workspace: WorkspaceDetail;
	/** The owner who is stepping back — always the viewer. */
	leaving: WorkspaceMember;
	onClose: () => void;
	/** The re-read detail, or `null` when the owner also left and so has no console to see. */
	onTransferred: (next: WorkspaceDetail | null) => void;
}

/** The successor picker, the disclosure and the confirmation. */
export function OwnershipTransfer(props: OwnershipTransferProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const successorId = useSignal("");
	const alsoLeave = useSignal(false);
	const working = useSignal(false);
	const refusal = useSignal<string | null>(null);

	const candidates = transferCandidates(ws.members, props.leaving.id);
	const successor = useComputed(() => candidates.find((m) => m.id === successorId.value) ?? null);
	const [cancel, confirm] = transferFooter({
		working: working.value,
		successorId: successorId.value,
	});

	async function transfer(): Promise<void> {
		const next = successor.peek();
		if (!next || working.peek()) return;
		batch(() => {
			working.value = true;
			refusal.value = null;
		});
		const res = await WorkspaceService.transferOwnership({
			kind: ws.kind,
			workspaceId: ws.id,
			successorMemberId: next.id,
			leave: alsoLeave.peek(),
		});
		working.value = false;
		if (!res.ok) {
			refusal.value = transferRefusal(res, next.name).text;
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
			class="wsp-transfer"
			onVisibleChange={(open) => {
				if (!open) props.onClose();
			}}
			footer={
				<div class="wsp-dialog__actions">
					<Button
						{...membersTierProps(cancel.tier)}
						label={cancel.label}
						onClick={props.onClose}
					/>
					<Button
						{...membersTierProps(confirm.tier, confirm.danger)}
						label={confirm.label}
						disabled={confirm.disabled}
						loading={confirm.busy}
						onClick={() => void transfer()}
					/>
				</div>
			}
		>
			<div class="wsp-dialog">
				<p class="wsp-dialog__intro">
					You own {ws.name}. Someone has to be able to restore this{" "}
					{copy.noun}, so ownership moves to another member before you can step back.
				</p>

				{candidates.length === 0
					? (
						<InlineNotice
							align="start"
							text={`There is nobody else in this ${copy.noun} yet. Invite someone and wait for them to join — then ownership can move to them.`}
						/>
					)
					: (
						<>
							<FormControl label="New owner" required hint="Active members only.">
								{({ id, describedBy, required }) => (
									<Select
										id={id}
										aria-describedby={describedBy}
										required={required}
										options={candidates.map((m) => ({
											value: m.id,
											label: m.name,
											description: `@${m.handle} · ${roleText(m, ws.roles)}`,
										}))}
										value={successorId}
										onValueChange={() => (refusal.value = null)}
										placeholder="Choose a member"
										filter={candidates.length > 8}
										fluid
									/>
								)}
							</FormControl>

							<FormControl collapseHint>
								{({ id }) => (
									<Checkbox
										id={id}
										value={alsoLeave}
										label={`Leave the ${copy.noun} after the transfer`}
									/>
								)}
							</FormControl>

							<InlineNotice
								align="start"
								class="wsp-dialog__disclosure"
								text={transferConsequences(
									ws.kind,
									successor.value?.name ?? null,
									alsoLeave.value,
								).join(" ")}
							/>
						</>
					)}

				{refusal.value && <InlineNotice assertive align="start" text={refusal.value} />}
			</div>
		</Dialog>
	);
}
