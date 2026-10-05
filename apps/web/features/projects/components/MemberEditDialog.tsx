import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import type { MemberRole, ProjectMemberRow } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * MemberEditDialog — the "Change role" surface: a modal {@link Dialog} letting an admin/owner/manager
 * change a participant's role. Stage seats are not edited here — they are offered by invitation and
 * accepted by the freelancer (Decision #139). STUB persistence — the save flips the roster
 * optimistically until the participant-role RPC lands. Reseeds whenever a different member is opened.
 */
export interface MemberEditDialogProps {
	open: import("@preact/signals").Signal<boolean>;
	member: ProjectMemberRow | null;
	onSave: (memberId: string, role: MemberRole) => void;
	onClose: () => void;
}

export function MemberEditDialog(props: MemberEditDialogProps): JSX.Element {
	const { member } = props;
	const role = useSignal<string>(member?.role ?? "member");

	// Reseed the controls when a different member is opened (the dialog is reused across rows).
	useEffect(() => {
		if (member) role.value = member.role;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [member?.id]);

	function save(): void {
		if (!member) return;
		props.onSave(member.id, role.value as MemberRole);
		props.open.value = false;
	}

	return (
		<Dialog
			visible={props.open}
			header="Change role"
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
						<UserAvatar
							image={member.party.avatar ?? undefined}
							label={member.party.name}
							size="md"
						/>
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
				</div>
			)}
		</Dialog>
	);
}
