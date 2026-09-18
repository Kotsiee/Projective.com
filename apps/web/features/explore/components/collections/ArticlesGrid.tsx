import type { JSX } from "preact";
import { PairGrid } from "./PairGrid.tsx";
import { ArticleCard } from "../cards/ArticleCard.tsx";
import type { HrefContext } from "../../core/routing.ts";
import type { ArticleItem } from "../../types/explore-types.ts";

/**
 * ArticlesGrid — the isolated articles feed (`/explore?category=articles`): a {@link PairGrid} of
 * HORIZONTAL {@link ArticleCard}s — thumbnail beside the text — two to a row where the content region
 * allows, one below that.
 *
 * Horizontal rather than the rail's media-on-top tile because a feed of articles is READ, not browsed
 * past: the title, the description and the date are what a reader scans, and putting the picture
 * beside them keeps every card the height of its text instead of the height of a 16:10 frame. The
 * lead-tile + rows combo (`ArticlesGridList`) stays the profile Posts section's presentation.
 *
 * Articles never open the results drawer (a read, not a preview), so there is no `onSelect`.
 */
export function ArticlesGrid(
	{ items, ctx, authed = false, label = "Articles" }: {
		items: ArticleItem[];
		ctx?: HrefContext;
		authed?: boolean;
		label?: string;
	},
): JSX.Element {
	return (
		<PairGrid
			items={items}
			label={label}
			wideCells
			keyOf={(a) => a.id}
			render={(a) => <ArticleCard item={a} ctx={ctx} orientation="list" authed={authed} />}
		/>
	);
}
