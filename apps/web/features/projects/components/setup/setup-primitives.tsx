import { cloneElement, type ComponentChildren, isValidElement, type JSX } from "preact";
import { HintPopover } from "@projective/ui/feedback";
import type { FieldValidation } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ProjectSetup, ProjectSetupStepKey } from "../../types/projects-types.ts";
import { anchorId, type SetupSectionKey } from "../../core/setup-sections.ts";
import { FieldGuard } from "../../core/setup-validation.ts";

/**
 * setup-primitives — the layout vocabulary every section of the Stage-2 setup form is built from
 * (`Section`, `Field`, `Validated` and the unboxed grouping devices), plus the client-side draft
 * identities a new stage, role or row is minted with.
 *
 * The draft-id counter lives here, in ONE module, because every editor that mints an id shares it: two
 * counters would hand a stage and a step the same suffix on the same page.
 */

// #region Layout primitives
/**
 * One labelled section of the flow.
 *
 * The `id` comes from the shared registry, so the rail's `#psu-budget` and this element are one
 * string decided in one place. It is also what makes a plain `#hash` in the address bar land
 * correctly with JavaScript off, which the stylesheet's `scroll-margin-block-start` then clears the
 * pinned chrome for.
 *
 * Separated by SPACING alone (§B.4 tier 1) — no box, no hairline. A section of prose and inputs is
 * static content, and the asymmetric rhythm above and below the heading already says where each one
 * begins.
 */
export function Section(props: {
	/** Which registry section this is — the anchor the side rail jumps to. */
	sectionKey: SetupSectionKey;
	title: string;
	/** The ladder hint for this section, shown only while the requirement is outstanding. */
	hint?: string;
	/**
	 * How the hint reads. `gate` (the default) is the amber "publishing is waiting on this"; `note` is
	 * the meta register, for a row the ladder carries but does not require — painting an OPTIONAL
	 * step's hint amber would report a requirement the ladder one region away says does not exist.
	 */
	hintTone?: "gate" | "note";
	children: ComponentChildren;
}): JSX.Element {
	return (
		<section id={anchorId(props.sectionKey)} class="psu-section">
			<div class="psu-section__head">
				<h2 class="psu-section__title">{props.title}</h2>
				{props.hint && (
					<p class="psu-section__hint" data-tone={props.hintTone ?? "gate"}>{props.hint}</p>
				)}
			</div>
			<div class="psu-section__body">{props.children}</div>
		</section>
	);
}

/**
 * A control plus its verdict, with the field's focus lifecycle tracked at the wrapper.
 *
 * Focus is watched here rather than on the control because `focusin`/`focusout` BUBBLE where `focus`
 * and `blur` do not: one wrapper therefore gives a Select, a number input and a rich-text region the
 * same clear-on-focus behaviour, and none of them has to grow a focus prop it does not have. It also
 * means a control whose panel is body-portalled reads as "left" the moment focus moves into that
 * panel, which is the honest answer — the reader has finished with the field's own box.
 *
 * The message carries a stable id derived from the control's, so a caller that owns a real input can
 * point `aria-describedby` at it. A reference to an element that is not currently rendered is simply
 * skipped by assistive technology, which is why the id may be wired unconditionally.
 */
export function Validated(props: {
	validation: FieldValidation;
	/** Id for the message element — `${controlId}-problem` by convention. */
	messageId?: string;
	children: ComponentChildren;
}): JSX.Element {
	const message = props.validation.message.value;
	return (
		<div
			class="psu-validated"
			onFocusIn={props.validation.handlers.onFocus}
			onFocusOut={props.validation.handlers.onBlur}
		>
			{props.children}
			{message && (
				<p
					class="psu-field__problem"
					id={props.messageId}
					data-status={props.validation.hintStatus.value}
				>
					{message}
				</p>
			)}
		</div>
	);
}

/**
 * One labelled control.
 *
 * `htmlFor` is supplied only for controls that expose a real focusable element with that id — the
 * text and number inputs. The composite controls (Select, SelectButton, Chips) take an `aria-label`
 * instead, so their visible name renders as a `<span>`: a `<label for>` pointing at an id no element
 * carries is worse than no label element at all, because assistive technology follows it and finds
 * nothing.
 *
 * `fieldKey` opts the control into blur-gated validation. It is optional because most fields here
 * have no failing verdict to gate — a dropdown with a default is never wrong — and a guard around
 * one of those would only add a wrapper element.
 */
/**
 * Merge a description id into whatever the control already points at.
 *
 * `aria-describedby` takes a LIST, so a field that has both a hint and a live verdict must reference
 * both — overwriting would silently drop whichever the caller set first. Only a single element child
 * can be cloned; anything else (a fragment, a string, several controls) is left alone and simply keeps
 * the visible-hint fallback, because guessing which of several children is "the control" is how a
 * description ends up attached to a wrapper nobody focuses.
 */
function describedBy(children: ComponentChildren, id: string): ComponentChildren {
	if (!isValidElement(children)) return children;
	const existing = (children.props as { "aria-describedby"?: string })["aria-describedby"];
	const merged = existing ? `${existing} ${id}` : id;
	return cloneElement(children, { "aria-describedby": merged });
}

export function Field(props: {
	label: string;
	htmlFor?: string;
	/**
	 * The static explanation of this field.
	 *
	 * Rendered as an on-demand disclosure behind a "?" beside the label rather than as a permanent line
	 * of prose under the control — a form of this length spends more vertical space on explanations
	 * nobody is reading a second time than on the fields themselves.
	 *
	 * The text is ALWAYS in the DOM, visually hidden, and the control points at it. The popover panel is
	 * body-portalled and unmounted while closed, so an IDREF to the panel would resolve to nothing for
	 * most of the field's life and the description would vanish from the accessibility tree; pointing at
	 * a stable hidden node instead makes the icon a purely VISUAL disclosure of something already
	 * announced. A screen-reader user never has to find and open it.
	 *
	 * This is only for STATIC help. A live verdict stays inline and visible — see {@link Validated}.
	 */
	hint?: string;
	/** Track focus/blur under this key so `fieldStatus` can hold a verdict back until the owner leaves. */
	fieldKey?: string;
	/**
	 * A live verdict to wrap the control in.
	 *
	 * The sibling of `fieldKey`, not a rival: `fieldKey` gates a status the CONTROL already knows how to
	 * paint, and this carries a sentence the control cannot know — so a field that has something to SAY
	 * about why it is incomplete passes this, and one that only has to look required passes the key.
	 */
	validation?: FieldValidation;
	children: ComponentChildren;
}): JSX.Element {
	// Derived from the control's own id where there is one, so it is stable across renders; otherwise
	// from the label, which is unique within a section on this surface.
	const hintId = props.hint
		? `${props.htmlFor ?? `psu-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}-hint`
		: undefined;
	const described = hintId ? describedBy(props.children, hintId) : props.children;

	const body = (
		<>
			<div class="psu-field__labelrow">
				{props.htmlFor
					? <label class="psu-field__label" for={props.htmlFor}>{props.label}</label>
					: <span class="psu-field__label">{props.label}</span>}
				{props.hint && (
					<HintPopover label={`About ${props.label.toLowerCase()}`}>{props.hint}</HintPopover>
				)}
			</div>
			{props.validation
				? (
					<Validated
						validation={props.validation}
						messageId={props.htmlFor ? `${props.htmlFor}-problem` : undefined}
					>
						{described}
					</Validated>
				)
				: described}
			{props.hint && <span id={hintId} class="psu-visually-hidden">{props.hint}</span>}
		</>
	);

	return props.fieldKey
		? <FieldGuard fieldKey={props.fieldKey} class="psu-field">{body}</FieldGuard>
		: <div class="psu-field">{body}</div>;
}

/**
 * Whether a ladder step is still outstanding.
 *
 * Read off the SERVER-derived `setup.steps` rather than re-tested against the data, so the sentence a
 * section shows and the row the progress bar draws are the same verdict. A step this projection does
 * not carry is not outstanding — an absent row is a requirement that does not apply to this shape,
 * which is a different fact from one nobody has satisfied.
 */
export function outstanding(setup: ProjectSetup, key: ProjectSetupStepKey): boolean {
	return setup.steps.some((step) => step.key === key && !step.done);
}

/**
 * A two-column row that becomes a plain block when it has only one child to hold.
 *
 * `.psu-row` is a two-column grid, so a lone `Field` inside it renders against an empty half-width
 * column — and padding the gap with a labelless spacer `Field` would put an unlabelled control in the
 * accessibility tree to fix a visual problem. The wrapper is chosen instead of the class.
 *
 * `paired` is the CALLER's answer, never a count of the children handed in. The trailing half of one
 * of these rows is a conditional element, and a `false` child is still a child — so a count taken
 * here would report a pair on exactly the render that has one field and an empty column.
 */
export function PairRow(
	{ paired, children }: { paired: boolean; children: ComponentChildren },
): JSX.Element {
	return paired ? <div class="psu-row">{children}</div> : <>{children}</>;
}

/**
 * A named run of related fields — grouped by a label and by SPACING, never by a box.
 *
 * §B.4 spends spacing first and a contour last, and a bordered group inside a section that already
 * sits inside a card would be the third surface on one screen (§B.9.7). So the grouping is carried by
 * the two channels that cost no separation device: a meta-register heading (§A.4) and an asymmetric
 * gap — wider above the heading than beneath it, which is what attaches the label to the fields it
 * names rather than to whatever preceded them. `.psu-group` owns that ratio; see the note there.
 *
 * The `role="group"` is named BY the heading it already renders rather than by a duplicate
 * `aria-label`, so the accessible name cannot drift from the visible one (WCAG 2.5.3). The id is
 * supplied by the caller because these fields render once per stage and several stages can be open
 * at once on the project surface — a constant would collide.
 */
export function FieldGroup(
	{ id, label, children }: { id: string; label: string; children: ComponentChildren },
): JSX.Element {
	return (
		<div class="psu-group" role="group" aria-labelledby={id}>
			<p class="psu-subhead" id={id}>{label}</p>
			{children}
		</div>
	);
}

/** A note beneath a group of controls — prose, never a chip, never boxed. */
export function Note({ children }: { children: ComponentChildren }): JSX.Element {
	return <p class="psu-note">{children}</p>;
}

/**
 * A collapsed group of settings that are set once and rarely revisited.
 *
 * Native `<details>`, deliberately. The sections of this form are SERVER components rendered by one
 * island, so a disclosure built on a signal would need its own hydration root for a control whose whole
 * job is to show and hide static markup — and it would collapse to nothing with JavaScript off, taking
 * the fields inside it out of reach. `<details>` is open-able, keyboard-operable and announced as a
 * disclosure with no script at all, and the browser already gives `<summary>` the right role and
 * `aria-expanded` handling. It is the same choice `StageProgressLedger` made for the same reason.
 *
 * Content inside is NOT boxed (§B.4): the summary row and the indent carry the grouping, and a border
 * around a disclosure that already sits inside a section would be the second device on one boundary.
 */
export function Disclosure(
	props: { label: string; children: ComponentChildren; open?: boolean },
): JSX.Element {
	return (
		<details class="psu-disclosure" open={props.open}>
			<summary class="psu-disclosure__summary">
				<Icon class="psu-disclosure__chev" name="chevron-down" size="sm" />
				<span class="psu-disclosure__label">{props.label}</span>
			</summary>
			<div class="psu-disclosure__body">{props.children}</div>
		</details>
	);
}
// #endregion

// #region Draft identity
let draftSeq = 0;

/** Mint a client-side id the fat service reads as a CREATE (the `stage-draft-` prefix is the signal). */
export function newStageId(): string {
	draftSeq += 1;
	return `stage-draft-${draftSeq}`;
}

/** Mint a client-side id the fat service reads as a role CREATE. */
export function newRoleId(): string {
	draftSeq += 1;
	return `role-draft-${draftSeq}`;
}

/** Task and per-stage-role rows are nested inside a stage, so their ids only have to be unique here. */
export function newRowId(prefix: string): string {
	draftSeq += 1;
	return `${prefix}-${draftSeq}`;
}

/** A copy of `arr` with the item at `from` moved to `to` — the reorder every drag list here commits. */
export function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
// #endregion
