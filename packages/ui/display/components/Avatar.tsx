import type { JSX, VNode } from "preact";
import "../styles/avatar.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../../fields/types/mod.ts";

// #region Local types
/**
 * Avatar size ramp; a bare number sets a custom pixel diameter via `--avatar-size`. Local to Avatar —
 * it extends the shared `FieldSize` ramp with `xl` + numeric, so it isn't promoted to the shared
 * fields vocabulary.
 */
export type AvatarSize = "sm" | "md" | "lg" | "xl" | number;
export type AvatarShape = "circle" | "square";
// #endregion

export interface AvatarProps {
	/** Image source. Takes priority in the fallback chain (image → initials → icon). */
	image?: string;
	/** Alt text for the image (default empty — avatars are usually adjacent to a visible name). */
	alt?: string;
	/** Source string for initials (first letters of up to two words) when no `image` is given. */
	label?: string;
	/** Icon shown when neither `image` nor `label` is given. */
	icon?: VNode;
	/** Corner treatment (default `circle`). */
	shape?: AvatarShape;
	/** Size ramp or a custom pixel diameter (default `md`). */
	size?: AvatarSize;
	/** Tints the fallback (initials/icon) background; ignored once an `image` renders. */
	severity?: Severity;
	class?: string;
	style?: JSX.CSSProperties;
	/** Accessible name override for the fallback (initials/icon) glyph; defaults to `label`/`alt`. */
	"aria-label"?: string;
}

/** First letters of up to the first two words of `label`, upper-cased. */
function initialsOf(label: string): string {
	const words = label.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Avatar — a person/entity glyph with a fallback chain: `image` → initials derived from `label` →
 * `icon` → a generic placeholder glyph. Zero client JS (no runtime image-error detection — the chain
 * is resolved from props, so pass only the source you know is valid).
 */
export function Avatar(props: AvatarProps): JSX.Element {
	const {
		image,
		alt = "",
		label,
		icon,
		shape = "circle",
		size = "md",
		severity,
		class: className,
		style,
		"aria-label": ariaLabel,
	} = props;

	const vars: Record<string, string | undefined> = {};
	if (typeof size === "number") vars["--avatar-size"] = `${size}px`;
	if (severity) {
		vars["--avatar-bg"] = `var(--${severity})`;
		vars["--avatar-fg"] = `var(--on-${severity}, var(--on-primary))`;
	}
	const sizeClass = typeof size === "string" ? `ui-avatar--size-${size}` : undefined;

	let content: JSX.Element;
	if (image) {
		content = <img class="ui-avatar__image" src={image} alt={alt} />;
	} else if (label) {
		content = <span class="ui-avatar__initials">{initialsOf(label)}</span>;
	} else if (icon) {
		content = (
			<span class="ui-avatar__icon" aria-hidden="true">
				{icon}
			</span>
		);
	} else {
		content = (
			<span class="ui-avatar__icon" aria-hidden="true">
				👤
			</span>
		);
	}

	return (
		<span
			class={cx(
				"ui-avatar",
				`ui-avatar--${shape}`,
				sizeClass,
				!image && "ui-avatar--fallback",
				className,
			)}
			style={styleVars(vars, style)}
			role={!image && (ariaLabel || label || alt) ? "img" : undefined}
			aria-label={!image ? (ariaLabel ?? label ?? alt) || undefined : undefined}
		>
			{content}
		</span>
	);
}
