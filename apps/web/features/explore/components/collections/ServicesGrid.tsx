import type { JSX } from "preact";
import { Grid } from "@projective/ui/layout";
import { ServiceCard } from "../cards/ServiceCard.tsx";
import type { ServiceItem } from "../../types/explore-types.ts";

/**
 * ServicesGrid — services displayed as a responsive fill grid (library {@link Grid} auto-fit via
 * `minChildWidth`, column-capped by `maxCols`), because services lead with a visual media thumbnail.
 * The wider min track + a 4-column cap keep the cards comfortably proportioned instead of collapsing
 * into a cramped 5-up row on wide viewports. Zero client JS.
 */
export function ServicesGrid(
	{ items, authed = false }: { items: ServiceItem[]; authed?: boolean },
): JSX.Element {
	return (
		<Grid minChildWidth="18rem" maxCols={4} gap={5} role="list" aria-label="Services">
			{items.map((s) => (
				<div role="listitem" key={s.id}>
					<ServiceCard item={s} authed={authed} />
				</div>
			))}
		</Grid>
	);
}
