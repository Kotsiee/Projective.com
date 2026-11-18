import { assertEquals } from "@std/assert";
import type { ListingWaitlistEntry } from "@projective/types/projects";
import { liveCount, waitlistMeta, waitlistPath, waitlistSummary } from "./waitlist-model.ts";

const clock = { ago: (iso: string) => `ago(${iso})`, at: (iso: string) => `at(${iso})` };

function entry(over: Partial<ListingWaitlistEntry>): ListingWaitlistEntry {
	return {
		userId: "00000000-0000-4000-8000-000000000001",
		handle: "@ada_lin",
		name: "Ada Lin",
		avatar: "",
		status: "waiting",
		position: 1,
		queuedAt: "q",
		invitedAt: null,
		inviteExpiresAt: null,
		resolvedAt: null,
		...over,
	};
}

Deno.test("the waitlist read names the listing and carries the dev axis only when set", () => {
	assertEquals(waitlistPath("svc-abcdefghjk"), "/api/catalogue/waitlist?listing=svc-abcdefghjk");
	assertEquals(
		waitlistPath("svc-abcdefghjk", "empty"),
		"/api/catalogue/waitlist?listing=svc-abcdefghjk&sim=empty",
	);
});

Deno.test("the summary names only the states with anyone in them, singular at one", () => {
	assertEquals(waitlistSummary({ waiting: 0, invited: 0, expired: 0, converted: 0 }), "");
	assertEquals(
		waitlistSummary({ waiting: 3, invited: 1, expired: 2, converted: 1 }),
		"3 waiting · 1 seat held · 1 bought a seat · 2 invites lapsed",
	);
	assertEquals(liveCount({ waiting: 3, invited: 1, expired: 2, converted: 1 }), 4);
});

Deno.test("each place's meta says what the seller needs about it", () => {
	assertEquals(waitlistMeta(entry({ position: 2 }), clock), [
		"Number 2 in the queue",
		"joined ago(q)",
	]);
	assertEquals(
		waitlistMeta(entry({ status: "invited", position: null, inviteExpiresAt: "x" }), clock),
		["Held until at(x)", "joined ago(q)"],
	);
	assertEquals(
		waitlistMeta(entry({ status: "converted", position: null, resolvedAt: "r" }), clock),
		["joined ago(q)", "bought ago(r)"],
	);
	assertEquals(
		waitlistMeta(entry({ status: "expired", position: null, resolvedAt: "r" }), clock),
		["joined ago(q)", "lapsed ago(r)"],
	);
});
