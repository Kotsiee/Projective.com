import { assertEquals } from "@std/assert";
import { mockAvatar, mockCover, photoSlug, unsplashUrl } from "./assets.ts";

/**
 * These tests exist for one reason: `assets.ts` replaced twenty-one privately-declared URL builders,
 * and the claim that the replacement is byte-identical is the whole basis for calling that a refactor
 * rather than a change. A comment asserting it is worth nothing; each case below is a literal string
 * lifted verbatim from the module it came from, at the line it came from.
 *
 * If one of these ever fails, the corpus has drifted and every fixture that renders an image drifted
 * with it — silently, because a wrong-but-valid Unsplash URL still returns a picture.
 */

Deno.test("photoSlug normalises both call conventions and is idempotent", () => {
	// explore/fixtures.ts passed a bare slug into a `photo-${id}` template.
	assertEquals(photoSlug("1600880292203-757bb62b4baf"), "photo-1600880292203-757bb62b4baf");
	// projects/detail-fixtures.ts passed an already-prefixed slug into a `${id}` template.
	assertEquals(photoSlug("photo-1487412720507-e7ab37603c6f"), "photo-1487412720507-e7ab37603c6f");
	// Applying it twice must not double the prefix.
	assertEquals(
		photoSlug(photoSlug("1600880292203-757bb62b4baf")),
		"photo-1600880292203-757bb62b4baf",
	);
});

Deno.test("mockAvatar reproduces the 96px face crop verbatim (13 former call sites)", () => {
	// projects/detail-fixtures.ts:27 FACE, projects/fixtures.ts:27, members-fixtures.ts:38,
	// messaging/conversation-fixtures.ts:25, scheduling/coordination-fixtures.ts:60,
	// workspace/workspace-fixtures.ts:108 face(), finance/{basket,wallet}-fixtures.ts, …
	assertEquals(
		mockAvatar("photo-1487412720507-e7ab37603c6f"),
		"https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	);
	// The same builder reached from the bare-slug convention (profile-fixtures.ts:64).
	assertEquals(
		mockAvatar("1487412720507-e7ab37603c6f"),
		"https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	);
	// catalogue-fixtures.ts:78 shipped a 160px variant as a literal.
	assertEquals(
		mockAvatar("photo-1506794778202-cad84cf45f1d", 160),
		"https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=facearea&facepad=3&w=160&h=160&q=80",
	);
});

Deno.test("mockCover reproduces every landscape variant verbatim", () => {
	// projects/detail-fixtures.ts:29 SCENE — fixed 640x280.
	assertEquals(
		mockCover("photo-1519085360753-af0119f7cbe7", 640, 280),
		"https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=640&h=280&q=80",
	);
	// workspace/workspace-fixtures.ts:113 banner() — fixed 1440x360.
	assertEquals(
		mockCover("photo-1519085360753-af0119f7cbe7", 1440, 360),
		"https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=1440&h=360&q=80",
	);
	// explore/fixtures.ts:29 + view-fixtures.ts:70 — the discovery corpus deliberately ships q=72.
	assertEquals(
		mockCover("1600880292203-757bb62b4baf", 900, 1100, 72),
		"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=900&h=1100&q=72",
	);
	// profile-fixtures.ts:60 — the profile cover deliberately ships q=75.
	assertEquals(
		mockCover("1600880292203-757bb62b4baf", 1200, 400, 75),
		"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1200&h=400&q=75",
	);
	// projects/board-fixtures.ts:271 — width-only, no height, q=60.
	assertEquals(
		mockCover("photo-1558655146-9f40138edfeb", 600, undefined, 60),
		"https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=600&q=60",
	);
});

Deno.test("unsplashUrl keeps parameter order stable so CDN cache keys survive", () => {
	// Order is auto, fit, facepad, w, h, q, crop. A semantically identical reordering would still
	// return an image while missing every warm cache entry, so the order is part of the contract.
	assertEquals(
		unsplashUrl("photo-1544005313-94ddf0286df2", { fit: "crop", w: 128, h: 128, crop: "faces" }),
		"https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=128&h=128&q=80&crop=faces",
	);
});
