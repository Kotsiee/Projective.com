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
