/**
 * Field styling helpers — translate the shared field vocabulary (size, variant, status, severity)
 * into BEM modifier class names and inline `--*` token references. Keeps every control's markup
 * consistent and the real declarations in `styles/field.css`.
 */
import type { FieldSize, FieldStatus, FieldVariant, Severity } from "../types/mod.ts";

/** Modifier classes shared by every input-shaped control, under a caller-supplied block name. */
export function fieldModifiers(
	block: string,
	opts: {
		size?: FieldSize;
		variant?: FieldVariant;
		status?: FieldStatus;
		fluid?: boolean;
		disabled?: boolean;
		readOnly?: boolean;
		loading?: boolean;
		focused?: boolean;
		open?: boolean;
	},
): string[] {
	const {
		size = "md",
		variant = "outlined",
		status = "default",
		fluid,
		disabled,
		readOnly,
		loading,
		focused,
		open,
	} = opts;
	return [
		`${block}--size-${size}`,
		`${block}--${variant}`,
		status !== "default" && `${block}--${status}`,
		fluid && `${block}--fluid`,
		disabled && `${block}--disabled`,
		readOnly && `${block}--readonly`,
		loading && `${block}--loading`,
		focused && `${block}--focused`,
		open && `${block}--open`,
	].filter(Boolean) as string[];
}

/**
 * The status glyph for the `.ui-field__mark` slot — the icon/shape channel that keeps a validation
 * state off hue alone (§A.5). Returns `null` for the neutral default so the slot stays collapsed.
 *
 * The shapes are deliberately distinct at a glance and under every CVD simulation: a bang for "this
 * is wrong", a tick for "this is right", a chevron-bang for the softer publishing gate.
 */
export function statusMark(status: FieldStatus | undefined): "alert" | "check" | "gate" | null {
	switch (status) {
		case "invalid":
		case "required":
			return "alert";
		case "success":
			return "check";
		case "warning":
		case "gate":
			return "gate";
		default:
			return null;
	}
}

/** Map a Severity to the token root it drives (`--{severity}` / `--on-{severity}`). */
export function severityToken(severity: Severity | undefined): string {
	switch (severity) {
		case "success":
			return "success";
		case "warning":
			return "warning";
		case "danger":
			return "danger";
		case "help":
			return "tertiary";
		case "info":
			return "secondary";
		case "secondary":
			return "secondary";
		case "primary":
		default:
			return "primary";
	}
}

/** Resolve the accent colour variables for a Severity, for controls that tint by severity. */
export function severityVars(severity: Severity | undefined): Record<string, string> {
	const t = severityToken(severity);
	return {
		"--field-accent": `var(--${t})`,
		"--field-on-accent": `var(--on-${t}, var(--on-primary))`,
	};
}

/**
 * `aria-invalid` value derived from status. `invalid` (malformed) and `required` (unmet initial
 * creation gate — RED) are truly invalid; `gate` (AMBER publishing gate) is a soft, informative
 * state, so it is intentionally NOT surfaced as `aria-invalid`.
 */
export function ariaInvalid(status: FieldStatus | undefined): boolean | undefined {
	return status === "invalid" || status === "required" ? true : undefined;
}

// #region The validation state policy (§A.7.5)
/**
 * What is being asked of one field right now. The inputs to {@link resolveFieldVerdict}.
 *
 * Deliberately plain data — no signals, no hooks, no DOM — so the policy that decides whether a
 * field paints red can be exercised directly by a test rather than inferred from a rendered tree.
 * {@link useFieldValidation} is a thin signals wrapper around this function and adds no rules of its
 * own.
 */
export interface FieldVerdictInput {
	/** What is wrong with the current value, or `null` when nothing is. */
	problem: string | null;
	/** Has the reader finished with this field at least once (i.e. blurred it)? */
	touched: boolean;
	/** Does the field hold focus at this moment? */
	focused: boolean;
	/** The form has demanded every verdict be shown — the submit-time reveal. Default `false`. */
	reveal?: boolean;
	/** The status painted for a revealed problem. Default `"invalid"`. */
	problemStatus?: FieldStatus;
	/**
	 * The status painted for a revealed field with nothing wrong. Default `"default"` — a form of
	 * green ticks is noise, so a caller opts into `"success"` where confirmation genuinely helps.
	 */
	resolvedStatus?: FieldStatus;
}

/** The two status channels and the message one field resolves to. */
export interface FieldVerdict {
	/**
	 * The status the CONTROL is given. `"default"` until the verdict is revealed, and `"default"`
	 * again for as long as the field holds focus — this is the channel that paints the outline and
	 * sets `aria-invalid`, and neither belongs on a field the reader is still inside.
	 */
	status: FieldStatus;
	/**
	 * The status the MESSAGE ROW is given (`FormControl`'s `status`). Identical to {@link status}
	 * except that it survives focus, so the sentence explaining the problem stays on screen while it
	 * is being fixed. Withdrawing the explanation at the exact moment the reader acts on it is the
	 * failure this second channel exists to avoid.
	 */
	hintStatus: FieldStatus;
	/** The sentence to render beneath the control, or `null` when there is nothing to say yet. */
	message: string | null;
	/** Whether the verdict is being shown at all — touched, or force-revealed by a submit. */
	revealed: boolean;
}

/** Nothing has been earned yet: no paint, no message, no `aria-invalid`. */
const SILENT: FieldVerdict = {
	status: "default",
	hintStatus: "default",
	message: null,
	revealed: false,
};

/**
 * Resolve one field's rendered validation state from its verdict and its lifecycle.
 *
 * Three rules, in order, and each of them is a rule about WHEN rather than about what a status
 * paints — the §A.7.3 state matrix is untouched by this function:
 *
 * 1. **Nothing paints before the reader has had a turn.** An untouched field resolves to
 *    `"default"` however wrong its value is. `status="required"` sets `aria-invalid`, so an empty
 *    field painted at rest is announced as an error before anybody has typed into it.
 * 2. **A submit force-reveals.** `reveal` is the one moment an untouched field may legitimately
 *    paint: a refusal with no visible cause is worse than an early one. A form owns a single
 *    `Signal<boolean>` and hands it to every field.
 * 3. **Focus clears the paint, never the message.** While the control holds focus the status
 *    channel goes quiet so the focus treatment owns the outline alone; `hintStatus` and
 *    `message` do not, so the explanation is still there to work from.
 */
export function resolveFieldVerdict(input: FieldVerdictInput): FieldVerdict {
	const revealed = input.touched || input.reveal === true;
	if (!revealed) return SILENT;

	const hintStatus = input.problem === null
		? (input.resolvedStatus ?? "default")
		: (input.problemStatus ?? "invalid");

	return {
		status: input.focused ? "default" : hintStatus,
		hintStatus,
		message: input.problem,
		revealed: true,
	};
}
// #endregion
