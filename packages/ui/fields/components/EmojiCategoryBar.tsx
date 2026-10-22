import type { JSX } from "preact";
import { Icon } from "../../icons/components/Icon.tsx";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import { EMOJI_CATEGORIES, type EmojiCategoryId } from "../core/emoji-data.ts";

/** Props for {@link EmojiCategoryBar}. */
export interface EmojiCategoryBarProps {
	/** A search is active: buttons toggle a category filter instead of scrolling to a section. */
	searching: boolean;
	/** The section in view while browsing. */
	active: EmojiCategoryId;
	/** The category the search results are narrowed to, if any. */
	filter: EmojiCategoryId | null;
	onPick: (id: EmojiCategoryId) => void;
}

/**
 * The category bar: a toolbar of icon-only ghost buttons with a roving tabindex (Left/Right,
 * Home/End). While browsing, each button is a location (`aria-current`) that scrolls to its section;
 * while searching, each is a toggle (`aria-pressed`) that narrows the results to its category.
 */
export function EmojiCategoryBar(
	{ searching, active, filter, onPick }: EmojiCategoryBarProps,
): JSX.Element {
	const current = searching ? filter : active;
	const tabbable = Math.max(0, EMOJI_CATEGORIES.findIndex((c) => c.id === current));

	function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const buttons = Array.from(
			event.currentTarget.querySelectorAll<HTMLButtonElement>(".ui-emoji-picker__category"),
		);
		const from = buttons.indexOf(event.target as HTMLButtonElement);
		if (from < 0) return;
		const last = buttons.length - 1;
		const to = event.key === "ArrowRight"
			? Math.min(last, from + 1)
			: event.key === "ArrowLeft"
			? Math.max(0, from - 1)
			: event.key === "Home"
			? 0
			: event.key === "End"
			? last
			: null;
		if (to === null) return;
		event.preventDefault();
		buttons[from].tabIndex = -1;
		buttons[to].tabIndex = 0;
		buttons[to].focus();
	}

	return (
		<div
			role="toolbar"
			aria-label="Emoji categories"
			aria-orientation="horizontal"
			class="ui-emoji-picker__categories"
			onKeyDown={onKeyDown}
		>
			{EMOJI_CATEGORIES.map((category, i) => {
				const on = current === category.id;
				return (
					<Tooltip key={category.id} content={category.label} placement="top">
						<button
							type="button"
							class="ui-emoji-picker__category"
							tabIndex={i === tabbable ? 0 : -1}
							aria-label={category.label}
							aria-pressed={searching ? on : undefined}
							aria-current={!searching && on ? "true" : undefined}
							data-active={on ? "true" : undefined}
							onClick={() => onPick(category.id)}
						>
							<Icon name={category.icon} size="sm" />
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}
