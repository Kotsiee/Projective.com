import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import "../styles/article-view.css";
import { VerifiedBadge } from "@features/explore/components/VerifiedBadge.tsx";
import { profileHref } from "@features/explore/core/routing.ts";
import ViewStyleAnchor from "../islands/ViewStyleAnchor.island.tsx";
import ArticleContent from "../islands/ArticleContent.island.tsx";
import ArticleMediaGallery from "../islands/ArticleMediaGallery.island.tsx";
import ArticleComments from "../islands/ArticleComments.island.tsx";
import { RelatedSection } from "./RelatedRail.tsx";
import { ViewIcon } from "./view-glyphs.tsx";
import { backHrefFor, backLabelFor, ENTITY_LABEL, signInHref } from "../core/view-model.ts";
import type { ArticleViewExtra, EntityView } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ArticleViewScreen — the custom **Articles** view template body (`/view/[id]?type=articles`). An
 * article-focused layout: an editorial header (title, then a byline carrying topic · uploader ·
 * published date · read time) over the cover, the rich {@link ArticleContent} body (the interactive
 * Table of Contents lives in the side nav), the {@link ArticleMediaGallery} carousel of every media
 * asset used, then the bottom sections — more from the uploader, suggested articles (reusing the
 * explore cards at a narrower 2-up because this template's column is a reading measure), and the
 * comments thread.
 */
export function ArticleViewScreen(
	{ view, article, ctx, authed }: {
		view: EntityView;
		article: ArticleViewExtra;
		ctx: HrefContext;
		authed: boolean;
	},
): JSX.Element {
	const { item, moreByOwner, similar } = view;
	const owner = item.owner;
	const ownerFirst = owner.name.split(/\s+/)[0] ?? owner.name;

	// "More articles by uploader": the owner's own articles; fall back to their other work if they have
	// only this one. "Suggested" is the topical cross-sell — other articles, excluding the owner's.
	const ownerArticles = moreByOwner.filter((i) => i.type === "articles");
	const moreItems = ownerArticles.length > 0 ? ownerArticles : moreByOwner.slice(0, 6);
	const moreTitle = ownerArticles.length > 0
		? `More articles by ${ownerFirst}`
		: `More from ${ownerFirst}`;
	const suggested = similar.filter((i) => i.type === "articles" && i.id !== item.id).slice(0, 8);

	return (
		<article class="vw vw-article">
			<ViewStyleAnchor />

			<div class="vw__back-row">
				<a class="vw__back" href={backHrefFor(ctx)}>
					<Icon name="arrow-left" size="sm" class="vw__back-arrow" />
					<span>{backLabelFor(ctx)}</span>
				</a>
			</div>

			<header class="art-header">
				<h1 class="art-header__title">{item.title}</h1>
				{
					/* The topic sits in the byline, not above the title — metadata about the piece, not a
				    kicker announcing a heading that already announces itself. */
				}
				<div class="art-header__byline">
					<span class="art-header__topic">{ENTITY_LABEL.articles} · {article.topic}</span>
					<span class="art-header__sep" aria-hidden="true" />
					<a class="art-author" href={profileHref(owner.handle)}>
						<Avatar
							image={owner.avatar}
							alt=""
							size="sm"
							shape={owner.kind === "business" ? "square" : "circle"}
						/>
						<span class="art-author__name">
							{owner.name}
							{owner.verified ? <VerifiedBadge size="sm" /> : null}
						</span>
					</a>
					<span class="art-header__sep" aria-hidden="true" />
					<span class="art-meta">
						<ViewIcon name="calendar" size={15} />
						<span>{article.publishedLabel}</span>
					</span>
					<span class="art-header__sep" aria-hidden="true" />
					<span class="art-meta">
						<ViewIcon name="clock" size={15} />
						<span>{article.readMinutes} min read</span>
					</span>
				</div>
			</header>

			<figure class="art-cover">
				<img class="art-cover__img" src={article.thumbnail} alt={item.title} />
			</figure>

			<div class="art-layout">
				<ArticleContent blocks={article.blocks} />
			</div>

			{article.assets.length > 0
				? (
					<section class="art-gallery-sec" aria-label="Media in this article">
						<div class="art-gallery-sec__head">
							<h2 class="vw-h2">Media in this article</h2>
							<p class="art-gallery-sec__sub">
								Every image, clip, and recording used above, in one place.
							</p>
						</div>
						<ArticleMediaGallery assets={article.assets} />
					</section>
				)
				: null}

			<div class="vw-body art-bottom">
				<RelatedSection
					title={moreTitle}
					subtitle={`More work from ${ownerFirst}`}
					items={moreItems}
					ctx={ctx}
					authed={authed}
					seeAllHref={`/${owner.handle}`}
					columns={2}
				/>
				{
					/* The article runs its rails inside a `--measure-wide` column, so 3-up would render 197px
				    cards. The host knows it is narrow; the carousel cannot. */
				}
				<RelatedSection
					title="Suggested articles"
					subtitle="More reading picked for this topic"
					items={suggested}
					ctx={ctx}
					authed={authed}
					columns={2}
				/>
				<ArticleComments
					comments={article.comments}
					authed={authed}
					signInHref={signInHref(item, ctx)}
				/>
			</div>
		</article>
	);
}
