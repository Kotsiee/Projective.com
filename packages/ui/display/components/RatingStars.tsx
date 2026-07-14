import type { JSX } from "preact";
import "../styles/rating-stars.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { FieldSize } from "../../fields/types/mod.ts";

// #region Props
/** Props for {@link RatingStars}. */
export interface RatingStarsProps {
	/** The score to render, clamped to `0…max`. Fractional values fill partial stars. */
	value: number;
	/** Number of stars in the meter (default `5`). */
	max?: number;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Optional sample size shown as a muted `(N)` after the score. */
	count?: number;
	/** Render the numeric score beside the stars (default `true` when `count` is given, else `false`). */
	showValue?: boolean;
	/**
	 * Accessible label. A sensible default is derived from `value`/`count`; override for context
	 * (e.g. "Rated 4.9 out of 5 as a helper").
	 */
	label?: string;
	class?: string;
}
// #endregion

/** The star glyph path — a single rounded five-point star drawn once and tiled across the meter. */
const STAR = "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z";

/**
 * RatingStars — a static, read-only star meter driven by a number. Unlike the interactive `Rating`
 * field (an island), this is a **zero-JS server component**: a card grid can render hundreds without
 * hydrating anything. Two tiled star rows (an empty track and a `--fill`-clipped filled overlay) give
 * fractional fills; a single `role="img"` label carries the score for assistive tech. Token-only.
 */
export function RatingStars(props: RatingStarsProps): JSX.Element {
	const { value, max = 5, size = "md", count, class: className } = props;
	const showValue = props.showValue ?? count !== undefined;
	const clamped = Math.max(0, Math.min(max, value));
	const pct = `${(clamped / max) * 100}%`;
	const label = props.label ??
		`Rated ${clamped.toFixed(1)} out of ${max}${count !== undefined ? `, ${count} ratings` : ""}`;

	return (
		<span
			class={cx("ui-ratingstars", `ui-ratingstars--size-${size}`, className)}
			role="img"
			aria-label={label}
		>
			<span class="ui-ratingstars__meter" style={styleVars({ "--ui-rs-fill": pct })}>
				<span class="ui-ratingstars__row ui-ratingstars__row--track" aria-hidden="true">
					<StarRow max={max} />
				</span>
				<span class="ui-ratingstars__row ui-ratingstars__row--fill" aria-hidden="true">
					<StarRow max={max} />
				</span>
			</span>
			{showValue && (
				<span class="ui-ratingstars__value" aria-hidden="true">
					{clamped.toFixed(1)}
					{count !== undefined && <span class="ui-ratingstars__count">({count})</span>}
				</span>
			)}
		</span>
	);
}

function StarRow({ max }: { max: number }): JSX.Element {
	return (
		<>
			{Array.from({ length: max }, (_, i) => (
				<svg key={i} viewBox="0 0 24 24" aria-hidden="true">
					<path d={STAR} fill="currentColor" />
				</svg>
			))}
		</>
	);
}
