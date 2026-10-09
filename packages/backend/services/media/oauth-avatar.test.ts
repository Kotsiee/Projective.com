import { assert, assertEquals } from "@std/assert";
import type { FetchedPage } from "../files/link-fetch.ts";
import { acceptOAuthImage } from "./oauth-avatar.ts";

const PNG_HEAD = new Uint8Array([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	0,
	0,
	0,
	13,
	0x49,
	0x48,
	0x44,
	0x52,
]);
const SVG_HEAD = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function page(overrides: Partial<FetchedPage>): FetchedPage {
	return {
		url: "https://lh3.googleusercontent.com/a/photo=s96-c",
		status: 200,
		headers: new Headers(),
		body: PNG_HEAD,
		truncated: false,
		...overrides,
	};
}

Deno.test("acceptOAuthImage: a complete PNG from the provider CDN is accepted by its bytes", () => {
	const out = acceptOAuthImage(page({}));
	assert(!("refusal" in out));
	assertEquals(out.mime, "image/png");
	assertEquals(out.ext, "png");
});

Deno.test("acceptOAuthImage: a redirect that lands off the allowlist is refused", () => {
	assert("refusal" in acceptOAuthImage(page({ url: "https://evil.example/photo.png" })));
});

Deno.test("acceptOAuthImage: a non-200, a truncated body and an empty body are refused", () => {
	assert("refusal" in acceptOAuthImage(page({ status: 404 })));
	assert("refusal" in acceptOAuthImage(page({ truncated: true })));
	assert("refusal" in acceptOAuthImage(page({ body: new Uint8Array() })));
});

Deno.test("acceptOAuthImage: markup served as a picture is refused by name", () => {
	const out = acceptOAuthImage(page({ body: SVG_HEAD }));
	assert("refusal" in out);
	assert(out.refusal.includes("SVG"));
});
