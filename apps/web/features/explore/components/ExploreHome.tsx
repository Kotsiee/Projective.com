import type { JSX } from "preact";
import { ExploreHomeHeader } from "./ExploreHomeHeader.tsx";
import { ProfileGrid } from "./collections/ProfileGrid.tsx";
import { ServicesGrid } from "./collections/ServicesGrid.tsx";
import { ProjectsList } from "./collections/ProjectsList.tsx";
import { ProductsMasonry } from "./collections/ProductsMasonry.tsx";
import { ArticlesGridList } from "./collections/ArticlesGridList.tsx";
import { SponsoredFrame } from "./promos/SponsoredFrame.tsx";
import { HelpArticlesStrip } from "./promos/HelpArticlesStrip.tsx";
import { CtaBanner } from "./promos/CtaBanner.tsx";
import { filterHref } from "../core/routing.ts";
import type { HomeFeed } from "../types/explore-types.ts";

/**
 * ExploreHome — the State A discovery feed (no active query). A varied presentation scheme tailored to
 * each entity format: bounded profile fill grids (freelancers, teams, businesses, people), a services
 * grid, a projects list, a products masonry, and an articles grid/list combo — interleaved with
 * deliberately reserved sponsored frames, help articles, and CTA banners. Fully static (zero client JS):
 * every section fills its row, so nothing strands the half-empty carousel rows this replaced.
 */
export function ExploreHome(
	{ feed, authed = false }: { feed: HomeFeed; authed?: boolean },
): JSX.Element {
	return (
		<>
			<ExploreHomeHeader />
			<div class="ex-home">
				<Section
					id="talent"
					eyebrow="Meet your helpers"
					title="Freelancers & Teams"
					emphasis="ready to help"
					href={filterHref({ category: "freelancers" })}
				>
					<ProfileGrid
						kind="freelancers"
						items={[...feed.freelancers, ...feed.teams]}
						limit={8}
						authed={authed}
					/>
				</Section>

				<SponsoredFrame slot={feed.sponsored[0]} />

				<Section
					id="services"
					eyebrow="Buy-now help"
					title="Services"
					emphasis="with one price"
					href={filterHref({ category: "services" })}
				>
					<ServicesGrid items={feed.services} authed={authed} />
				</Section>

				<CtaBanner banner={feed.ctas.freelancer} />

				<Section
					id="projects"
					eyebrow="Teams forming now"
					title="Projects"
					emphasis="hiring now"
					href={filterHref({ category: "projects" })}
				>
					<ProjectsList items={feed.projects} authed={authed} />
				</Section>

				<Section
					id="businesses"
					eyebrow="Companies hiring"
					title="Businesses"
					emphasis="on Projective"
					href={filterHref({ category: "businesses" })}
				>
					<ProfileGrid kind="profiles" items={feed.businesses} authed={authed} />
				</Section>

				<Section
					id="products"
					eyebrow="Ready-made goodies"
					title="Products"
					emphasis="to download"
					href={filterHref({ category: "products" })}
				>
					<ProductsMasonry items={feed.products} authed={authed} />
				</Section>

				<HelpArticlesStrip articles={feed.helpArticles} />

				<Section
					id="people"
					eyebrow="People to know"
					title="Individuals"
					emphasis="worth a follow"
					href={filterHref({ category: "users" })}
				>
					<ProfileGrid kind="profiles" items={feed.users} authed={authed} />
				</Section>

				<Section
					id="articles"
					eyebrow="Learn the ropes"
					title="Articles"
					emphasis="& guides"
					href="/help"
				>
					<ArticlesGridList items={feed.articles} authed={authed} />
				</Section>

				<CtaBanner banner={feed.ctas.team} />
			</div>
		</>
	);
}

/** A titled Home section; the heading + "See all" link wrap the marketing SectionHeading. */
function Section(
	{ id, eyebrow, title, emphasis, href, children }: {
		id: string;
		eyebrow: string;
		title: string;
		emphasis: string;
		href: string;
		children: JSX.Element;
	},
): JSX.Element {
	return (
		<section class="ex-home__section" id={`ex-${id}`} aria-labelledby={`ex-${id}-title`}>
			<div class="ex-home__container">
				<header class="ex-head">
					<div class="ex-head__main">
						<span class="ex-eyebrow ex-eyebrow--rule">{eyebrow}</span>
						<h2 class="ex-head__title" id={`ex-${id}-title`}>
							<span class="ex-head__title-thin">{title}</span>{" "}
							<span class="ex-head__title-strong">{emphasis}</span>
						</h2>
					</div>
					<a class="ex-viewall" href={href}>See all →</a>
				</header>
			</div>
			{children}
		</section>
	);
}
