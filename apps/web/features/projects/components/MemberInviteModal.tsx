import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { Button, Chips, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import { Tag } from "@projective/ui/display";
import type { MemberInvite, MemberRole, MemberStageRef } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";
import { MemberRoleBadge } from "./MemberBadges.tsx";
import { CloseIcon } from "./glyphs.tsx";
import { ResendIcon } from "./member-glyphs.tsx";

/**
 * MemberInviteModal — the multi-invite + pending-invitations surface (task §3). A modal {@link Dialog}
 * with two tabs: **Invite** (add several emails as chips, pick the role they join as, and optionally
 * assign them straight to a stage) and **Pending Invitations** (the outstanding queue, each with resend
 * / cancel). STUB persistence — sending appends an optimistic pending row and the resend/cancel actions
 * mutate the local queue; the live path (the `projects.invitations` insert + email dispatch) lands
 * behind `PROJECTS_BACKEND_LIVE`. Only opened for a managing viewer (the island gates the trigger).
 */
export interface MemberInviteModalProps {
	open: Signal<boolean>;
	stages: MemberStageRef[];
	invites: MemberInvite[];
	/** The current channel's stage id, pre-selected in the assign picker (channel-stage scope). */
	defaultStageId: string | null;
	onInvite: (emails: string[], role: MemberRole, stageId: string | null) => void;
	onResend: (id: string) => void;
	onCancel: (id: string) => void;
	onClose: () => void;
}

export function MemberInviteModal(props: MemberInviteModalProps): JSX.Element {
	const { stages, invites } = props;
	const tab = useSignal<"invite" | "pending">("invite");
	const emails = useSignal<string[]>([]);
	const role = useSignal<string>("freelancer");
	const stageId = useSignal<string>(props.defaultStageId ?? "");

	const stageOptions = [
		{ label: "Whole project (no stage)", value: "" },
		...stages.map((s) => ({ label: s.name, value: s.id })),
	];
	const validEmails = emails.value.filter((e) => /.+@.+\..+/.test(e.trim()));

	function send(): void {
		if (validEmails.length === 0) return;
		props.onInvite(validEmails, role.value as MemberRole, stageId.value || null);
		emails.value = [];
		tab.value = "pending";
	}

	return (
		<Dialog
			visible={props.open}
			header="Invite members"
			width="34rem"
			onVisibleChange={(v) => !v && props.onClose()}
			class="mem-dialog mem-invite"
		>
			<div class="mem-tabs" role="tablist" aria-label="Invite views">
				<button
					type="button"
					role="tab"
					class="mem-tab"
					aria-selected={tab.value === "invite"}
					data-active={tab.value === "invite" ? "true" : undefined}
					onClick={() => (tab.value = "invite")}
				>
					Invite people
				</button>
				<button
					type="button"
					role="tab"
					class="mem-tab"
					aria-selected={tab.value === "pending"}
					data-active={tab.value === "pending" ? "true" : undefined}
					onClick={() => (tab.value = "pending")}
				>
					Pending{invites.length > 0 ? ` (${invites.length})` : ""}
				</button>
			</div>

			{tab.value === "invite"
				? (
					<div class="mem-invite__form" role="tabpanel">
						<label class="mem-field">
							<span class="mem-field__label">Email addresses</span>
							<Chips
								fluid
								placeholder="name@company.com — press Enter"
								value={emails}
								aria-label="Invitee emails"
							/>
							<span class="mem-field__hint">
								Add one or more — press Enter or comma between each.
							</span>
						</label>

						<div class="mem-invite__row">
							<label class="mem-field">
								<span class="mem-field__label">Role</span>
								<Select
									fluid
									options={ASSIGNABLE_ROLES.map((r) => ({ label: r.label, value: r.value }))}
									value={role}
									aria-label="Invite role"
								/>
							</label>
							{stages.length > 0 && (
								<label class="mem-field">
									<span class="mem-field__label">Assign to stage</span>
									<Select
										fluid
										options={stageOptions}
										value={stageId}
										aria-label="Assign to stage"
									/>
								</label>
							)}
						</div>

						<div class="mem-dialog__foot">
							<Button
								variant="text"
								severity="secondary"
								label="Cancel"
								onClick={() => (props.open.value = false)}
							/>
							<Button
								variant="filled"
								label={validEmails.length > 1
									? `Send ${validEmails.length} invites`
									: "Send invite"}
								disabled={validEmails.length === 0}
								onClick={send}
							/>
						</div>
					</div>
				)
				: (
					<div class="mem-pending" role="tabpanel">
						{invites.length === 0
							? (
								<div class="mem-empty" role="status">
									<p class="mem-empty__title">No pending invitations</p>
									<p class="mem-empty__note">
										Invites you send will appear here until they're accepted.
									</p>
								</div>
							)
							: (
								<ul class="mem-pending__list">
									{invites.map((inv) => (
										<li key={inv.id} class="mem-pending__item">
											<div class="mem-pending__main">
												<span class="mem-pending__email">{inv.email}</span>
												<span class="mem-pending__meta">
													<MemberRoleBadge role={inv.role} />
													{inv.stageName && <span class="mem-stagechip">{inv.stageName}</span>}
													<Tag
														value={inv.status === "expired" ? "Expired" : "Pending"}
														severity={inv.status === "expired" ? "warning" : "info"}
														variant="subtle"
														rounded
													/>
													<span class="mem-pending__age">{inv.invitedLabel}</span>
												</span>
											</div>
											<div class="mem-pending__actions">
												<button
													type="button"
													class="mem-iconbtn"
													aria-label={`Resend invite to ${inv.email}`}
													onClick={() => props.onResend(inv.id)}
												>
													{ResendIcon}
												</button>
												<button
													type="button"
													class="mem-iconbtn mem-iconbtn--danger"
													aria-label={`Cancel invite to ${inv.email}`}
													onClick={() => props.onCancel(inv.id)}
												>
													{CloseIcon}
												</button>
											</div>
										</li>
									))}
								</ul>
							)}
					</div>
				)}
		</Dialog>
	);
}
