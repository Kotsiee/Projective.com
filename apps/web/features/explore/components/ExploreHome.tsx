import type { JSX } from "preact";
import { ExploreHomeHeader } from "./ExploreHomeHeader.tsx";
import { ServiceCard } from "./cards/ServiceCard.tsx";
import { ProductCard } from "./cards/ProductCard.tsx";
import { ProjectCard } from "./cards/ProjectCard.tsx";
import { ProfileCard } from "./cards/ProfileCard.tsx";
import { ArticleCard } from "./cards/ArticleCard.tsx";
import { SponsoredFrame } from "./promos/SponsoredFrame.tsx";
import { HelpArticlesStrip } from "./promos/HelpArticlesStrip.tsx";
import { CtaBanner } from "./promos/CtaBanner.tsx";
import { HomeGrid } from "./HomeGrid.tsx";
import CategoryChips from "../islands/CategoryChips.island.tsx";
import RecommendedPanel from "../islands/RecommendedPanel.island.tsx";
import ContinueRail from "../islands/ContinueRail.island.tsx";
import HomeRail from "../islands/HomeRail.island.tsx";
import { HOME_SECTIONS } from "../core/home-model.ts";
import type { ArticleItem, HomeFeed, ProfileItem } from "../types/explore-types.ts";

/**
 * ExploreHome — the State A discovery feed (no active query).
 *
 * Two blocks, and the split is the whole layout:
 *
 * **The fold** — hero, category chips, Recommended panel — is a fixed-height grid sized to the first
 * screen, so a reader lands on something they can act on without scrolling. Its last row is
 * `minmax(0, 1fr)`, so the recommendations absorb whatever the hero and the chips leave rather than
 * the page hoping three stacked regions happen to add up.
 *
 * **The body** is a stack of horizontal rails, one idiom repeated: a two-tone heading, a scroll
 * progress separator, paging arrows, and a drag-scrollable row of equal-height cards. Every section
 * is the same module with different children, so the reader learns the interaction once.
 *
 * The presentation this replaces was a set of fill grids, a masonry and a list — a different shape
 * per entity, which meant a different scan pattern per section and a page that ran to nearly 9,000px.
 *
 * Two things are deliberately kept from that layout: the promo frames (a sponsored slot, two CTA
 * banners, the help strip) stay interleaved, because they are real surfaces with real purposes that
 * the brief did not ask to remove; and every card stays a SERVER component, passed into the rail
 * islands as children, so the first byte carries the content and the islands carry only the gesture.
 *
 * One consequence worth naming: Businesses and Individuals no longer have dedicated body sections.
 * They are reachable from the Recommended panel's People toggle, from the category chip bar (which is
 * why that bar carries more than the four chips the design calls out), and from the footer.
 */
export function ExploreHome(
	{ feed, authed = false }: { feed: HomeFeed; authed?: boolean },
): JSX.Element {
	// The Recommended panel's People toggle mixes freelancers and teams — the Home's own long-standing
	// answer to "who can help", and the pairing the `?category=freelancers` query itself returns.
	const people: ProfileItem[] = [...feed.recommended.people];

	return (
		<>
			<div class="ex-fold">
				<ExploreHomeHeader />

				<div class="ex-fold__inner">
					<CategoryChips />
				</div>

				<div class="ex-fold__inner">
					<RecommendedPanel>
						<Panel id="services" label="Recommended services">
							{feed.recommended.services.map((s) => (
								<Cell key={s.id}>
									<ServiceCard item={s} authed={authed} />
								</Cell>
							))}
						</Panel>
						<Panel id="products" label="Recommended products">
							{feed.recommended.products.map((p) => (
								<Cell key={p.id}>
									<ProductCard item={p} authed={authed} />
								</Cell>
							))}
						</Panel>
						<Panel id="projects" label="Recommended projects">
							{feed.recommended.projects.map((p) => (
								<Cell key={p.id}>
									<ProjectCard item={p} authed={authed} />
								</Cell>
							))}
						</Panel>
						<Panel id="people" label="Recommended people">
							{people.map((p) => (
								<Cell key={p.id}>
									<ProfileCard item={p} authed={authed} />
								</Cell>
							))}
						</Panel>
					</RecommendedPanel>
				</div>
			</div>

			<div class="ex-home">
				{
					/* Client-only by necessity — the history it reads is per-device `localStorage`, so this
				    renders nothing at all until it has hydrated and found something. See the island. */
				}
				<section class="ex-home__section">
					<ContinueRail authed={authed} />
				</section>

				<Section def={HOME_SECTIONS.services}>
					{feed.services.map((s) => (
						<Cell key={s.id}>
							<ServiceCard item={s} authed={authed} />
						</Cell>
					))}
				</Section>

				<SponsoredFrame slot={feed.sponsored[0]} />

				<Section def={HOME_SECTIONS.freelancers}>
					{[...feed.freelancers, ...feed.teams].map((p) => (
						<Cell key={p.id}>
							<ProfileCard item={p} authed={authed} />
						</Cell>
					))}
				</Section>

				<CtaBanner banner={feed.ctas.freelancer} />

				{
					/*
					 * Projects are the one section laid out as a GRID rather than a rail. A project card has
					 * no media, so its height is predictable, and a brief is something a reader compares
					 * against its neighbours rather than browses past — four of them visible at once beats
					 * four with two behind a gesture. Capped at four so the block is a full 2×2 with no
					 * ragged final row; "See all" on the heading carries the rest.
					 */
				}
				<div class="ex-home__section">
					<HomeGrid
						id={HOME_SECTIONS.projects.id}
						lead={HOME_SECTIONS.projects.lead}
						tail={HOME_SECTIONS.projects.tail}
						href={HOME_SECTIONS.projects.href}
					>
						{feed.projects.slice(0, 4).map((p) => (
							<div class="ex-rail__gridcell" role="listitem" key={p.id}>
								<ProjectCard item={p} authed={authed} />
							</div>
						))}
					</HomeGrid>
				</div>

				<Section def={HOME_SECTIONS.products}>
					{feed.products.map((p) => (
						<Cell key={p.id}>
							<ProductCard item={p} authed={authed} />
						</Cell>
					))}
				</Section>

				<HelpArticlesStrip articles={feed.helpArticles} />

				<Section
					def={HOME_SECTIONS.articles}
					search
					searchPlaceholder="Search guides…"
				>
					{feed.articles.map((a: ArticleItem) => (
						<Cell key={a.id}>
							<ArticleCard item={a} orientation="grid" authed={authed} />
						</Cell>
					))}
				</Section>

				<CtaBanner banner={feed.ctas.team} />
			</div>
		</>
	);
}

/** One rail cell — the fixed-width, stretch-height slot that gives a row its flat top and bottom. */
function Cell({ children }: { children: JSX.Element }): JSX.Element {
	return <div class="ex-rail__cell" role="listitem">{children}</div>;
}

/**
 * One Recommended panel: a full rail track that the island shows or hides. Each keeps its own scroll
 * position, so returning to a category returns the reader to where they left it.
 */
function Panel(
	{ id, label, children }: { id: string; label: string; children: JSX.Element[] },
): JSX.Element {
	return (
		<div class="ex-rec__panel ex-rail__track" role="list" data-rec-panel={id} aria-label={label}>
			{children}
		</div>
	);
}

/** One body section — the shared rail module, measured and padded to the page's container. */
function Section(
	{ def, search = false, searchPlaceholder, children }: {
		def: { id: string; lead: string; tail: string; href: string };
		search?: boolean;
		searchPlaceholder?: string;
		children: JSX.Element[];
	},
): JSX.Element {
	return (
		<div class="ex-home__section">
			<HomeRail
				id={def.id}
				lead={def.lead}
				tail={def.tail}
				href={def.href}
				search={search}
				searchPlaceholder={searchPlaceholder}
				searchCategory="articles"
			>
				{children}
			</HomeRail>
		</div>
	);
}
