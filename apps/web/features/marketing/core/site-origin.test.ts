/**
 * The origin every canonical URL and JSON-LD `@id` is built on. A wrong one is silent: the page
 * renders, and search engines index the proxy's internal host — or whatever a client put in Host.
 */
import { assertEquals } from "@std/assert";
import { siteOrigin } from "./site-origin.ts";

const REQUEST = new URL("http://internal:8000/legal/terms?ref=x");

Deno.test("production builds on APP_URL, never on the request's Host", () => {
	assertEquals(
		siteOrigin(REQUEST, { appEnv: "production", appUrl: "https://projective.app/" }),
		"https://projective.app",
	);
	assertEquals(
		siteOrigin(new URL("https://evil.example/legal"), {
			appEnv: "production",
			appUrl: "https://projective.app",
		}),
		"https://projective.app",
	);
});

Deno.test("development keeps the origin being browsed", () => {
	assertEquals(
		siteOrigin(new URL("http://127.0.0.1:5173/help"), {
			appEnv: "development",
			appUrl: "http://localhost:3000",
		}),
		"http://127.0.0.1:5173",
	);
});

Deno.test("an unusable APP_URL falls back to the request origin", () => {
	for (const appUrl of ["", "not a url", "ftp://projective.app"]) {
		assertEquals(siteOrigin(REQUEST, { appEnv: "production", appUrl }), "http://internal:8000");
	}
});
