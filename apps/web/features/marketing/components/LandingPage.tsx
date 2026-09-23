import type { JSX } from "preact";
import type { LandingPayload } from "@projective/types/explore";
import "../styles/landing.css";
import { Hero } from "./Hero.tsx";
import { SectionHeading } from "./SectionHeading.tsx";
import { OpenProjectsGrid } from "./OpenProjectsGrid.tsx";
import { ProductsMasonry } from "./ProductsMasonry.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import { Testimonials } from "./Testimonials.tsx";
import ProfilesCarousel from "../islands/ProfilesCarousel.island.tsx";
import ServicesCarousel from "../islands/ServicesCarousel.island.tsx";
import SchemaInjector from "../islands/SchemaInjector.island.tsx";
import MagneticField from "../islands/MagneticField.island.tsx";
import { landingShowcase } from "../core/landing-data.ts";
import { landingJsonLd } from "../core/seo.ts";

/**
 * LandingPage — the composed public marketing surface.
 *
 * Renders full-bleed within the Green PageCanvas scroll region. Alternates full-viewport locking
 * sections (Hero) with massive edge-to-edge showcase blocks (carousels, grid, masonry). All
 * structure is composed from `@projective/ui` primitives; the interactive tracks and the hero field
 * are the only islands. The schema.org graph is injected into the live DOM for AIO/SEO.
 *
 * Every showcase is the LIVE marketplace (`ExploreBackendService.landing()`): a section with nothing
 * published behind it is not rendered, and when the marketplace cannot be read at all (`landing` is
 * `null`) the static story still renders and one quiet notice stands where the listings would be.
 */
export function LandingPage({ landing }: { landing: LandingPayload | null }): JSX.Element {
	const show = landing
		? landingShowcase(landing.home)
		: { profiles: [], services: [], projects: [], products: [] };
	return (
		<div class="lp">
			{/* SSR copy for non-JS crawlers; SchemaInjector re-adds a persistent node to the live DOM. */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: landingJsonLd() }}
			/>
			<SchemaInjector />

			<Hero image={landing?.heroImage ?? null} stats={landing?.stats ?? null} />

			<HowItWorks />

			{!landing && (
				<section class="lp-section lp-notice" role="status">
					<div class="lp-section__container">
						<p class="lp-notice__text">
							We couldn't load the latest listings just now.{" "}
							<a class="lp-notice__link" href="">Try again</a> or{" "}
							<a class="lp-notice__link" href="/explore">browse the marketplace</a>.
						</p>
					</div>
				</section>
			)}

			{show.profiles.length > 0 && (
				<section
					class="lp-section lp-section--profiles"
					id="lp-profiles"
					aria-labelledby="lp-profiles-title"
				>
					<div class="lp-section__container">
						<SectionHeading
							id="lp-profiles-title"
							eyebrow="Meet your helpers"
							title="People, ready to"
							emphasis="help"
							lede="Browse friendly experts and ready-made teams. Tap any card to see their work, their reviews, and their prices."
							action={<a class="lp-viewall" href="/explore">See everyone →</a>}
						/>
					</div>
					<ProfilesCarousel profiles={show.profiles} />
				</section>
			)}

			{show.services.length > 0 && (
				<section
					class="lp-section lp-section--services"
					id="lp-services"
					aria-labelledby="lp-services-title"
				>
					<div class="lp-section__container">
						<SectionHeading
							id="lp-services-title"
							eyebrow="Ready-to-buy help"
							title="Help you can"
							emphasis="buy now"
							lede="Clear jobs with one simple price and a delivery date. Pay safely and get started today."
							action={<a class="lp-viewall" href="/explore">See everything →</a>}
						/>
					</div>
					<ServicesCarousel services={show.services} />
				</section>
			)}

			{show.projects.length > 0 && (
				<section
					class="lp-section lp-section--projects"
					id="lp-projects"
					aria-labelledby="lp-projects-title"
				>
					<div class="lp-section__container">
						<SectionHeading
							id="lp-projects-title"
							eyebrow="Teams forming now"
							title="Projects"
							emphasis="hiring now"
							lede="Real projects looking for helpers. Open one to see the plan, the stages and the roles, and join in."
							action={<a class="lp-viewall" href="/explore">See all →</a>}
						/>
						<OpenProjectsGrid projects={show.projects} />
					</div>
				</section>
			)}

			{show.products.length > 0 && (
				<section
					class="lp-section lp-section--products"
					id="lp-products"
					aria-labelledby="lp-products-title"
				>
					<div class="lp-section__container">
						<SectionHeading
							id="lp-products-title"
							eyebrow="Ready-made goodies"
							title="Get a head start with"
							emphasis="ready-made"
							lede="Templates, kits, and downloads from the same makers you can hire. Buy once, download straight away."
							action={<a class="lp-viewall" href="/explore">See all →</a>}
						/>
						<ProductsMasonry products={show.products} />
					</div>
				</section>
			)}

			<Testimonials quotes={landing?.testimonials ?? []} />

			<MagneticField />
		</div>
	);
}
