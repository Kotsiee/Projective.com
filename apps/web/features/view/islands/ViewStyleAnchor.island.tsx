import { Avatar, RatingStars, Tag } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { EmptyState } from "@projective/ui/utils";
import "../styles/view.css";

/**
 * ViewStyleAnchor — a zero-UI style anchor for the Entity View page.
 *
 * Shared `@projective/ui` component CSS — and this feature's own sheets — only reach a page through a
 * CLIENT (island) bundle: the umbrella is a resolved dependency, so its transitive `import "./x.css"`
 * side-effects are collected from the island graph, not the SSR render (see the Explore
 * `CardStyleAnchor`). The lower-body recommendation rails reuse the Explore cards, which are SERVER
 * components, so the card primitives (`Avatar` · `RatingStars` · `Tag`) are imported here purely so
 * their stylesheets bundle once per page regardless of which card types the rails render.
 *
 * It also carries `view.css`, `Button` and `EmptyState`. Those are not for the rails — they are for the
 * **not-found branch**, which renders no lane. Every app-local sheet on this surface is otherwise
 * delivered by the lane island, and `viewLaneFor` returns `null` for an unresolved id, so that branch
 * used to ship with zero rules in the CSSOM for `.vw`, `.ui-empty` or its only call to action. A style
 * anchor is only worth having if it covers the state that has nothing else.
 *
 * Renders a `hidden`, `aria-hidden` stub.
 */
export default function ViewStyleAnchor() {
	return (
		<div hidden aria-hidden="true">
			<Avatar size="sm" />
			<RatingStars value={0} />
			<Tag value="" />
			<Button label="" />
			<Icon name="arrow-left" />
			<EmptyState title="" />
		</div>
	);
}
