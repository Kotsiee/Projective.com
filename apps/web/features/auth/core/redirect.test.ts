import { assertEquals } from "@std/assert";
import {
	DEFAULT_REDIRECT,
	isAuthPath,
	readRedirect,
	safeRedirect,
	withRedirect,
} from "./redirect.ts";

// #region safeRedirect — same-origin narrowing
Deno.test("safeRedirect honours an in-app path", () => {
	assertEquals(safeRedirect("/projects/acme/general"), "/projects/acme/general");
	assertEquals(safeRedirect("/wallet?w=team:1"), "/wallet?w=team:1");
});

Deno.test("safeRedirect rejects anything that is not a same-origin path", () => {
	for (
		const hostile of [
			"//evil.example",
			"/\u005Cevil.example", // a backslash, escaped so the literal survives tooling
			"https://evil.example/steal",
			"javascript:alert(1)",
			"projects",
			"/proj\u0000ects",
			"",
			null,
			undefined,
		]
	) {
		assertEquals(safeRedirect(hostile), DEFAULT_REDIRECT, `should reject ${String(hostile)}`);
	}
});
// #endregion

// #region The redirect loop — an auth route is never a post-auth destination
Deno.test("isAuthPath matches whole segments only", () => {
	for (const path of ["/login", "/join", "/JOIN", "/verify", "/join/", "/api/auth/callback"]) {
		assertEquals(isAuthPath(path), true, `${path} should be an auth path`);
	}
	// A route that merely starts with the same letters is an ordinary app route.
	for (const path of ["/joined", "/logins", "/", "/projects", "/api/authors"]) {
		assertEquals(isAuthPath(path), false, `${path} should NOT be an auth path`);
	}
});

Deno.test("safeRedirect refuses to send a signed-in user back into the auth flow", () => {
	assertEquals(safeRedirect("/login"), DEFAULT_REDIRECT);
	assertEquals(safeRedirect("/join?type=organization"), DEFAULT_REDIRECT);
	assertEquals(safeRedirect("/api/auth/oauth/google"), DEFAULT_REDIRECT);
});

Deno.test("safeRedirect will not trust an auth route arriving as the FALLBACK either", () => {
	// The bug shape: a page captured `/join` as its own return path and passed it down as a default.
	assertEquals(safeRedirect(null, "/join"), DEFAULT_REDIRECT);
	assertEquals(safeRedirect("//evil.example", "/login"), DEFAULT_REDIRECT);
	// A legitimate fallback still wins over an unusable candidate.
	assertEquals(safeRedirect(null, "/explore"), "/explore");
});
// #endregion

// #region readRedirect — return path BEFORE the default
Deno.test("readRedirect prefers the captured return path over the default landing page", () => {
	const params = new URLSearchParams({ redirectTo: "/projects/acme" });
	assertEquals(readRedirect(params), "/projects/acme");
});

Deno.test("readRedirect accepts the legacy `redirect` key the guard once wrote", () => {
	assertEquals(readRedirect(new URLSearchParams({ redirect: "/wallet" })), "/wallet");
});

Deno.test("readRedirect falls back only when no usable return path was captured", () => {
	assertEquals(readRedirect(new URLSearchParams()), DEFAULT_REDIRECT);
	assertEquals(readRedirect(new URLSearchParams({ redirectTo: "/join" })), DEFAULT_REDIRECT);
	assertEquals(readRedirect(new URLSearchParams(), "/explore"), "/explore");
});
// #endregion

// #region withRedirect — threading the path between auth steps
Deno.test("withRedirect threads a captured path and omits a redundant default", () => {
	assertEquals(withRedirect("/login", "/wallet"), "/login?redirectTo=%2Fwallet");
	assertEquals(withRedirect("/login", DEFAULT_REDIRECT), "/login");
	// An auth route in the value slot is dropped rather than threaded onward.
	assertEquals(withRedirect("/login", "/join"), "/login");
});

Deno.test("withRedirect appends to a base path that already carries a query", () => {
	assertEquals(
		withRedirect("/api/auth/oauth/google?mode=signin", "/explore"),
		"/api/auth/oauth/google?mode=signin&redirectTo=%2Fexplore",
	);
});
// #endregion
