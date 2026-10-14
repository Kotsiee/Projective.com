import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { scopeNoun } from "../core/catalogue-model.ts";
import type { CatalogueTypeFilter } from "../types/catalogue-types.ts";

/**
 * ConsoleStates — the console canvas's non-list states: loading (shaped like what is arriving), a
 * failed read (named, with the recovery, and saying plainly when the list on screen is stale), an
 * empty catalogue or an empty filter.
 * Every state ends in a control: a state that names a next step must let the reader take it.
 */

const SKELETON_COUNT = 8;

/** The loading state, in the shape of the grid or the list. */
export function ConsoleSkeleton({ grid }: { grid: boolean }): JSX.Element {
	return (
		<div class={grid ? "cat-skel cat-skel--grid" : "cat-skel cat-skel--list"} aria-hidden="true">
			{Array.from({ length: SKELETON_COUNT }, (_, i) => <div key={i} class="cat-skel__cell" />)}
		</div>
	);
}

/** Props for {@link ConsoleError}. */
export interface ConsoleErrorProps {
	message: string;
	/** Listings from an earlier read are still on screen. */
	stale: boolean;
	onRetry: () => void;
}

/** A read that failed. */
export function ConsoleError({ message, stale, onRetry }: ConsoleErrorProps): JSX.Element {
	return (
		<div class="cat-state cat-state--error" role="alert">
			<span class="cat-state__glyph" aria-hidden="true">
				<Icon name="refresh" size="lg" />
			</span>
			<p class="cat-state__title">{message}</p>
			<p class="cat-state__note">
				{stale
					? "The listings below are from the last load that worked, so they may not match your filters."
					: "Nothing was lost. Your listings are safe; this view just couldn't reach them."}
			</p>
			<button type="button" class="cat-state__cta" onClick={onRetry}>
				<Icon name="refresh" /> Try again
			</button>
		</div>
	);
}

/** Props for {@link ConsoleEmpty}. */
export interface ConsoleEmptyProps {
	/** A search, facet or quick filter is narrowing the list. */
	filtered: boolean;
	type: CatalogueTypeFilter;
	onClear: () => void;
	onCreate: () => void;
}

/** Nothing to show: an empty filter, or an empty catalogue. */
export function ConsoleEmpty(
	{ filtered, type, onClear, onCreate }: ConsoleEmptyProps,
): JSX.Element {
	const noun = scopeNoun(type);
	if (filtered) {
		return (
			<div class="cat-state" role="status">
				<span class="cat-state__glyph" aria-hidden="true">
					<Icon name="filter-off" size="lg" />
				</span>
				<p class="cat-state__title">No {noun} match these filters</p>
				<p class="cat-state__note">Your other {noun} are still here. Only the view is narrowed.</p>
				<button type="button" class="cat-state__cta" onClick={onClear}>Clear filters</button>
			</div>
		);
	}
	return (
		<div class="cat-state" role="status">
			<span class="cat-state__glyph" aria-hidden="true">
				<Icon name="catalogue" size="lg" />
			</span>
			<p class="cat-state__title">Create your first {noun.slice(0, -1)}</p>
			<p class="cat-state__note">Draft it, price it and publish it, all from here.</p>
			<button type="button" class="cat-state__cta cat-state__cta--primary" onClick={onCreate}>
				<Icon name="plus" /> New {noun.slice(0, -1)}
			</button>
		</div>
	);
}
