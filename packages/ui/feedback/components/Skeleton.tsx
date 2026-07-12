/**
 * Skeleton — a content placeholder shown while real content loads. Purely decorative (`aria-hidden`)
 * — pair it with a `Loader`/`aria-busy` region, or a visually-hidden "Loading…" label, so assistive
 * tech has something to announce. `lines` renders a stack of `text`-shape rows with the last one
 * narrower, mimicking a paragraph's ragged final line.
 */
import type { JSX } from "preact";
import "../styles/skeleton.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

// #region Props
export type SkeletonShape = "rect" | "circle" | "text";
export type SkeletonAnimation = "pulse" | "wave" | "none";

export interface SkeletonProps {
	/** Placeholder shape (default `rect`). `circle` forces a 1:1 aspect ratio. */
	shape?: SkeletonShape;
	/** Inline size — a CSS length (default `100%`). */
	width?: string;
	/** Block size — a CSS length (default `1rem` for `text`, `100%`/aspect-derived otherwise). */
	height?: string;
	/** Corner radius override (defaults from `shape`: `text`→sm, `rect`→base, `circle`→pill). */
	radius?: string;
	/** Number of stacked rows for `shape="text"` (default `1`). */
	lines?: number;
	/** Shimmer treatment (default `pulse`). `none` also applies automatically under reduced-motion. */
	animation?: SkeletonAnimation;
	id?: string;
	class?: string;
}
// #endregion

function block(
	shape: SkeletonShape,
	width: string | undefined,
	height: string | undefined,
	radius: string | undefined,
	animation: SkeletonAnimation,
	opts: { id?: string; class?: string; key?: string | number } = {},
): JSX.Element {
	return (
		<span
			key={opts.key}
			id={opts.id}
			aria-hidden="true"
			class={cx(
				"ui-skeleton",
				`ui-skeleton--${shape}`,
				animation !== "none" && `ui-skeleton--${animation}`,
				opts.class,
			)}
			style={styleVars({
				"--skeleton-width": width,
				"--skeleton-height": height,
				"--skeleton-radius": radius,
			})}
		/>
	);
}

/** Renders one placeholder block, or (for `shape="text"` with `lines > 1`) a stacked paragraph. */
export function Skeleton(props: SkeletonProps): JSX.Element {
	const {
		shape = "rect",
		width,
		height,
		radius,
		lines = 1,
		animation = "pulse",
		id,
		class: className,
	} = props;

	if (shape === "text" && lines > 1) {
		return (
			<span id={id} class={cx("ui-skeleton-group", className)} aria-hidden="true">
				{Array.from({ length: lines }, (_, i) => {
					const isLast = i === lines - 1;
					return block(
						"text",
						isLast ? width ?? "70%" : width,
						height,
						radius,
						animation,
						{ class: "ui-skeleton-group__row", key: i },
					);
				})}
			</span>
		);
	}

	return block(shape, width, height, radius, animation, { id, class: className });
}
