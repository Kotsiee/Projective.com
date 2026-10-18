import { assertEquals } from "@std/assert";
import { createVoteStore, type VoteAnswer } from "./vote-store.ts";

const IDEA = { slug: "fbk-kbyrph7gdt", viewerVoted: false, voteCount: 4 };

/** A sender that answers when told to, so a test can look at the in-flight state. */
function deferred(): {
	send: (slug: string, voted: boolean) => Promise<VoteAnswer>;
	answer: (a: VoteAnswer) => void;
	calls: boolean[];
} {
	let resolve: (a: VoteAnswer) => void = () => {};
	const calls: boolean[] = [];
	return {
		calls,
		send: (_slug, voted) => {
			calls.push(voted);
			return new Promise((r) => (resolve = r));
		},
		answer: (a) => resolve(a),
	};
}

Deno.test("a press flips at once, then settles on the server's true count", async () => {
	const store = createVoteStore();
	store.seed([IDEA]);
	const sender = deferred();
	const done = store.toggle(IDEA.slug, sender.send);
	assertEquals(store.get(IDEA.slug), { voted: true, count: 5, pending: true, error: null });
	sender.answer({ ok: true, voted: true, voteCount: 7 });
	const outcome = await done;
	assertEquals(outcome.ok, true);
	assertEquals(store.get(IDEA.slug), { voted: true, count: 7, pending: false, error: null });
	assertEquals(sender.calls, [true]);
});

Deno.test("a refusal rolls the idea back exactly and keeps the message for an inline error", async () => {
	const store = createVoteStore();
	store.seed([{ ...IDEA, viewerVoted: true, voteCount: 9 }]);
	const outcome = await store.toggle(
		IDEA.slug,
		() => Promise.resolve({ ok: false, message: "Voting has closed on this idea." }),
	);
	assertEquals(outcome.ok, false);
	assertEquals(store.get(IDEA.slug), {
		voted: true,
		count: 9,
		pending: false,
		error: "Voting has closed on this idea.",
	});
});

Deno.test("a network failure is a refusal too", async () => {
	const store = createVoteStore();
	store.seed([IDEA]);
	const outcome = await store.toggle(IDEA.slug, () => Promise.reject(new Error("offline")));
	assertEquals(outcome.ok, false);
	assertEquals(store.get(IDEA.slug)?.count, 4);
	assertEquals(typeof store.get(IDEA.slug)?.error, "string");
});

Deno.test("a second press while one is in flight is ignored, and a refresh never overwrites it", async () => {
	const store = createVoteStore();
	store.seed([IDEA]);
	const sender = deferred();
	const first = store.toggle(IDEA.slug, sender.send);
	const second = await store.toggle(IDEA.slug, sender.send);
	assertEquals(second.sent, false);
	store.seed([{ ...IDEA, voteCount: 100 }]);
	assertEquals(store.get(IDEA.slug)?.count, 5);
	sender.answer({ ok: true, voted: true, voteCount: 5 });
	await first;
	assertEquals(sender.calls.length, 1);
	store.seed([{ ...IDEA, viewerVoted: true, voteCount: 6 }]);
	assertEquals(store.get(IDEA.slug)?.count, 6);
});

Deno.test("an idea the store has never seen is not sent", async () => {
	const store = createVoteStore();
	const outcome = await store.toggle(
		"fbk-2222222222",
		() => Promise.resolve({ ok: true, voted: true, voteCount: 1 }),
	);
	assertEquals(outcome.sent, false);
});

Deno.test("a retraction never drops a count below zero", async () => {
	const store = createVoteStore();
	store.seed([{ ...IDEA, viewerVoted: true, voteCount: 0 }]);
	const sender = deferred();
	const done = store.toggle(IDEA.slug, sender.send);
	assertEquals(store.get(IDEA.slug)?.count, 0);
	sender.answer({ ok: true, voted: false, voteCount: 0 });
	await done;
});
