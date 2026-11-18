import { assert, assertEquals } from "@std/assert";
import {
	signUnsubscribeToken,
	unsubscribeUrl,
	verifyUnsubscribeToken,
} from "./unsubscribe-token.ts";
import { MarketingUnsubscribeService } from "./MarketingUnsubscribeService.ts";

const SECRET = "s".repeat(48);
const USER = "0b8e6c4a-2d1f-4e3b-8a7c-9d0e1f2a3b4c";

Deno.test("unsubscribe token — round-trips the person, and carries no address", async () => {
	const token = (await signUnsubscribeToken(USER, SECRET))!;
	assert(token && !token.includes("@") && !token.includes(USER));
	assertEquals(await verifyUnsubscribeToken(token, SECRET), USER);
	const url = new URL(unsubscribeUrl(token, "https://staging.projective.test/x"));
	assertEquals([url.origin, url.pathname, url.searchParams.get("token")], [
		"https://staging.projective.test",
		"/api/comms/unsubscribe",
		token,
	]);
});

Deno.test("unsubscribe token — a tampered id or signature, another key, or junk verifies as nobody", async () => {
	const token = (await signUnsubscribeToken(USER, SECRET))!;
	const [id, sig] = token.split(".");
	const otherUser =
		(await signUnsubscribeToken("11111111-2222-4333-8444-555555555555", SECRET))!.split(".")[0];
	const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
	for (
		const bad of [
			`${otherUser}.${sig}`,
			`${id}.${flipped}`,
			`${id}`,
			"",
			"a.b.c",
			`${id}.${sig}.x`,
			"%%%.***",
		]
	) {
		assertEquals(await verifyUnsubscribeToken(bad, SECRET), null, bad);
	}
	assertEquals(await verifyUnsubscribeToken(token, "t".repeat(48)), null);
});

Deno.test("unsubscribe token — no well-formed dispatcher secret, no link", async () => {
	for (const secret of [undefined, "XXXX-XXXX", "short"]) {
		assertEquals(await signUnsubscribeToken(USER, secret), null, String(secret));
	}
	assertEquals(await signUnsubscribeToken("not-a-uuid", SECRET), null);
});

Deno.test("MarketingUnsubscribeService — a link this server did not sign is a 404; a signed one unsubscribes", async () => {
	const calls: string[] = [];
	const rpc = (userId: string) => {
		calls.push(userId);
		return Promise.resolve("unsubscribed" as const);
	};
	const verify = (token: string | null) => verifyUnsubscribeToken(token, SECRET);

	const forged = await MarketingUnsubscribeService.unsubscribe("abc.def", {
		live: true,
		verify,
		rpc,
	});
	assertEquals([forged.ok, forged.status, calls.length], [false, 404, 0]);

	const token = await signUnsubscribeToken(USER, SECRET);
	const done = await MarketingUnsubscribeService.unsubscribe(token, { live: true, verify, rpc });
	assertEquals([done.ok, done.data?.outcome, calls], [true, "unsubscribed", [USER]]);
});
