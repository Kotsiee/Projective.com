import type { JSX } from "preact";
import { ServicesGrid } from "@features/explore/components/collections/ServicesGrid.tsx";
import ServicesRow from "../islands/ServicesRow.island.tsx";
import { SERVICES_ANCHOR } from "../core/profile-model.ts";
import type { ServiceItem } from "../types/profile-types.ts";

/**
 * ProfileServicesSection — a seller's active listings as their own region, rendered by the layout
 * directly ABOVE the section tabs so it is on screen whichever section is routed. The cards are the
 * SAME `ServicesGrid` `/explore` renders; the island around them clamps the grid to one row and
 * offers "Show all" when more exist. Renders nothing for a buyer entity or an empty catalogue — a
 * region with a name and no rows is a placeholder, and the hero's Hire control (which lands here)
 * already falls back to the conversation when there is nothing to land on.
 *
 * A SERVER component: the listing markup never crosses the hydration boundary as data.
 */
export interface ProfileServicesSectionProps {
	services: ServiceItem[];
	authed: boolean;
}

export function ProfileServicesSection(
	{ services, authed }: ProfileServicesSectionProps,
): JSX.Element | null {
	if (services.length === 0) return null;
	const headingId = `${SERVICES_ANCHOR}-heading`;
	return (
		<section id={SERVICES_ANCHOR} class="pf-services ex" aria-labelledby={headingId}>
			<h2 id={headingId} class="pf-h">Services</h2>
			<ServicesRow count={services.length}>
				<ServicesGrid items={services} authed={authed} />
			</ServicesRow>
		</section>
	);
}
