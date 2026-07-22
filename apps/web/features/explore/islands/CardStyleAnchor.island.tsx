import { Avatar, RatingStars } from "@projective/ui/display";

/**
 * CardStyleAnchor — a zero-UI style anchor for the Explore feed.
 *
 * The Explore cards are **server components**, and shared `@projective/ui` component CSS only reaches a
 * page through a CLIENT (island) bundle — the umbrella package is resolved as a dependency, so its
 * transitive `import "./x.css"` side-effects are collected from the island graph, not the SSR render.
 * On the Search Results state the `SearchDashboard` island already pulls in the card CSS (it imports
 * `EntityCard`); the static Home state (`ExploreHome`) has no such island, so its Avatar + RatingStars
 * styles would go missing once the profile carousel island was retired.
 *
 * This island imports those two components purely so their stylesheets are bundled once per Explore
 * page. It renders a `hidden`, `aria-hidden` stub — never visible and out of the accessibility tree —
 * whose only job is to keep the component modules (and thus their CSS) in the island bundle.
 */
export default function CardStyleAnchor() {
	return (
		<div hidden aria-hidden="true">
			<Avatar size="sm" />
			<RatingStars value={0} />
		</div>
	);
}
