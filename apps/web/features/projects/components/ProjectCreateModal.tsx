import type { JSX } from "preact";
import "../styles/project-create-modal.css";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { Button, InputText, Textarea } from "@projective/ui/fields";
import type { FieldStatus } from "@projective/ui/fields";
import { Avatar } from "@projective/ui/display";
import { Icon, type IconName } from "@projective/ui/icons";
import { toDisplayCurrency } from "@projective/types/finance";
import {
	createInputForType,
	PROJECT_TYPE_HINT,
	PROJECT_TYPE_LABEL,
	ProjectTypeChoice,
} from "../types/projects-types.ts";
import type { CreateProject } from "../types/projects-types.ts";
import { ProjectSidebarService } from "../core/ProjectSidebarService.ts";
import { formFocusEntry, formKeyNav, formPointerDown } from "../core/form-keys.ts";
import { CloseIcon } from "./glyphs.tsx";

/**
 * ProjectCreateModal — the ONE surface that mints a project, wherever the client starts from.
 *
 * It replaces two modals that did the same job with different fields: the `/projects` lane's
 * Quick-Init (title · type · currency · baseline price) and the `/[handle]` hero's two-step wizard
 * (a type card step, then title · brief · currency · price). Two implementations of one form is two
 * chances to disagree about what a project needs before it can exist — and they already had: the
 * wizard's Task card minted one structure while the lane's had no Task at all.
 *
 * Four fields, and every one of them is something the client already knows at the moment they press
 * Create:
 *
 *  - **Title** — the address bar, the feed card and the channel header;
 *  - **Description** — one or two lines, optional, so the workspace opens on the sentence they
 *    already wrote rather than an empty editor;
 *  - **Type** — Task · One-off · Pipeline, the three the product offers ({@link ProjectTypeChoice});
 *  - **Invited freelancer** — CONTEXTUAL, and read-only: rendered only when the modal was opened
 *    from a seller's profile, where the answer is already settled by the page it was opened from.
 *
 * # One form, two pacings
 *
 * The `/projects` lane opens it as a single screen, because its create menu has already settled the
 * type on the way in. A client arriving from a seller's profile gets the same fields SPLIT in two —
 * the type on its own screen, then the details ({@link ProjectCreateModalProps.flow}) — because
 * nothing on that page has chosen a type for them, and which of the three kinds of engagement this
 * is changes what every field after it means. The fields, the payload, the keyboard rule and the
 * refusal handling are identical either way; only the pacing differs, which is what keeps a Task
 * minted from a profile the same row as a Task minted from the lane.
 *
 * Currency and the baseline price are deliberately NOT here. Neither blocks a coherent draft, both
 * are decisions about money that deserve the workspace's own Advanced options, and asking for a
 * figure before the brief is written is asking somebody to price work they have not described. The
 * currency still travels in the payload — it prices escrow for the life of the engagement, so it
 * cannot be absent — seeded from the viewer's resolved money context and changed later in Rules.
 *
 * Rendered through {@link BodyPortal} so its `position: fixed` chrome never re-bases onto the blurred
 * shell (the glass-blur trap), with a SELF-CLEARING enter transform so any portalled panel a field
 * opens still resolves against the viewport.
 */

// #region Vocabulary
/** The glyph each type leads with — the registry's own, never a hand-authored `<svg>` (§B.7). */
const TYPE_ICON: Record<ProjectTypeChoice, IconName> = {
	task: "ticket",
	one_off: "submission",
	pipeline: "stages",
};

/** The three cards, derived from the SSOT enum's own members rather than restated. */
const TYPE_CARDS: readonly ProjectTypeChoice[] = ProjectTypeChoice.options;

/**
 * Stable ids — one instance is ever mounted, and each hint must bind to the control it describes.
 *
 * The type control is a `radiogroup`, which is not a labelable element, so it carries an
 * `aria-labelledby` pointing at its visible heading rather than a `<label for>` that would resolve to
 * nothing (WCAG 2.5.3 holds either way).
 */
const TITLE_ID = "pjc-title";
const BRIEF_ID = "pjc-brief";
const TYPE_LABEL_ID = "pjc-type-label";
const TYPE_HINT_ID = "pjc-type-hint";
const INVITE_ID = "pjc-invite";

/** The SSOT's own bounds, restated where the controls enforce them. */
const TITLE_MIN = 3;
const TITLE_MAX = 160;
const BRIEF_MAX = 2000;
// #endregion

/** The seller a project is being created FOR, when the modal was opened from their profile. */
export interface CreateModalSeller {
	name: string;
	/** The `@handle`, with or without its `@` — rendered as written. */
	handle: string;
	avatar?: string | null;
}

export interface ProjectCreateModalProps {
	open: boolean;
	/** Preset type from the lane's create menu; the selector can still change it. */
	initialType: ProjectTypeChoice;
	/**
	 * The currency the project is SEEDED in — the viewer's resolved money context, threaded from SSR.
	 * A seed, not a presentation preference: what is stored here prices escrow for the life of the
	 * engagement, and it is the workspace's Advanced options that change it afterwards.
	 */
	defaultCurrency: string;
	/** Active workspace id → the created engagement's `scopeId`. */
	scopeId: string;
	/** Present only when opened from a `/[handle]` profile — renders the invited-freelancer row. */
	seller?: CreateModalSeller;
	/**
	 * How the form is PACED — see the module docblock.
	 *
	 * `"single"` (the default) puts every field on one screen. `"stepped"` asks for the type first and
	 * the details second, and in that mode nothing is pre-selected: {@link initialType} is read only
	 * as the fallback for where focus lands if the reader steps Back before picking anything, because
	 * a first step arriving with an answer already filled in is a default the client never chose.
	 */
	flow?: "single" | "stepped";
	onClose: () => void;
	/**
	 * Called with the created project's **slug** once the write succeeds — never the uuid, which no
	 * longer routes at all (Decision #88): handing one to this callback navigates the client straight
	 * from a successful create to a 404.
	 */
	onCreated: (slug: string) => void;
}

/** Which control a server-side field error belongs to. */
type FieldKey = "title" | "description" | "format";

/**
 * The refusal paths this surface can render. A Zod issue whose path names anything else (`currency`,
 * `scopeId`, `form`) has no control to land on, so it stays in the footer message rather than being
 * pinned to an unrelated field.
 */
const FIELD_KEYS: ReadonlySet<string> = new Set<FieldKey>(["title", "description", "format"]);

/** Mount once; drive it with `open`. */
export function ProjectCreateModal(props: ProjectCreateModalProps): JSX.Element | null {
	const {
		open,
		initialType,
		defaultCurrency,
		scopeId,
		seller,
		flow = "single",
		onClose,
		onCreated,
	} = props;
	const stepped = flow === "stepped";

	const { mounted, state } = usePresence(open);
	const stack = useOverlayStack({ active: mounted, lockScroll: true, layer: "modal" });
	const panelRef = useRef<HTMLDivElement>(null);
	const titleFieldRef = useRef<HTMLDivElement>(null);
	const cardsRef = useRef<HTMLDivElement>(null);
	/*
	 * Focus enters on the first thing the reader is being asked for: the type cards in `stepped`, the
	 * name in `single`. The trap treats a non-focusable ref as a SCOPE and focuses its first tabbable
	 * descendant, so pointing at either wrapper is enough — and `stepped` never changes for the life
	 * of a mount, so the ref this resolves to is stable.
	 */
	useFocusTrap({
		active: mounted,
		containerRef: panelRef,
		initialFocusRef: stepped ? cardsRef : titleFieldRef,
	});
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	// #region Form state
	/** Which screen `stepped` is on. Pinned at 2 in `single`, where both halves render at once. */
	const step = useSignal<1 | 2>(stepped ? 1 : 2);
	const title = useSignal("");
	const brief = useSignal("");
	/**
	 * Null only on a `stepped` first visit: the type step opens NEUTRAL, so the reader's press is the
	 * answer rather than the confirmation of one already made for them. Non-null everywhere a payload
	 * is built, because step 2 is only reachable by picking.
	 */
	const type = useSignal<ProjectTypeChoice | null>(stepped ? null : initialType);

	/**
	 * Per-field interaction state. A field rests on the neutral border and only shows an error once it
	 * has been BLURRED — an input that turns red before the user has had a turn is scolding them for
	 * not having typed yet — and clears back to neutral the moment it is focused again.
	 */
	const touched = useSignal<Partial<Record<FieldKey, boolean>>>({});
	const focused = useSignal<FieldKey | null>(null);
	/** Field-keyed refusals from the write, cleared per field as soon as that field is edited. */
	const fieldErrors = useSignal<Partial<Record<FieldKey, string>>>({});

	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);
	// #endregion

	// Seed the form whenever the modal (re)opens, so a dismissed half-filled draft never leaks into
	// the next attempt.
	useEffect(() => {
		if (!open) return;
		step.value = stepped ? 1 : 2;
		title.value = "";
		brief.value = "";
		type.value = stepped ? null : initialType;
		touched.value = {};
		focused.value = null;
		fieldErrors.value = {};
		submitting.value = false;
		formError.value = null;
	}, [open, initialType, stepped]);

	/** The title's own verdict, independent of whether it has been shown yet. */
	const titleVerdict = useComputed<FieldStatus>(() => {
		const len = title.value.trim().length;
		if (len === 0) return "required";
		return len < TITLE_MIN ? "invalid" : "default";
	});

	if (!mounted) return null;

	const picked = type.value;
	/** The type screen — `stepped`'s first step, and never rendered at all in `single`. */
	const onTypeStep = stepped && step.value === 1;

	// #region Field plumbing
	const markTouched = (key: FieldKey) => {
		focused.value = null;
		if (!touched.value[key]) touched.value = { ...touched.value, [key]: true };
	};

	const clearFieldError = (key: FieldKey) => {
		if (fieldErrors.value[key] === undefined) return;
		const next = { ...fieldErrors.value };
		delete next[key];
		fieldErrors.value = next;
	};

	/**
	 * Resolve a control's rendered status. A focused field is always neutral — the focus treatment is
	 * the signal the user needs while typing — so an error can only appear on a field they have left.
	 */
	const statusOf = (key: FieldKey, verdict: FieldStatus = "default"): FieldStatus => {
		if (focused.value === key) return "default";
		if (fieldErrors.value[key]) return "invalid";
		return touched.value[key] ? verdict : "default";
	};

	/** Focus/blur tracking lives on a WRAPPER: `blur` does not bubble, but it does capture. */
	const fieldProps = (key: FieldKey) => ({
		class: "pjc__field",
		onFocusCapture: () => (focused.value = key),
		onBlurCapture: () => markTouched(key),
	});
	// #endregion

	const titleStatus = statusOf("title", titleVerdict.value);
	const titleError = fieldErrors.value.title ??
		(titleStatus === "required"
			? "Give your project a name."
			: titleStatus === "invalid"
			? `Use at least ${TITLE_MIN} characters.`
			: null);

	// #region Handlers
	const onTitleChange = (value: string) => {
		title.value = value;
		clearFieldError("title");
	};

	const onBriefChange = (value: string) => {
		brief.value = value;
		clearFieldError("description");
	};

	const focusTitleField = () => {
		titleFieldRef.current?.querySelector<HTMLInputElement>("input")?.focus();
	};

	const pickType = (next: ProjectTypeChoice) => {
		type.value = next;
		clearFieldError("format");
		if (!stepped) return;
		/*
		 * A choice-only step advances on the choice: the press IS the answer, and a Continue button
		 * under three cards asks the reader to confirm something they have already said.
		 *
		 * The focus move is deferred by a macrotask, because the field it moves to does not exist until
		 * this render commits — and a step that advances while focus sits on a card no longer in the
		 * document drops a keyboard reader at the top of the dialog. A frame would be worse still:
		 * `requestAnimationFrame` never fires in a hidden or unpainted tab, and entering a form must
		 * not depend on one that may never arrive.
		 */
		step.value = 2;
		setTimeout(focusTitleField, 0);
	};

	/** Back to the type step, with focus on the card that was chosen (or the first, if none was). */
	const stepBack = () => {
		step.value = 1;
		const chosen = type.value;
		setTimeout(() => {
			const selector = chosen ? `[data-type="${chosen}"]` : ".pjc__type";
			panelRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
		}, 0);
	};

	/**
	 * Arrow keys move the choice, and moving it SELECTS it.
	 *
	 * The radiogroup pattern's own rule: a radio's selection follows focus, so a reader driving the
	 * three cards with the arrows never has to press a second key to commit the one they have landed
	 * on. Enter is then free to mean "done here", which is what `formKeyNav` makes it do.
	 */
	const onCardKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
		const delta = e.key === "ArrowRight" || e.key === "ArrowDown"
			? 1
			: e.key === "ArrowLeft" || e.key === "ArrowUp"
			? -1
			: 0;
		if (delta === 0) return;
		e.preventDefault();
		const n = TYPE_CARDS.length;
		const next = TYPE_CARDS[(index + delta + n) % n];
		pickType(next);
		// Focus follows the selection, so the roving tabindex and the caret agree about where the
		// reader is. Queried by value rather than held in a ref array — the cards are three static
		// children, and a ref array would need re-seeding on every render for no gain.
		panelRef.current?.querySelector<HTMLButtonElement>(`[data-type="${next}"]`)?.focus();
	};

	const buildPayload = (chosen: ProjectTypeChoice): CreateProject => {
		const [format, hasStages] = createInputForType(chosen);
		return {
			title: title.value.trim(),
			format,
			hasStages,
			description: brief.value.trim(),
			// Seeded, never asked (see the module docblock). `toDisplayCurrency` narrows a preference
			// the viewer may hold in a currency the platform cannot price in.
			currency: toDisplayCurrency(defaultCurrency),
			baselineAmountCents: null,
			scopeType: "personal",
			scopeId,
		};
	};

	const submit = async () => {
		if (submitting.value) return; // a double-press must not post twice
		// Unreachable from the interface — the primary is not rendered on the type step — but a payload
		// cannot be built without it, so the guard states the invariant rather than assuming it.
		const chosen = type.value;
		if (!chosen) return;
		if (titleVerdict.value !== "default") {
			touched.value = { ...touched.value, title: true };
			focusTitleField();
			return;
		}
		submitting.value = true;
		formError.value = null;
		fieldErrors.value = {};
		const res = await ProjectSidebarService.create(buildPayload(chosen));
		submitting.value = false;
		if (res.ok && res.data) {
			onCreated(res.data.slug);
			return;
		}
		const next: Partial<Record<FieldKey, string>> = {};
		const seen = new Set<FieldKey>();
		for (const [path, message] of Object.entries(res.errors ?? {})) {
			const key = path.split(".")[0];
			if (!FIELD_KEYS.has(key)) continue;
			next[key as FieldKey] = message;
			seen.add(key as FieldKey);
		}
		fieldErrors.value = next;
		// A refusal a field is already showing must be visible, so mark those fields touched.
		if (seen.size > 0) {
			const marks = { ...touched.value };
			for (const key of seen) marks[key] = true;
			touched.value = marks;
		}
		formError.value = res.message ?? "Couldn't create the project. Try again.";
	};
	// #endregion

	const blocked = !onTypeStep && (titleError !== null || formError.value !== null);
	const note = onTypeStep
		? "You can change the type later in the project's settings."
		: (formError.value ?? titleError ??
			(seller
				? `A draft. Finish the setup on its page, then bring ${seller.name} in from the roster.`
				: "You can add the stages, the pricing and the rules straight after this."));

	/** The heading names what is being made, once the reader has said what it is. */
	const heading = stepped && !onTypeStep && picked
		? `New ${PROJECT_TYPE_LABEL[picked].toLowerCase()}`
		: "New project";

	return (
		<BodyPortal>
			<div class="pjc" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} onClick={onClose} />
				<div
					ref={panelRef}
					class="pjc__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label="New project"
					tabIndex={-1}
					/*
					 * The keyboard rule, delegated once from the panel (`core/form-keys.ts`) exactly as the
					 * Stage-2 workspace delegates it from the form root — so Enter, Ctrl+Enter and the
					 * arrows mean the same thing on the modal that mints a project and on the surface that
					 * finishes configuring it.
					 */
					onKeyDownCapture={formKeyNav}
					onFocusInCapture={formFocusEntry}
					onPointerDownCapture={formPointerDown}
				>
					<header class="pjc__top">
						<div class="pjc__title">
							<h2 class="pjc__heading">{heading}</h2>
							{stepped && (
								<p class="pjc__step" aria-live="polite">
									{onTypeStep ? "Step 1 of 2 · Choose a type" : "Step 2 of 2 · Name it"}
								</p>
							)}
						</div>
						<button type="button" class="pjc__close" aria-label="Close" onClick={onClose}>
							{CloseIcon}
						</button>
					</header>

					<div class="pjc__body">
						{
							/*
							 * The type step. Plain buttons in a `group`, NOT a radiogroup, and the distinction is
							 * load-bearing: a radiogroup's selection follows focus, so arrowing across the cards
							 * would advance the step on every key — and the shared Enter rule treats an
							 * already-chosen radio as "move to the next control", which on the card the reader
							 * just stepped Back to would be a dead press. As buttons, Enter and Space are the
							 * browser's own activation, and activation is exactly what this step means.
							 */
						}
						{onTypeStep && (
							<>
								<p class="pjc__lead">
									{seller
										? `What kind of work are you bringing ${seller.name} into?`
										: "What kind of work is this?"}
								</p>
								<div
									ref={cardsRef}
									class="pjc__types pjc__types--list"
									role="group"
									aria-label="Project type"
								>
									{TYPE_CARDS.map((value) => (
										<button
											key={value}
											type="button"
											data-type={value}
											class="pjc__type pjc__type--row"
											aria-current={value === picked ? "true" : undefined}
											onClick={() => pickType(value)}
										>
											<span class="pjc__type-glyph" aria-hidden="true">
												<Icon name={TYPE_ICON[value]} size="xl" />
											</span>
											<span class="pjc__type-text">
												<span class="pjc__type-label">{PROJECT_TYPE_LABEL[value]}</span>
												<span class="pjc__type-hint">{PROJECT_TYPE_HINT[value]}</span>
											</span>
										</button>
									))}
								</div>
								{fieldErrors.value.format && (
									<p class="pjc__hint pjc__hint--error">{fieldErrors.value.format}</p>
								)}
							</>
						)}

						{!onTypeStep && (
							<>
								<div ref={titleFieldRef} {...fieldProps("title")}>
									<label class="pjc__label" for={TITLE_ID}>Project name</label>
									<InputText
										id={TITLE_ID}
										value={title}
										onValueChange={onTitleChange}
										placeholder="e.g. Helia wallet redesign"
										block
										maxLength={TITLE_MAX}
										required
										status={titleStatus}
									/>
									{titleError && <p class="pjc__hint pjc__hint--error">{titleError}</p>}
								</div>

								<div {...fieldProps("description")}>
									<label class="pjc__label" for={BRIEF_ID}>
										Description
										<span class="pjc__optional">Optional</span>
									</label>
									<Textarea
										id={BRIEF_ID}
										value={brief}
										onValueChange={onBriefChange}
										placeholder="What needs doing, and what does finished look like?"
										rows={3}
										maxRows={7}
										autoResize
										maxLength={BRIEF_MAX}
										status={statusOf("description")}
										fluid
									/>
									<p class="pjc__hint">
										{fieldErrors.value.description ??
											"A line or two is plenty — the full brief comes next."}
									</p>
								</div>

								{!stepped && (
									<div class="pjc__field">
										<span class="pjc__label" id={TYPE_LABEL_ID}>Project type</span>
										<div
											class="pjc__types"
											role="radiogroup"
											aria-labelledby={TYPE_LABEL_ID}
											aria-describedby={TYPE_HINT_ID}
										>
											{TYPE_CARDS.map((value, index) => {
												const active = value === picked;
												return (
													<button
														key={value}
														type="button"
														role="radio"
														aria-checked={active}
														data-type={value}
														class="pjc__type"
														// Roving tabindex: one stop for the whole group, on the chosen card, so Tab
														// steps past the control rather than through it.
														tabIndex={active ? 0 : -1}
														onClick={() => pickType(value)}
														onKeyDown={(e) => onCardKeyDown(e, index)}
													>
														<span class="pjc__type-glyph" aria-hidden="true">
															<Icon name={TYPE_ICON[value]} size="lg" />
														</span>
														<span class="pjc__type-label">{PROJECT_TYPE_LABEL[value]}</span>
													</button>
												);
											})}
										</div>
										<p class="pjc__hint" id={TYPE_HINT_ID}>
											{fieldErrors.value.format ??
												PROJECT_TYPE_HINT[picked ?? initialType]}
										</p>
									</div>
								)}

								{
									/*
									 * The invited freelancer is CONTEXT, not a control: the modal was opened from this
									 * person's profile, so there is no choice left to offer and a picker would only
									 * invite the client to contradict the page they came from. It is rendered read-only
									 * for the same reason the checkout prints what you are buying — the commitment
									 * being made should be legible at the moment it is made.
									 */
								}
								{seller && (
									<div class="pjc__field">
										<span class="pjc__label" id={INVITE_ID}>Invited freelancer</span>
										<div class="pjc__invitee" aria-labelledby={INVITE_ID}>
											<Avatar
												image={seller.avatar ?? undefined}
												label={seller.name}
												shape="circle"
												size="sm"
											/>
											<span class="pjc__invitee-text">
												<span class="pjc__invitee-name">{seller.name}</span>
												<span class="pjc__invitee-handle">{seller.handle}</span>
											</span>
										</div>
										<p class="pjc__hint">
											They are invited from the project's roster once it has a scope and a price.
										</p>
									</div>
								)}
							</>
						)}
					</div>

					<footer class="pjc__foot">
						<p class="pjc__note" role="status" data-tone={blocked ? "error" : "muted"}>
							{note}
						</p>
						<div class="pjc__actions">
							{stepped && !onTypeStep
								? <Button variant="text" label="Back" onClick={stepBack} />
								: <Button variant="text" label="Cancel" onClick={onClose} />}
							{
								/*
								 * Absent on the type step rather than disabled: there is nothing to create yet, and a
								 * control that renders and refuses advertises a capability it does not have. The
								 * cards ARE this step's action.
								 */
							}
							{!onTypeStep && (
								<Button
									variant="filled"
									severity="primary"
									label={submitting.value ? "Creating…" : "Create project"}
									loading={submitting.value}
									disabled={submitting.value}
									onClick={submit}
								/>
							)}
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}
