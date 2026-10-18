import type { JSX } from "preact";
import { CHANGELOG_CATEGORY_LABEL, type ChangelogCategory } from "@projective/types/editorial";
import { feedHref, toggleCategoryHref } from "../core/changelog-url.ts";

/** Props for {@link CategoryFilters}. */
export interface CategoryFiltersProps {
	/** The categories selected now. */
	selected: readonly ChangelogCategory[];
	/** Every category with how many visible releases carry it, in filter order. */
	counts: ReadonlyArray<{ category: ChangelogCategory; count: number }>;
	/** Every visible release, for the "All releases" chip's count. */
	allCount: number;
}

/** A chip's release count: the figure, read as "6 releases". */
function Count({ n }: { n: number }): JSX.Element {
	return (
		<span class="chl-filter__count">
			{n}
			<span class="ui-visually-hidden">{n === 1 ? " release" : " releases"}</span>
		</span>
	);
}

/**
 * CategoryFilters — the feed's one control group: "All releases" plus one chip per category that
 * has releases (or is selected, so it can always be cleared). Each chip is a real link to the feed
 * with that category toggled — several may be selected at once, a release matching ANY of them is
 * listed — so the filter works with no JavaScript and every filtered view has an address. The
 * selected chips carry `aria-current="true"`; each chip's count is part of its name.
 *
 * These are controls, so they earn a container (§B.11.3); the categories on each release stay
 * inline text. Server-rendered and stylesheet-free.
 */
export function CategoryFilters(
	{ selected, counts, allCount }: CategoryFiltersProps,
): JSX.Element {
	const shown = counts.filter(({ category, count }) => count > 0 || selected.includes(category));
	const none = selected.length === 0;
	return (
		<nav class="chl-filters" aria-labelledby="chl-filters-label" data-print="hide">
			<p id="chl-filters-label" class="chl-filters__label">Filter by category</p>
			<ul class="chl-filters__list" role="list">
				<li>
					<a
						class="chl-filter"
						href={feedHref([])}
						aria-current={none ? "true" : undefined}
					>
						<span class="chl-filter__text">All releases</span> <Count n={allCount} />
					</a>
				</li>
				{shown.map(({ category, count }) => {
					const on = selected.includes(category);
					return (
						<li key={category}>
							<a
								class="chl-filter"
								href={toggleCategoryHref(selected, category)}
								aria-current={on ? "true" : undefined}
							>
								<span class="chl-filter__text">{CHANGELOG_CATEGORY_LABEL[category]}</span>{" "}
								<Count n={count} />
								{on ? <span class="ui-visually-hidden">, selected — remove filter</span> : null}
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
