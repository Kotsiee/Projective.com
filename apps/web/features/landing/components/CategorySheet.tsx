import type { JSX, RefObject } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Drawer } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { HERO_CATEGORIES, HERO_SEARCH_COPY, type HeroCategory } from "../core/hero-search.ts";

// #region Props
/** Props for {@link CategorySheet}. */
export interface CategorySheetProps {
	/** Open state, shared with the picker button that opens it. */
	visible: Signal<boolean>;
	/** The category the search is in now. */
	value: HeroCategory;
	/** A category was taken (a tap, Enter or Space); the sheet closes with it. */
	onPick: (value: HeroCategory) => void;
	/** Where focus lands when the sheet closes: the search input. */
	returnFocusRef: RefObject<HTMLElement | null>;
	/** The radio group's name, unique per search instance. */
	name: string;
	/** The id of the sheet's body: the element the picker button's `aria-controls` names. */
	id: string;
}
// #endregion

// #region Component
/**
 * CategorySheet — the hero search's category picker below `--bp-md` (`flows/LANDING.md` §2.1
 * overlays): a bottom sheet from the overlay family (the app's `Drawer`: portal, scrim, focus trap,
 * scroll lock, Escape; Decision #171) titled "Search in", re-skinned `lp-sheet` and marked
 * `lp-portal` so the landing's tokens resolve at `<body>`. A radio group of the five categories:
 * the arrow keys move the choice inside the sheet only, and a tap, Enter or Space takes it and
 * closes the sheet, which hands focus back to the search input. Escape or Close leaves the search
 * in the category it was in when the sheet opened.
 *
 * Loaded on demand by the `HeroSearch` island the first time the sheet opens, so it never weighs on
 * the hero's initial JavaScript; it sits outside `islands/` because it is not an island (Decision
 * #285 (D)).
 */
export function CategorySheet(
	{ visible, value, onPick, returnFocusRef, name, id }: CategorySheetProps,
): JSX.Element {
	const checkedRef = useRef<HTMLInputElement>(null);
	const committed = useRef(value);
	committed.current = value;
	const choice = useSignal<HeroCategory>(value);

	// Each opening starts from the category the search is in.
	useSignalEffect(() => {
		if (visible.value) choice.value = committed.current;
	});

	return (
		<Drawer
			visible={visible}
			position="bottom"
			size="auto"
			header={HERO_SEARCH_COPY.sheetTitle}
			class="lp-portal lp-sheet"
			initialFocusRef={checkedRef}
			returnFocusRef={returnFocusRef}
		>
			<div id={id}>
				<fieldset class="lp-sheet__options">
					<legend class="ui-visually-hidden">{HERO_SEARCH_COPY.sheetTitle}</legend>
					{HERO_CATEGORIES.map((option) => (
						<label
							key={option.value}
							class="lp-sheet__option"
							onClick={(event) => {
								// A pointer press (detail ≥ 1) takes the choice; a keyboard-made click does not.
								if (event.detail > 0) onPick(option.value);
							}}
						>
							<input
								ref={option.value === choice.value ? checkedRef : undefined}
								class="lp-sheet__radio"
								type="radio"
								name={name}
								value={option.value}
								checked={option.value === choice.value}
								onChange={() => (choice.value = option.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onPick(option.value);
									}
								}}
							/>
							<span class="lp-sheet__glyph" aria-hidden="true">
								<Icon name={option.glyph} />
							</span>
							<span>{option.label}</span>
						</label>
					))}
				</fieldset>
			</div>
		</Drawer>
	);
}
// #endregion
