import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
import { InputText } from "@projective/ui/fields";
import { SearchIcon } from "../components/catalogue-glyphs.tsx";
import { segmentHref, TYPE_TABS } from "../core/catalogue-model.ts";
import {
	type AnalyticsPeriod,
	analyticsPeriod,
	consoleBusy,
	consoleError,
	consoleQuery,
	consoleTotal,
} from "../core/catalogue-state.ts";
import type { CatalogueTypeFilter } from "../types/catalogue-types.ts";

/**
 * CatalogueHeader — the console's middle-nav HEADER band. It owns what the region contract says it
 * owns: **identity** (what you are looking at, and how much of it), and the **global controls** that
 * scope the whole surface — the one search field and the analytics window.
 *
 * Both were previously in the scrolling body: the search inside a `.fx-toolbar` that duplicated the
 * lane's own, and the period switch inside the analytics block. Search now writes the single
 * {@link consoleQuery} signal that the body fetch AND the lane narrow both read, so the two can no
 * longer disagree; the period switch matches `/wallet`, whose header band owns its 30/60/90 range.
 *
 * The count is read, not computed — the body publishes what the server actually returned.
 */

// #region Props + constants
export interface CatalogueHeaderProps {
	/** The active `?type=` segment — names the scope in the identity block. */
	type: CatalogueTypeFilter;
	/** The SSR result count, so the band reports a real number in the first byte. */
	initialTotal: number;
	/** The SSR search term (a shared/bookmarked `?search=` URL paints its own query). */
	initialSearch: string;
}

const PERIODS = ["7d", "30d", "90d"] as const;
// #endregion

/** The plural noun for a type segment — the console never says "items". */
function scopeNoun(type: CatalogueTypeFilter): string {
	return type === "service" ? "services" : type === "product" ? "products" : "listings";
}

export default function CatalogueHeader(props: CatalogueHeaderProps): JSX.Element {
	const noun = scopeNoun(props.type);

	/*
	 * The field binds STRAIGHT to the shared signal — no local mirror. A mirror would have to be kept
	 * in sync by hand, and this island re-renders on every `consoleBusy` / `consoleTotal` /
	 * `consoleError` tick, so a stale mirror resets the input's value out from under whoever is typing.
	 * One signal, one writer, no synchronisation to get wrong.
	 */
	useEffect(() => {
		consoleQuery.value = props.initialSearch;
		consoleTotal.value = props.initialTotal;
	}, []);

	const total = consoleTotal.value;
	const busy = consoleBusy.value;
	const failed = consoleError.value !== null;

	return (
		<div class="cat-hdr">
			<div class="cat-hdr__ident">
				<h1 class="cat-hdr__title">Catalogue</h1>
				{
					/*
					 * The count is the identity's second half: "Catalogue · 16 services" answers both what
					 * this is and how much of it there is. While a fetch is in flight it says so rather than
					 * asserting a stale number, and after a failure it refuses to assert one at all.
					 */
				}
				<span class="cat-hdr__count" aria-live="polite">
					{failed
						? "Couldn’t refresh"
						: busy
						? `Searching ${noun}…`
						: `${total} ${total === 1 ? noun.replace(/s$/, "") : noun}`}
				</span>
			</div>

			<div class="cat-hdr__search">
				<InputText
					value={consoleQuery}
					placeholder={`Search ${noun}`}
					type="search"
					variant="bare"
					size="sm"
					block
					aria-label={`Search ${noun}`}
					start={
						<span class="cat-hdr__searchicon" aria-hidden="true">
							<SearchIcon size={16} />
						</span>
					}
				/>
			</div>

			{
				/*
				 * Mobile-only type segment. The lane owns this switch, and the lane is `display: none` below
				 * the breakpoint — so without a home it is unreachable on a phone. It lands here rather than
				 * in the footer because three controls will not fit a 390px band, and this band has already
				 * hidden the page title at that width. It navigates, exactly as the lane's does: `?type=`
				 * scopes the console body too, and the two roots can only agree on the address.
				 */
			}
			<div class="cat-hdr__types" role="group" aria-label="Catalogue type">
				{TYPE_TABS.map((t) => (
					<a
						key={t.value}
						class="cat-hdr__type"
						href={segmentHref(t.value)}
						data-on={props.type === t.value ? "true" : undefined}
						aria-current={props.type === t.value ? "true" : undefined}
					>
						{t.label}
					</a>
				))}
			</div>

			<div class="cat-period" role="group" aria-label="Analytics period">
				{PERIODS.map((p) => (
					<button
						key={p}
						type="button"
						class="cat-period__btn"
						data-on={analyticsPeriod.value === p ? "true" : undefined}
						aria-pressed={analyticsPeriod.value === p}
						onClick={() => (analyticsPeriod.value = p as AnalyticsPeriod)}
					>
						{p}
					</button>
				))}
			</div>
		</div>
	);
}
