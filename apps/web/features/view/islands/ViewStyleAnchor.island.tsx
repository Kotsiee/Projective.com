import { Avatar, RatingStars, Tag } from "@projective/ui/display";

/**
 * ViewStyleAnchor — a zero-UI style anchor for the Entity View page.
 *
 * The lower-body recommendation rails reuse the Explore cards, which are SERVER components; shared
 * `@projective/ui` component CSS only reaches a page through a CLIENT (island) bundle (the umbrella is
 * a resolved dependency, so its transitive `import "./x.css"` side-effects are collected from the
 * island graph, not the SSR render — see the Explore `CardStyleAnchor`). This island imports the card
 * primitives (`Avatar` · `RatingStars` · `Tag`) purely so their stylesheets bundle once per page,
 * regardless of which card types the rails happen to render. Renders a `hidden`, `aria-hidden` stub.
 */
export default function ViewStyleAnchor() {
	return (
		<div hidden aria-hidden="true">
			<Avatar size="sm" />
			<RatingStars value={0} />
			<Tag value="" />
		</div>
	);
}
