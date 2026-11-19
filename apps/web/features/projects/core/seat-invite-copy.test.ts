import { assertEquals } from "@std/assert";
import type { SeatInviteView } from "@projective/types/projects";
import { seatInviteCopy } from "./seat-invite-copy.ts";

function view(extra: Partial<SeatInviteView> = {}): SeatInviteView {
	return {
		state: "open",
		seatsLeft: 2,
		cohortName: "Spring cohort",
		firstStartsAt: "2026-12-01T10:00:00.000Z",
		sponsorName: "Noor Haddad",
		listingTitle: "Design systems workshop",
		listingSlug: "svc-ruxa6p25af",
		projectSlug: "prj-23456789ab",
		...extra,
	};
}

Deno.test("seatInviteCopy — only an open link offers the claim, and it says how many are left", () => {
	const open = seatInviteCopy(view());
	assertEquals(open.canClaim, true);
	assertEquals(open.title, "Noor Haddad shared a seat on Design systems workshop");
	assertEquals(open.body.startsWith("2 seats are left"), true);
	assertEquals(seatInviteCopy(view({ seatsLeft: 1 })).body.startsWith("One seat is left"), true);
	for (const state of ["seated", "host", "own", "full", "revoked", "started", "ended"] as const) {
		assertEquals(seatInviteCopy(view({ state })).canClaim, false, state);
	}
});

Deno.test("seatInviteCopy — a seated reader is sent to their sessions, everyone else to the listing", () => {
	assertEquals(seatInviteCopy(view({ state: "seated" })).next?.href, "/projects/prj-23456789ab");
	assertEquals(seatInviteCopy(view({ state: "full" })).next?.href, "/view/svc-ruxa6p25af");
	assertEquals(seatInviteCopy(null).canClaim, false);
});
