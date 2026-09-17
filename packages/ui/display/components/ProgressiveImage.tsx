import type { ComponentChildren, JSX } from "preact";
import "../styles/progressive-image.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";
import { blurHashAverage, isBlurHash } from "../core/blurhash.ts";

// #region Types
/**
 * What is known about a picture before its bytes arrive. Structurally the metadata SSOT's
 * `ImagePlaceholder` (`@projective/types/files`), which this package may not import; a caller passes
 * the Zod value straight through.
 */
export interface ImagePlaceholder {
	/** BlurHash of the image, painted beneath it while it loads and kept if it fails. */
	blurhash?: string | null;
	/**
	 * The ground colour as `#rrggbb`. Derived from the hash's DC term when absent, so a caller with
	 * a hash never has to carry a second value; `--surface-2` when there is neither.
	 */
	color?: string | null;
}

export interface ProgressiveImageProps {
	/** The image. An empty or absent source renders the fallback from the first byte. */
	src?: string | null;
	/** Alt text. Empty (the default) for a decorative image beside its own caption. */
	alt?: string;
	/** The preview painted beneath the picture; see {@link ImagePlaceholder}. */
	placeholder?: ImagePlaceholder | null;
	/** How the picture fills the frame (default `cover`). */
	fit?: "cover" | "contain";
	loading?: "lazy" | "eager";
	decoding?: "async" | "sync" | "auto";
	fetchpriority?: "high" | "low" | "auto";
	/** Intrinsic dimensions, forwarded to the `<img>` so layout can reserve the box before load. */
	width?: number | string;
	height?: number | string;
	/** `draggable` for the `<img>` — `false` inside a pointer-drag surface so no native ghost forms. */
	draggable?: boolean;
	/**
	 * What the frame shows when the image cannot: rendered in the fallback slot, centred. Defaults to
	 * the registry's `image` glyph in muted ink. An avatar passes its initials.
	 */
	fallback?: ComponentChildren;
	/** Class for the frame. */
	class?: string;
	/** Class for the `<img>` itself, for sheets that select the image element. */
	imgClass?: string;
	style?: JSX.CSSProperties;
}
// #endregion

/**
 * ProgressiveImage — an `<img>` with a three-stage fallback: the picture, else its BlurHash preview,
 * else a neutral placeholder. Zero client JS of its own.
 *
 * ## The three stages, and where each is decided
 *
 *  1. **The picture.** A plain `<img>` on top of the frame. It paints the moment it can, with or
 *     without script — nothing here delays it.
 *  2. **The BlurHash.** Beneath the image, on the frame's `::before`. Two layers deliver it: the
 *     hash's AVERAGE colour is read on the server (`blurHashAverage` — six characters, no trig) and
 *     written as `--pimg-color`, so the first byte carries a correctly-toned ground for every image
 *     on the page; the full decode happens client-side, once, by the page's `ProgressiveImage`
 *     watcher (`core/progressive-image.ts`), which writes the decoded preview as `--pimg-hash`.
 *  3. **The neutral fallback.** The fallback slot — a muted glyph, or whatever the caller passes —
 *     shown only on an `error` frame that has no hash to show instead.
 *
 * The component renders NO state attribute (except for the one case it can know on the server: an
 * empty source, which is a failure before any request). Every other transition is written by the
 * watcher from the element's own `complete` / `naturalWidth` and the document-level `load`/`error`
 * capture, so there is never a listener to attach per image and never a `src` rewritten — the only
 * way a reload loop could start.
 *
 * ## Fitting in
 *
 * The frame is a block that fills its container on both axes; the image inside fills the frame and
 * crops (`object-fit: cover`). It drops into any tile that already sizes an `<img>` to 100%/100%,
 * and a sheet that selects `img` descendants still matches. Pass `imgClass` for one that selects
 * the image by class.
 */
export function ProgressiveImage(props: ProgressiveImageProps): JSX.Element {
	const {
		src,
		alt = "",
		placeholder,
		fit = "cover",
		loading,
		decoding = "async",
		fetchpriority,
		width,
		height,
		draggable,
		fallback,
		class: className,
		imgClass,
		style,
	} = props;

	const source = src?.trim() ?? "";
	const rawHash = placeholder?.blurhash;
	const hash = isBlurHash(rawHash) ? rawHash : undefined;
	const ground = placeholder?.color ?? (hash ? blurHashAverage(hash) : null) ?? undefined;
	// No source is a failure the server already knows about — and the one state it may write. A named
	// picture that cannot render still has a name, so the frame carries it where the image would have.
	const named = !source && alt.trim() !== "";

	return (
		<span
			class={cx("ui-pimg", fit === "contain" && "ui-pimg--contain", className)}
			data-pimg=""
			data-blurhash={hash}
			data-state={source ? undefined : "error"}
			role={named ? "img" : undefined}
			aria-label={named ? alt : undefined}
			style={styleVars({ "--pimg-color": ground }, style)}
		>
			{source
				? (
					<img
						class={cx("ui-pimg__img", imgClass)}
						src={source}
						alt={alt}
						loading={loading}
						decoding={decoding}
						fetchpriority={fetchpriority}
						width={width}
						height={height}
						draggable={draggable}
					/>
				)
				: null}
			<span class="ui-pimg__fallback" aria-hidden="true">
				{fallback ?? <Icon name="image" size="md" />}
			</span>
		</span>
	);
}
