import { assertEquals } from "@std/assert";
import { inspectRedirect } from "./proxy-navigation.ts";

const ID = "5b0c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const NAV_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8";
const IMG_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

function check(query: string, headers: Record<string, string>, method = "GET"): string | null {
	const url = new URL(`http://localhost/api/media/proxy/${ID}${query}`);
	return inspectRedirect(new Request(url, { method, headers }), url, ID);
}

Deno.test("proxy-navigation: a document navigation goes to the inspector", () => {
	assertEquals(check("", { accept: NAV_ACCEPT, "sec-fetch-dest": "document" }), `/inspect/${ID}`);
});

Deno.test("proxy-navigation: the share slug is carried to the inspector", () => {
	assertEquals(
		check("?share=abc&tier=lg", { accept: NAV_ACCEPT, "sec-fetch-dest": "document" }),
		`/inspect/${ID}?share=abc`,
	);
});

Deno.test("proxy-navigation: without fetch metadata, an HTML-first Accept is a navigation", () => {
	assertEquals(check("", { accept: NAV_ACCEPT }), `/inspect/${ID}`);
	assertEquals(check("", { accept: IMG_ACCEPT }), null);
	assertEquals(check("", {}), null);
});

Deno.test("proxy-navigation: subresource fetches stream the bytes", () => {
	assertEquals(check("", { accept: IMG_ACCEPT, "sec-fetch-dest": "image" }), null);
	assertEquals(check("", { accept: "*/*", "sec-fetch-dest": "video" }), null);
	assertEquals(check("", { accept: "*/*", "sec-fetch-dest": "empty" }), null);
	// An HTML Accept on a subresource is still a subresource.
	assertEquals(check("", { accept: NAV_ACCEPT, "sec-fetch-dest": "iframe" }), null);
});

Deno.test("proxy-navigation: ?raw and ?download opt a navigation out", () => {
	const nav = { accept: NAV_ACCEPT, "sec-fetch-dest": "document" };
	assertEquals(check("?raw=true", nav), null);
	assertEquals(check("?raw=1", nav), null);
	assertEquals(check("?download=1", nav), null);
});

Deno.test("proxy-navigation: HEAD never redirects", () => {
	assertEquals(check("", { accept: NAV_ACCEPT, "sec-fetch-dest": "document" }, "HEAD"), null);
});
