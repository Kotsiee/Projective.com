import { assert, assertEquals } from "@std/assert";
import { LocalKeys } from "./storage-keys.ts";
import {
	parseScreenShare,
	resolveScreenShare,
	SCREEN_SHARE_COOKIE,
	SCREEN_SHARE_PREPAINT_SCRIPT,
	screenShareCookie,
	screenShareRootAttributes,
} from "./screen-share-context.ts";

function request(cookie: string | null): Request {
	return new Request("https://app.example.test/", { headers: cookie ? { cookie } : {} });
}

interface RestorerRun {
	attributes: Map<string, string>;
	keysRead: string[];
	written: string | null;
}

function runRestorer(
	cookie: string,
	stored: string | null,
	protocol = "http:",
	storageThrows = false,
): RestorerRun {
	const run: RestorerRun = { attributes: new Map(), keysRead: [], written: null };
	const document = {
		get cookie(): string {
			return cookie;
		},
		set cookie(value: string) {
			run.written = value;
		},
		documentElement: {
			setAttribute: (name: string, value: string) => run.attributes.set(name, value),
		},
	};
	const localStorage = {
		getItem: (key: string): string | null => {
			if (storageThrows) throw new Error("SecurityError");
			run.keysRead.push(key);
			return stored;
		},
	};
	const restorer = new Function(
		"document",
		"localStorage",
		"location",
		SCREEN_SHARE_PREPAINT_SCRIPT,
	);
	restorer(document, localStorage, { protocol });
	return run;
}

Deno.test("screen share cookie — on only for the exact value 1", () => {
	assertEquals(resolveScreenShare(request("pj.screen_share=1")), true);
	assertEquals(resolveScreenShare(request("pj.a11y=x; pj.screen_share=1; pj.currency=EUR")), true);
	assertEquals(resolveScreenShare(request(null)), false);
	for (const junk of ["0", "", "true", "11", "%31", "1x", "yes", "<script>"]) {
		assertEquals(resolveScreenShare(request(`pj.screen_share=${junk}`)), false, junk);
	}
	assertEquals(resolveScreenShare(request("xpj.screen_share=1")), false);
	assertEquals(resolveScreenShare(request("pj.screen_share_other=1")), false);
	assertEquals(parseScreenShare(undefined), false);
	assertEquals(parseScreenShare(null), false);
});

Deno.test("screen share cookie — the builder writes the mirror, Secure only on HTTPS", () => {
	assertEquals(
		screenShareCookie(true, false),
		"pj.screen_share=1; path=/; max-age=31536000; samesite=lax",
	);
	assertEquals(
		screenShareCookie(true, true),
		"pj.screen_share=1; path=/; max-age=31536000; samesite=lax; secure",
	);
	assertEquals(
		screenShareCookie(false, false),
		"pj.screen_share=; path=/; max-age=0; samesite=lax",
	);
	assertEquals(
		screenShareCookie(false, true),
		"pj.screen_share=; path=/; max-age=0; samesite=lax; secure",
	);
	assertEquals(screenShareCookie(true, false).toLowerCase().includes("httponly"), false);
	const pair = screenShareCookie(true, false).split(";")[0];
	assertEquals(resolveScreenShare(request(pair)), true);
});

Deno.test("screen share — only ON becomes an attribute", () => {
	assertEquals(screenShareRootAttributes(true), { "data-screen-share": "active" });
	assertEquals(screenShareRootAttributes(false), {});
});

Deno.test("pre-paint restorer — its literal key is LocalKeys.SCREEN_SHARE", () => {
	const run = runRestorer("", "1");
	assertEquals(run.keysRead, [LocalKeys.SCREEN_SHARE]);
	assertEquals(LocalKeys.SCREEN_SHARE, "pj.local.screenShare");
});

Deno.test("pre-paint restorer — its cookie format is screenShareCookie's", () => {
	assertEquals(runRestorer("", "1", "http:").written, screenShareCookie(true, false));
	assertEquals(runRestorer("", "1", "https:").written, screenShareCookie(true, true));
	assert(SCREEN_SHARE_PREPAINT_SCRIPT.includes(`"${SCREEN_SHARE_COOKIE}=`));
});

Deno.test("pre-paint restorer — localStorage alone paints the mode and re-writes the cookie", () => {
	const run = runRestorer("pj.a11y=contrast-high", "1");
	assertEquals(run.attributes.get("data-screen-share"), "active");
	assertEquals(run.written, screenShareCookie(true, false));
});

Deno.test("pre-paint restorer — nothing stored, nothing painted", () => {
	for (const stored of [null, "", "0", "true"]) {
		const run = runRestorer("", stored);
		assertEquals(run.attributes.size, 0, String(stored));
		assertEquals(run.written, null, String(stored));
	}
});

Deno.test("pre-paint restorer — a cookie of exactly 1 paints, and is never re-written", () => {
	const run = runRestorer("pj.currency=EUR; pj.screen_share=1", null);
	assertEquals(run.attributes.get("data-screen-share"), "active");
	assertEquals(run.written, null);
	assertEquals(run.keysRead, []);
});

Deno.test("pre-paint restorer — any other cookie value is the server's answer: off", () => {
	for (const cookie of ["pj.screen_share=", "pj.screen_share=0", "pj.screen_share=11"]) {
		const run = runRestorer(cookie, "1");
		assertEquals(run.attributes.size, 0, cookie);
		assertEquals(run.written, null, cookie);
	}
});

Deno.test("pre-paint restorer — storage that throws leaves the page alone", () => {
	const run = runRestorer("", "1", "https:", true);
	assertEquals(run.attributes.size, 0);
	assertEquals(run.written, null);
});
