/**
 * @projective/ui/fields — shared field primitives.
 *
 * Cross-cutting types used by every control (size, severity, variant, the controllable-value
 * contract). Component-specific prop interfaces live with their component; only vocabulary shared
 * across the taxonomy belongs here. See DESIGN_SYSTEM.md §C.1 (fields roster) and §A (tokens).
 */
import type { Signal } from "@preact/signals";

// #region Value binding
/**
 * The signal-first value contract (SYSTEM_ARCHITECTURE.md §UI). Every control accepts either a raw
 * value (uncontrolled — the component owns an internal signal, seeded from this) or a `Signal<T>`
 * (controlled — the component reads/writes the caller's signal directly). See `useControllable`.
 */
export type Bindable<T> = T | Signal<T>;

/** Change callback shape shared by controls that also emit imperative events. */
export type ValueChange<T> = (value: T) => void;
// #endregion

// #region Sizing & density
/** Control size ramp. Drives height, inline padding, font-size, and adornment scale. */
export type FieldSize = "sm" | "md" | "lg";
// #endregion

// #region Severity / state
/**
 * Semantic status of a control — maps to the fixed-hue ramps (`--success|--warning|--danger`) plus
 * the neutral default. `info` uses the primary ramp. Never conveys meaning by hue alone: the CVD
 * overlay (§A.5) pairs each with an icon/shape channel.
 */
export type Severity = "primary" | "secondary" | "success" | "info" | "warning" | "help" | "danger";

/**
 * Validation-oriented subset used by inputs for the coloured outline + `aria-invalid`.
 *
 * Two of these encode the platform's two-tier **creation gate** (root CLAUDE.md — the "quick to
 * onboard, slow to set up" rule): a field is highlighted by *when* it is needed, not only by whether
 * it is malformed.
 *  - `required` — **RED (initial-creation gate).** The field is needed *right now* to create the base
 *    record (e.g. a Project Name). Drives the danger ramp + `aria-invalid`.
 *  - `gate` — **AMBER (publishing gate).** The field is optional to save a draft but needed before the
 *    record can be *published* (posted to Explore / opened for hiring) — e.g. Description, Budget,
 *    Stage details. Drives the warning ramp; it is a soft, informative state, so it is NOT
 *    `aria-invalid`.
 *
 * `invalid`/`success`/`warning` remain the generic validity states. Never conveys meaning by hue
 * alone: consumers pair each with an icon/shape channel for the CVD overlay (§A.5).
 */
export type FieldStatus =
	| "default"
	| "invalid"
	| "success"
	| "warning"
	| "required"
	| "gate";
// #endregion

// #region Surface variant
/**
 * Visual treatment of an input's own surface (PrimeNG parity):
 *  - `outlined` — hairline outline on `--surface` (default).
 *  - `filled`   — tonal `--surface-2` fill, borderless until focus.
 *  - `transparent` — no surface/border; inherits parent (for inline / in-group use).
 *  - `bare` — a true borderless toolbar treatment: NO resting border/background in the inactive,
 *    unhovered, unfocused state; hover reveals a faint surface tint and focus a soft ring only (no
 *    hairline ever appears). For dense, high-end enterprise toolbars (search / sort / filter).
 */
export type FieldVariant = "outlined" | "filled" | "transparent" | "bare";
// #endregion

// #region Shared control props
/** Props common to every interactive field control. Spread onto the concrete prop interface. */
export interface BaseFieldProps {
	/** Native form field name. */
	name?: string;
	/** Stable id; auto-generated (SSR-safe) when omitted. Wired to the label + `aria-describedby`. */
	id?: string;
	/** Disable interaction; sets `aria-disabled` and removes the control from the tab order. */
	disabled?: boolean;
	/** Read-only: value shown, not editable (still focusable, unlike disabled). */
	readOnly?: boolean;
	/** Marks the field required for validation + `aria-required`. */
	required?: boolean;
	/** Validation status → invalid outline + `aria-invalid`. */
	status?: FieldStatus;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Stretch to fill the inline size of the parent (PrimeNG `fluid`). */
	fluid?: boolean;
	/** Accessible label when no visible `<label>` is associated. */
	"aria-label"?: string;
	/** Id(s) of describing text (hint/error) for `aria-describedby`. */
	"aria-describedby"?: string;
}

/** A `{ label, value }` option, the lingua franca for Select/MultiSelect/Listbox/etc. */
export interface Option<V = string> {
	label: string;
	value: V;
	/** Disable selection of this single option. */
	disabled?: boolean;
	/** Optional group key (flat options are grouped by this when a grouped view is requested). */
	group?: string;
	/** Optional leading icon token/name for renderers that support it. */
	icon?: string;
}

/** A group of options for the grouped rendering path (Select/MultiSelect/Listbox). */
export interface OptionGroup<V = string> {
	label: string;
	value?: V;
	items: Option<V>[];
	icon?: string;
}
// #endregion
