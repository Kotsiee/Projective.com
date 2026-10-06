import { assertEquals } from "@std/assert";
import {
	calculateProfileCompleteness,
	GO_LIVE_MIN_SKILLS,
	type ProfileSetupFacts,
} from "./profile-setup.ts";

const EMPTY_SELLER: ProfileSetupFacts = {
	seller: true,
	hasPhoto: false,
	hasHeadline: false,
	hasStory: false,
	skillCount: 0,
	payoutReady: false,
	hoursPublished: false,
};

const COMPLETE_SELLER: ProfileSetupFacts = {
	seller: true,
	hasPhoto: true,
	hasHeadline: true,
	hasStory: true,
	skillCount: GO_LIVE_MIN_SKILLS,
	payoutReady: true,
	hoursPublished: true,
};

Deno.test("completeness: an empty seller has five pending steps and is not live", () => {
	const c = calculateProfileCompleteness(EMPTY_SELLER);
	assertEquals(c.steps.map((s) => s.id), ["photo", "story", "skills", "payout", "hours"]);
	assertEquals(c.percent, 0);
	assertEquals(c.remaining, 5);
	assertEquals(c.goLive, { applies: true, met: false, remaining: 3 });
});

Deno.test("completeness: the go-live baseline is met before 100%", () => {
	const c = calculateProfileCompleteness({
		...EMPTY_SELLER,
		hasPhoto: true,
		hasHeadline: true,
		hasStory: true,
		skillCount: GO_LIVE_MIN_SKILLS,
	});
	assertEquals(c.percent, 60);
	assertEquals(c.goLive, { applies: true, met: true, remaining: 0 });
	assertEquals(c.complete, false);
});

Deno.test("completeness: a headline without a story does not complete the story step", () => {
	const c = calculateProfileCompleteness({ ...COMPLETE_SELLER, hasStory: false });
	assertEquals(c.steps.find((s) => s.id === "story")?.done, false);
	assertEquals(c.goLive.met, false);
});

Deno.test("completeness: fewer than the minimum skills leaves the skills step pending", () => {
	const c = calculateProfileCompleteness({
		...COMPLETE_SELLER,
		skillCount: GO_LIVE_MIN_SKILLS - 1,
	});
	assertEquals(c.steps.find((s) => s.id === "skills")?.done, false);
	assertEquals(c.percent, 80);
});

Deno.test("completeness: an uncheckable payout fact is left out of the count, not guessed", () => {
	const c = calculateProfileCompleteness({ ...COMPLETE_SELLER, payoutReady: null });
	assertEquals(c.steps.some((s) => s.id === "payout"), false);
	assertEquals(c.percent, 100);
	assertEquals(c.complete, true);
});

Deno.test("completeness: a buyer has no skills or payout steps and no go-live milestone", () => {
	const c = calculateProfileCompleteness({
		...EMPTY_SELLER,
		seller: false,
		hasPhoto: true,
		payoutReady: true,
	});
	assertEquals(c.steps.map((s) => s.id), ["photo", "story", "hours"]);
	assertEquals(c.steps.every((s) => !s.goLive), true);
	assertEquals(c.percent, 33);
	assertEquals(c.goLive, { applies: false, met: false, remaining: 0 });
});
