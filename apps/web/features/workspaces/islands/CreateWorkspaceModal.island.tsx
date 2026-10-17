import type { JSX } from "preact";
import { batch, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Dialog, InlineNotice, ProgressSpinner } from "@projective/ui/feedback";
import {
	Button,
	FieldLegend,
	FormControl,
	InputText,
	SelectButton,
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
import { handleProblem, handleSuggestions } from "../core/handle-check.ts";
import {
	classifyCreateRefusal,
	CREATE_FAILED,
	createCopy,
	createFooterActions,
	createGateOpen,
	createKindMode,
	type CreateRefusal,
	handleFromName,
	KIND_CHOICES,
	nameProblem,
	normalizeHandleInput,
	suggestionActions,
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
 * `useFieldValidation`, so a problem shows after the reader leaves the field and its paint clears
 * while they are back in it. A handle mirrored from the name is revealed when the name is left, since
 * the reader may never visit the handle field at all.
 *
 * **One filled control** (§B.8.1): the tier-2 structural commit, enabled only for a valid name and a
 * handle the namespace has just called available. Every rule the dialog renders lives in
 * `core/create-model.ts`, where it is unit-tested.
 *
 * Shared by `/teams` and `/businesses` (Decision #61): the kind is fixed by the route that mounts it,
 * and asked (a `SelectButton`) only when a neutral surface mounts it without one. `Dialog` portals to
 * `document.body`, so the lane's glass chrome cannot clip it.
 */

/** The form's id — the footer's commit sits outside the body and submits it by reference. */
const FORM_ID = "wsp-create-form";

/** Where a plan's limits are raised: Settings → Billing, at the plan. */
const PLAN_HREF = settingsHref("billing", "plan");

export interface CreateWorkspaceModalProps {
	/**
	 * The kind to create. A route that already commits to one (`/teams`, `/businesses`) passes it and
	 * the dialog never asks; a neutral surface omits it and the dialog offers both.
	 */
	kind?: WorkspaceKind;
	/** Ask for the kind even inside a committed route. */
	allowKindChoice?: boolean;
}

export default function CreateWorkspaceModal(props: CreateWorkspaceModalProps): JSX.Element {
	const mode = createKindMode(props.kind, props.allowKindChoice);
	const kind: WorkspaceKind = mode === "fixed"
		? props.kind ?? createSeedKind.value
		: createSeedKind.value;

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
	/** The handle field's scope, so applying a suggestion can return the caret to it. */
	const handleScope = useRef<HTMLDivElement>(null);

	const check = checker.state.value;
	const copy = createCopy(kind, mode);
	const [cancelAction, createAction] = createFooterActions(kind, mode, {
		name: name.value,
		handle: check,
		submitting: submitting.value,
	});
	const suggestions = handleField.revealed.value ? handleSuggestions(check) : [];

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

	function onNameBlur(): void {
		nameField.handlers.onBlur();
		// A mirrored handle the reader never visits must still explain itself once they move on.
		if (!handleEdited.peek() && handle.peek() !== "") handleField.touched.value = true;
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
		handleScope.current?.querySelector<HTMLInputElement>("input")?.focus();
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
					<Button variant="text" label={cancelAction.label} onClick={close} />
					<Button
						structural
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

				{mode === "choice" && (
					<FormControl
						label="Kind"
						hint={KIND_CHOICES.find((c) => c.value === kind)?.note}
					>
						{({ id, describedBy }) => (
							<SelectButton
								id={id}
								aria-label="Kind"
								aria-describedby={describedBy}
								options={KIND_CHOICES.map(({ value, label }) => ({ value, label }))}
								value={createSeedKind}
								onValueChange={() => (refusal.value = null)}
							/>
						)}
					</FormControl>
				)}

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
								onBlur={onNameBlur}
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
								placeholder="northern-grid"
								maxLength={WORKSPACE_HANDLE_MAX}
								autoCapitalize="none"
								spellcheck={false}
								autoComplete="off"
								enterKeyHint="go"
								block
							/>
						)}
					</FormControl>

					{
						/*
						 * The live line. The answer arrives asynchronously, so it is announced rather than
						 * left for a screen reader to go looking for; it stays mounted and empty between
						 * answers so the region exists before the first one.
						 */
					}
					<p class="wsp-create__check" role="status" aria-live="polite">
						{check.status === "checking" && (
							<>
								<span class="wsp-create__check-mark" aria-hidden="true">
									<ProgressSpinner size={14} strokeWidth={2} aria-label="Checking" />
								</span>
								<span>Checking @{check.handle}…</span>
							</>
						)}
						{check.status === "available" && (
							<>
								<span class="wsp-create__check-mark" data-tone="success" aria-hidden="true">
									{cloneGlyph(CheckGlyph)}
								</span>
								<span>@{check.handle} is available</span>
							</>
						)}
						{check.failed && (
							<>
								<span>{check.reason}</span>
								<Button
									variant="text"
									size="sm"
									label="Check again"
									onClick={() => checker.recheck()}
								/>
							</>
						)}
					</p>

					{suggestions.length > 0 && (
						<div class="wsp-create__suggest" role="group" aria-label="Free alternatives">
							<span class="wsp-create__suggest-label" aria-hidden="true">Try</span>
							{suggestionActions(suggestions).map((action, i) => (
								<Button
									key={action.key}
									variant="text"
									size="sm"
									label={action.label}
									onClick={() => applySuggestion(suggestions[i])}
								/>
							))}
						</div>
					)}
				</div>

				<FieldLegend text="Required to create the draft" />

				{refusal.value && <RefusalNotice refusal={refusal.value} />}
			</form>
		</Dialog>
	);
}

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
			{refusal.reason === "payout" && (
				<PayoutGateLink details={refusal.details} class="wsp-create__fix" />
			)}
			{refusal.reason === "entitlement" && (
				<Link
					href={PLAN_HREF}
					class="wsp-create__fix"
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
