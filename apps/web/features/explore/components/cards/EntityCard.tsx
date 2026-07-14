import type { JSX } from "preact";
import { FreelancerCard } from "./FreelancerCard.tsx";
import { ProfileBannerCard } from "./ProfileBannerCard.tsx";
import { ServiceCard } from "./ServiceCard.tsx";
import { ProjectRow } from "./ProjectRow.tsx";
import { ProductCard } from "./ProductCard.tsx";
import { ArticleCard } from "./ArticleCard.tsx";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem } from "../../types/explore-types.ts";

/**
 * EntityCard — the presentation switch mapping an {@link ExploreItem} to its card by `type`. Used by
 * the Search Results feed (grouped rows + unified virtual feed) so the results layout stays agnostic
 * of entity shape. `onSelect`, when provided, wires the in-place detail drawer (Search Results only).
 */
export function EntityCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ExploreItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	switch (item.type) {
		case "freelancers":
		case "teams":
			return <FreelancerCard item={item} ctx={ctx} onSelect={onSelect} authed={authed} />;
		case "users":
		case "businesses":
			return <ProfileBannerCard item={item} ctx={ctx} onSelect={onSelect} authed={authed} />;
		case "services":
			return <ServiceCard item={item} ctx={ctx} onSelect={onSelect} authed={authed} />;
		case "projects":
			return <ProjectRow item={item} ctx={ctx} onSelect={onSelect} authed={authed} />;
		case "products":
			return <ProductCard item={item} ctx={ctx} onSelect={onSelect} authed={authed} />;
		case "articles":
			return <ArticleCard item={item} ctx={ctx} authed={authed} />;
	}
}
