import { assertEquals } from "@std/assert";
import { resolveCta, type ServiceBookingOffer } from "@projective/types/services";
import { seatCount } from "@projective/types/projects";
import { previewWaitlistOffer } from "./waitlist-preview.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");

function cohortOffer(remaining: number): ServiceBookingOffer {
	const seats = seatCount(10, 10 - remaining);
	return {
		subjectId: "svc-abcdefghjk",
		subjectTitle: "A group session",
		format: "cohort",
		cta: resolveCta({
			format: "cohort",
			sessionCount: 1,
			seatsRemaining: remaining,
			draftHref: null,
			bookingsOpen: true,
		}),
		contact: {
			handle: "seller",
			sellerName: "Seller",
			sellerAvatar: null,
			subjectId: "svc-abcdefghjk",
			subjectTitle: "A group session",
			actions: [],
			requiresSignIn: false,
			signInHref: null,
		},
		capacity: seats,
		cohort: {
			cohortId: "00000000-0000-4000-8000-000000000001",
			name: "Cohort",
			seats,
			firstStartsAt: null,
			sittings: [],
			curriculum: [],
		},
		waitlist: null,
		draft: null,
		sessionCount: 1,
		durationMinutes: 60,
		escrows: true,
		requiresSignIn: false,
		signInHref: null,
	};
}

Deno.test("auto, and any format but a group session, leave the offer untouched", () => {
	const offer = cohortOffer(4);
	assertEquals(previewWaitlistOffer(offer, "auto", NOW), offer);
	assertEquals(previewWaitlistOffer(offer, undefined, NOW), offer);
	const session: ServiceBookingOffer = { ...offer, format: "session" };
	assertEquals(previewWaitlistOffer(session, "invited", NOW), session);
});

Deno.test("each previewed place resolves through the server's own CTA rules", () => {
	const invited = previewWaitlistOffer(cohortOffer(0), "invited", NOW);
	assertEquals(invited.cta.primary.kind, "reserve_seat");
	assertEquals(invited.capacity?.remaining, 1);
	assertEquals(invited.waitlist?.holdExpiresAt, "2026-11-20T12:00:00.000Z");

	const waiting = previewWaitlistOffer(cohortOffer(4), "waiting", NOW);
	assertEquals(waiting.cta.primary.label, "On the waitlist");
	assertEquals(waiting.cta.primary.disabled, true);
	assertEquals(waiting.capacity?.remaining, 0);

	const expired = previewWaitlistOffer(cohortOffer(0), "expired", NOW);
	assertEquals(expired.cta.primary.label, "Join the waitlist again");
});
