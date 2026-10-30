import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { once } from "./request-memo.ts";

/** A `run` that counts its calls and answers `value`. */
function counting<T>(value: T) {
	const calls = { count: 0 };
	const run = () => {
		calls.count++;
		return Promise.resolve(value);
	};
	return { calls, run };
}

Deno.test("once — regions of one request share one read", async () => {
	const url = new URL("https://projective.test/teams/acme");
	const { calls, run } = counting("roster");
	const [lane, header] = [once(url, "roster|u1|", run), once(url, "roster|u1|", run)];
	assertStrictEquals(lane, header, "the second region joins the first read's promise");
	assertEquals(await lane, "roster");
	assertEquals(await once(url, "roster|u1|", run), "roster");
	assertEquals(calls.count, 1);
	await once(url, "bench|u1|", run);
	assertEquals(calls.count, 2, "a different key is a different read");
});

Deno.test("once — two requests never share a read, even for the same href", async () => {
	const { calls, run } = counting("agenda");
	await once(new URL("https://projective.test/calendar"), "calendar|u1|", run);
	await once(new URL("https://projective.test/calendar"), "calendar|u1|", run);
	assertEquals(calls.count, 2, "the read after a mutation must not be served the earlier answer");
});

Deno.test("once — a rejection leaves the memo, so a retry in the same request runs again", async () => {
	const req = new Request("https://projective.test/projects");
	let calls = 0;
	const run = () => ++calls === 1 ? Promise.reject(new Error("down")) : Promise.resolve("ok");
	await assertRejects(() => once(req, "session:access-cookie", run), Error, "down");
	assertEquals(await once(req, "session:access-cookie", run), "ok");
	assertEquals(await once(req, "session:access-cookie", run), "ok", "a success stays memoised");
	assertEquals(calls, 2);
});
