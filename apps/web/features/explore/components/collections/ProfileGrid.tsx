import type { JSX } from "preact";
import { Grid } from "@projective/ui/layout";
import { FreelancerCard } from "../cards/FreelancerCard.tsx";
import { ProfileBannerCard } from "../cards/ProfileBannerCard.tsx";
import type { ProfileItem } from "../../types/explore-types.ts";

/**
 * ProfileGrid — the Home layout's bounded profile teaser. Replaces the starved horizontal carousel:
 * with only a handful of curated entities per section, a carousel stranded a half-empty row, so instead
 * a responsive fill grid (library {@link Grid} auto-fit, column-capped) stretches the cards to fill the
 * width evenly (N items → N columns up to the cap). Sliced to one desktop row; "See all →" in the
 * section header carries the rest. `freelancers` render the compact talent banner; `profiles`
 * (users / teams / businesses) render the wide banner card — mirroring the retired EntityCarousel.
 */
export function ProfileGrid(
	{ kind, items, limit = 4, authed = false }: {
		kind: "freelancers" | "profiles";
		items: ProfileItem[];
		/** Cap on cards shown in the teaser row (the rest live behind "See all →"). */
		limit?: number;
		authed?: boolean;
	},
): JSX.Element {
	const shown = items.slice(0, limit);
	return (
		<Grid
			class="ex-profilegrid"
			minChildWidth="18rem"
			maxCols={4}
			gap={5}
			role="list"
			aria-label="Profiles"
		>
			{shown.map((it) => (
				<div role="listitem" key={it.id}>
					{kind === "freelancers"
						? <FreelancerCard item={it} authed={authed} />
						: <ProfileBannerCard item={it} authed={authed} />}
				</div>
			))}
		</Grid>
	);
}
