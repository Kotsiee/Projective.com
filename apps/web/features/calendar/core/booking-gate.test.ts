import { assertEquals } from "@std/assert";
import type { SchedulePage } from "@projective/types/scheduling";
import { restrictBooking } from "./booking-gate.ts";

const PAGE = {
	scope: "availability",
	title: "Juno",
	subtitle: null,
	timezone: "Europe/London",
	ownerHandle: "juno",
	viewerCanBook: true,
	availability: { workingHours: [], blackouts: [] },
	events: [],
	callOffer: {
		acceptsCalls: true,
		courtesyEnabled: true,
		courtesyDurationMinutes: 15,
		paidEnabled: false,
		paidDurationMinutes: 30,
		feeAmountMinor: null,
		feeCurrency: null,
		agendaRequired: true,
		platforms: [],
	},
	now: 0,
} as unknown as SchedulePage;

Deno.test("an adult viewer's page passes through untouched", () => {
	assertEquals(restrictBooking(PAGE, false), PAGE);
});

Deno.test("a restricted viewer's page books nothing and carries no call offer", () => {
	const page = restrictBooking(PAGE, true);
	assertEquals(page.viewerCanBook, false);
	assertEquals("callOffer" in page, false);
	assertEquals(page.events, PAGE.events);
	assertEquals(PAGE.viewerCanBook, true, "the input page is not mutated");
});

Deno.test("no page stays no page", () => {
	assertEquals(restrictBooking(null, true), null);
	assertEquals(restrictBooking(undefined, true), undefined);
});
