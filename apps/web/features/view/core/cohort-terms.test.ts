import { assertEquals } from "@std/assert";
import type { CohortOffer } from "@projective/types/projects";
import {
	cohortMinimumSentence,
	cohortTermRows,
	cohortTermsSentence,
	instantLabel,
} from "./cohort-terms.ts";

function offer(over: Partial<CohortOffer> = {}): CohortOffer {
	return {
		cohortId: "00000000-0000-4000-8000-000000000001",
		name: "Winter cohort",
		seats: { total: 12, taken: 2, remaining: 10, sentence: "10 of 12 seats remaining" },
		firstStartsAt: "2026-12-08T18:00:00.000Z",
		sittings: [0, 1, 2].map((k) => ({
			id: `00000000-0000-4000-8000-00000000010${k}`,
			title: `Session ${k + 1}`,
			startsAt: new Date(Date.parse("2026-12-08T18:00:00.000Z") + k * 7 * 86_400_000).toISOString(),
			endsAt: new Date(Date.parse("2026-12-08T20:00:00.000Z") + k * 7 * 86_400_000).toISOString(),
		})),
		curriculum: [],
		minSeats: 5,
		enrolmentClosesAt: "2026-12-07T18:00:00.000Z",
		cadence: "weekly",
		...over,
	};
}

Deno.test("a cohort discloses its start and cadence, its close and its minimum as key terms", () => {
	const rows = cohortTermRows(offer(), "UTC");
	assertEquals(rows.map((r) => r.label), ["Starts", "Enrolment", "Minimum"]);
	assertEquals(rows[0].note, "Weekly · 3 sessions");
	assertEquals(rows[2].value, "5 seats");
	assertEquals(cohortTermRows(null, "UTC"), []);
	assertEquals(cohortTermRows(offer({ minSeats: null }), "UTC").map((r) => r.label), [
		"Starts",
		"Enrolment",
	]);
});

Deno.test("with no zone yet the times read in UTC and say so", () => {
	assertEquals(instantLabel("2026-12-07T18:00:00.000Z", null, "en-GB").endsWith(" UTC"), true);
	assertEquals(instantLabel("2026-12-07T18:00:00.000Z", "UTC", "en-GB").endsWith(" UTC"), false);
	assertEquals(instantLabel("not a date", "UTC"), "");
});

Deno.test("the sentence forms say what happens below the minimum", () => {
	const sentence = cohortTermsSentence(offer(), "UTC")!;
	assertEquals(sentence.includes("Weekly · 3 sessions"), true);
	assertEquals(sentence.includes("Runs with at least 5 seats"), true);
	assertEquals(sentence.includes("every seat refunded in full"), true);
	assertEquals(
		cohortTermsSentence(offer({ minSeats: null }), "UTC")!.includes("Enrolment closes"),
		true,
	);
	assertEquals(cohortMinimumSentence(offer({ minSeats: null }), "UTC"), null);
	assertEquals(
		cohortMinimumSentence(offer(), "UTC")!.startsWith("This cohort runs with at least 5 seats."),
		true,
	);
});
