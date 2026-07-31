import "../styles/explore.css";
import { Avatar, RatingStars } from "@projective/ui/display";

/**
 * CardStyleAnchor — a zero-UI style anchor for the Explore feed.
 *
 * The Explore cards are **server components**, and component CSS only reaches a page through a CLIENT
 * (island) bundle — a stylesheet imported by a server component is collected from the island graph, not
 * the SSR render. On the Search Results state the `SearchDashboard` island already pulls in the shared
 * `@projective/ui` card CSS (it imports `EntityCard`); the static Home state (`ExploreHome`) has no such
 * island, so its Avatar + RatingStars styles would go missing once the profile carousel island was
 * retired.
 *
 * The same mechanism strands the feature's OWN sheet. `ExploreScreen` imports `explore.css`, but as a
 * server component that import reached nothing: `/explore` shipped `explore-results.css` (which
 * `profile.css` also `@import`s, giving it a second carrier) and no `.ex-card` rule at all, so every
 * card on the surface the family was written for rendered as unstyled markup. `/@handle` and `/view`
 * were unaffected — `profile.css` `@import`s `explore.css` too, and profile islands carry it. Anchoring
 * the sheet HERE gives `/explore` the carrier it never had.
 *
 * This island therefore imports `explore.css` plus the two library components purely so their
 * stylesheets are bundled once per Explore page. It renders a `hidden`, `aria-hidden` stub — never
 * visible and out of the accessibility tree — whose only job is to keep those modules (and thus their
 * CSS) in the island bundle.
 */
export default function CardStyleAnchor() {
	return (
		<div hidden aria-hidden="true">
			<Avatar size="sm" />
			<RatingStars value={0} />
		</div>
	);
}
