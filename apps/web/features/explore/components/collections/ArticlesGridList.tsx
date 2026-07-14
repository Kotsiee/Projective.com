import type { JSX } from "preact";
import { ArticleCard } from "../cards/ArticleCard.tsx";
import type { ArticleItem } from "../../types/explore-types.ts";

/**
 * ArticlesGridList — the articles grid/list combo: the lead article renders as a large grid tile, the
 * remainder as compact list rows beside it. Both use {@link ArticleCard} (orientation-switched via
 * CSS), so a single card component drives both presentations. Zero client JS.
 */
export function ArticlesGridList(
	{ items, authed = false }: { items: ArticleItem[]; authed?: boolean },
): JSX.Element | null {
	const [lead, ...rest] = items;
	if (!lead) return null;
	return (
		<div class="ex-artcombo" role="list" aria-label="Articles">
			<div class="ex-artcombo__lead" role="listitem">
				<ArticleCard item={lead} orientation="grid" authed={authed} />
			</div>
			<div class="ex-artcombo__rows">
				{rest.map((a) => (
					<div role="listitem" key={a.id}>
						<ArticleCard item={a} orientation="list" authed={authed} />
					</div>
				))}
			</div>
		</div>
	);
}
