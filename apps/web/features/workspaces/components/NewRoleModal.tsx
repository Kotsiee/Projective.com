import type { JSX } from "preact";
import { batch, type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import {
	Button,
	FormControl,
	InputText,
	Select,
	Textarea,
	useFieldValidation,
} from "@projective/ui/fields";
import {
	kindCopy,
	roleLabel,
	type UpsertRoleInput,
	type WorkspaceDetail,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import type { WorkspaceResult } from "../types/results.ts";
import {
	baseOptions,
	clampBase,
	cloneHint,
	cloneOptionGroups,
	type CustomRoleBase,
	rankCapProblem,
	ROLE_NAME_EXAMPLE,
	ROLE_NAME_MAX,
	ROLE_SUMMARY_MAX,
	type RoleCapContext,
	roleEditorFooter,
	roleEditorInput,
	roleEditorIntro,
	roleNameProblem,
	rolesTierProps,
	roleSummaryProblem,
	type RolesViewer,
	seedFrom,
	seedNote,
	startPointOf,
	startPoints,
} from "../core/roles-model.ts";
import { managerCapContextOf, managerCapRefusal } from "../core/members-model.ts";

/**
 * NewRoleModal and EditRoleModal — the Roles screen's two role dialogs (Decision #320, replacing the
 * C3 `RoleEditor`).
 *
 * **New role** asks three things, each a `FormControl` over a ui field: the role's **Name** (required,
 * trimmed, unique, at most `ROLE_NAME_MAX`), an optional **Description** (`ROLE_SUMMARY_MAX`, shown
 * under the name in the roster and in role pickers) and ONE **Clone permissions from** `Select` — a
 * clean slate, one of the kind's templates (data, `core/role-templates.ts`), a preset or a custom role.
 * The old pair of "Start from" and "Based on" asked the same question twice: the clone now brings its
 * rank too (clamped to what the author may create), and the field's hint says both what the role starts
 * with and what it ranks as. A clone carries only what the author may grant; what it lost is said.
 * Picking a source suggests its name and description unless the reader has typed their own.
 *
 * **Edit details** asks Name, Description and **Ranks as** — the preset the role ranks as, who may
 * manage the people holding it — and keeps the role's saved permissions and holders. On a business a
 * re-rank that would add managers past the plan's cap is said on the field before the press.
 *
 * Each commit is its dialog's one filled control: "Create role" at tier 2 (a structural creation),
 * "Save changes" at tier 3; Cancel is tier 5. A field problem paints at rest after blur and on a press
 * of the commit (§A.7); a server refusal (a 422's field errors included) is said in an assertive notice.
 * Initial focus is the Name input itself — its scope wraps the input alone, so the label row's hint
 * button never takes it. Every rule is `core/roles-model.ts`. Mounted by `WorkspaceRoles` and remounted (keyed) on every open,
 * so a dismissed draft never reappears.
 */

/** The form ids — each footer's commit sits outside the body and submits its form by reference. */
const CREATE_FORM = "wsp-role-create";
const EDIT_FORM = "wsp-role-edit";

/** The rows the Description field opens at. */
const SUMMARY_ROWS = 2;

/** The Description field's live counter. */
function summaryCount(summary: string): string {
	return `${summary.length} / ${ROLE_SUMMARY_MAX}`;
}

/** The first of a refusal's field errors the dialog can name, else its message. */
function refusalText(
	res: Pick<WorkspaceResult<unknown>, "details" | "errors" | "message">,
	ws: WorkspaceDetail,
	fallback: string,
): string {
	return managerCapRefusal(res.details, managerCapContextOf(ws)) ??
		res.errors?.name ?? res.errors?.summary ?? res.errors?.basePreset ??
		res.errors?.capabilities ?? res.message ?? fallback;
}

// #region New role
export interface NewRoleModalProps {
	workspace: WorkspaceDetail;
	viewer: RolesViewer;
	/** Whether the dialog is open — the screen's signal. */
	visible: Signal<boolean>;
	/** The source the trigger implied: `blank` (New role) or `role:<id>` (Duplicate, Clone). */
	startKey: string;
	/** The re-read detail after the write, and the role's name and capabilities as written. */
	onSaved: (next: WorkspaceDetail, written: Pick<UpsertRoleInput, "name" | "capabilities">) => void;
}

export function NewRoleModal(props: NewRoleModalProps): JSX.Element {
	const ws = props.workspace;
	const { viewer } = props;
	const copy = kindCopy(ws.kind);
	const points = startPoints(ws.kind, ws.roles);
	const first = startPointOf(points, props.startKey);

	/** The Clone from value — the Select writes it. */
	const sourceKey = useSignal(first.key);
	/** The source whose name and description were last suggested, to tell typed text from a suggestion. */
	const applied = useSignal(first.key);
	const name = useSignal(first.name);
	const summary = useSignal(first.summary);
	const saving = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const reveal = useSignal(false);
	const nameField = useFieldValidation({
		problem: () => roleNameProblem(name.value, ws.roles),
		reveal,
	});
	const summaryField = useFieldValidation({
		problem: () => roleSummaryProblem(summary.value),
		reveal,
	});
	/** Initial focus: the dialog resolves this scope to the Name input inside it. */
	const nameScope = useRef<HTMLDivElement>(null);

	const source = startPointOf(points, sourceKey.value);
	const seed = seedFrom(source, viewer);
	const left = seedNote(seed.dropped, ws.kind);
	const [cancel, commit] = roleEditorFooter("create", saving.value);

	// #region Handlers
	function close(): void {
		props.visible.value = false;
	}

	/** A new source suggests its name and description — unless the reader has typed their own. */
	function pickSource(key: string): void {
		const previous = startPointOf(points, applied.peek());
		const next = startPointOf(points, key);
		batch(() => {
			sourceKey.value = next.key;
			applied.value = next.key;
			const typedName = name.peek().trim();
			if (typedName === "" || typedName === previous.name) name.value = next.name;
			const typedSummary = summary.peek().trim();
			if (typedSummary === "" || typedSummary === previous.summary) summary.value = next.summary;
			refusal.value = null;
		});
	}

	async function submit(): Promise<void> {
		reveal.value = true;
		if (saving.peek() || nameField.problem.peek() || summaryField.problem.peek()) return;
		const current = seedFrom(startPointOf(points, sourceKey.peek()), viewer);
		const input = roleEditorInput(ws, {
			mode: "create",
			name: name.peek(),
			summary: summary.peek(),
			basePreset: current.basePreset,
			seed: { capabilities: current.capabilities },
		});
		batch(() => {
			saving.value = true;
			refusal.value = null;
		});
		const res = await WorkspaceService.upsertRole(input);
		if (!res.ok || !res.data) {
			batch(() => {
				saving.value = false;
				refusal.value = refusalText(res, ws, "Could not create that role.");
			});
			return;
		}
		saving.value = false;
		props.onSaved(res.data, input);
		close();
	}
	// #endregion

	return (
		<Dialog
			visible={props.visible}
			header="New role"
			modal
			width="32rem"
			initialFocusRef={nameScope}
			footer={
				<div class="wsp-dialog__actions">
					<Button
						{...rolesTierProps(cancel.tier)}
						label={cancel.label}
						disabled={cancel.disabled}
						onClick={close}
					/>
					<Button
						{...rolesTierProps(commit.tier)}
						type="submit"
						form={CREATE_FORM}
						label={commit.label}
						loading={commit.busy}
					/>
				</div>
			}
		>
			<form
				id={CREATE_FORM}
				class="wsp-dialog"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<p class="wsp-dialog__intro">{roleEditorIntro("create", ws.kind, seed.capabilities)}</p>

				<div class="wsp-dialog__field">
					<FormControl
						label="Name"
						required
						hint={`Up to ${ROLE_NAME_MAX} characters, unique in this ${copy.noun}.`}
						status={nameField.hintStatus.value}
						error={nameField.message.value ?? undefined}
					>
						{({ id, describedBy, required }) => (
							<div ref={nameScope}>
								<InputText
									id={id}
									aria-describedby={describedBy}
									required={required}
									value={name}
									onValueChange={() => (refusal.value = null)}
									status={nameField.status.value}
									onFocus={nameField.handlers.onFocus}
									onBlur={() => {
										name.value = name.peek().trim();
										nameField.handlers.onBlur();
									}}
									placeholder={ROLE_NAME_EXAMPLE[ws.kind]}
									maxLength={ROLE_NAME_MAX}
									autoComplete="off"
									block
								/>
							</div>
						)}
					</FormControl>
				</div>

				<FormControl
					label="Description"
					hint="Optional. One sentence on what it is for, shown under its name."
					note={summaryCount(summary.value)}
					status={summaryField.hintStatus.value}
					error={summaryField.message.value ?? undefined}
				>
					{({ id, describedBy }) => (
						<Textarea
							id={id}
							aria-describedby={describedBy}
							value={summary}
							onValueChange={() => (refusal.value = null)}
							status={summaryField.status.value}
							rows={SUMMARY_ROWS}
							autoResize
							maxLength={ROLE_SUMMARY_MAX}
						/>
					)}
				</FormControl>

				<div class="wsp-dialog__field">
					<FormControl
						label="Clone permissions from"
						hint="Copies a role's permissions and rank into the new role. The original never changes."
						note={cloneHint(seed)}
					>
						{({ id, describedBy }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								options={cloneOptionGroups(points)}
								grouping
								value={sourceKey}
								onValueChange={(value) => pickSource(value)}
								fluid
							/>
						)}
					</FormControl>
					{left && <InlineNotice align="start" text={left} />}
				</div>

				{refusal.value && <InlineNotice assertive align="start" text={refusal.value} />}
			</form>
		</Dialog>
	);
}
// #endregion

// #region Edit details
export interface EditRoleModalProps {
	workspace: WorkspaceDetail;
	viewer: RolesViewer;
	/** The manager-cap context the Ranks as field is judged against (a business). */
	cap: RoleCapContext;
	visible: Signal<boolean>;
	/** The custom role being edited. */
	role: WorkspaceRoleDef;
	/** The re-read detail after the write, and the role's name as written. */
	onSaved: (next: WorkspaceDetail, written: Pick<UpsertRoleInput, "name">) => void;
}

export function EditRoleModal(props: EditRoleModalProps): JSX.Element {
	const ws = props.workspace;
	const { viewer, role } = props;
	const copy = kindCopy(ws.kind);
	const offered = baseOptions(ws.kind, viewer.rank);

	const name = useSignal(role.name);
	const summary = useSignal(role.summary);
	const base = useSignal<CustomRoleBase>(clampBase(role.basePreset, offered));
	const saving = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const reveal = useSignal(false);
	const nameField = useFieldValidation({
		problem: () => roleNameProblem(name.value, ws.roles, role.id),
		reveal,
	});
	const summaryField = useFieldValidation({
		problem: () => roleSummaryProblem(summary.value),
		reveal,
	});
	const nameScope = useRef<HTMLDivElement>(null);

	const capped = rankCapProblem(role, base.value, props.cap);
	const [cancel, commit] = roleEditorFooter("edit", saving.value);

	function close(): void {
		props.visible.value = false;
	}

	async function submit(): Promise<void> {
		reveal.value = true;
		if (saving.peek() || nameField.problem.peek() || summaryField.problem.peek()) return;
		if (rankCapProblem(role, base.peek(), props.cap)) return;
		const input = roleEditorInput(ws, {
			mode: "edit",
			name: name.peek(),
			summary: summary.peek(),
			basePreset: base.peek(),
			role,
		});
		batch(() => {
			saving.value = true;
			refusal.value = null;
		});
		const res = await WorkspaceService.upsertRole(input);
		if (!res.ok || !res.data) {
			batch(() => {
				saving.value = false;
				refusal.value = refusalText(res, ws, "Could not save that role.");
			});
			return;
		}
		saving.value = false;
		props.onSaved(res.data, input);
		close();
	}

	return (
		<Dialog
			visible={props.visible}
			header={`Edit ${role.name}`}
			modal
			width="32rem"
			initialFocusRef={nameScope}
			footer={
				<div class="wsp-dialog__actions">
					<Button
						{...rolesTierProps(cancel.tier)}
						label={cancel.label}
						disabled={cancel.disabled}
						onClick={close}
					/>
					<Button
						{...rolesTierProps(commit.tier)}
						type="submit"
						form={EDIT_FORM}
						label={commit.label}
						loading={commit.busy}
					/>
				</div>
			}
		>
			<form
				id={EDIT_FORM}
				class="wsp-dialog"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<p class="wsp-dialog__intro">{roleEditorIntro("edit", ws.kind, [])}</p>

				<div class="wsp-dialog__field">
					<FormControl
						label="Name"
						required
						hint={`Up to ${ROLE_NAME_MAX} characters, unique in this ${copy.noun}.`}
						status={nameField.hintStatus.value}
						error={nameField.message.value ?? undefined}
					>
						{({ id, describedBy, required }) => (
							<div ref={nameScope}>
								<InputText
									id={id}
									aria-describedby={describedBy}
									required={required}
									value={name}
									onValueChange={() => (refusal.value = null)}
									status={nameField.status.value}
									onFocus={nameField.handlers.onFocus}
									onBlur={() => {
										name.value = name.peek().trim();
										nameField.handlers.onBlur();
									}}
									maxLength={ROLE_NAME_MAX}
									autoComplete="off"
									block
								/>
							</div>
						)}
					</FormControl>
				</div>

				<FormControl
					label="Description"
					hint="Optional. One sentence on what it is for, shown under its name."
					note={summaryCount(summary.value)}
					status={summaryField.hintStatus.value}
					error={summaryField.message.value ?? undefined}
				>
					{({ id, describedBy }) => (
						<Textarea
							id={id}
							aria-describedby={describedBy}
							value={summary}
							onValueChange={() => (refusal.value = null)}
							status={summaryField.status.value}
							rows={SUMMARY_ROWS}
							autoResize
							maxLength={ROLE_SUMMARY_MAX}
						/>
					)}
				</FormControl>

				<FormControl
					label="Ranks as"
					required
					hint="Who may manage the people holding it. Never above your own rank."
					status={capped ? "invalid" : undefined}
					error={capped ?? undefined}
				>
					{({ id, describedBy, required }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							required={required}
							options={offered.map((r) => ({ value: r, label: roleLabel(r) }))}
							value={base}
							onValueChange={() => (refusal.value = null)}
							status={capped ? "invalid" : undefined}
							fluid
						/>
					)}
				</FormControl>

				{refusal.value && <InlineNotice assertive align="start" text={refusal.value} />}
			</form>
		</Dialog>
	);
}
// #endregion
