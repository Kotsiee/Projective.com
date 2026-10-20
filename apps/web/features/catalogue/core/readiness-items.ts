import {
	type EditSection,
	formArchetypeOf,
	type ListingDetail,
	type PublishReadiness,
} from "@projective/types/catalogue";

/** One line of the publish checklist. */
export interface ReadinessItem {
	label: string;
	done: boolean;
}

const CHOOSE_AVAILABILITY = "Choose availability";
const BOOKABLE_SOON = "Open a bookable time in the next 30 days";

const SECTION_OF: Readonly<Record<string, EditSection>> = {
	"Add a title": "basics",
	"Choose a delivery model": "basics",
	"Add a cover image": "media",
	"Set a price": "pricing",
	"Add at least one stage": "offer",
	[CHOOSE_AVAILABILITY]: "availability",
	[BOOKABLE_SOON]: "availability",
};

/**
 * The Edit section that fixes the first missing requirement, so a locked Publish can take the seller
 * straight to it; `null` when nothing is missing or the gate names a requirement no section owns.
 */
export function firstMissingSection(missing: readonly string[]): EditSection | null {
	for (const label of missing) {
		const section = SECTION_OF[label];
		if (section) return section;
	}
	return null;
}

/**
 * The publish checklist for a listing: every requirement the gate knows for its form archetype, in
 * page order, each done or still missing — a Pipeline's stage and a session's availability and
 * bookable window included, so they read as requirements before they are ever missed. The missing
 * ones are the gate's own words, so the list and the footer's sentence never disagree. A bookable
 * window cannot be met before availability is chosen, so it is never ticked ahead of it.
 */
export function readinessItems(
	listing: Pick<ListingDetail, "kind" | "serviceType">,
	readiness: PublishReadiness,
): ReadinessItem[] {
	const archetype = formArchetypeOf(listing.kind, listing.serviceType);
	const required = [
		"Add a title",
		...(listing.kind === "service" ? ["Choose a delivery model"] : []),
		"Add a cover image",
		"Set a price",
		...(archetype === "pipeline" ? ["Add at least one stage"] : []),
		...(archetype === "session" || archetype === "cohort"
			? [CHOOSE_AVAILABILITY, BOOKABLE_SOON]
			: []),
	];
	const extra = readiness.missing.filter((m) => !required.includes(m));
	const blocked = readiness.missing.includes(CHOOSE_AVAILABILITY);
	return [...required, ...extra].map((label) => ({
		label,
		done: !readiness.missing.includes(label) && !(label === BOOKABLE_SOON && blocked),
	}));
}
