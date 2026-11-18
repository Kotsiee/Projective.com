import { assertEquals } from "@std/assert";
import { NO_LIVE_CHANNELS, parseChannelLivenessOverride } from "@projective/types/comms";
import {
	channelLiveness,
	type DeliverySources,
	deliverySources,
	resolveChannelLiveness,
} from "./channel-liveness.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	const before = Object.keys(vars).map((name) => [name, Deno.env.get(name)] as const);
	Object.entries(vars).forEach(([name, value]) => apply(name, value));
	try {
		fn();
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

Deno.test("deliverySources — no dispatcher runs today, so no channel is live even with a real Resend key", () => {
	withEnv({ RESEND_API_KEY: "re_live_key", MAIL_FROM: "Projective <no-reply@example.com>" }, () => {
		const sources = deliverySources();
		assertEquals(sources.dispatcher, false);
		assertEquals(sources.transports.email, true);
		assertEquals(channelLiveness(), NO_LIVE_CHANNELS);
	});
});

Deno.test("deliverySources — the placeholder key counts as no email transport", () => {
	withEnv({ RESEND_API_KEY: "XXXX-XXXX", MAIL_FROM: "Projective <no-reply@example.com>" }, () => {
		assertEquals(deliverySources().transports.email, false);
	});
});

Deno.test("channelLiveness — the development override wins over the sources", () => {
	const live: DeliverySources = { dispatcher: true, transports: EVERY_TRANSPORT };
	assertEquals(channelLiveness("live", { dispatcher: false, transports: NO_TRANSPORT }), {
		email: true,
		push: true,
		sms: true,
	});
	assertEquals(channelLiveness("off", live), NO_LIVE_CHANNELS);
	assertEquals(channelLiveness(null, live), { email: true, push: true, sms: true });
});

Deno.test("parseChannelLivenessOverride — only live and off are overrides", () => {
	assertEquals(parseChannelLivenessOverride(" live "), "live");
	assertEquals(parseChannelLivenessOverride("off"), "off");
	for (const raw of [undefined, null, "", "auto", "LIVE", "on"]) {
		assertEquals(parseChannelLivenessOverride(raw), null);
	}
});
