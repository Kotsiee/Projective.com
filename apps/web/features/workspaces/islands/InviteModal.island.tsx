import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { CAPABILITY_LABEL, type WorkspaceDetail } from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { closeInvite, inviteModalOpen, inviteSeedRoleId } from "../core/workspace-state.ts";

/**
 * InviteModal — bring somebody in, by handle or by email.
 *
 * **Two routes to the same act, because the obstacle differs.** A handle works when they are already
 * here; an email when they are not yet. An invitation always names one person or one address and only
 * that invitee can accept it — there are no shareable join links, because a link that silently carries a
 * role is the one invitation mechanism nobody audits.
 *
 * **The role is chosen at invite time and previewed in full.** An invitation is a permission grant that
 * happens to arrive later, so the modal shows what the chosen role will let them do BEFORE it is sent.
 * The owner seat is never on offer: ownership moves only by transfer, from the owner themselves.
 */

export interface InviteModalProps {
	workspace: WorkspaceDetail;
	onUpdated: (next: WorkspaceDetail) => void;
}

/** How the invitee is addressed. */
type Mode = "handle" | "email";

export default function InviteModal(props: InviteModalProps): JSX.Element {
	const ws = props.workspace;
	/**
	 * Every role this viewer may offer: never the owner seat, and never one carrying a permission the
	 * viewer does not hold themselves — offering a role is granting it, and the database refuses that, so
	 * the picker does not present a choice that can only fail.
	 */
	const held = new Set(ws.viewerCapabilities);
	const offerable = ws.roles.filter((r) =>
		r.basePreset !== "owner" && r.capabilities.every((c) => held.has(c))
	);
	const mode = useSignal<Mode>("handle");
	const target = useSignal("");
	const roleId = useSignal<string>(
		inviteSeedRoleId.value ?? offerable.find((r) => r.preset === "member")?.id ??
			offerable[0]?.id ?? "",
	);
	const note = useSignal("");
	const sending = useSignal(false);
	const error = useSignal<string | null>(null);

	const role = useComputed(() => offerable.find((r) => r.id === roleId.value) ?? null);

	function reset(): void {
		target.value = "";
		note.value = "";
		error.value = null;
		sending.value = false;
	}

	async function send(): Promise<void> {
		error.value = null;
		const value = target.value.trim();
		if (value.length === 0) {
			error.value = mode.value === "handle" ? "Enter a handle." : "Enter an email address.";
			return;
		}
		if (!role.value) {
			error.value = "Choose the role they will hold.";
			return;
		}

		sending.value = true;
		const res = await WorkspaceService.invite({
			kind: ws.kind,
			workspaceId: ws.id,
			handle: mode.value === "handle" ? value.replace(/^@/, "") : undefined,
			email: mode.value === "email" ? value : undefined,
			roleId: role.value.id,
			note: note.value.trim() || undefined,
		});
		sending.value = false;
		if (!res.ok || !res.data) {
			error.value = res.errors?.handle ?? res.errors?.email ?? res.errors?.roleId ??
				res.errors?.note ?? res.message ?? "Could not send that invitation.";
			return;
		}
		props.onUpdated(res.data);
		closeInvite();
		reset();
	}

	return (
		<Dialog
			visible={inviteModalOpen}
			header={`Invite to ${ws.name}`}
			modal
			width="30rem"
			class="wsp-inviteform"
			onVisibleChange={(open) => {
				if (!open) {
					closeInvite();
					reset();
				}
			}}
			footer={
				<div class="wsp-inviteform__actions">
					<Button
						variant="text"
						label="Cancel"
						onClick={() => {
							closeInvite();
							reset();
						}}
					/>
					<Button
						variant="filled"
						label={sending.value ? "Sending…" : "Send invitation"}
						disabled={sending.value}
						onClick={send}
					/>
				</div>
			}
		>
			<div class="wsp-inviteform__row" role="radiogroup" aria-label="How to invite">
				{(["handle", "email"] as const).map((m) => (
					<button
						key={m}
						type="button"
						role="radio"
						aria-checked={mode.value === m}
						class="wsp-create__kind"
						data-on={mode.value === m ? "true" : undefined}
						data-kind={ws.kind}
						onClick={() => {
							mode.value = m;
							error.value = null;
						}}
					>
						<span class="wsp-create__kind-name">
							{m === "handle" ? "By handle" : "By email"}
						</span>
						<span class="wsp-create__kind-note">
							{m === "handle" ? "They are already here" : "They are not yet"}
						</span>
					</button>
				))}
			</div>

			<div class="wsp-inviteform__field">
				<label class="wsp-inviteform__label" for="wsp-invite-target">
					{mode.value === "handle" ? "Handle" : "Email address"}
				</label>
				<InputText
					id="wsp-invite-target"
					value={target}
					onValueChange={(v) => {
						target.value = v;
						error.value = null;
					}}
					placeholder={mode.value === "handle" ? "ravi" : "name@company.com"}
					type={mode.value === "email" ? "email" : "text"}
					start={mode.value === "handle" ? "@" : undefined}
					block
					maxLength={160}
				/>
			</div>

			<div class="wsp-inviteform__field">
				<label class="wsp-inviteform__label" for="wsp-invite-role">Role</label>
				<select
					id="wsp-invite-role"
					class="wsp-select"
					value={roleId.value}
					onChange={(e) => {
						roleId.value = (e.target as HTMLSelectElement).value;
					}}
				>
					{offerable.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name}
							{r.preset ? "" : " (custom)"}
						</option>
					))}
				</select>
				{/* What the role actually permits, BEFORE the invitation goes out. */}
				{role.value && (
					<div class="wsp-inviteform__preview">
						<p class="wsp-inviteform__hint">{role.value.summary}</p>
						<p class="wsp-inviteform__preview-caps">
							{role.value.capabilities.length === 0
								? "No special permissions — they can see the workspace and take part."
								: role.value.capabilities.map((c) => CAPABILITY_LABEL[c]).join(" · ")}
						</p>
					</div>
				)}
			</div>

			<div class="wsp-inviteform__field">
				<label class="wsp-inviteform__label" for="wsp-invite-note">Note (optional)</label>
				<InputText
					id="wsp-invite-note"
					value={note}
					onValueChange={(v) => {
						note.value = v;
					}}
					placeholder={`Come and help us on ${ws.name}`}
					block
					maxLength={400}
				/>
			</div>

			<p class="wsp-inviteform__hint">
				The invitation lasts 14 days. You can resend or withdraw it from the invitations queue.
			</p>

			{error.value && <p class="wsp-inviteform__error" role="alert">{error.value}</p>}
		</Dialog>
	);
}
