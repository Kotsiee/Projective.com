import type { JSX } from "preact";
import { batch, type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, FormControl, InputText, Select, useFieldValidation } from "@projective/ui/fields";
import {
	kindCopy,
	roleLabel,
	type UpsertRoleInput,
	type WorkspaceDetail,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	baseOptions,
	BLANK_START,
	clampBase,
	type CustomRoleBase,
	ROLE_NAME_EXAMPLE,
	ROLE_NAME_MAX,
	roleEditorFooter,
	roleEditorInput,
	roleEditorIntro,
	type RoleEditorMode,
	roleNameProblem,
	rolesTierProps,
	type RolesViewer,
	seedFrom,
	seedNote,
	startPointOf,
	startPoints,
} from "../core/roles-model.ts";

/**
 * RoleEditor — create a custom role, or rename one (Teams work order C3).
 *
 * **Create** asks three things, each a `FormControl` over a ui field: the role's Name, where it
 * Starts from — nothing, a TEMPLATE (`core/role-templates.ts`, data: Contributor on a team) or a copy
 * of an existing role, presets included, which is how a preset is "edited" — and the preset it is
 * Based on (its rank: who may manage the people holding it). The starting point's capabilities are
 * filtered to what the author may grant before anything is sent, and what was left out is said, so the
 * role the server writes is the role the reader saw. **Rename** keeps the role's capabilities and
 * summary and asks only Name and Based on.
 *
 * The commit is the dialog's one filled control: "Create role" at tier 2 (a structural creation) or
 * "Save role" at tier 3; Cancel is tier 5. A name problem paints at rest after blur and on a press of
 * the commit (§A.7); a server refusal is said in an assertive notice. Every rule here — the starting
 * points, the ranks offered, the seed, the name check, the footer — is `core/roles-model.ts`.
 *
 * Mounted by `RolesMatrix` and remounted (keyed) on every open, so a dismissed draft never reappears.
 */

/** The form's id — the footer's commit sits outside the body and submits it by reference. */
const FORM_ID = "wsp-role-form";

export interface RoleEditorProps {
	workspace: WorkspaceDetail;
	viewer: RolesViewer;
	/** Whether the dialog is open — the screen's signal. */
	visible: Signal<boolean>;
	mode: RoleEditorMode;
	/** The role being renamed (`mode: "rename"`). */
	role: WorkspaceRoleDef | null;
	/** The starting point the trigger implied (`mode: "create"`): `blank`, `template:…` or `role:…`. */
	startKey: string;
	/** The re-read detail after a write, and the role's name and capabilities as written. */
	onSaved: (next: WorkspaceDetail, written: Pick<UpsertRoleInput, "name" | "capabilities">) => void;
}

export function RoleEditor(props: RoleEditorProps): JSX.Element {
	const ws = props.workspace;
	const { viewer, mode, role } = props;
	const copy = kindCopy(ws.kind);
	const points = startPoints(ws.kind, ws.roles);
	const offered = baseOptions(ws.kind, viewer.rank);
	const firstStart = startPointOf(points, mode === "create" ? props.startKey : BLANK_START);

	/** The Start from value — the Select writes it. */
	const startKey = useSignal(firstStart.key);
	/** The starting point whose name and rank were last applied, to tell a typed name from a suggested one. */
	const applied = useSignal(firstStart.key);
	const name = useSignal(mode === "rename" && role ? role.name : firstStart.name);
	const base = useSignal<CustomRoleBase>(
		mode === "rename" && role
			? clampBase(role.basePreset, offered)
			: seedFrom(firstStart, viewer).basePreset,
	);
	const saving = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const reveal = useSignal(false);
	const nameField = useFieldValidation({
		problem: () =>
			roleNameProblem(name.value, ws.roles, mode === "rename" ? role?.id ?? null : null),
		reveal,
	});
	/** Initial focus: the dialog resolves this scope to the Name input inside it. */
	const nameScope = useRef<HTMLDivElement>(null);

	const start = startPointOf(points, startKey.value);
	const seed = seedFrom(start, viewer);
	const left = mode === "create" ? seedNote(seed.dropped, ws.kind) : null;
	const [cancel, commit] = roleEditorFooter(mode, saving.value);

	// #region Handlers
	function close(): void {
		props.visible.value = false;
	}

	/**
	 * A new starting point carries its suggested name — unless the reader has typed their own — and
	 * its rank, clamped to what they may create.
	 */
	function pickStart(key: string): void {
		const previous = startPointOf(points, applied.peek());
		const next = startPointOf(points, key);
		batch(() => {
			startKey.value = next.key;
			applied.value = next.key;
			const typed = name.peek().trim();
			if (typed === "" || typed === previous.name) name.value = next.name;
			base.value = seedFrom(next, viewer).basePreset;
			refusal.value = null;
		});
	}

	async function submit(): Promise<void> {
		reveal.value = true;
		if (saving.peek() || nameField.problem.peek()) return;
		const current = startPointOf(points, startKey.peek());
		const input = roleEditorInput(ws, {
			mode,
			name: name.peek(),
			basePreset: base.peek(),
			seed: { capabilities: seedFrom(current, viewer).capabilities, summary: current.summary },
			role: role ?? undefined,
		});
		batch(() => {
			saving.value = true;
			refusal.value = null;
		});
		const res = await WorkspaceService.upsertRole(input);
		if (!res.ok || !res.data) {
			batch(() => {
				saving.value = false;
				refusal.value = res.errors?.name ?? res.errors?.basePreset ?? res.errors?.capabilities ??
					res.message ??
					(mode === "create" ? "Could not create that role." : "Could not rename that role.");
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
			header={mode === "create" ? "New role" : `Rename ${role?.name ?? "role"}`}
			modal
			width="30rem"
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
						form={FORM_ID}
						label={commit.label}
						loading={commit.busy}
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
				<p class="wsp-dialog__intro">{roleEditorIntro(mode, ws.kind, seed.capabilities)}</p>

				<div class="wsp-dialog__field" ref={nameScope}>
					<FormControl
						label="Name"
						required
						hint={`Up to ${ROLE_NAME_MAX} characters, unique in this ${copy.noun}.`}
						status={nameField.hintStatus.value}
						error={nameField.message.value ?? undefined}
					>
						{({ id, describedBy, required }) => (
							<InputText
								id={id}
								aria-describedby={describedBy}
								required={required}
								value={name}
								onValueChange={() => (refusal.value = null)}
								status={nameField.status.value}
								onFocus={nameField.handlers.onFocus}
								onBlur={nameField.handlers.onBlur}
								placeholder={ROLE_NAME_EXAMPLE[ws.kind]}
								maxLength={ROLE_NAME_MAX}
								autoComplete="off"
								block
							/>
						)}
					</FormControl>
				</div>

				{mode === "create" && (
					<div class="wsp-dialog__field">
						<FormControl label="Start from" hint={start.description}>
							{({ id, describedBy }) => (
								<Select
									id={id}
									aria-describedby={describedBy}
									options={points.map((p) => ({
										value: p.key,
										label: p.label,
										description: p.description,
									}))}
									value={startKey}
									onValueChange={(value) => pickStart(value)}
									fluid
								/>
							)}
						</FormControl>
						{left && <InlineNotice align="start" text={left} />}
					</div>
				)}

				<FormControl
					label="Based on"
					required
					hint="The preset it ranks as — who may manage the people holding it. Never above your own."
				>
					{({ id, describedBy, required }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							required={required}
							options={offered.map((r) => ({ value: r, label: roleLabel(r) }))}
							value={base}
							onValueChange={() => (refusal.value = null)}
							fluid
						/>
					)}
				</FormControl>

				{refusal.value && <InlineNotice assertive align="start" text={refusal.value} />}
			</form>
		</Dialog>
	);
}
