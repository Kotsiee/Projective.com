import type { JSX } from "preact";
import { RailCell as Cell } from "./RailCell.tsx";
import { EntityCard } from "./cards/EntityCard.tsx";
import HomeRail from "../islands/HomeRail.island.tsx";
import { discoveryHeading } from "../core/discovery-rails.ts";
import type { DiscoveryRail, HomeFeed } from "../types/explore-types.ts";

/**
 * DiscoveryRails — the Home feed's discovery rails, in reading order: the viewer's "Because you
 * viewed …" (or its "Picked for you" fallback), their "Saved", then the shared "Trending" (or its "New
 * on Projective" fallback).
 *
 * The discovery service decided what fills each rail — the personal ones under the viewer's own token
 * — and sends `null` for a rail with nothing honest to show, so a guest sees only the shared one and a
 * new account sees none of its own. This component only renders: the shared rail module, server-side
 * cards of whatever type each item is, and a heading worded from the rail's kind.
 */
export function DiscoveryRails({ feed, authed }: { feed: HomeFeed; authed: boolean }): JSX.Element {
	const rails = [feed.personal.viewed, feed.personal.saved, feed.trending].filter(
		(rail): rail is DiscoveryRail => rail !== null && rail.items.length > 0,
	);
	return (
		<>
			{rails.map((rail) => <DiscoveryRailSection key={rail.kind} rail={rail} authed={authed} />)}
		</>
	);
}

/** One discovery rail on the rails' measure. */
function DiscoveryRailSection(
	{ rail, authed }: { rail: DiscoveryRail; authed: boolean },
): JSX.Element {
	const heading = discoveryHeading(rail);
	return (
		<div class="ex-home__section" data-shelf={heading.id}>
			<HomeRail
				id={heading.id}
				lead={heading.lead}
				tail={heading.tail}
				subtitle={heading.subtitle}
				label={heading.label}
			>
				{rail.items.map((item) => (
					<Cell key={item.id}>
						<EntityCard item={item} authed={authed} productLayout="fixed" />
					</Cell>
				))}
			</HomeRail>
		</div>
	);
}
