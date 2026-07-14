import type { JSX } from "preact";
import { Grid } from "@projective/ui/layout";
import { ServiceCard } from "../cards/ServiceCard.tsx";
import type { ServiceItem } from "../../types/explore-types.ts";

/**
 * ServicesGrid — services displayed as a standard responsive grid (library {@link Grid} auto-fill via
 * `minChildWidth`), because services lead with a visual media thumbnail. Zero client JS.
 */
export function ServicesGrid(
	{ items, authed = false }: { items: ServiceItem[]; authed?: boolean },
): JSX.Element {
	return (
		<Grid minChildWidth="15rem" gap={5} role="list" aria-label="Services">
			{items.map((s) => (
				<div role="listitem" key={s.id}>
					<ServiceCard item={s} authed={authed} />
				</div>
			))}
		</Grid>
	);
}
