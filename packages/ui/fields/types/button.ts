/**
 * Button's prop contract — the colour-ramp tones of the Interaction Matrix (DESIGN_SYSTEM §B.8.1).
 *
 * Kept apart from `components/Button.tsx` because that module imports its stylesheet, and a module
 * graph that reaches CSS cannot be loaded by `deno test`: the tone rules below are type errors by
 * design, and only a CSS-free home lets a test assert that they stay errors.
 */
import type { ComponentChildren, JSX, RefObject, VNode } from "preact";
import type { FieldSize, Severity } from "./mod.ts";

export type ButtonVariant = "filled" | "outlined" | "text" | "link";

/**
 * Button colour ramp: the shared {@link Severity} set plus two Button-only tiers of the Interaction
 * Matrix (§B.8.1) — `accent`, the amber terminal financial/conversion commit (`--accent` /
 * `--on-accent`), and `neutral`, the outlined utility action (`--on-surface` ink on a
 * `--hairline-strong` border). Neither is a status, so neither reaches Tag/Badge/Alert/Message/Toast.
 */
export type ButtonSeverity = Severity | "accent" | "neutral";

/** Props shared by every Button regardless of colour ramp. */
export interface ButtonBaseProps
	extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "icon" | "loading"> {
	/** Button label. Optional for icon-only buttons (pass `aria-label` then). */
	label?: string;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Elevated (raised) surface with a resting shadow. */
	raised?: boolean;
	/** Pill / fully-rounded corners. */
	rounded?: boolean;
	/** Icon-only square button (requires `aria-label`). */
	iconOnly?: boolean;
	/** Leading/trailing icon node. */
	icon?: VNode;
	/** Icon placement (default `left`). */
	iconPos?: "left" | "right";
	/** Loading state — swaps the icon for a spinner and blocks activation. */
	loading?: boolean;
	/** Optional badge value shown at the top-right corner. */
	badge?: string | number;
	/** Stretch to fill the parent's inline size. */
	fluid?: boolean;
	/**
	 * The rendered `<button>`, for a Button that triggers an overlay (`ActionMenu` / `Popover`'s
	 * `api.ref`). `Button` is a function component, so a plain `ref` stops at the component and never
	 * reaches the node the overlay anchors to and returns focus to — the `LaneIconButton.triggerRef`
	 * seam.
	 */
	triggerRef?: RefObject<HTMLElement>;
	children?: ComponentChildren;
}

/** A status or brand ramp: every fill treatment is legal. */
export interface ButtonSemanticTone {
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Fill treatment (default `filled`). `text`/`link` are low-emphasis; `outlined` is medium. */
	variant?: ButtonVariant;
	/** Tier 2 is opt-in and filled-only — see {@link ButtonStructuralTone}. */
	structural?: false;
}

/**
 * Tier 2 of the Interaction Matrix — the primary structural commitment (Add to project, Create
 * project). It is not a severity: `structural` re-inks a filled semantic Button with the §D.7.7
 * monochrome inverted pair (`--on-surface` fill · `--surface` ink), which swaps sides with the theme
 * by construction. Filled only, because the pair is contrast-checked as a fill, and an outlined or
 * text Button in `--on-surface` ink is already tier 4/5's look.
 */
export interface ButtonStructuralTone {
	/** Carried for the API's sake; the structural pair replaces the ramp's colours. */
	severity?: Severity;
	/** Only `filled` is legal for the structural tone. */
	variant?: "filled";
	/** Renders the tier-2 monochrome inverted fill (`.ui-button--structural`). */
	structural: true;
}

/**
 * The amber terminal-commit ramp. Filled only: `--accent` is contrast-checked as a fill under
 * `--on-accent`, not as ink on a page surface, so an outlined/text/link label would be unreadable.
 */
export interface ButtonAccentTone {
	/** Terminal financial / conversion commit (Pay, Hire, Fund escrow). */
	severity: "accent";
	/** Only `filled` is legal for the accent ramp. */
	variant?: "filled";
	/** Tier 1 is never also tier 2. */
	structural?: false;
}

/**
 * The neutral utility ramp — tier 4 of the Interaction Matrix (Upload, Message, Follow). Outlined
 * only: the tier is defined as a hairline-bordered control, so a neutral fill would read as tier 2.
 */
export interface ButtonNeutralTone {
	/** Utility action, inked in `--on-surface` rather than a brand or status hue. */
	severity: "neutral";
	/** Only `outlined` is legal for the neutral ramp. */
	variant: "outlined";
	/** Tier 4 is outlined; tier 2 is its filled counterpart and spelled on a semantic tone. */
	structural?: false;
}

/** Button props: the shared base plus exactly one colour-ramp contract. */
export type ButtonProps =
	& ButtonBaseProps
	& (ButtonSemanticTone | ButtonStructuralTone | ButtonAccentTone | ButtonNeutralTone);
