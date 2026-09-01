import { assertEquals } from "@std/assert";
import { oauthSimulationTarget, resolveAuthScreenBounce } from "./auth-routing.ts";
import { DEFAULT_REDIRECT } from "./redirect.ts";

const at = (path: string) => new URL(path, "https://projective.test");

// #region The authenticated-visitor guard on /login and /join
Deno.test("a guest is never bounced off an auth screen", () => {
	assertEquals(resolveAuthScreenBounce(at("/login?redirectTo=/wallet"), false), null);
	assertEquals(resolveAuthScreenBounce(at("/join"), false), null);
});

Deno.test("an authenticated visitor is returned to their captured path, not asked to sign in again", () => {
	assertEquals(resolveAuthScreenBounce(at("/login?redirectTo=/wallet"), true), "/wallet");
	assertEquals(
		resolveAuthScreenBounce(at("/login?redirect=/projects/acme"), true),
		"/projects/acme",
	);
});

Deno.test("an authenticated visitor with no captured path falls back to the landing page", () => {
	assertEquals(resolveAuthScreenBounce(at("/login"), true), DEFAULT_REDIRECT);
	assertEquals(resolveAuthScreenBounce(at("/join"), true), DEFAULT_REDIRECT);
	assertEquals(resolveAuthScreenBounce(at("/login/"), true), DEFAULT_REDIRECT);
});

Deno.test("an existing user is never walked back through /join", () => {
	assertEquals(resolveAuthScreenBounce(at("/join?type=organization"), true), DEFAULT_REDIRECT);
	assertEquals(resolveAuthScreenBounce(at("/join?redirectTo=/explore"), true), "/explore");
});

Deno.test("a self-referential return path cannot make the guard loop", () => {
	// The guard's own destination is sanitised, so `/login?redirectTo=/login` exits the flow.
	assertEquals(resolveAuthScreenBounce(at("/login?redirectTo=/login"), true), DEFAULT_REDIRECT);
	assertEquals(resolveAuthScreenBounce(at("/login?redirectTo=/join"), true), DEFAULT_REDIRECT);
});

Deno.test("a Google identity mid-signup is authenticated by design and must NOT be bounced", () => {
	// The OAuth callback signs a new identity in, THEN sends them here to create their profile.
	assertEquals(resolveAuthScreenBounce(at("/join?oauth=google&email=ada@x.com"), true), null);
});

Deno.test("the guard ignores every screen that is not sign-in or sign-up", () => {
	for (const path of ["/verify", "/forgot-password", "/explore", "/joined"]) {
		assertEquals(resolveAuthScreenBounce(at(path), true), null, `${path} should render`);
	}
});
// #endregion

// #region The non-live OAuth simulation
Deno.test("a simulated SIGN-IN returns to the captured path — never /join", () => {
	const target = oauthSimulationTarget(
		new URLSearchParams({ mode: "signin", redirectTo: "/wallet" }),
	);
	assertEquals(target, "/wallet");
});

Deno.test("a simulated sign-in with no captured path lands on the default, not /join", () => {
	assertEquals(oauthSimulationTarget(new URLSearchParams({ mode: "signin" })), DEFAULT_REDIRECT);
});

Deno.test("a simulated sign-in refuses a hostile or self-referential return path", () => {
	for (const hostile of ["//evil.example", "https://evil.example", "/login"]) {
		assertEquals(
			oauthSimulationTarget(new URLSearchParams({ mode: "signin", redirectTo: hostile })),
			DEFAULT_REDIRECT,
		);
	}
});

Deno.test("a simulated SIGN-UP still pre-fills /join and carries the return path onward", () => {
	const target = oauthSimulationTarget(
		new URLSearchParams({ mode: "signup", redirectTo: "/explore" }),
	);
	const url = new URL(target, "https://projective.test");
	assertEquals(url.pathname, "/join");
	assertEquals(url.searchParams.get("oauth"), "google");
	assertEquals(url.searchParams.get("email"), "ada.lovelace@gmail.com");
	assertEquals(url.searchParams.get("redirectTo"), "/explore");
});

Deno.test("an absent mode keeps the historical sign-up behaviour", () => {
	const url = new URL(oauthSimulationTarget(new URLSearchParams()), "https://projective.test");
	assertEquals(url.pathname, "/join");
});
// #endregion
