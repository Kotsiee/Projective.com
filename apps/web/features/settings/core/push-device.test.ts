import { assertEquals } from "@std/assert";
import { detectPlatform, type PushInputs, pushStateFor } from "./push-device-model.ts";

const BASE: PushInputs = {
	publicKey: "BPub",
	simulated: null,
	platform: "supported",
	permission: "default",
	endpoint: null,
};

Deno.test("pushStateFor — push not configured, or no Push API: nothing renders", () => {
	assertEquals(pushStateFor({ ...BASE, publicKey: null }), { kind: "hidden" });
	assertEquals(pushStateFor({ ...BASE, platform: "unsupported" }), { kind: "hidden" });
	assertEquals(pushStateFor({ ...BASE, publicKey: null, simulated: "granted" }), {
		kind: "hidden",
	});
});

Deno.test("pushStateFor — the real browser: never asked, blocked, iOS outside the Home Screen, subscribed", () => {
	assertEquals(pushStateFor(BASE), { kind: "off", publicKey: "BPub" });
	assertEquals(pushStateFor({ ...BASE, permission: "granted" }), {
		kind: "off",
		publicKey: "BPub",
	});
	assertEquals(pushStateFor({ ...BASE, permission: "denied" }), { kind: "denied" });
	assertEquals(pushStateFor({ ...BASE, platform: "ios-not-installed" }), {
		kind: "ios-not-installed",
	});
	assertEquals(
		pushStateFor({ ...BASE, permission: "granted", endpoint: "https://fcm.googleapis.com/x" }),
		{
			kind: "on",
			publicKey: "BPub",
			endpoint: "https://fcm.googleapis.com/x",
		},
	);
});

Deno.test("pushStateFor — every simulated pushPermission state wins over the real browser", () => {
	const real = { ...BASE, permission: "denied" as const, platform: "unsupported" as const };
	assertEquals(pushStateFor({ ...real, simulated: "prompt" }), { kind: "off", publicKey: "BPub" });
	assertEquals(pushStateFor({ ...real, simulated: "granted" }), {
		kind: "on",
		publicKey: "BPub",
		endpoint: null,
	});
	assertEquals(pushStateFor({ ...BASE, simulated: "denied" }), { kind: "denied" });
	assertEquals(pushStateFor({ ...BASE, simulated: "unsupported" }), { kind: "hidden" });
	assertEquals(pushStateFor({ ...BASE, simulated: "ios-not-installed" }), {
		kind: "ios-not-installed",
	});
});

Deno.test("detectPlatform — iOS Safari in a tab is not installed; a Home-Screen app or a desktop browser is supported", () => {
	const standalone = (on: boolean) =>
		({
			PushManager: class {},
			Notification: class {},
			matchMedia: () => ({ matches: on }),
		}) as unknown as typeof globalThis;
	const iphone = {
		userAgent:
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile Safari/604.1",
		serviceWorker: {},
	} as unknown as Navigator;
	const chrome = {
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
		serviceWorker: {},
	} as unknown as Navigator;
	assertEquals(detectPlatform(iphone, standalone(false)), "ios-not-installed");
	assertEquals(detectPlatform(iphone, standalone(true)), "supported");
	assertEquals(detectPlatform(chrome, standalone(false)), "supported");
	assertEquals(
		detectPlatform({ userAgent: chrome.userAgent } as Navigator, standalone(false)),
		"unsupported",
	);
	assertEquals(detectPlatform(undefined), "unsupported");
});
