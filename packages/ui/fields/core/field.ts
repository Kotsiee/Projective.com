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
		focused && `${block}--focused`,
		open && `${block}--open`,
	].filter(Boolean) as string[];
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
