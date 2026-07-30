import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import {
	CreateWorkspaceInputSchema,
	type HandleCheck,
	kindCopy,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { closeCreate, createModalOpen, createSeedKind } from "../core/workspace-state.ts";
import { initialsOf } from "../core/workspace-model.ts";
import { CheckGlyph, cloneGlyph, DeclineGlyph } from "../core/workspace-glyphs.tsx";

/**
 * CreateWorkspaceModal — the Draft-First creation dialog for a team or a business.
 *
 * **Deliberately tiny.** Name plus a unique `@handle` is the entire form; the entity is created
 * immediately as a draft and the user lands INSIDE it, where a checklist invites the rest. That is a
 * product decision, not an unfinished one — a nine-field wizard in front of a first team is how people
 * decide not to have a team. Everything a wizard would have collected (logo, bio, members, payout
 * method, verification) becomes a checklist row on the overview: reachable, never blocking.
 *
 * **The handle verdict is server-authoritative.** The client renders an answer it was given and never
 * decides availability itself — the handle namespace is shared across users, teams, businesses and
 * organisations, and only the server can see all four. The probe is debounced, because an availability
 * check that fires per keystroke is a scraper rather than a form.
 *
 * The dialog is `@projective/ui` `Dialog`, which portals to `document.body`: the shell's glass chrome
 * re-bases `position: fixed`, so an in-tree overlay would be clipped by the very lane it opened from.
 */

/** How long to wait after the last keystroke before probing the handle. */
const PROBE_DELAY_MS = 400;

/** DOM id of the name field — focus is moved by id because `InputText` exposes no ref. */
const NAME_FIELD_ID = "wsp-create-name";

/** The states the handle field can be in. `idle` also covers "too short to be worth asking about". */
type HandleState = "idle" | "checking" | "available" | "taken" | "invalid";

export interface CreateWorkspaceModalProps {
	/**
	 * The kind to create. When the modal opens from a route that already commits to one (`/teams`,
	 * `/businesses`) the kind chooser is hidden — re-asking a question the URL already answered is
	 * noise. It appears only when opened from a neutral surface such as the header Create menu.
	 */
	kind?: WorkspaceKind;
	/** Force the kind chooser on even inside a committed route. */
	allowKindChoice?: boolean;
}

/**
 * Derive a legal handle from a display name — lowercased, hyphen-joined, and stripped of the
 * leading/trailing hyphens the SSOT's pattern rejects.
 */
function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

export default function CreateWorkspaceModal(props: CreateWorkspaceModalProps): JSX.Element {
	const kind = useSignal<WorkspaceKind>(props.kind ?? createSeedKind.value);
	const name = useSignal("");
	const handle = useSignal("");
	/** Set once the user edits the handle directly, so the name stops being mirrored into it. */
	const handleTouched = useSignal(false);
	const handleState = useSignal<HandleState>("idle");
	const handleReason = useSignal<string | null>(null);
	const suggestions = useSignal<readonly string[]>([]);
	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);

	/** The debounce timer, so a fresh keystroke supersedes an in-flight wait. */
	const probeTimer = useRef<number | null>(null);
	/** Monotonic probe id — a slow answer for an older handle must not overwrite a newer verdict. */
	const probeSeq = useRef(0);

	const copy = useComputed(() => kindCopy(kind.value));
	const showKindChoice = props.allowKindChoice ?? props.kind === undefined;

	// The seed kind can differ between openings (the roster's ＋ New vs a neutral Create menu), so track
	// it while the dialog is closed rather than only at mount.
	useEffect(() => {
		if (!createModalOpen.value && props.kind === undefined) kind.value = createSeedKind.value;
	}, [createModalOpen.value, props.kind]);

	// Move the caret to Name on open. `Dialog` owns the focus TRAP and its restoration; this only
	// chooses where inside the trap to start, which the dialog cannot guess.
	useEffect(() => {
		if (!createModalOpen.value) return;
		const id = setTimeout(() => {
			document.getElementById(NAME_FIELD_ID)?.focus();
		}, 60);
		return () => clearTimeout(id);
	}, [createModalOpen.value]);

	/** Clear every field, so a dismissed draft never reappears half-filled. */
	function reset(): void {
		name.value = "";
		handle.value = "";
		handleTouched.value = false;
		handleState.value = "idle";
		handleReason.value = null;
		suggestions.value = [];
		formError.value = null;
		submitting.value = false;
		if (probeTimer.current !== null) clearTimeout(probeTimer.current);
		probeTimer.current = null;
	}

	/** Debounced availability probe. A short handle stays `idle` rather than being called invalid. */
	function probe(next: string): void {
		if (probeTimer.current !== null) clearTimeout(probeTimer.current);
		suggestions.value = [];

		if (next.length < 3) {
			handleState.value = "idle";
			handleReason.value = null;
			return;
		}
		if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(next)) {
			handleState.value = "invalid";
			handleReason.value = "Lowercase letters, numbers and hyphens only.";
			return;
		}

		handleState.value = "checking";
		handleReason.value = null;
		const seq = ++probeSeq.current;
		probeTimer.current = setTimeout(async () => {
			const res = await WorkspaceService.checkHandle(next);
			// A verdict for a handle the user has already moved past is stale — drop it.
			if (seq !== probeSeq.current) return;
			const check = res.data as HandleCheck | undefined;
			if (!res.ok || !check) {
				handleState.value = "idle";
				handleReason.value = null;
				return;
			}
			handleState.value = check.available ? "available" : "taken";
			handleReason.value = check.reason;
			suggestions.value = check.suggestions;
		}, PROBE_DELAY_MS) as unknown as number;
	}

	function onNameInput(value: string): void {
		name.value = value;
		formError.value = null;
		// Mirror the name into the handle until the user takes it over, so the common case is no typing.
		if (!handleTouched.value) {
			const slug = slugify(value);
			handle.value = slug;
			probe(slug);
		}
	}

	function onHandleInput(value: string): void {
		handleTouched.value = true;
		const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
		handle.value = cleaned;
		formError.value = null;
		probe(cleaned);
	}

	function applySuggestion(next: string): void {
		handleTouched.value = true;
		handle.value = next;
		probe(next);
	}

	const canSubmit = useComputed(() =>
		!submitting.value &&
		name.value.trim().length >= 2 &&
		handle.value.length >= 3 &&
		handleState.value === "available"
	);

	async function submit(): Promise<void> {
		if (!canSubmit.value) return;
		const parsed = CreateWorkspaceInputSchema.safeParse({
			kind: kind.value,
			name: name.value.trim(),
			handle: handle.value,
		});
		if (!parsed.success) {
			formError.value = parsed.error.issues[0]?.message ?? "Check the highlighted fields.";
			return;
		}

		submitting.value = true;
		formError.value = null;
		const res = await WorkspaceService.create(parsed.data);
		if (!res.ok || !res.data) {
			submitting.value = false;
			// A handle taken between the probe and the submit is the one race worth naming precisely.
			formError.value = res.errors?.handle ?? res.message ??
				"Could not create it — please try again.";
			if (res.errors?.handle) {
				handleState.value = "taken";
				handleReason.value = res.errors.handle;
			}
			return;
		}

		const created = res.data.workspace;
		closeCreate();
		reset();
		// Land INSIDE the new entity. Deliberately NO automatic context switch: creating a team is not
		// the same act as beginning to work as it, and the overview offers that as one explicit tap.
		globalThis.location.assign(workspaceHref(created.kind, created.id));
	}

	const verdict = handleState.value;
	/** `data-available` is tri-state: `undefined` while we have no answer to report. */
	const available = verdict === "available"
		? "true"
		: verdict === "idle" || verdict === "checking"
		? undefined
		: "false";

	return (
		<Dialog
			visible={createModalOpen}
			header={showKindChoice ? "Create a workspace" : `Create a ${copy.value.noun}`}
			modal
			width="27rem"
			class="wsp-create"
			onVisibleChange={(open) => {
				if (!open) {
					closeCreate();
					reset();
				}
			}}
			footer={
				<div class="wsp-create__actions">
					<Button
						variant="text"
						label="Cancel"
						onClick={() => {
							closeCreate();
							reset();
						}}
					/>
					<Button
						variant="filled"
						label={submitting.value ? "Creating…" : `Create ${copy.value.noun}`}
						disabled={!canSubmit.value}
						onClick={submit}
					/>
				</div>
			}
		>
			<p class="wsp-create__intro">
				{copy.value.pitch}
			</p>

			{showKindChoice && (
				<div class="wsp-create__field">
					<span class="wsp-create__label" id="wsp-create-kind-label">What are you making?</span>
					<div class="wsp-create__kinds" role="radiogroup" aria-labelledby="wsp-create-kind-label">
						{(["team", "business"] as const).map((k) => {
							const c = kindCopy(k);
							const on = kind.value === k;
							return (
								<button
									key={k}
									type="button"
									role="radio"
									aria-checked={on}
									class="wsp-create__kind"
									data-kind={k}
									data-on={on ? "true" : undefined}
									onClick={() => {
										kind.value = k;
										formError.value = null;
									}}
								>
									<span class="wsp-create__kind-name">{c.Noun}</span>
									<span class="wsp-create__kind-note">
										{k === "team" ? "Deliver work as one unit" : "Hire as one company"}
									</span>
								</button>
							);
						})}
					</div>
				</div>
			)}

			<div class="wsp-create__field">
				<label class="wsp-create__label" for={NAME_FIELD_ID}>Name</label>
				<InputText
					id={NAME_FIELD_ID}
					value={name}
					onValueChange={onNameInput}
					placeholder={kind.value === "team" ? "Northern grid collective" : "Halliwell Estates"}
					block
					maxLength={120}
				/>
				<span class="wsp-create__hint">You can change this later.</span>
			</div>

			<div class="wsp-create__field">
				<label class="wsp-create__label" for="wsp-create-handle">Handle</label>
				<InputText
					id="wsp-create-handle"
					value={handle}
					onValueChange={onHandleInput}
					placeholder="northern-grid"
					block
					maxLength={40}
					start="@"
					status={verdict === "taken" || verdict === "invalid" ? "invalid" : "default"}
				/>
				{
					/*
					 * A live region: the verdict arrives asynchronously, so a screen reader must be told
					 * rather than having to go looking for it.
					 */
				}
				<span
					class="wsp-create__handle-state"
					data-available={available}
					role="status"
					aria-live="polite"
				>
					{verdict === "checking" && "Checking…"}
					{verdict === "available" && (
						<>
							{cloneGlyph(CheckGlyph)}
							{`@${handle.value} is available`}
						</>
					)}
					{(verdict === "taken" || verdict === "invalid") && (
						<>
							{cloneGlyph(DeclineGlyph)}
							{handleReason.value ?? "That handle is not available."}
						</>
					)}
					{verdict === "idle" && `Your public address — /@${handle.value || "handle"}`}
				</span>
				{suggestions.value.length > 0 && (
					<div class="wsp-create__suggest">
						<span class="wsp-create__hint">Try:</span>
						{suggestions.value.map((s) => (
							<button
								key={s}
								type="button"
								class="wsp-create__suggestion"
								onClick={() => applySuggestion(s)}
							>
								@{s}
							</button>
						))}
					</div>
				)}
			</div>

			<div class="wsp-create__preview">
				<span class="wsp-mark wsp-mark--md" data-kind={kind.value} aria-hidden="true">
					{initialsOf(name.value || copy.value.Noun, handle.value)}
				</span>
				<span class="wsp-create__preview-body">
					<span class="wsp-create__preview-name">
						{name.value || `Your ${copy.value.noun}`}
					</span>
					<span class="wsp-create__preview-handle">
						Created as a draft — finish setting it up inside.
					</span>
				</span>
			</div>

			{formError.value && <p class="wsp-create__error" role="alert">{formError.value}</p>}
		</Dialog>
	);
}
