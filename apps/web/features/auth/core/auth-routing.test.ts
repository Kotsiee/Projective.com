import { assertEquals } from "@std/assert";
import {
	joinCompletionTarget,
	oauthSimulationTarget,
	resolveAuthScreenBounce,
	resolveOnboardingBounce,
} from "./auth-routing.ts";
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

// #region The un-onboarded bounce
const ADA = {
	provider: "google",
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@x.com",
	avatar: "https://lh3.googleusercontent.com/a/pic",
};

Deno.test("an onboarded account is never sent back through onboarding", () => {
	assertEquals(resolveOnboardingBounce({ onboarded: true }, ADA, at("/projects")), null);
});

Deno.test("an ABSENT onboarding claim lets the page render", () => {
	// A token minted before the claim existed, or a hook that errored, says nothing — and nothing is
	// not "no profile". Bouncing here would walk every holder of an older token through /join.
	assertEquals(resolveOnboardingBounce({}, ADA, at("/projects")), null);
	assertEquals(resolveOnboardingBounce(undefined, ADA, at("/projects")), null);
	assertEquals(resolveOnboardingBounce(null, ADA, at("/projects")), null);
});

Deno.test("an identity /join cannot complete is left alone rather than sent to a dead end", () => {
	// No pre-fill means no email, and /join renders that field read-only for an already-authenticated
	// account — so the form could not be submitted. An organisation owner is exactly this shape.
	assertEquals(resolveOnboardingBounce({ onboarded: false }, null, at("/projects")), null);
});
Deno.test("a CONFIRMED absent profile is sent to /join with its pre-fill and its captured path", () => {
	const url = new URL(
		resolveOnboardingBounce({ onboarded: false }, ADA, at("/projects?create=1"))!,
		"https://projective.test",
	);
	assertEquals(url.pathname, "/join");
	assertEquals(url.searchParams.get("oauth"), "google");
	assertEquals(url.searchParams.get("email"), "ada@x.com");
	assertEquals(url.searchParams.get("redirectTo"), "/projects?create=1");
});

Deno.test("the bounce destination is one the auth-screen guard lets render", () => {
	// The composition IS the loop guard: this middleware sends them to /join and that one sends
	// authenticated visitors OFF /join, so if the pre-fill marker were ever dropped the two would
	// ping-pong. Asserting each in isolation would not catch it.
	const target = resolveOnboardingBounce({ onboarded: false }, ADA, at("/wallet"))!;
	assertEquals(resolveAuthScreenBounce(at(target), true), null);
});

Deno.test("a captured path that is itself an auth screen cannot make the trip loop", () => {
	// /join and /login are the two paths whose presence in `redirectTo` would send the user straight
	// back where they came from once onboarding finishes. `safeRedirect` refuses both, which is why
	// the composition above terminates. A protocol-relative target is not tested through this door:
	// the argument is a parsed `URL`'s own pathname, so `//evil.example/x` reaches it as `/x`.
	for (const looping of ["/join", "/login"]) {
		const url = new URL(
			resolveOnboardingBounce({ onboarded: false }, ADA, at(looping))!,
			"https://projective.test",
		);
		assertEquals(url.searchParams.get("redirectTo"), DEFAULT_REDIRECT, looping);
	}
});

Deno.test("the builder itself refuses a hostile return path, whatever hands it one", () => {
	// `resolveOnboardingBounce` can only supply a real pathname, but the builder is exported and the
	// callback feeds it a `redirectTo` that DID come off a query string.
	for (const hostile of ["//evil.example", "https://evil.example/x", "/login"]) {
		const url = new URL(joinCompletionTarget(ADA, hostile), "https://projective.test");
		assertEquals(url.searchParams.get("redirectTo"), DEFAULT_REDIRECT, hostile);
	}
});

Deno.test("a missing pre-fill still produces a usable /join address", () => {
	// The marker is what makes /join complete an existing federated account instead of signing a new
	// one up, so it is present even when the token carried no identity to pre-fill with.
	const url = new URL(joinCompletionTarget(null, "/projects"), "https://projective.test");
	assertEquals(url.searchParams.get("oauth"), "google");
	assertEquals(url.searchParams.get("firstName"), null);
	assertEquals(url.searchParams.get("avatar"), null);
	assertEquals(url.searchParams.get("redirectTo"), "/projects");
});
// #endregion
