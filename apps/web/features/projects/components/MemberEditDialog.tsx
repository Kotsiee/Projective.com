import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button, MultiSelect, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import type { MemberRole, MemberStageRef, ProjectMemberRow } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";

/**
 * MemberEditDialog — the combined "Edit Member" surface (task §2.2 "Edit Member Role" + the multi-stage
 * form of §2.2 "Assign/Unassign Stage"). A modal {@link Dialog} letting an admin/owner/manager change a
 * participant's role and set which stages they contribute to, in one place. STUB persistence — the save
 * flips the roster optimistically; the live path (the participant-role + stage-assignment RPCs) lands
 * behind `PROJECTS_BACKEND_LIVE`. Reseeds its controls whenever a different member is opened.
 */
export interface MemberEditDialogProps {
	open: import("@preact/signals").Signal<boolean>;
	member: ProjectMemberRow | null;
	stages: MemberStageRef[];
	onSave: (memberId: string, role: MemberRole, stageNames: string[]) => void;
	onClose: () => void;
}

export function MemberEditDialog(props: MemberEditDialogProps): JSX.Element {
	const { member, stages } = props;
	const role = useSignal<string>(member?.role ?? "member");
	const assigned = useSignal<string[]>(member?.assignedStages ?? []);

	// Reseed the controls when a different member is opened (the dialog is reused across rows).
	useEffect(() => {
		if (member) {
			role.value = member.role;
			assigned.value = [...member.assignedStages];
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [member?.id]);

	const stageOptions = stages.map((s) => ({ label: s.name, value: s.name }));

	function save(): void {
		if (!member) return;
		props.onSave(member.id, role.value as MemberRole, assigned.value);
		props.open.value = false;
	}

	return (
		<Dialog
			visible={props.open}
			header="Edit member"
			width="30rem"
			onVisibleChange={(v) => !v && props.onClose()}
			class="mem-dialog"
			footer={
				<div class="mem-dialog__foot">
					<Button
						variant="text"
						severity="secondary"
						label="Cancel"
						onClick={() => (props.open.value = false)}
					/>
					<Button variant="filled" label="Save changes" onClick={save} disabled={!member} />
				</div>
			}
		>
			{member && (
				<div class="mem-editform">
					<div class="mem-editform__who">
						<Avatar image={member.party.avatar ?? undefined} label={member.party.name} size="md" />
						<div class="mem-editform__whotext">
							<span class="mem-editform__name">{member.party.name}</span>
							<span class="mem-editform__email">{member.email}</span>
						</div>
					</div>

					<label class="mem-field">
						<span class="mem-field__label">Role</span>
						<Select
							fluid
							options={ASSIGNABLE_ROLES.map((r) => ({ label: r.label, value: r.value }))}
							value={role}
							aria-label="Member role"
						/>
						<span class="mem-field__hint">
							Controls this member's permissions within the project.
						</span>
					</label>

					{stageOptions.length > 0 && (
						<label class="mem-field">
							<span class="mem-field__label">Assigned stages</span>
							<MultiSelect
								fluid
								display="chip"
								placeholder="No stages assigned"
								options={stageOptions}
								value={assigned}
								aria-label="Assigned stages"
							/>
							<span class="mem-field__hint">
								The stages this member contributes to. Clearing a stage unassigns them from it.
							</span>
						</label>
					)}
				</div>
			)}
		</Dialog>
	);
}
