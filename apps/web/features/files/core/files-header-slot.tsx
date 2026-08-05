import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import FilesHeaderBand from "../islands/FilesHeaderBand.island.tsx";
import { filesLocationOf } from "./files-lane-slot.tsx";

/**
 * files-header-slot — the middle-nav HEADER band on every `/files*` route.
 *
 * The band answers "where am I, and how is this set narrowed": the location identity and its trail,
 * free-text search, the kind/source filter entry, and the sort module. They live here rather than
 * above the grid because the BODY's remit on this surface is viewing and selecting data — a filter
 * dropdown sitting on top of a file table makes the table's width negotiable, and the table's width is
 * the whole point (`/wallet` is the reference implementation of this contract, `/messages` was rebuilt
 * to match).
 *
 * It also carries the SECTION/BROWSE switcher for viewports below the lane's breakpoint. Tree
 * navigation is the lane's job and stays there wherever the lane exists — but the lane is
 * `display: none` under 768px (`middle-nav.css`), and on `/files` it is the only route between the
 * library, the mounted engagements and the connected drives. A region cannot own a responsibility it
 * does not render, so below that width the duty TRANSFERS to this band rather than duplicating.
 *
 * Composed after the projects/messaging resolvers in `middleNavHeaderFor`, so exactly one region owns
 * the band per URL. Server-only — never imported by an island.
 */
export function filesHeaderFor(url: URL, context: UserContext): ComponentChildren {
	const loc = filesLocationOf(url, context);
	if (!loc) return null;
	return (
		<FilesHeaderBand
			base={loc.base}
			scope={loc.scope}
			subjectId={loc.subjectId}
			segments={loc.segments}
			ownerLabel={loc.ownerLabel}
		/>
	);
}
