import { assertEquals, assertStringIncludes } from "@std/assert";
import {
	composeInternalMessage,
	composeShareText,
	externalShareUrl,
	SHARE_TARGETS,
} from "./share-targets.ts";

/*
 * A share intent that is wrong fails at the far end, in somebody else's app, with an empty
 * composer and no error — so the templates are pinned here, against the one thing that would
 * silently break them: a character that must be escaped exactly once.
 */

const req = {
	url: "https://projective.com/view/sv-brand-identity-sprint?ref=a&b=c",
	title: "Brand Identity Sprint",
	text: "Worth a look",
};

Deno.test("every listed target is either an intent with a URL or the one documented paste-mode target", () => {
	for (const spec of SHARE_TARGETS) {
		const url = externalShareUrl(spec.key, req);
		if (spec.mode === "intent") {
			assertEquals(typeof url, "string", spec.key);
		} else {
			assertEquals(url, null, spec.key);
			assertEquals(spec.key, "instagram");
		}
	}
});

Deno.test("the URL is escaped exactly once — the ampersand in the query survives as %26", () => {
	const fb = externalShareUrl("facebook", req)!;
	assertStringIncludes(
		fb,
		"u=https%3A%2F%2Fprojective.com%2Fview%2Fsv-brand-identity-sprint%3Fref%3Da%26b%3Dc",
	);
	assertEquals(fb.includes("%2526"), false);
	const tg = externalShareUrl("telegram", req)!;
	assertStringIncludes(tg, "url=https%3A%2F%2Fprojective.com");
	assertStringIncludes(tg, "&text=Brand%20Identity%20Sprint%20%E2%80%94%20Worth%20a%20look");
});

Deno.test("WhatsApp carries the link inside its text, X and Telegram carry it as a parameter", () => {
	const wa = externalShareUrl("whatsapp", req)!;
	assertStringIncludes(wa, "https://wa.me/?text=");
	assertStringIncludes(decodeURIComponent(wa.slice("https://wa.me/?text=".length)), req.url);
	const x = externalShareUrl("x", req)!;
	assertStringIncludes(x, "https://x.com/intent/post?url=");
	assertStringIncludes(x, "&text=");
	const snap = externalShareUrl("snapchat", req)!;
	assertEquals(snap, `https://www.snapchat.com/scan?attachmentUrl=${encodeURIComponent(req.url)}`);
});

Deno.test("a request with no note carries only the title, and no dangling separator", () => {
	assertEquals(composeShareText({ title: "Only a title" }), "Only a title");
	assertEquals(composeShareText({ title: "", text: "Only text" }), "Only text");
	assertEquals(composeShareText({ title: "  ", text: "  " }), "");
	const tg = externalShareUrl("telegram", { url: "https://p.com/x", title: "" })!;
	assertEquals(tg.includes("&text="), false);
});

Deno.test("the internal message leads with the note, else the title, and ends with the link on its own line", () => {
	assertEquals(
		composeInternalMessage(req, "Thought of you"),
		`Thought of you\n${req.url}`,
	);
	assertEquals(
		composeInternalMessage(req, "   "),
		`Brand Identity Sprint — Worth a look\n${req.url}`,
	);
	assertEquals(
		composeInternalMessage({ url: "https://p.com", title: "", text: "" }, ""),
		"https://p.com",
	);
});
