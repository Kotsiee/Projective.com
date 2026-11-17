import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import "@ui/fields/styles/swatch-picker.css";
import { cx } from "@ui/core/cx.ts";
import { SWATCH_COLUMNS, SWATCHES, swatchFor } from "@ui/fields/core/swatches.ts";
import { Icon } from "@projective/ui/icons";
import type { MenuItem } from "@projective/ui/navigation";
import type { CalendarEvent } from "@projective/types/scheduling";

/** Props for {@link EventColorGrid}. */
export interface EventColorGridProps {
	/** The entry's own swatch token, or `null` for its kind's colour. */
	value: string | null;
	/** Told the token picked, or `null` for the default; not told when the reader re-picks the same. */
	onPick: (accent: string | null) => void;
	/** Close the menu the grid sits in. */
	onDone: () => void;
}

/**
 * EventColorGrid — an entry's colour, as two rows of six inside its right-click menu (Decision #441),
 * the `/files` folder menu's pattern over the calendar's own palette (Decision #408): Default and the
 * eleven hues, drawn with `SwatchPicker`'s cells so a colour reads the same in both.
 *
 * It keeps the menu's keyboard model: arrows move inside it, Up and Down leave from its edges, and a
 * pick closes the menu. Each cell is a `menuitemradio`, its name spoken.
 */
export function EventColorGrid({ value, onPick, onDone }: EventColorGridProps): JSX.Element {
	const grid = useRef<HTMLDivElement>(null);
	const current = swatchFor(value).token;

	function pick(token: string | null): void {
		onDone();
		if (token !== current) onPick(token);
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLElement>, index: number): void {
		if (e.key === "Enter" || e.key === " ") {
			e.stopPropagation();
			return;
		}
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const steps: Record<string, number> = {
			ArrowLeft: rtl ? 1 : -1,
			ArrowRight: rtl ? -1 : 1,
			ArrowUp: -SWATCH_COLUMNS,
			ArrowDown: SWATCH_COLUMNS,
		};
		const step = steps[e.key];
		const cells = grid.current?.querySelectorAll<HTMLElement>("button");
		const next = step === undefined ? undefined : cells?.[index + step];
		if (!next) return;
		e.preventDefault();
		e.stopPropagation();
		next.focus();
	}

	return (
		<div class="ui-swatches ui-swatches--size-sm" ref={grid}>
			{SWATCHES.map((swatch, index) => (
				<button
					key={swatch.slug}
					type="button"
					class={cx("ui-swatches__swatch", `ui-swatches__swatch--${swatch.slug}`)}
					role="menuitemradio"
					aria-checked={swatch.token === current}
					aria-label={swatch.label}
					tabIndex={-1}
					onClick={() => pick(swatch.token)}
					onKeyDown={(e) => onKeyDown(e, index)}
				>
					{swatch.token === null && <Icon name="close" size="xs" />}
				</button>
			))}
		</div>
	);
}

/** An entry's colour grid as a menu row, for any menu that belongs to the entry. */
export function eventColourRow(
	event: CalendarEvent,
	onPick: (accent: string | null) => void,
): MenuItem {
	return {
		key: "colour",
		label: "Colour",
		content: (close) => (
			<EventColorGrid value={event.accent ?? null} onPick={onPick} onDone={close} />
		),
	};
}
