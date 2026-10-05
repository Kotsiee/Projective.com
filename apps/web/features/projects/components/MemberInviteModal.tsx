import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { Button, Chips, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import type { AssignableMemberRole, MemberStageRef } from "../types/projects-types.ts";
import { INVITE_BATCH_MAX } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";

/**
 * MemberInviteModal — invite people by `@handle` or email: several as chips, the role they join as,
 * and (on an engagement with stages) the stage they are seated on when they accept. Opened from the
 * footer's Invite trigger; the outstanding queue lives in the Members tab's Invitations section, so
 * the modal is the form alone.
 *
 * Persisted: the parent sends through `MembersService.invite` (`POST /api/projects/[id]/invites`). A
 * handle becomes an identity-addressed invitation the person answers in-app; an email stays
 * email-addressed. The modal closes only once the server has issued at least one invitation; a send
 * refused outright (the outbound ceiling, a cooldown, a duplicate) keeps the draft open with the
 * server's sentence inline.
 */
export interface MemberInviteModalProps {
	open: Signal<boolean>;
	stages: MemberStageRef[];
	/** Whether stages are a dimension of this engagement — a one-off or a session has no picker. */
	showStages: boolean;
	/** The current channel's stage id, pre-selected in the assign picker (channel-stage scope). */
	defaultStageId: string | null;
	/** Send the invitations; resolves to the server's refusal, or `null` once something was issued. */
	onInvite: (
		addresses: string[],
		role: AssignableMemberRole,
		stageId: string | null,
	) => Promise<string | null>;
}

const HANDLE_RE = /^@[a-z0-9][a-z0-9_.-]{1,39}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One chip as the server will read it: trimmed and lowercased, or `null` when it is neither shape. */
function normaliseAddress(raw: string): string | null {
	const value = raw.trim().toLowerCase();
	return HANDLE_RE.test(value) || EMAIL_RE.test(value) ? value : null;
}

export function MemberInviteModal(props: MemberInviteModalProps): JSX.Element {
	const { stages } = props;
	const addresses = useSignal<string[]>([]);
	const role = useSignal<string>("freelancer");
	const stageId = useSignal<string>(props.defaultStageId ?? "");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);

	const stageOptions = [
		{ label: "Whole project (no stage)", value: "" },
		...stages.map((s) => ({ label: s.name, value: s.id })),
	];
	const valid = [
		...new Set(
			addresses.value.map(normaliseAddress).filter((a): a is string => a !== null),
		),
	];
	const invalidCount = addresses.value.length -
		addresses.value.filter((a) => normaliseAddress(a)).length;
	const overBatch = valid.length > INVITE_BATCH_MAX;
	const pickStage = props.showStages && stages.length > 0;

	async function send(): Promise<void> {
		if (valid.length === 0 || overBatch || busy.value) return;
		busy.value = true;
		error.value = null;
		try {
			const refusal = await props.onInvite(
				valid,
				role.value as AssignableMemberRole,
				pickStage ? stageId.value || null : null,
			);
			if (refusal) {
				error.value = refusal;
				return;
			}
			addresses.value = [];
			props.open.value = false;
		} finally {
			busy.value = false;
		}
	}

	return (
		<Dialog
			visible={props.open}
			header="Invite people"
			width="34rem"
			class="mem-dialog mem-invite"
			onVisibleChange={(v) => !v && (error.value = null)}
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
						label={valid.length > 1 ? `Send ${valid.length} invites` : "Send invite"}
						disabled={valid.length === 0 || overBatch}
						loading={busy.value}
						onClick={() => void send()}
					/>
				</div>
			}
		>
			<div class="mem-invite__form">
				<label class="mem-field">
					<span class="mem-field__label">People</span>
					<Chips
						fluid
						placeholder="@handle or name@company.com — press Enter"
						value={addresses}
						aria-label="Invitee handles or emails"
					/>
					<span class="mem-field__hint">
						{overBatch
							? `Up to ${INVITE_BATCH_MAX} at a time.`
							: invalidCount > 0
							? `${invalidCount} ${
								invalidCount === 1 ? "entry is" : "entries are"
							} not an @handle or email and will be skipped.`
							: "A Projective @handle, or any email address — press Enter or comma between each."}
					</span>
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
				{error.value && <p class="mem-dialog__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}
