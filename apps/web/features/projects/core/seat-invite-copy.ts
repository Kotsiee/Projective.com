import type { SeatInviteView } from "@projective/types/projects";

/** What a seat-link landing says and offers, by state. */
export interface SeatInviteCopy {
	title: string;
	body: string;
	canClaim: boolean;
	next: { label: string; href: string } | null;
}

/**
 * The seat-link landing's words (Decision #522), from the link's state as the server reads it for this
 * person. Pure, so each state's sentence is pinned by a test.
 */
export function seatInviteCopy(view: SeatInviteView | null): SeatInviteCopy {
	if (!view) {
		return {
			title: "This seat link doesn't work",
			body: "It may have been mistyped. Ask the person who shared it to send it again.",
			canClaim: false,
			next: { label: "Explore group sessions", href: "/explore?type=services" },
		};
	}
	const listing = view.listingSlug ? { label: "See the session", href: `/view/${view.listingSlug}` } : null;
	const project = view.projectSlug ? { label: "Open the sessions", href: `/projects/${view.projectSlug}` } : null;
	const what = view.listingTitle ?? view.cohortName;
	switch (view.state) {
		case "open":
			return {
				title: `${view.sponsorName} shared a seat on ${what}`,
				body: view.seatsLeft === 1
					? "One seat is left on this link. It's already paid for, and the first person to claim it gets it."
					: `${view.seatsLeft} seats are left on this link. They're already paid for, and each goes to the first person to claim it.`,
				canClaim: true,
				next: null,
			};
		case "seated":
			return {
				title: "You already have a seat",
				body: `You're booked on ${what}. The link's seats are left for someone else.`,
				canClaim: false,
				next: project,
			};
		case "host":
			return {
				title: "You run this session",
				body: `${view.sponsorName} is sharing seats they bought on ${what}. Each claimer joins your cohort on a seat already paid for.`,
				canClaim: false,
				next: project,
			};
		case "own":
			return {
				title: "This is your own link",
				body: "Send it to the people you bought seats for. Each claims one, until the first session starts.",
				canClaim: false,
				next: listing,
			};
		case "full":
			return {
				title: "Every shared seat has been claimed",
				body: `${view.sponsorName}'s spare seats on ${what} are all taken. You can still book your own.`,
				canClaim: false,
				next: listing,
			};
		case "revoked":
			return {
				title: "This seat link was turned off",
				body: `${view.sponsorName} stopped sharing seats on ${what}. Ask them for a new link, or book your own.`,
				canClaim: false,
				next: listing,
			};
		case "started":
			return {
				title: "This cohort has started",
				body: `Seats on ${what} can't be handed on once the first session begins.`,
				canClaim: false,
				next: listing,
			};
		case "ended":
			return {
				title: "This booking has ended",
				body: `The seats behind this link are no longer booked on ${what}.`,
				canClaim: false,
				next: listing,
			};
	}
}
