import type { JSX, VNode } from "preact";
import { batch, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Dialog, InlineNotice, ProgressSpinner } from "@projective/ui/feedback";
import {
	Button,
	FieldLegend,
	FormControl,
	InputText,
	useFieldValidation,
} from "@projective/ui/fields";
import { Link } from "@projective/ui/navigation";
import {
	CreateWorkspaceInputSchema,
	WORKSPACE_HANDLE_MAX,
	WORKSPACE_NAME_MAX,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { PayoutGateLink } from "@features/settings/components/PayoutGateLink.tsx";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { settingsHref } from "@features/settings/core/settings-registry.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { closeCreate, createModalOpen, createSeedKind } from "../core/workspace-state.ts";
import { CheckGlyph, cloneGlyph, DeclineGlyph } from "../core/workspace-glyphs.tsx";
import { handleProblem } from "../core/handle-check.ts";
import {
	classifyCreateRefusal,
	CREATE_FAILED,
	createCopy,
	createFooterActions,
	createGateOpen,
	type CreateRefusal,
	type HandleFieldPhase,
	handleFromName,
	handleLiveLine,
	type HandleLiveTone,
	isPlainEnter,
	nameProblem,
	normalizeHandleInput,
	recheckAction,
	suggestionActions,
	tierProps,
	visibleSuggestions,
} from "../core/create-model.ts";
import { useHandleCheck } from "../hooks/useHandleCheck.ts";

/**
 * CreateWorkspaceModal — the Draft-First creation dialog for a team or a business.
 *
 * **Name plus `@handle` is the whole form.** The entity is created at once as a draft and the reader
 * lands INSIDE it, where a checklist invites the rest (logo, bio, members, payouts, verification) —
 * reachable, never blocking. A wizard in front of a first team is how people decide not to have one.
 *
 * **The handle check is live and server-authoritative** (`hooks/useHandleCheck.ts`): the claim rule
 * the database applies (length, charset, reserved words) is settled locally from the SSOT, and only
 * the question the client cannot answer — is it free across people, teams, businesses and
 * enterprises — is asked, debounced and sequenced. A taken handle comes back with up to three free
 * alternatives, offered as one-tap text buttons.
 *
 * **Validation paints at rest** (§A.7): each field is a `FormControl` driven by
 * `useFieldValidation`, so a problem shows after the reader leaves THAT field and its paint clears
 * while they are back in it. A handle mirrored from the name may never be visited, so once the name is
 * left the polite live line says why it cannot be had — without marking the handle field invalid
 * before the reader has had a turn in it.
 *
 * **One filled control** (§B.8.1): the tier-2 structural commit, enabled only for a valid name and a
 * handle the namespace has just called available. Every button takes its tone from `tierProps` and
 * every rule the dialog renders lives in `core/create-model.ts`, where it is unit-tested.
 *
 * Shared by `/teams` and `/businesses` (Decision #61): the kind is fixed by the route that mounts it
 * and is never asked (BU1). `Dialog` portals to `document.body`, so the lane's glass chrome cannot
 * clip it.
 */

/** The form's id — the footer's commit sits outside the body and submits it by reference. */
const FORM_ID = "wsp-create-form";

/** Where a plan's limits are raised: Settings → Billing, at the plan. */
const PLAN_HREF = settingsHref("billing", "plan");

export interface CreateWorkspaceModalProps {
	/**
	 * The route's kind (`/teams`, `/businesses`). Omitted, the dialog creates the kind its trigger
	 * seeded (`openCreate(kind)`) — it never asks.
	 */
	kind?: WorkspaceKind;
}

export default function CreateWorkspaceModal(props: CreateWorkspaceModalProps): JSX.Element {
	const kind: WorkspaceKind = props.kind ?? createSeedKind.value;

	const name = useSignal("");
	const handle = useSignal("");
	/** The reader has typed into the handle, so the name stops being mirrored into it. */
	const handleEdited = useSignal(false);
	const submitting = useSignal(false);
	const refusal = useSignal<CreateRefusal | null>(null);

	const checker = useHandleCheck();
	const nameField = useFieldValidation({ problem: () => nameProblem(name.value) });
	const handleField = useFieldValidation({ problem: () => handleProblem(checker.state.value) });

	/** Initial focus: the dialog resolves this scope to the name input inside it. */
	const nameScope = useRef<HTMLDivElement>(null);
	/** The handle field's scope, so Enter in the name, a suggestion or a retry can put the caret in it. */
	const handleScope = useRef<HTMLDivElement>(null);

	const check = checker.state.value;
	const copy = createCopy(kind);
	const [cancelAction, createAction] = createFooterActions(kind, {
		name: name.value,
		handle: check,
		submitting: submitting.value,
	});
	const phase: HandleFieldPhase = {
		nameLeft: nameField.touched.value,
		handleEdited: handleEdited.value,
		handleRevealed: handleField.revealed.value,
	};
	const live = handleLiveLine(check, phase);
	const recheck = recheckAction(check);
	const suggestions = visibleSuggestions(check, phase);

	// #region Handlers
	/** Clear every field and verdict, so a dismissed draft never reappears half-filled. */
	function reset(): void {
		batch(() => {
			name.value = "";
			handle.value = "";
			handleEdited.value = false;
			submitting.value = false;
			refusal.value = null;
			nameField.reset();
			handleField.reset();
		});
		checker.reset();
	}

	function close(): void {
		closeCreate();
		reset();
	}

	function onNameInput(value: string): void {
		name.value = value;
		refusal.value = null;
		if (handleEdited.peek()) return;
		// Mirror the name into the handle until the reader takes it over — the common case is no typing.
		const derived = handleFromName(value);
		handle.value = derived;
		checker.input(derived);
	}

	/** Put the caret in the handle field. */
	function focusHandle(): void {
		handleScope.current?.querySelector<HTMLInputElement>("input")?.focus();
	}

	/** Enter in the name walks forward to the handle, as the keyboard's "next" label says. */
	function onNameKeyDown(event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
		if (event.defaultPrevented || !isPlainEnter(event)) return;
		event.preventDefault();
		focusHandle();
	}

	function onHandleInput(value: string): void {
		const next = normalizeHandleInput(value);
		handle.value = next;
		// Clearing the field hands it back to the name.
		handleEdited.value = next !== "";
		refusal.value = null;
		checker.input(next);
	}

	function applySuggestion(next: string): void {
		handle.value = next;
		handleEdited.value = true;
		refusal.value = null;
		checker.input(next);
		focusHandle();
	}

	/**
	 * Ask again after an unanswered probe. The retry leaves with the failure it answers, so the caret
	 * goes back to the handle rather than falling to the page with the unmounted button.
	 */
	function onRecheck(): void {
		checker.recheck();
		focusHandle();
	}

	async function submit(): Promise<void> {
		const state = checker.state.peek();
		if (!createGateOpen({ name: name.peek(), handle: state, submitting: submitting.peek() })) {
			return;
		}
		const parsed = CreateWorkspaceInputSchema.safeParse({
			kind,
			name: name.peek().trim(),
			handle: state.handle,
		});
		if (!parsed.success) {
			refusal.value = {
				reason: "other",
				message: parsed.error.issues[0]?.message ?? CREATE_FAILED,
			};
			return;
		}

		batch(() => {
			submitting.value = true;
			refusal.value = null;
		});
		const res = await WorkspaceService.create(parsed.data);
		if (!res.ok || !res.data) {
			const why = classifyCreateRefusal(res);
			batch(() => {
				submitting.value = false;
				refusal.value = why;
				if (why.reason === "handle") handleField.touched.value = true;
			});
			// The handle went between the check and the create: ask the namespace again, which also
			// brings back the free alternatives.
			if (why.reason === "handle") checker.recheck();
			return;
		}

		const created = res.data;
		close();
		// Land INSIDE the new draft, at its handle — the console's one address. Deliberately no context
		// switch: creating a team is not the same act as beginning to work as it.
		globalThis.location.assign(workspaceHref(created.kind, created.handle));
	}
	// #endregion

	return (
		<Dialog
			visible={createModalOpen}
			header={copy.header}
			modal
			width="27rem"
			initialFocusRef={nameScope}
			onVisibleChange={(open) => {
				if (!open) close();
			}}
			footer={
				<div class="wsp-create__actions">
					<Button
						{...tierProps(cancelAction.tier)}
						label={cancelAction.label}
						disabled={cancelAction.disabled}
						onClick={close}
					/>
					<Button
						{...tierProps(createAction.tier)}
						type="submit"
						form={FORM_ID}
						label={createAction.label}
						disabled={createAction.disabled}
						loading={submitting.value}
					/>
				</div>
			}
		>
			<form
				id={FORM_ID}
				class="wsp-create"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<p class="wsp-create__intro">{copy.intro}</p>

				<div ref={nameScope}>
					<FormControl
						label="Display name"
						required
						hint="You can change this later."
						status={nameField.hintStatus.value}
						error={nameField.message.value ?? undefined}
					>
						{({ id, describedBy, required }) => (
							<InputText
								id={id}
								aria-describedby={describedBy}
								required={required}
								value={name}
								onValueChange={onNameInput}
								status={nameField.status.value}
								onFocus={nameField.handlers.onFocus}
								onBlur={nameField.handlers.onBlur}
								onKeyDown={onNameKeyDown}
								placeholder={copy.namePlaceholder}
								maxLength={WORKSPACE_NAME_MAX}
								autoComplete="off"
								enterKeyHint="next"
								block
							/>
						)}
					</FormControl>
				</div>

				<div ref={handleScope} class="wsp-create__handle">
					<FormControl
						label="Handle"
						required
						hint="Lowercase letters, numbers and hyphens. It is also your public address."
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
								placeholder={copy.handlePlaceholder}
								maxLength={WORKSPACE_HANDLE_MAX}
								autoCapitalize="none"
								spellcheck={false}
								autoComplete="off"
								enterKeyHint="go"
								block
							/>
						)}
					</FormControl>

					<div class="wsp-create__status">
						{
							/*
							 * The live line. The answer arrives asynchronously, so it is announced rather
							 * than left for a screen reader to go looking for; it stays mounted and empty
							 * between answers so the region exists before the first one. The retry sits
							 * beside it, outside the region, so its label is not read as part of the news.
							 */
						}
						<p class="wsp-create__check" role="status" aria-live="polite">
							{live && (
								<>
									<LiveMark tone={live.tone} />
									<span>{live.text}</span>
								</>
							)}
						</p>
						{recheck && (
							<Button
								{...tierProps(recheck.tier)}
								size="sm"
								label={recheck.label}
								disabled={recheck.disabled}
								onClick={onRecheck}
							/>
						)}
					</div>

					{suggestions.length > 0 && (
						<div class="wsp-create__suggest" role="group" aria-label="Free alternatives">
							<span class="wsp-create__suggest-label" aria-hidden="true">Try</span>
							<div class="wsp-create__suggest-list">
								{suggestionActions(suggestions).map((action, i) => (
									<Button
										key={action.key}
										{...tierProps(action.tier)}
										size="sm"
										label={action.label}
										disabled={action.disabled}
										onClick={() => applySuggestion(suggestions[i])}
									/>
								))}
							</div>
						</div>
					)}
				</div>

				<FieldLegend text="Required to create the draft" />

				{refusal.value && <RefusalNotice refusal={refusal.value} />}
			</form>
		</Dialog>
	);
}

// #region Live line
/**
 * The live line's leading mark: a spinner while the namespace is asked, a tick for a free handle, a
 * decline for one that cannot be had. Decorative — the sentence beside it carries the meaning — so a
 * failed probe, whose retry already marks the line, draws none.
 */
function LiveMark({ tone }: { tone: HandleLiveTone }): VNode | null {
	if (tone === "failed") return null;
	return (
		<span class="wsp-create__check-mark" data-tone={tone} aria-hidden="true">
			{tone === "checking"
				? <ProgressSpinner size={14} strokeWidth={2} aria-label="Checking" />
				: cloneGlyph(tone === "available" ? CheckGlyph : DeclineGlyph)}
		</span>
	);
}
// #endregion

// #region Refusal
/**
 * A refused create, inside the dialog where the reader can act on it — never a toast that is gone
 * before it is read. Each refusal carries its own fix: the earning gate links to Settings →
 * Verification, the plan cap to the plan; the persona gate has no fix here, and a lost handle is
 * already being re-checked above.
 */
function RefusalNotice({ refusal }: { refusal: CreateRefusal }): JSX.Element {
	return (
		<InlineNotice
			assertive
			align="start"
			class="wsp-create__refusal"
			icon={<span class="wsp-create__refusal-mark">{cloneGlyph(DeclineGlyph)}</span>}
		>
			<span>{refusal.message}</span>
			{
				/* A word space, not a margin, before the fix: when it wraps to its own line it starts
				 * flush with the sentence, and its label never breaks (workspace-roster.css). */
			}
			{(refusal.reason === "payout" || refusal.reason === "entitlement") && " "}
			{refusal.reason === "payout" && <PayoutGateLink details={refusal.details} />}
			{refusal.reason === "entitlement" && (
				<Link
					href={PLAN_HREF}
					onClick={(event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
						if (
							event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
							event.button !== 0
						) return;
						event.preventDefault();
						openSettings("billing", "plan");
					}}
				>
					See plans
				</Link>
			)}
		</InlineNotice>
	);
}
// #endregion
