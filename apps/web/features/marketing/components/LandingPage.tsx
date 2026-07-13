import type { JSX } from "preact";
import "../styles/landing.css";
import { Hero } from "./Hero.tsx";
import { SectionHeading } from "./SectionHeading.tsx";
import { OpenProjectsGrid } from "./OpenProjectsGrid.tsx";
import { ProductsMasonry } from "./ProductsMasonry.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import { Testimonials } from "./Testimonials.tsx";
import { PublicFooter } from "./PublicFooter.tsx";
import ProfilesCarousel from "../islands/ProfilesCarousel.island.tsx";
import ServicesCarousel from "../islands/ServicesCarousel.island.tsx";
import SchemaInjector from "../islands/SchemaInjector.island.tsx";
import MagneticField from "../islands/MagneticField.island.tsx";
import { PRODUCTS, PROFILES, PROJECTS, SERVICES } from "../core/landing-data.ts";
import { landingJsonLd } from "../core/seo.ts";

/**
 * LandingPage — the composed public marketing surface.
 *
 * Renders full-bleed within the Green PageCanvas scroll region. Alternates full-viewport locking
 * sections (Hero) with massive edge-to-edge showcase blocks (carousels, grid, masonry). All
 * structure is composed from `@projective/ui` primitives; the interactive tracks and the hero field
 * are the only islands. The schema.org graph is injected into the live DOM for AIO/SEO.
 */
export function LandingPage(): JSX.Element {
	return (
		<div class="lp">
			{/* SSR copy for non-JS crawlers; SchemaInjector re-adds a persistent node to the live DOM. */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: landingJsonLd() }}
			/>
			<SchemaInjector />

			<Hero />

			<HowItWorks />

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
				<ProfilesCarousel profiles={PROFILES} />
			</section>

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
				<ServicesCarousel services={SERVICES} />
			</section>

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
						lede="Real projects looking for helpers, with the money already set aside and kept safe. Open one to see the plan and join in."
						action={<a class="lp-viewall" href="/explore">See all →</a>}
					/>
					<OpenProjectsGrid projects={PROJECTS} />
				</div>
			</section>

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
					<ProductsMasonry products={PRODUCTS} />
				</div>
			</section>

			<Testimonials />

			<PublicFooter />

			<MagneticField />
		</div>
	);
}
