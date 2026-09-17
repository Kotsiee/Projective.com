import type { JSX, VNode } from "preact";
import "../styles/avatar.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../../fields/types/mod.ts";
import { Icon } from "../../icons/mod.ts";
import { type ImagePlaceholder, ProgressiveImage } from "./ProgressiveImage.tsx";

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
	/**
	 * What is known about the image before it arrives — its BlurHash and/or average colour. Painted
	 * beneath the picture while it loads; ignored when there is no `image`.
	 */
	placeholder?: ImagePlaceholder | null;
	/** `loading` for the `<img>`. Unset by default: an avatar is small and usually beside its name. */
	loading?: "lazy" | "eager";
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
 * `icon` → a generic placeholder glyph.
 *
 * The chain is resolved from props on the server AND at runtime: the image renders through
 * {@link ProgressiveImage}, whose fallback slot carries the same initials/icon the avatar would have
 * shown with no `image` at all. So a photo that 404s degrades to the person's initials over the
 * tonal fill rather than to a broken-image glyph, and a `placeholder` (hash or colour) tones the
 * fill while the photo is still travelling. Zero client JS of its own — the page's image watcher
 * writes the state.
 */
export function Avatar(props: AvatarProps): JSX.Element {
	const {
		image,
		alt = "",
		placeholder,
		loading,
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

	// The non-image chain, rendered directly when there is no image and as the frame's fallback
	// slot when there is one — one tree, so the two can never disagree about what "no photo" shows.
	let fallback: JSX.Element;
	if (label) {
		fallback = <span class="ui-avatar__initials">{initialsOf(label)}</span>;
	} else if (icon) {
		fallback = (
			<span class="ui-avatar__icon" aria-hidden="true">
				{icon}
			</span>
		);
	} else {
		fallback = (
			<span class="ui-avatar__icon" aria-hidden="true">
				<Icon name="user" />
			</span>
		);
	}

	const content = image
		? (
			<ProgressiveImage
				class="ui-avatar__image"
				src={image}
				alt={alt}
				placeholder={placeholder}
				loading={loading}
				fallback={fallback}
			/>
		)
		: fallback;

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
