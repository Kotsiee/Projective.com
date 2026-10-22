import { Component, type JSX, type RefObject } from "preact";
import { styleVars } from "../../core/style.ts";
import type { EmojiEntry } from "../core/emoji-data.ts";

// #region Types
/** One labelled run of cells; `start` is the flat index of its first cell. */
export interface EmojiGridSection {
	readonly id: string;
	readonly label: string;
	readonly entries: readonly EmojiEntry[];
	readonly start: number;
}

/** Props for {@link EmojiGrid}. */
export interface EmojiGridProps {
	sections: readonly EmojiGridSection[];
	columns: number;
	/** The one cell in the tab order (2D roving tabindex). */
	focusIndex: number;
	label: string;
	scrollerRef: RefObject<HTMLDivElement>;
	onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void;
	onClick: (event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
	onPointerOver: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
	onFocusIn: (event: JSX.TargetedFocusEvent<HTMLDivElement>) => void;
	onScroll: () => void;
}
// #endregion

// #region Cell
interface EmojiCellProps {
	entry: EmojiEntry;
	index: number;
	tabbable: boolean;
}

class EmojiCell extends Component<EmojiCellProps> {
	override shouldComponentUpdate(next: EmojiCellProps): boolean {
		const { entry, index, tabbable } = this.props;
		return next.entry !== entry || next.index !== index || next.tabbable !== tabbable;
	}

	override render(): JSX.Element {
		const { entry, index, tabbable } = this.props;
		return (
			<div role="gridcell" class="ui-emoji-picker__cell">
				<button
					type="button"
					class="ui-emoji-picker__emoji"
					tabIndex={tabbable ? 0 : -1}
					data-index={index}
					aria-label={entry.label}
				>
					{entry.emoji}
				</button>
			</div>
		);
	}
}
// #endregion

// #region Grid
function chunk(entries: readonly EmojiEntry[], size: number): EmojiEntry[][] {
	const rows: EmojiEntry[][] = [];
	for (let i = 0; i < entries.length; i += size) rows.push(entries.slice(i, i + size));
	return rows;
}

/**
 * The emoji body: a scrolling ARIA grid of labelled row groups, each under a sticky section title.
 * Cells are native ghost buttons; pointer and focus are handled by delegation on the scroller.
 * Off-screen sections skip layout and paint (`content-visibility: auto`), which keeps ~1,900 cells
 * cheap without a windowing layer that would break focus, find-in-page and scroll-to-section.
 */
export function EmojiGrid(props: EmojiGridProps): JSX.Element {
	const { sections, columns, focusIndex, label, scrollerRef } = props;
	return (
		<div
			ref={scrollerRef}
			role="grid"
			aria-label={label}
			class="ui-emoji-picker__scroller"
			onKeyDown={props.onKeyDown}
			onClick={props.onClick}
			onPointerOver={props.onPointerOver}
			onFocusIn={props.onFocusIn}
			onScroll={props.onScroll}
		>
			{sections.map((section) => (
				<div
					key={section.id}
					role="rowgroup"
					aria-label={section.label}
					class="ui-emoji-picker__section"
					data-section={section.id}
				>
					<div class="ui-emoji-picker__section-title" aria-hidden="true">{section.label}</div>
					<div
						class="ui-emoji-picker__rows"
						style={styleVars({
							"--emoji-rows": String(Math.ceil(section.entries.length / columns)),
						})}
					>
						{chunk(section.entries, columns).map((row, r) => (
							<div key={r} role="row" class="ui-emoji-picker__row">
								{row.map((entry, c) => {
									const index = section.start + r * columns + c;
									return (
										<EmojiCell
											key={entry.hexcode}
											entry={entry}
											index={index}
											tabbable={index === focusIndex}
										/>
									);
								})}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
// #endregion
