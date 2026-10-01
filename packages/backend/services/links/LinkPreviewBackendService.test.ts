import { assert, assertEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import { clearScanCache } from "../files/link-scan.ts";
import { LinkPreviewBackendService } from "./LinkPreviewBackendService.ts";

/*
 * What a link inside a message shows its reader, and what the `/exit` interstitial says about it.
 * These run with the files backend off, so the scanner answers offline: the Safe Browsing test host
 * is blocked, a link's suspicious shape is judged locally, and an ordinary https link reads safe
 * with a title drawn from its path.
 */

const HOST = "localhost:5373";
const reader = (userId: string): ReadActor => ({
	userId,
	contextId: userId,
	contextType: "personal",
});
const GUEST = reader("");
const BLOCKED = "https://testsafebrowsing.appspot.com/s/phishing.html";

Deno.test("previews: a guest is refused; a reader gets verdicts, with metadata only for a safe link", async () => {
	clearScanCache();
	const refused = await LinkPreviewBackendService.previews([BLOCKED], GUEST, HOST);
	assertEquals(refused.status, 401);

	const res = await LinkPreviewBackendService.previews(
		[
			BLOCKED,
			"https://example.com/case-studies/design-system-docs",
			"https://example.com:8443/login",
		],
		reader("links-reader"),
		HOST,
	);
	assert(res.ok && res.data, res.message);
	const { previews } = res.data;

	const blocked = previews[BLOCKED];
	assert(blocked?.kind === "external");
	assertEquals(blocked.verdict, "blocked");
	assertEquals([blocked.title, blocked.description, blocked.faviconUrl], [null, null, null]);
	assert(blocked.reason);

	const safe = previews["https://example.com/case-studies/design-system-docs"];
	assert(safe?.kind === "external");
	assertEquals(safe.verdict, "safe");
	assertEquals(safe.title, "Design system docs");
	assertEquals(safe.reason, null);

	const odd = previews["https://example.com:8443/login"];
	assert(odd?.kind === "external");
	assertEquals(odd.verdict, "suspicious");
	assertEquals(odd.title, null);
});

Deno.test("previews: a plain internal link gets no card, and the batch answers only what it can", async () => {
	clearScanCache();
	const res = await LinkPreviewBackendService.previews(
		[`http://${HOST}/settings`, "not a link"],
		reader("links-internal"),
		HOST,
	);
	assert(res.ok && res.data, res.message);
	assertEquals(res.data.previews, {});
});

Deno.test("exitCheck: a guest never triggers a scan, but a link's suspicious shape is still reported", async () => {
	clearScanCache();
	const unchecked = await LinkPreviewBackendService.exitCheck(BLOCKED, GUEST, HOST);
	assert(unchecked.ok && unchecked.data);
	assertEquals(unchecked.data.verdict, "pending");

	const shaped = await LinkPreviewBackendService.exitCheck(
		"https://example.com:8443/login",
		GUEST,
		HOST,
	);
	assert(shaped.ok && shaped.data);
	assertEquals(shaped.data.verdict, "suspicious");
	assert(shaped.data.reason?.includes("8443"));

	await LinkPreviewBackendService.exitCheck(BLOCKED, reader("links-scanner"), HOST);
	const remembered = await LinkPreviewBackendService.exitCheck(BLOCKED, GUEST, HOST);
	assert(remembered.ok && remembered.data);
	assertEquals(
		remembered.data.verdict,
		"blocked",
		"a guest sees a verdict a reader's scan left behind",
	);
});

Deno.test("exitCheck: an internal link comes back as a same-origin path, and a non-link is refused", async () => {
	const internal = await LinkPreviewBackendService.exitCheck(
		"https://projective.io//evil.com/x?y=1",
		GUEST,
		HOST,
	);
	assert(internal.ok && internal.data);
	assertEquals(internal.data.internal, true);
	assertEquals(internal.data.url, "/evil.com/x?y=1");

	for (
		const raw of [
			"javascript:alert(1)",
			"",
			"ftp://example.com/file",
			"https://user:pw@example.com/",
		]
	) {
		const refused = await LinkPreviewBackendService.exitCheck(raw, GUEST, HOST);
		assertEquals(refused.status, 422, raw);
	}
});
