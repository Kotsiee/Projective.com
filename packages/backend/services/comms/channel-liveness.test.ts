import { assertEquals } from "@std/assert";
import { NO_LIVE_CHANNELS, parseChannelLivenessOverride } from "@projective/types/comms";
import {
	channelLiveness,
	type DeliverySources,
	deliverySources,
	resolveChannelLiveness,
} from "./channel-liveness.ts";

async function withEnvAsync(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> {
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	const before = Object.keys(vars).map((name) => [name, Deno.env.get(name)] as const);
	Object.entries(vars).forEach(([name, value]) => apply(name, value));
	try {
		await fn();
	} finally {
		before.forEach(([name, value]) => apply(name, value));
	}
}

const EVERY_TRANSPORT = { email: true, push: true, sms: true } as const;
const NO_TRANSPORT = { email: false, push: false, sms: false } as const;

Deno.test("resolveChannelLiveness — a configured transport with no dispatcher sends nothing", () => {
	assertEquals(
		resolveChannelLiveness({ dispatcher: false, transports: EVERY_TRANSPORT }),
		NO_LIVE_CHANNELS,
	);
});

Deno.test("resolveChannelLiveness — a dispatcher with no transport sends nothing", () => {
	assertEquals(
		resolveChannelLiveness({ dispatcher: true, transports: NO_TRANSPORT }),
		NO_LIVE_CHANNELS,
	);
});

Deno.test("resolveChannelLiveness — a channel is live once the dispatcher runs and its transport is configured", () => {
	const sources: DeliverySources = {
		dispatcher: true,
		transports: { email: true, push: false, sms: false },
	};
	assertEquals(resolveChannelLiveness(sources), { email: true, push: false, sms: false });
});

Deno.test("deliverySources — the dispatcher half is the running dispatcher, the transports half its registry", async () => {
	const sources = await deliverySources(
		() => Promise.resolve(true),
		() => ({ email: true, push: false, sms: false }),
	);
	assertEquals(sources, { dispatcher: true, transports: { email: true, push: false, sms: false } });
});

Deno.test("deliverySources — a running dispatcher with the shipped, empty registry makes no channel live, even with a real Resend key", async () => {
	await withEnvAsync({
		RESEND_API_KEY: "re_live_key",
		MAIL_FROM: "Projective <no-reply@example.com>",
	}, async () => {
		const sources = await deliverySources(() => Promise.resolve(true));
		assertEquals(sources.dispatcher, true);
		assertEquals(sources.transports, NO_TRANSPORT);
		assertEquals(await channelLiveness(null, sources), NO_LIVE_CHANNELS);
	});
});

Deno.test("deliverySources — no dispatcher bearer, no dispatcher: the placeholder and a short secret count as absent", async () => {
	for (const secret of [undefined, "XXXX-XXXX", "short-secret"]) {
		await withEnvAsync({ COMMS_DISPATCH_SECRET: secret, AUTH_BACKEND_LIVE: "true" }, async () => {
			assertEquals((await deliverySources()).dispatcher, false, String(secret));
		});
	}
});

Deno.test("channelLiveness — the development override wins over the sources", async () => {
	const live: DeliverySources = { dispatcher: true, transports: EVERY_TRANSPORT };
	assertEquals(await channelLiveness("live", { dispatcher: false, transports: NO_TRANSPORT }), {
		email: true,
		push: true,
		sms: true,
	});
	assertEquals(await channelLiveness("off", live), NO_LIVE_CHANNELS);
	assertEquals(await channelLiveness(null, live), { email: true, push: true, sms: true });
});

Deno.test("parseChannelLivenessOverride — only live and off are overrides", () => {
	assertEquals(parseChannelLivenessOverride(" live "), "live");
	assertEquals(parseChannelLivenessOverride("off"), "off");
	for (const raw of [undefined, null, "", "auto", "LIVE", "on"]) {
		assertEquals(parseChannelLivenessOverride(raw), null);
	}
});
