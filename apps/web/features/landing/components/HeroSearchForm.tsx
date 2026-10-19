import type { ComponentChildren, JSX, Ref } from "preact";
import type { ReadonlySignal } from "@preact/signals";
import { SUGGEST_QUERY_MAX } from "@projective/types/explore/limits";
import {
	HERO_CATEGORIES,
	HERO_SEARCH_COPY,
	type HeroCategory,
	heroCategory,
	type HeroGlyph,
	NO_MATCHES_TEXT,
	noMatchesLabel,
	removeRecentLabel,
	searchAnywayLabel,
	sheetButtonLabel,
	type SuggestPhase,
	type SuggestRow,
	type SuggestSection,
	type SuggestSectionId,
	TYPEWRITER_FRAME,
} from "../core/hero-search.ts";

// #region Ids
/** The element ids one search instance owns; `idSuffix` keeps a second instance's ids unique. */
export interface HeroSearchIds {
	input: string;
	select: string;
	list: string;
	status: string;
	removeHint: string;
	sheetButton: string;
	sheet: string;
}

/** The ids of the instance with `suffix` (`""` for the hero, `"-final"` for the final call to action). */
export function heroSearchIds(suffix = ""): HeroSearchIds {
	return {
		input: `lp-q${suffix}`,
		select: `lp-category${suffix}`,
		list: `lp-suggest${suffix}`,
		status: `lp-suggest-status${suffix}`,
		removeHint: `lp-suggest-remove${suffix}`,
		sheetButton: `lp-category-btn${suffix}`,
		sheet: `lp-category-sheet${suffix}`,
	};
}

/** The id of the listbox's option at flat index `index`. */
export function optionId(ids: HeroSearchIds, index: number): string {
	return `${ids.list}-${index}`;
}
// #endregion

// #region Props
/** What the island does when the visitor acts; absent on the server's first paint and in tests. */
export interface HeroSearchHandlers {
	submit: (event: SubmitEvent) => void;
	input: (value: string) => void;
	keyDown: (event: KeyboardEvent) => void;
	focus: () => void;
	focusOut: (event: FocusEvent) => void;
	category: (value: HeroCategory) => void;
	openSheet: () => void;
	choose: (index: number) => void;
	hover: (index: number) => void;
	remove: (term: string) => void;
}

/** Props for {@link HeroSearchForm}: the search's whole visible state, and its handlers. */
export interface HeroSearchFormProps {
	ids: HeroSearchIds;
	query: string;
	category: HeroCategory;
	/** Hydrated: the `/` shortcut is bound, so its hint shows and `aria-keyshortcuts` is declared. */
	hydrated: boolean;
	/**
	 * Below `--bp-md` the icon button that opens the category sheet stands in for the select (once
	 * hydrated, and while the sheet can load).
	 */
	scopeButton: boolean;
	/**
	 * The typewriter's typed part while it runs (the overlay shows), else `null`. The island passes a
	 * signal, so each character updates the overlay's text node without re-rendering the form.
	 */
	typewriter: string | ReadonlySignal<string> | null;
	/** The `/` hint and `aria-keyshortcuts` belong to this instance (the hero's only, #282). */
	slashFocus: boolean;
	/**
	 * The search landmark's name, so two searches on one page are told apart: `labelledBy` (a
	 * heading's id, `aria-labelledby`) or else `label` (`aria-label`). Neither leaves it unnamed.
	 */
	landmark?: { label?: string; labelledBy?: string };
	/** The suggestions panel is open. */
	open: boolean;
	sections: readonly SuggestSection[];
	/** The flat index of the `aria-activedescendant` row, or -1. */
	active: number;
	status: SuggestPhase;
	/** The polite status region's sentence. */
	announcement: string;
	sheetOpen: boolean;
	/** The picture a person row shows when the payload carries none (`DEFAULT_AVATAR_URL`). */
	avatarFallback: string;
	/** Renders a registry icon (the island passes `Icon`; tests pass a stand-in). */
	glyph: (name: HeroGlyph) => ComponentChildren;
	formRef?: Ref<HTMLFormElement>;
	inputRef?: Ref<HTMLInputElement>;
	on?: HeroSearchHandlers;
}
// #endregion

// #region Rows
/** The glyph a listing row falls back to when its hit carries no cover. */
const LISTING_GLYPH: Partial<Record<SuggestSectionId, HeroGlyph>> = {
	services: "service",
	projects: "projects",
};

/** Keep focus in the input when a row or its remove control is pressed. */
function keepFocus(event: MouseEvent): void {
	event.preventDefault();
}

/** One row's leading visual: an avatar, a cover, or a glyph. */
function RowLead(
	{ row, section, avatarFallback, glyph }: {
		row: SuggestRow;
		section: SuggestSectionId;
		avatarFallback: string;
		glyph: HeroSearchFormProps["glyph"];
	},
): JSX.Element | null {
	if (row.kind === "person") {
		return (
			<span class="lp-suggest__lead lp-suggest__lead--avatar">
				<img
					class="lp-suggest__img"
					src={row.avatar ?? avatarFallback}
					alt=""
					width={32}
					height={32}
					loading="lazy"
					decoding="async"
				/>
			</span>
		);
	}
	if (row.kind === "listing" && row.media) {
		return (
			<span class="lp-suggest__lead">
				<img
					class="lp-suggest__img"
					src={row.media}
					alt=""
					width={32}
					height={32}
					loading="lazy"
					decoding="async"
				/>
			</span>
		);
	}
	const name: HeroGlyph | undefined = row.kind === "recent"
		? "history"
		: row.kind === "trending"
		? "arrow-up-right"
		: row.kind === "search"
		? "search"
		: row.kind === "listing"
		? LISTING_GLYPH[section]
		: undefined;
	if (!name) return null;
	return <span class="lp-suggest__lead" aria-hidden="true">{glyph(name)}</span>;
}

/** One row's text: its title and meta line, or the action it runs. */
function RowText({ row }: { row: SuggestRow }): JSX.Element {
	switch (row.kind) {
		case "recent":
		case "trending":
			return (
				<span class="lp-suggest__text">
					<span class="lp-suggest__title">{row.term}</span>
				</span>
			);
		case "clear-recent":
			return (
				<span class="lp-suggest__text">
					<span class="lp-suggest__action">{HERO_SEARCH_COPY.clearRecent}</span>
				</span>
			);
		case "person":
			return (
				<span class="lp-suggest__text">
					<span class="lp-suggest__title">{row.name}</span>
					<span class="lp-suggest__meta">{row.meta}</span>
				</span>
			);
		case "listing":
			return (
				<span class="lp-suggest__text">
					<span class="lp-suggest__title">{row.title}</span>
					<span class="lp-suggest__meta">{row.meta}</span>
				</span>
			);
		case "search":
			return (
				<span class="lp-suggest__text">
					<span class="lp-suggest__title">
						{row.empty ? NO_MATCHES_TEXT : searchAnywayLabel(row.q)}
					</span>
				</span>
			);
	}
}
// #endregion

// #region Component
/**
 * HeroSearchForm — the landing search's markup as a pure function of its state
 * (`flows/LANDING.md` §4.1). The `HeroSearch` island owns the state and renders this; the server's
 * first paint is the same call with nothing open, which is the no-JavaScript search.
 *
 * A real `<form role="search" action="/explore" method="get">`: the visually hidden `<label>`, a
 * native `<select name="category">` (the desktop picker, and the value carrier everywhere), the
 * `q` input — an ARIA combobox (`aria-expanded`, `aria-controls`, `aria-activedescendant`) with an
 * `aria-hidden` typewriter overlay over its static placeholder — the `/` hint ("/ to search", its box
 * reserved on the server and shown with `aria-keyshortcuts` once the shortcut is bound), and the
 * submit. Below `--bp-md`, once hydrated, an icon button the same width stands in for the select
 * and opens the category sheet. The suggestions panel is a listbox of labelled groups under the
 * field, positioned over the page so nothing below it moves; a recent search's remove button sits
 * beside its option (an option's content is presentational), named for the term; a polite status
 * region reads the panel's state out.
 *
 * ARIA states are written as the strings `"true"` / `"false"`: the server renderer drops a `false`
 * attribute and prints a bare `true` one, and a combobox needs both states explicit.
 */
export function HeroSearchForm(props: HeroSearchFormProps): JSX.Element {
	const { ids, query, category, open, sections, active, on, glyph } = props;
	const current = heroCategory(category);
	const quiet = props.typewriter !== null;
	const shortcut = props.slashFocus && props.hydrated;
	const modifiers = [
		props.hydrated && " lp-hero-search--hydrated",
		props.scopeButton && " lp-hero-search--sheet",
		open && " lp-hero-search--open",
	].filter(Boolean).join("");
	let index = -1;

	return (
		<div class={`lp-hero-search${modifiers}`} onFocusOut={on?.focusOut}>
			<form
				ref={props.formRef}
				class="lp-hero-search__form"
				role="search"
				aria-labelledby={props.landmark?.labelledBy || undefined}
				aria-label={props.landmark?.labelledBy ? undefined : props.landmark?.label || undefined}
				action="/explore"
				method="get"
				onSubmit={on?.submit}
			>
				<label class="ui-visually-hidden" for={ids.input}>{HERO_SEARCH_COPY.label}</label>
				<div class="lp-search">
					<div class="lp-search__scope">
						<select
							id={ids.select}
							class="lp-search__select"
							name="category"
							aria-label={HERO_SEARCH_COPY.picker}
							value={category}
							onChange={on &&
								((event) => on.category(event.currentTarget.value as HeroCategory))}
						>
							{HERO_CATEGORIES.map((option) => (
								<option
									key={option.value}
									value={option.value}
									selected={option.value === category}
								>
									{option.label}
								</option>
							))}
						</select>
						<span class="lp-search__chevron" aria-hidden="true">{glyph("chevron-down")}</span>
					</div>
					{props.scopeButton && (
						<button
							type="button"
							id={ids.sheetButton}
							class="lp-search__scope-btn"
							aria-label={sheetButtonLabel(category)}
							aria-haspopup="dialog"
							aria-expanded={props.sheetOpen ? "true" : "false"}
							aria-controls={props.sheetOpen ? ids.sheet : undefined}
							onClick={on?.openSheet}
						>
							<span aria-hidden="true">{glyph(current.glyph)}</span>
							<span class="lp-search__scope-caret" aria-hidden="true">{glyph("chevron-down")}</span>
						</button>
					)}
					<div class="lp-search__control">
						<input
							ref={props.inputRef}
							id={ids.input}
							class={`lp-search__input${quiet ? " lp-search__input--quiet" : ""}`}
							type="text"
							name="q"
							value={query}
							placeholder={HERO_SEARCH_COPY.placeholder}
							role="combobox"
							aria-autocomplete="list"
							aria-expanded={open ? "true" : "false"}
							aria-controls={ids.list}
							aria-activedescendant={open && active >= 0 ? optionId(ids, active) : undefined}
							aria-keyshortcuts={shortcut ? "/" : undefined}
							autoComplete="off"
							autoCapitalize="off"
							spellcheck={false}
							enterKeyHint="search"
							inputMode="search"
							maxLength={SUGGEST_QUERY_MAX}
							onInput={on && ((event) => on.input(event.currentTarget.value))}
							onKeyDown={on?.keyDown}
							onFocus={on?.focus}
						/>
						{quiet && (
							<span class="lp-search__typewriter" aria-hidden="true">
								{TYPEWRITER_FRAME.open}
								{props.typewriter}
								<span class="lp-search__caret" />
								{TYPEWRITER_FRAME.close}
							</span>
						)}
					</div>
					{props.slashFocus && (
						<span
							class={`lp-search__hint${shortcut ? " lp-search__hint--live" : ""}`}
							aria-hidden="true"
						>
							<kbd class="lp-search__kbd">/</kbd>
							{HERO_SEARCH_COPY.shortcutHint}
						</span>
					)}
					<button type="submit" class="lp-btn lp-btn--brand lp-search__submit">
						<span class="lp-search__submit-icon" aria-hidden="true">{glyph("search")}</span>
						<span class="lp-search__submit-text">{HERO_SEARCH_COPY.submit}</span>
					</button>
				</div>

				<div class="lp-suggest" hidden={!open}>
					<div
						id={ids.list}
						class="lp-suggest__list"
						role="listbox"
						aria-label={HERO_SEARCH_COPY.listbox}
					>
						{sections.map((section) => {
							const labelId = `${ids.list}-${section.id}`;
							return (
								<div
									key={section.id}
									class={`lp-suggest__group lp-suggest__group--${section.id}`}
									role="group"
									aria-labelledby={section.label ? labelId : undefined}
									aria-label={section.label ? undefined : HERO_SEARCH_COPY.submit}
								>
									{section.label && (
										<div id={labelId} class="lp-suggest__label" role="presentation">
											{section.label}
										</div>
									)}
									{section.rows.map((row) => {
										index += 1;
										const i = index;
										const option = (
											<div
												key={i}
												id={optionId(ids, i)}
												class="lp-suggest__option"
												role="option"
												aria-selected={i === active ? "true" : "false"}
												aria-label={row.kind === "search" && row.empty
													? noMatchesLabel(row.q)
													: undefined}
												aria-describedby={row.kind === "recent" ? ids.removeHint : undefined}
												onMouseDown={keepFocus}
												onClick={on && (() => on.choose(i))}
												onPointerMove={on && (() => i !== active && on.hover(i))}
											>
												<RowLead
													row={row}
													section={section.id}
													avatarFallback={props.avatarFallback}
													glyph={glyph}
												/>
												<RowText row={row} />
												{row.kind === "search" && !row.empty && (
													<kbd class="lp-suggest__enter" aria-hidden="true">Enter</kbd>
												)}
											</div>
										);
										if (row.kind !== "recent") return option;
										// The remove control sits beside its option, never inside it: an option's
										// content is presentational, so a button there could not be reached.
										return (
											<div key={i} class="lp-suggest__row" role="none">
												{option}
												<button
													type="button"
													class="lp-suggest__remove"
													tabIndex={-1}
													aria-label={removeRecentLabel(row.term)}
													onMouseDown={keepFocus}
													onClick={on && (() => on.remove(row.term))}
												>
													<span aria-hidden="true">{glyph("close")}</span>
												</button>
											</div>
										);
									})}
								</div>
							);
						})}
					</div>
					{props.status === "loading" && query.trim() !== "" && (
						<p class="lp-suggest__status" aria-hidden="true">{HERO_SEARCH_COPY.searching}</p>
					)}
					{props.status === "error" && query.trim() !== "" && (
						<p class="lp-suggest__status" aria-hidden="true">{HERO_SEARCH_COPY.failed}</p>
					)}
				</div>
				<span id={ids.removeHint} hidden>{HERO_SEARCH_COPY.removeHint}</span>
			</form>
			<p id={ids.status} class="ui-visually-hidden" role="status" aria-live="polite">
				{props.announcement}
			</p>
		</div>
	);
}
// #endregion
