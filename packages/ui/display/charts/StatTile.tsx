import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/stat-tile.css";
import { cx } from "../../core/cx.ts";
import { deltaDirection } from "./geometry.ts";
import { Sparkline } from "./Sparkline.tsx";

/** Props for {@link StatTileRow}. */
export interface StatTileRowProps {
	/** Accessible name for the group — a row of tiles is one instrument. */
	label: string;
	children: ComponentChildren;
	class?: string;
}

/**
 * StatTileRow — a responsive fill grid of {@link StatTile}s, separated by spacing and one hairline per
 * boundary, never boxed (§B.4).
 */
export function StatTileRow(props: StatTileRowProps): JSX.Element {
	return (
		<div class={cx("ui-stats", props.class)} role="group" aria-label={props.label}>
			{props.children}
		</div>
	);
}

/** Props for {@link StatTile}. */
export interface StatTileProps {
	/** The tracked micro-label. Sentence case; the stylesheet upper-cases it. */
	label: string;
	/**
	 * The figure, already final: a `compactCount` of a count, a server-formatted string, or a
	 * `MoneyView` element — money reaches the screen only through MoneyView, which then converts to
	 * the viewer's currency and takes the tile's register (size and weight) rather than its own.
	 */
	value: string | VNode;
	/** A pre-formatted signed delta (`"+12%"`). Direction is read from its sign, never recomputed. */
	delta?: string | null;
	/** A short qualifier under the figure, shown when there is no sparkline. */
	caption?: string;
	/** A series for the accent sparkline. Fewer than two points draws nothing. */
	trend?: readonly number[];
	/** A small leading glyph inside the figure. */
	icon?: VNode;
	/** Spoken form of the figure when the printed one reads badly aloud (`12.9K`). */
	srValue?: string;
	class?: string;
}

/**
 * StatTile — an unboxed metric: a tracked micro-label, the value at the display register in
 * `tabular-nums`, a signed delta as meta text with an arrow glyph (direction never carried by colour
 * alone), and an optional decorative sparkline. The tile never computes what it displays.
 */
export function StatTile(props: StatTileProps): JSX.Element {
	const { label, value, delta, caption, trend, icon, srValue } = props;
	const dir = deltaDirection(delta);
	return (
		<div class={cx("ui-stat", props.class)}>
			<span class="ui-stat__label">{label}</span>
			<div class="ui-stat__row">
				<span class="ui-stat__value" aria-hidden={srValue ? "true" : undefined}>
					{icon && <span class="ui-stat__icon">{icon}</span>}
					{value}
				</span>
				{srValue && <span class="ui-visually-hidden">{srValue}</span>}
				{delta && (
					<span class="ui-stat__delta" data-dir={dir}>
						<span class="ui-stat__arrow" aria-hidden="true">
							{dir === "up" ? "↑" : dir === "down" ? "↓" : "→"}
						</span>
						{delta}
					</span>
				)}
			</div>
			{trend && trend.length > 1
				? <Sparkline values={trend} decorative class="ui-stat__spark" />
				: caption
				? <p class="ui-stat__caption">{caption}</p>
				: null}
		</div>
	);
}
