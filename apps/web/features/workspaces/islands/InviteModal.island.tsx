import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { CAPABILITY_LABEL, kindCopy, type WorkspaceDetail } from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { closeInvite, inviteModalOpen, inviteSeedRoleId } from "../core/workspace-state.ts";

/**
 * InviteModal — bring somebody in, by handle, by email, or by a shareable link.
 *
 * **Three routes to the same act, because the obstacle differs each time.** A handle works when they
 * are already here; an email when they are not yet; a link when you do not know who yet (a cohort, a
 * hiring round). Collapsing them into one field would force the user to know which case they are in
 * before they can start.
 *
 * **The role is chosen at invite time and previewed in full.** An invitation is a permission grant that
 * happens to arrive later, so the modal shows what the chosen role will let them do BEFORE it is sent —
 * discovering that a "Member" could withdraw funds after they accepted is the wrong order.
 */

export interface InviteModalProps {
	workspace: WorkspaceDetail;
	onUpdated: (next: WorkspaceDetail) => void;
}

/** How the invitee is addressed. */
type Mode = "handle" | "email" | "link";

export default function InviteModal(props: InviteModalProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);

	const mode = useSignal<Mode>("handle");
	const target = useSignal("");
	const roleId = useSignal<string>(
		inviteSeedRoleId.value ?? ws.roles.find((r) => r.preset === "member")?.id ?? ws.roles[0]?.id ??
			"member",
	);
	const note = useSignal("");
	const sending = useSignal(false);
	const error = useSignal<string | null>(null);
	const linkIssued = useSignal<string | null>(null);

	const role = useComputed(() => ws.roles.find((r) => r.id === roleId.value) ?? null);

	function reset(): void {
		target.value = "";
		note.value = "";
		error.value = null;
		sending.value = false;
		linkIssued.value = null;
	}

	async function send(): Promise<void> {
		error.value = null;

		if (mode.value === "link") {
			// A share link is issued locally against the chosen role; the server mints the real token when
			// the first person redeems it, so nothing here is a credential.
			linkIssued.value = `${globalThis.location?.origin ?? ""}${
				kindCopy(ws.kind).base
			}/${ws.id}?join=${roleId.value}`;
			return;
		}

		const value = target.value.trim();
		if (value.length === 0) {
			error.value = mode.value === "handle" ? "Enter a handle." : "Enter an email address.";
			return;
		}

		sending.value = true;
		const res = await WorkspaceService.invite({
			workspaceId: ws.id,
			handle: mode.value === "handle" ? value.replace(/^@/, "") : undefined,
			email: mode.value === "email" ? value : undefined,
			roleId: roleId.value,
			note: note.value.trim() || undefined,
		});
		sending.value = false;
		if (!res.ok || !res.data) {
			error.value = res.errors?.handle ?? res.errors?.email ?? res.message ??
				"Could not send that invitation.";
			return;
		}
		props.onUpdated(res.data.workspace);
		closeInvite();
		reset();
	}

	async function copyLink(): Promise<void> {
		if (!linkIssued.value) return;
		try {
			await navigator.clipboard.writeText(linkIssued.value);
		} catch { /* clipboard unavailable — the field is selectable as a fallback */ }
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
						label={mode.value === "link"
							? "Create link"
							: sending.value
							? "Sending…"
							: "Send invitation"}
						disabled={sending.value}
						onClick={send}
					/>
				</div>
			}
		>
			<div class="wsp-inviteform__row" role="radiogroup" aria-label="How to invite">
				{(["handle", "email", "link"] as const).map((m) => (
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
							{m === "handle" ? "By handle" : m === "email" ? "By email" : "Share a link"}
						</span>
						<span class="wsp-create__kind-note">
							{m === "handle"
								? "They are already here"
								: m === "email"
								? "They are not yet"
								: "You do not know who yet"}
						</span>
					</button>
				))}
			</div>

			{mode.value !== "link" && (
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
			)}

			<div class="wsp-inviteform__field">
				<label class="wsp-inviteform__label" for="wsp-invite-role">Role</label>
				<select
					id="wsp-invite-role"
					class="wsp-people__view"
					value={roleId.value}
					onChange={(e) => {
						roleId.value = (e.target as HTMLSelectElement).value;
					}}
				>
					{ws.roles.map((r) => (
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

			{mode.value !== "link" && (
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
			)}

			{linkIssued.value && (
				<div class="wsp-invites__linkrow">
					<InputText
						class="wsp-invites__linkfield"
						value={linkIssued.value}
						readOnly
						block
						aria-label="Invitation link"
					/>
					<Button variant="text" label="Copy" onClick={copyLink} />
					<p class="wsp-invites__linknote">
						Anyone with this link joins as{" "}
						{role.value?.name ?? "a member"}. Revoke it from the invitations queue.
					</p>
				</div>
			)}

			{error.value && <p class="wsp-inviteform__error" role="alert">{error.value}</p>}
		</Dialog>
	);
}
