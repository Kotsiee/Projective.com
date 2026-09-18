import type { JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { publishedLabel } from "../../core/card-signals.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ArticleItem, ExploreItem } from "../../types/explore-types.ts";

/**
 * ArticleCard — a help/editorial article. One markup tree, two orientations switched by CSS: `grid`
 * puts the thumbnail above the text (the Home rail, the grouped-results rail, the profile's lead
 * tile); `list` puts it BESIDE the text in a 35/65 split (the isolated articles feed, the profile's
 * rows), stacking back to media-on-top only when the card itself is too narrow to split.
 *
 * The media and the text pane sit inside `.ex-art__frame` rather than directly under the card: the
 * card is the size container the fold is queried against, and a container query never matches the
 * container itself — so the element whose columns change has to be a child of it.
 *
 * The text pane is the same four bands in both: the title; one metadata line — topic · read time ·
 * publication date — as inline middot-separated text (§B.11, never chips); the summary, muted and
 * clamped to two lines so a long standfirst cannot set the height of every sibling in an equalised
 * row; and the author byline. The date is absolute (`publishedLabel`): an article is dated the way
 * its own page dates it, where a project posting shows its age because the age is the fact.
 *
 * Articles ALWAYS navigate straight to their standalone page — they deliberately IGNORE `onSelect`, so
 * they never open the Search Results side-drawer (an article is a read, not a preview).
 */
export function ArticleCard(
	{ item, ctx = { scope: "explore" }, orientation = "grid", authed = false }: {
		item: ArticleItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		orientation?: "grid" | "list";
		authed?: boolean;
	},
): JSX.Element {
	const published = publishedLabel(item.createdAt);
	const meta = [item.topic, `${item.readMinutes} min read`, published].filter(Boolean);

	return (
		<article
			class={`ex-card ex-card--article ex-card--article-${orientation}`}
			data-item-id={item.id}
			data-item-type={item.type}
		>
			<CardLink item={item} ctx={ctx} label={item.title} />
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />
			<div class="ex-art__frame">
				<div class="ex-media ex-art__media">
					<ProgressiveImage src={item.media} placeholder={item.mediaPlaceholder} loading="lazy" />
				</div>
				<div class="ex-card__body ex-art__body">
					<h3 class="ex-card__title ex-card__title--sm">{item.title}</h3>
					<p class="ex-art__meta">
						{meta.map((fact, i) => (
							<span class="ex-art__fact" key={fact}>
								{i > 0 && <span class="ex-art__dot" aria-hidden="true">·</span>}
								{i === meta.length - 1 && published
									? <time dateTime={item.createdAt}>{fact}</time>
									: fact}
							</span>
						))}
					</p>
					<p class="ex-art__desc">{item.summary}</p>
					<div class="ex-card__byline">
						<OwnerBadge owner={item.owner} variant="mini" />
					</div>
				</div>
			</div>
		</article>
	);
}
