import { assertEquals } from "@std/assert";
import {
	MOCK_OAUTH_AVATAR,
	MOCK_SAMPLE_MEDIA,
	mockAvatar as appAvatar,
	mockCover as appCover,
	photoSlug as appSlug,
} from "./mock-assets.ts";

/**
 * This file exists to stop a duplicate from drifting.
 *
 * `apps/web/utils/mock-assets.ts` and `packages/backend/mocks/assets.ts` are deliberately two copies
 * of one behaviour, because root CLAUDE.md §2 forbids the island-side module from importing the
 * backend package. A duplicate nobody checks is exactly how the corpus ended up with `q=72`, `q=75`
 * and `q=80` all claiming to be "the" cover crop, so the app copy is pinned against the same literal
 * strings the backend test uses. Comparing the two implementations directly would reintroduce the
 * import this split exists to avoid, so both are compared to the same third thing: the expected URL.
 */

Deno.test("app mockAvatar matches the backend builder byte for byte", () => {
	assertEquals(
		appAvatar("photo-1487412720507-e7ab37603c6f"),
		"https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	);
	assertEquals(
		appAvatar("1487412720507-e7ab37603c6f"),
		"https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	);
});

Deno.test("app mockCover matches the backend builder byte for byte", () => {
	// The former `landing-data.ts` unsplash() default (q=72).
	assertEquals(
		appCover("1600880292203-757bb62b4baf", 900, 1100, 72),
		"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=900&h=1100&q=72",
	);
	// The former `showcase-model.ts` bannerFor() literal.
	assertEquals(
		appCover("photo-1519085360753-af0119f7cbe7", 1600, 460),
		"https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=1600&h=460&q=80",
	);
	// Width-only: the height segment must vanish entirely, not render as `h=undefined`.
	assertEquals(
		appCover("photo-1558655146-9f40138edfeb", 600, undefined, 60),
		"https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=600&q=60",
	);
});

Deno.test("photoSlug is idempotent on both conventions", () => {
	assertEquals(appSlug("1600880292203-757bb62b4baf"), "photo-1600880292203-757bb62b4baf");
	assertEquals(appSlug(appSlug("1600880292203-757bb62b4baf")), "photo-1600880292203-757bb62b4baf");
});

Deno.test("the OAuth stub avatar keeps its distinct Google-shaped query", () => {
	// Deliberately NOT the common shape: no auto=format, no q, plus crop=faces. Normalising it would
	// change the one asset whose job is to look like it came from a provider CDN.
	assertEquals(
		MOCK_OAUTH_AVATAR,
		"https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=128&h=128&fit=crop&crop=faces",
	);
});

Deno.test("catalogue sample media is unchanged after the move out of the island", () => {
	assertEquals(MOCK_SAMPLE_MEDIA, [
		"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&h=600&q=72",
		"https://images.unsplash.com/photo-1545235617-9465d2a55698?auto=format&fit=crop&w=800&h=600&q=72",
		"https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?auto=format&fit=crop&w=800&h=600&q=72",
	]);
});
