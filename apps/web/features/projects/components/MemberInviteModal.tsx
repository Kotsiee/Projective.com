import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { Button, Chips, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import type { MemberRole, MemberStageRef } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";

/**
 * MemberInviteModal — invite people by email: several addresses as chips, the role they join as, and
 * (on an engagement with stages) the stage they are assigned to on acceptance. Opened from the
 * footer's Invite trigger; the outstanding queue lives in the Members tab's Invitations section, so
 * the modal is the form alone. STUB persistence — sending appends optimistic `pending` rows to that
 * section; the live email-invitation write lands behind `PROJECTS_BACKEND_LIVE`.
 */
export interface MemberInviteModalProps {
	open: Signal<boolean>;
	stages: MemberStageRef[];
	/** Whether stages are a dimension of this engagement — a one-off or a session has no picker. */
	showStages: boolean;
	/** The current channel's stage id, pre-selected in the assign picker (channel-stage scope). */
	defaultStageId: string | null;
	onInvite: (emails: string[], role: MemberRole, stageId: string | null) => void;
}

export function MemberInviteModal(props: MemberInviteModalProps): JSX.Element {
	const { stages } = props;
	const emails = useSignal<string[]>([]);
	const role = useSignal<string>("freelancer");
	const stageId = useSignal<string>(props.defaultStageId ?? "");

	const stageOptions = [
		{ label: "Whole project (no stage)", value: "" },
		...stages.map((s) => ({ label: s.name, value: s.id })),
	];
	const validEmails = emails.value.filter((e) => /.+@.+\..+/.test(e.trim()));
	const pickStage = props.showStages && stages.length > 0;

	function send(): void {
		if (validEmails.length === 0) return;
		props.onInvite(validEmails, role.value as MemberRole, pickStage ? stageId.value || null : null);
		emails.value = [];
		props.open.value = false;
	}

	return (
		<Dialog
			visible={props.open}
			header="Invite people"
			width="34rem"
			class="mem-dialog mem-invite"
			footer={
				<div class="mem-dialog__foot">
					<Button
						variant="text"
						severity="secondary"
						label="Cancel"
						onClick={() => (props.open.value = false)}
					/>
					<Button
						variant="filled"
						label={validEmails.length > 1 ? `Send ${validEmails.length} invites` : "Send invite"}
						disabled={validEmails.length === 0}
						onClick={send}
					/>
				</div>
			}
		>
			<div class="mem-invite__form">
				<label class="mem-field">
					<span class="mem-field__label">Email addresses</span>
					<Chips
						fluid
						placeholder="name@company.com — press Enter"
						value={emails}
						aria-label="Invitee emails"
					/>
					<span class="mem-field__hint">Add one or more — press Enter or comma between each.</span>
				</label>

				<div class="mem-invite__row" data-single={pickStage ? undefined : "true"}>
					<label class="mem-field">
						<span class="mem-field__label">Role</span>
						<Select
							fluid
							options={ASSIGNABLE_ROLES.map((r) => ({ label: r.label, value: r.value }))}
							value={role}
							aria-label="Invite role"
						/>
					</label>
					{pickStage && (
						<label class="mem-field">
							<span class="mem-field__label">Assign to stage</span>
							<Select fluid options={stageOptions} value={stageId} aria-label="Assign to stage" />
						</label>
					)}
				</div>
			</div>
		</Dialog>
	);
}
