import type { JSX, RefObject } from "preact";
import { ServiceDetail } from "./detail/ServiceDetail.tsx";
import { ProductDetail } from "./detail/ProductDetail.tsx";
import { ProjectDetail } from "./detail/ProjectDetail.tsx";
import { ProfileDetail } from "./detail/ProfileDetail.tsx";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * DetailPanel — the Search Results drawer's body: an at-a-glance preview of the page the item opens,
 * in its order (media → category and title → key metrics → summary), with a layout per entity.
 * `titleId` names the drawer by the one title heading. The region takes focus when the drawer opens
 * (`regionRef`, `tabindex="-1"`), so the drawer's keys act at once without a tab stop of its own.
 * Prices come from the same structured amounts the cards read, so the drawer quotes the card's figure.
 */
export function DetailPanel(
	{ item, titleId, regionRef }: {
		item: ExploreItem;
		titleId: string;
		regionRef?: RefObject<HTMLDivElement>;
	},
): JSX.Element {
	return (
		<div
			ref={regionRef}
			class="ex-detail"
			data-entity={item.type}
			role="document"
			aria-labelledby={titleId}
			tabIndex={-1}
		>
			<DetailBody item={item} titleId={titleId} />
		</div>
	);
}

function DetailBody({ item, titleId }: { item: ExploreItem; titleId: string }): JSX.Element | null {
	switch (item.type) {
		case "services":
			return <ServiceDetail item={item} titleId={titleId} />;
		case "products":
			return <ProductDetail item={item} titleId={titleId} />;
		case "projects":
			return <ProjectDetail item={item} titleId={titleId} />;
		case "freelancers":
		case "teams":
		case "businesses":
		case "users":
			return <ProfileDetail item={item} titleId={titleId} />;
		case "articles":
			return null;
	}
}
