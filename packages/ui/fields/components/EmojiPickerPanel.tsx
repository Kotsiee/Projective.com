/// <reference lib="dom" />
import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/components/Icon.tsx";
import { Button } from "./Button.tsx";
import { EmojiCategoryBar } from "./EmojiCategoryBar.tsx";
import { EmojiGrid, type EmojiGridSection } from "./EmojiGrid.tsx";
import {
	EMOJI_CATEGORIES,
	type EmojiCategoryId,
	type EmojiDataset,
	type EmojiEntry,
} from "../core/emoji-data.ts";
import { searchEmoji } from "../core/emoji-search.ts";
import { isEmojiGridKey, layoutEmojiRows, moveInEmojiGrid } from "../core/emoji-grid.ts";
import { loadedEmojiDataset, loadEmojiDataset } from "../core/emoji-loader.ts";

/** Cells per grid row; the stylesheet reads the same number through `--emoji-columns`. */
export const EMOJI_COLUMNS = 8;

/** Props for {@link EmojiPickerPanel}. */
export interface EmojiPickerPanelProps {
	/** Insert one emoji; the panel stays open for the next. */
	onSelect: (entry: EmojiEntry) => void;
	/** Close and hand focus back to the host's field (Escape, or Backspace on an empty search). */
	onReturn: () => void;
	searchRef: RefObject<HTMLInputElement>;
	rootRef: RefObject<HTMLDivElement>;
}

function prefersReducedMotion(): boolean {
	return document.documentElement.dataset.motion === "reduced" ||
		(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

function isPrintable(event: KeyboardEvent): boolean {
	if (event.isComposing || event.key.length !== 1 || event.key === " " || event.metaKey) {
		return false;
	}
	const altGraph = event.getModifierState?.("AltGraph") ?? false;
	return !((event.ctrlKey || event.altKey) && !altGraph);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The picker's body: search field, category bar, emoji grid and preview line. Focus has two stages:
 * the search field (typing filters; Enter or ArrowDown enters the grid; Backspace on an empty field
 * closes) and the grid (arrows move a 2D roving tabindex; Enter or Space inserts; a printable key
 * returns to the search with that character appended). Escape anywhere closes.
 */
export function EmojiPickerPanel(
	{ onSelect, onReturn, searchRef, rootRef }: EmojiPickerPanelProps,
): JSX.Element {
	// #region State
	const dataset = useSignal<EmojiDataset | null>(loadedEmojiDataset());
	const loadError = useSignal<string | null>(null);
	const query = useSignal("");
	const filter = useSignal<EmojiCategoryId | null>(null);
	const active = useSignal<EmojiCategoryId>(EMOJI_CATEGORIES[0].id);
	const focusIndex = useSignal(0);
	const preview = useSignal<EmojiEntry | null>(null);
	const announcement = useSignal("");
	const scrollerRef = useRef<HTMLDivElement>(null);
	/** The section a category press is scrolling to; the scroll-spy stands down until it arrives. */
	const scrollTarget = useRef<EmojiCategoryId | null>(null);
	const spyFrame = useRef(0);
	// #endregion

	// #region Load
	function load(): void {
		loadError.value = null;
		loadEmojiDataset()
			.then((data) => (dataset.value = data))
			.catch((error: unknown) => (loadError.value = errorMessage(error)));
	}

	useEffect(() => {
		if (!dataset.value) load();
		return () => cancelAnimationFrame(spyFrame.current);
	}, []);
	// #endregion

	// #region Derived
	const data = dataset.value;
	const searching = query.value.trim().length > 0;
	const sections = useMemo<EmojiGridSection[]>(() => {
		if (!data) return [];
		if (searching) {
			const label = filter.value
				? `${EMOJI_CATEGORIES.find((c) => c.id === filter.value)?.label} results`
				: "Search results";
			return [{
				id: "results",
				label,
				entries: searchEmoji(data, query.value, filter.value),
				start: 0,
			}];
		}
		let start = 0;
		return EMOJI_CATEGORIES.map((category) => {
			const entries = data.byCategory.get(category.id) ?? [];
			const section = { id: category.id, label: category.label, entries, start };
			start += entries.length;
			return section;
		});
	}, [data, searching, query.value, filter.value]);
	const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
	const rows = useMemo(
		() => layoutEmojiRows(sections.map((s) => s.entries.length), EMOJI_COLUMNS),
		[sections],
	);
	// #endregion

	// #region Focus
	function focusCell(index: number): void {
		if (flat.length === 0) return;
		const next = Math.min(Math.max(index, 0), flat.length - 1);
		focusIndex.value = next;
		const cell = scrollerRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`);
		cell?.focus({ preventScroll: true });
		cell?.scrollIntoView({ block: "nearest" });
	}

	function focusSearch(): void {
		searchRef.current?.focus();
	}

	function resetResults(): void {
		focusIndex.value = 0;
		scrollerRef.current?.scrollTo({ top: 0 });
	}

	function setQuery(next: string): void {
		query.value = next;
		if (!next.trim()) filter.value = null;
		resetResults();
		if (next.trim() && dataset.value) {
			const count = searchEmoji(dataset.value, next, filter.value).length;
			announcement.value = count === 0 ? "No emojis found" : `${count} emoji found`;
		} else announcement.value = "";
	}

	function select(entry: EmojiEntry): void {
		onSelect(entry);
		announcement.value = `Inserted ${entry.label}`;
	}
	// #endregion

	// #region Search field
	function onSearchKeyDown(event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
		if (event.key === "Backspace" && event.currentTarget.value === "") {
			event.preventDefault();
			onReturn();
		} else if (event.key === "Enter" || event.key === "ArrowDown") {
			event.preventDefault();
			focusCell(0);
		}
	}
	// #endregion

	// #region Grid
	function cellIndex(target: EventTarget | null): number | null {
		const cell = target instanceof Element ? target.closest<HTMLElement>("[data-index]") : null;
		return cell ? Number(cell.dataset.index) : null;
	}

	function onGridKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const index = cellIndex(event.target);
		if (index === null) return;
		if (isEmojiGridKey(event.key)) {
			event.preventDefault();
			const next = moveInEmojiGrid(rows, index, event.key, event.ctrlKey || event.metaKey);
			if (next === "exit-top") focusSearch();
			else focusCell(next);
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			const entry = flat[index];
			if (entry) select(entry);
		} else if (event.key === "Backspace") {
			event.preventDefault();
			focusSearch();
			setQuery(query.value.slice(0, -1));
		} else if (isPrintable(event)) {
			event.preventDefault();
			focusSearch();
			setQuery(query.value + event.key);
		}
	}

	function onGridClick(event: JSX.TargetedMouseEvent<HTMLDivElement>): void {
		const index = cellIndex(event.target);
		if (index === null) return;
		focusIndex.value = index;
		const entry = flat[index];
		if (entry) select(entry);
	}

	function onGridPointerOver(event: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const index = cellIndex(event.target);
		if (index !== null) preview.value = flat[index] ?? null;
	}

	function onGridFocusIn(event: JSX.TargetedFocusEvent<HTMLDivElement>): void {
		const index = cellIndex(event.target);
		if (index === null) return;
		focusIndex.value = index;
		preview.value = flat[index] ?? null;
	}

	function onGridScroll(): void {
		if (searching) return;
		cancelAnimationFrame(spyFrame.current);
		spyFrame.current = requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const top = scroller.scrollTop + 4;
			let inView: EmojiCategoryId = EMOJI_CATEGORIES[0].id;
			for (const node of scroller.querySelectorAll<HTMLElement>("[data-section]")) {
				if (node.offsetTop <= top) inView = node.dataset.section as EmojiCategoryId;
			}
			if (scrollTarget.current) {
				if (inView !== scrollTarget.current) return;
				scrollTarget.current = null;
			}
			active.value = inView;
		});
	}
	// #endregion

	// #region Categories
	function onPickCategory(id: EmojiCategoryId): void {
		if (searching) {
			filter.value = filter.value === id ? null : id;
			setQuery(query.value);
			return;
		}
		const scroller = scrollerRef.current;
		const section = scroller?.querySelector<HTMLElement>(`[data-section="${id}"]`);
		if (!scroller || !section) return;
		active.value = id;
		scrollTarget.current = id;
		focusIndex.value = sections.find((s) => s.id === id)?.start ?? 0;
		scroller.scrollTo({
			top: section.offsetTop,
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}
	// #endregion

	// #region Render
	function onRootKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		onReturn();
	}

	const shown = preview.value;
	const filterLabel = EMOJI_CATEGORIES.find((c) => c.id === filter.value)?.label;

	return (
		<div
			ref={rootRef}
			class="ui-emoji-picker"
			tabIndex={-1}
			style={styleVars({ "--emoji-columns": String(EMOJI_COLUMNS) })}
			onKeyDown={onRootKeyDown}
		>
			<div class="ui-emoji-picker__search">
				<span class="ui-field ui-input ui-field--size-sm ui-field--outlined ui-field--fluid">
					<span class="ui-input__adornment ui-input__adornment--start">
						<Icon name="search" />
					</span>
					<input
						ref={searchRef}
						type="text"
						class="ui-field__input ui-input__input"
						placeholder="Search emoji"
						aria-label="Search emoji"
						autoComplete="off"
						spellcheck={false}
						enterKeyHint="go"
						value={query.value}
						onInput={(e) => setQuery(e.currentTarget.value)}
						onKeyDown={onSearchKeyDown}
					/>
				</span>
			</div>

			<EmojiCategoryBar
				searching={searching}
				active={active.value}
				filter={filter.value}
				onPick={onPickCategory}
			/>

			{loadError.value
				? (
					<div class="ui-emoji-picker__state" role="alert">
						<p class="ui-emoji-picker__state-title">Emoji couldn't load</p>
						<Button label="Try again" variant="text" size="sm" onClick={load} />
					</div>
				)
				: !data
				? <p class="ui-emoji-picker__state" role="status">Loading emoji…</p>
				: flat.length === 0
				? (
					<div class="ui-emoji-picker__state">
						<p class="ui-emoji-picker__state-title">No emojis found</p>
						{filterLabel
							? (
								<Button
									label="Search all categories"
									variant="text"
									size="sm"
									onClick={() => onPickCategory(filter.value as EmojiCategoryId)}
								/>
							)
							: <p class="ui-emoji-picker__state-hint">Try a feeling, like “happy” or “party”.</p>}
					</div>
				)
				: (
					<EmojiGrid
						sections={sections}
						columns={EMOJI_COLUMNS}
						focusIndex={focusIndex.value}
						label={searching ? "Search results" : "Emoji"}
						scrollerRef={scrollerRef}
						onKeyDown={onGridKeyDown}
						onClick={onGridClick}
						onPointerOver={onGridPointerOver}
						onFocusIn={onGridFocusIn}
						onScroll={onGridScroll}
					/>
				)}

			<div class="ui-emoji-picker__preview" aria-hidden="true">
				{shown
					? (
						<>
							<span class="ui-emoji-picker__preview-glyph">{shown.emoji}</span>
							<span class="ui-emoji-picker__preview-label">{shown.label}</span>
							{shown.shortcodes[0] && (
								<span class="ui-emoji-picker__preview-code">:{shown.shortcodes[0]}:</span>
							)}
						</>
					)
					: <span class="ui-emoji-picker__preview-label">Pick an emoji</span>}
			</div>

			<p class="ui-visually-hidden" role="status" aria-live="polite">{announcement.value}</p>
		</div>
	);
	// #endregion
}
