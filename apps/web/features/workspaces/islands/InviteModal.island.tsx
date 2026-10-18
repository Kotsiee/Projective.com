import type { JSX, VNode } from "preact";
import { batch, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { Dialog, InlineNotice, ProgressSpinner } from "@projective/ui/feedback";
import {
	Button,
	FormControl,
	InputText,
	Select,
	SelectButton,
	Textarea,
	useFieldValidation,
} from "@projective/ui/fields";
import { CAPABILITY_LABEL, kindCopy, type WorkspaceDetail } from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { closeInvite, inviteModalOpen, inviteSeedRoleId } from "../core/workspace-state.ts";
import {
	grantableRoles,
	INVITE_EMAIL_MAX,
	INVITE_MODES,
	inviteCounts,
	inviteEmailProblem,
	inviteFooter,
	type InviteGateInput,
	inviteGateOpen,
	type InviteHandleLine,
	inviteHandleLine,
	inviteHandleProblem,
	type InviteMode,
	inviteRefusalText,
	inviteRoleSeed,
	inviteSeatItems,
	membersTierProps,
	normalizeInviteHandle,
	roleOptions,
	seatsFull,
} from "../core/members-model.ts";
import { useHandleCheck } from "../hooks/useHandleCheck.ts";

/**
 * InviteModal — bring somebody in, by handle or by email.
 *
 * **Two routes to the same act** — a handle when they are already here, an email when they are not
 * yet — chosen with a `SelectButton`. An invitation always names one person or one address and only
 * that invitee can accept it; there are no shareable join links.
 *
 * **The handle is looked up live** with R3's `useHandleCheck` (the one handle binding every form
 * shares). That check asks the shared handle namespace — people, teams, businesses, enterprises and
 * the 90-day holds — so it can say for certain only that NOBODY holds a handle (a problem on the
 * field). A taken handle may be an entity's, so the line never claims a person was found: it says the
 * server looks the handle up on send, which resolves people only (`inviteHandleLine` /
 * `inviteHandleProblem`). The entity's own handle and a current member's are refused outright. A
 * username the entity claim rule cannot judge (it may hold `.` or `_`) is likewise left for the server.
 *
 * **The role list holds only roles the inviter may grant** — never the owner seat, never one carrying
 * a capability they lack (`grantableRoles`, the mirror of `org.invite_workspace_member`) — and what the
 * chosen role permits is said before the invitation goes out. The plan's free seats and the pending
 * count are a MetaLine; a full plan closes Send and says why.
 *
 * Every field is a `FormControl` (§A.7 rest-only validation paint); "Send invitation" is the dialog's
 * one filled control (tier 3), Cancel tier 5. Its trigger in the lane footer rig, "Invite members", is
 * a tier-4 utility (`core/rig-model.ts`). Shared by teams and businesses (Decision #61).
 */

/** The form's id — the footer's commit sits outside the body and submits it by reference. */
const FORM_ID = "wsp-invite-form";

export interface InviteModalProps {
	workspace: WorkspaceDetail;
	onUpdated: (next: WorkspaceDetail) => void;
}

export default function InviteModal(props: InviteModalProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const grantable = grantableRoles(ws.roles, ws.viewerCapabilities);
	const memberHandles = new Set(ws.members.map((m) => m.handle.toLowerCase()));
	/** Only unexpired invitations hold a seat, so only they are "pending" beside the seat count. */
	const live = inviteCounts(ws.invites, Date.now()).live;

	const mode = useSignal<InviteMode>("handle");
	const handle = useSignal("");
	const email = useSignal("");
	const roleId = useSignal(inviteRoleSeed(grantable, inviteSeedRoleId.peek()));
	const note = useSignal("");
	const sending = useSignal(false);
	const refusal = useSignal<string | null>(null);

	const checker = useHandleCheck();
	const handleField = useFieldValidation({
		problem: () => inviteHandleProblem(checker.state.value, memberHandles, ws.kind, ws.handle),
	});
	const emailField = useFieldValidation({ problem: () => inviteEmailProblem(email.value) });

	/** Initial focus: the dialog resolves this scope to the address input inside it. */
	const addressScope = useRef<HTMLDivElement>(null);
	/** The roles on offer as of the latest render, for the effect that seeds the picker on open. */
	const offer = useRef(grantable);
	offer.current = grantable;

	// The picker opens on the role the trigger implied, re-read every time the dialog opens.
	useSignalEffect(() => {
		if (!inviteModalOpen.value) return;
		roleId.value = inviteRoleSeed(offer.current, inviteSeedRoleId.value);
	});

	const gate: InviteGateInput = {
		mode: mode.value,
		handle: checker.state.value,
		email: email.value,
		roleId: roleId.value,
		sending: sending.value,
		seats: ws.seats,
		memberHandles,
		kind: ws.kind,
		ownHandle: ws.handle,
	};
	const [cancel, send] = inviteFooter(gate);
	const line = mode.value === "handle"
		? inviteHandleLine(checker.state.value, memberHandles, ws.handle)
		: null;
	const role = grantable.find((r) => r.id === roleId.value) ?? null;
	const full = seatsFull(ws.seats);

	// #region Handlers
	/** Clear every field and verdict, so a dismissed draft never reappears half-filled. */
	function reset(): void {
		batch(() => {
			mode.value = "handle";
			handle.value = "";
			email.value = "";
			note.value = "";
			sending.value = false;
			refusal.value = null;
			handleField.reset();
			emailField.reset();
		});
		checker.reset();
	}

	function close(): void {
		closeInvite();
		reset();
	}

	function onHandleInput(value: string): void {
		const next = normalizeInviteHandle(value);
		handle.value = next;
		refusal.value = null;
		checker.input(next);
	}

	async function submit(): Promise<void> {
		const current: InviteGateInput = {
			...gate,
			mode: mode.peek(),
			handle: checker.state.peek(),
			email: email.peek(),
			roleId: roleId.peek(),
			sending: sending.peek(),
		};
		if (!inviteGateOpen(current)) {
			if (current.mode === "handle") handleField.touched.value = true;
			else emailField.touched.value = true;
			return;
		}
		const byHandle = current.mode === "handle";
		const addressee = byHandle ? `@${handle.peek()}` : email.peek().trim();
		batch(() => {
			sending.value = true;
			refusal.value = null;
		});
		const res = await WorkspaceService.invite({
			kind: ws.kind,
			workspaceId: ws.id,
			handle: byHandle ? handle.peek() : undefined,
			email: byHandle ? undefined : email.peek().trim(),
			roleId: current.roleId,
			note: note.peek().trim() || undefined,
		});
		if (!res.ok || !res.data) {
			batch(() => {
				sending.value = false;
				refusal.value = inviteRefusalText(res, addressee);
			});
			return;
		}
		props.onUpdated(res.data);
		close();
	}
	// #endregion

	return (
		<Dialog
			visible={inviteModalOpen}
			header={`Invite to ${ws.name}`}
			modal
			width="30rem"
			initialFocusRef={addressScope}
			onVisibleChange={(open) => {
				if (!open) close();
			}}
			footer={
				<div class="wsp-dialog__actions">
					<Button {...membersTierProps(cancel.tier)} label={cancel.label} onClick={close} />
					<Button
						{...membersTierProps(send.tier)}
						type="submit"
						form={FORM_ID}
						label={send.label}
						disabled={send.disabled}
						loading={send.busy}
					/>
				</div>
			}
		>
			<form
				id={FORM_ID}
				class="wsp-dialog"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<MetaLine class="wsp-dialog__meta" items={inviteSeatItems(ws.seats, live)} />

				<FormControl
					label="How to reach them"
					hint={INVITE_MODES.find((m) => m.value === mode.value)?.note}
				>
					{({ id, describedBy }) => (
						<SelectButton
							id={id}
							aria-label="How to reach them"
							aria-describedby={describedBy}
							options={INVITE_MODES.map(({ value, label }) => ({ value, label }))}
							value={mode}
							onValueChange={() => (refusal.value = null)}
						/>
					)}
				</FormControl>

				<div ref={addressScope} class="wsp-dialog__field">
					{mode.value === "handle"
						? (
							<>
								<FormControl
									label="Handle"
									required
									hint="Their @handle on Projective."
									status={handleField.hintStatus.value}
									error={handleField.message.value ?? undefined}
								>
									{({ id, describedBy, required }) => (
										<InputText
											id={id}
											aria-describedby={describedBy}
											required={required}
											value={handle}
											onValueChange={onHandleInput}
											status={handleField.status.value}
											onFocus={handleField.handlers.onFocus}
											onBlur={handleField.handlers.onBlur}
											start="@"
											placeholder="ravi"
											maxLength={40}
											autoCapitalize="none"
											spellcheck={false}
											autoComplete="off"
											block
										/>
									)}
								</FormControl>
								{
									/*
									 * The lookup's live line — a polite region, mounted and empty between answers so it
									 * exists before the first one.
									 */
								}
								<p class="wsp-dialog__check" role="status" aria-live="polite">
									{line && (
										<>
											<LiveMark tone={line.tone} />
											<span>{line.text}</span>
										</>
									)}
								</p>
							</>
						)
						: (
							<FormControl
								label="Email address"
								required
								hint="They join with this address."
								status={emailField.hintStatus.value}
								error={emailField.message.value ?? undefined}
							>
								{({ id, describedBy, required }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										required={required}
										type="email"
										value={email}
										onValueChange={() => (refusal.value = null)}
										status={emailField.status.value}
										onFocus={emailField.handlers.onFocus}
										onBlur={emailField.handlers.onBlur}
										placeholder="name@company.com"
										maxLength={INVITE_EMAIL_MAX}
										autoComplete="off"
										block
									/>
								)}
							</FormControl>
						)}
				</div>

				<div class="wsp-dialog__field">
					<FormControl
						label="Role"
						required
						hint={role?.summary || `The role they hold when they join this ${copy.noun}.`}
					>
						{({ id, describedBy, required }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								required={required}
								options={roleOptions(grantable)}
								value={roleId}
								onValueChange={() => (refusal.value = null)}
								placeholder="Choose a role"
								fluid
							/>
						)}
					</FormControl>
					{
						/* What the role permits, BEFORE the invitation goes out — facts, so a MetaLine. */
					}
					{role && (
						<MetaLine
							size="xs"
							class="wsp-dialog__caps"
							items={role.capabilities.length === 0
								? ["No special permissions — they see the workspace and take part"]
								: role.capabilities.map((c) => CAPABILITY_LABEL[c])}
						/>
					)}
				</div>

				<FormControl label="Note" hint="Optional. They read it with the invitation.">
					{({ id, describedBy }) => (
						<Textarea
							id={id}
							aria-describedby={describedBy}
							value={note}
							rows={2}
							autoResize
							maxRows={6}
							maxLength={400}
							placeholder={`Come and help us on ${ws.name}`}
							fluid
						/>
					)}
				</FormControl>

				<p class="wsp-dialog__intro">
					The invitation lasts 14 days. You can resend or withdraw it from Invitations.
				</p>

				{grantable.length === 0 && (
					<InlineNotice
						align="start"
						text={`You can offer only a role whose permissions you hold yourself, and none of this ${copy.noun}'s roles fits. Ask an admin to invite them.`}
					/>
				)}
				{full && (
					<InlineNotice
						align="start"
						text={`Every seat on the ${copy.noun}'s plan is taken or offered. Withdraw an invitation or upgrade the plan to invite someone else.`}
					/>
				)}
				{refusal.value && <InlineNotice assertive align="start" text={refusal.value} />}
			</form>
		</Dialog>
	);
}

// #region Live line
/**
 * The live line's leading mark: a spinner while the namespace is asked, and nothing otherwise — the
 * lookup never confirms a person (only the server can), so no line earns a success tick. Decorative:
 * the sentence beside it carries the meaning.
 */
function LiveMark({ tone }: { tone: InviteHandleLine["tone"] }): VNode | null {
	if (tone !== "checking") return null;
	return (
		<span class="wsp-dialog__check-mark" aria-hidden="true">
			<ProgressSpinner size={14} strokeWidth={2} aria-label="Looking up" />
		</span>
	);
}
// #endregion
