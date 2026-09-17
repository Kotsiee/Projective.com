import { assertEquals } from "@std/assert";
import type { ProfileShowcase, ProfileShowcaseItem } from "../types/profile-types.ts";
import {
	advancePlan,
	dampedDrag,
	resolveSwipe,
	rovingFocusFor,
	SHOWCASE_DWELL_MS,
	slidesOf,
	withPrimaryImage,
	wrapIndex,
} from "./showcase-model.ts";

const still = (src: string): ProfileShowcaseItem => ({ kind: "image", src, alt: src });
const reel: ProfileShowcaseItem = { kind: "video", src: "reel.mp4", poster: "p.jpg", alt: "reel" };
const showcase: ProfileShowcase = {
	primary: { kind: "image", src: "cover.jpg", alt: "cover" },
	extras: [reel, still("a.jpg")],
};

Deno.test("slidesOf leads with the primary and keeps the extras in order", () => {
	assertEquals(slidesOf(null), []);
	assertEquals(slidesOf(showcase).map((s) => s.src), ["cover.jpg", "reel.mp4", "a.jpg"]);
});

Deno.test("withPrimaryImage replaces only the lead still, and mints a set from nothing", () => {
	assertEquals(withPrimaryImage(showcase, null, "x"), showcase);
	const edited = withPrimaryImage(showcase, "new.jpg", "Ivy — showcase");
	assertEquals(edited?.primary, { kind: "image", src: "new.jpg", alt: "cover" });
	assertEquals(edited?.extras, showcase.extras);
	assertEquals(withPrimaryImage(null, "new.jpg", "Ivy — showcase"), {
		primary: { kind: "image", src: "new.jpg", alt: "Ivy — showcase" },
		extras: [],
	});
});

Deno.test("wrapIndex wraps both ways and tolerates an empty set", () => {
	assertEquals(wrapIndex(3, 3), 0);
	assertEquals(wrapIndex(-1, 3), 2);
	assertEquals(wrapIndex(7, 3), 1);
	assertEquals(wrapIndex(0, 0), 0);
});

Deno.test("rovingFocusFor steps and wraps the focused dot without selecting", () => {
	assertEquals(rovingFocusFor("ArrowRight", 2, 3), 0);
	assertEquals(rovingFocusFor("ArrowLeft", 0, 3), 2);
	assertEquals(rovingFocusFor("Home", 2, 3), 0);
	assertEquals(rovingFocusFor("End", 0, 3), 2);
	assertEquals(rovingFocusFor("Enter", 1, 3), null);
});

Deno.test("resolveSwipe commits on distance or a flick, and flips under RTL", () => {
	// A slow, short drag snaps back.
	assertEquals(resolveSwipe(-40, 600, 0.1), 0);
	// Distance commits: 18% of 600 is 108px.
	assertEquals(resolveSwipe(-120, 600, 0.1), 1);
	assertEquals(resolveSwipe(120, 600, 0.1), -1);
	// A flick commits on a short travel, but not on a twitch.
	assertEquals(resolveSwipe(-30, 600, 0.9), 1);
	assertEquals(resolveSwipe(-10, 600, 0.9), 0);
	// The same physical drag reveals the PREVIOUS slide when the slides run right-to-left.
	assertEquals(resolveSwipe(-120, 600, 0.1, true), -1);
	assertEquals(resolveSwipe(120, 600, 0.1, true), 1);
});

Deno.test("dampedDrag resists only past the ends, direction-aware", () => {
	// Mid-set: full travel both ways.
	assertEquals(dampedDrag(-50, 1, 3), -50);
	assertEquals(dampedDrag(50, 1, 3), 50);
	// First slide: dragging right (revealing a previous that does not exist) is damped.
	assertEquals(dampedDrag(50, 0, 3), 15);
	assertEquals(dampedDrag(-50, 0, 3), -50);
	// Last slide: dragging left is damped.
	assertEquals(dampedDrag(-50, 2, 3), -15);
	// RTL mirrors which edge each direction hits.
	assertEquals(dampedDrag(-50, 0, 3, true), -15);
	assertEquals(dampedDrag(50, 2, 3, true), 15);
});

Deno.test("advancePlan dwells on a still, waits on a playing video, holds after it ends", () => {
	const base = { count: 3, paused: false, reduced: false, videoEnded: false };
	assertEquals(advancePlan({ ...base, slide: still("a") }), {
		kind: "dwell",
		ms: SHOWCASE_DWELL_MS,
	});
	assertEquals(advancePlan({ ...base, slide: reel }), { kind: "await-video" });
	assertEquals(advancePlan({ ...base, slide: reel, videoEnded: true }), {
		kind: "dwell",
		ms: SHOWCASE_DWELL_MS,
	});
	// Nothing to advance to, nothing to arm.
	assertEquals(advancePlan({ ...base, slide: still("a"), count: 1 }), { kind: "none" });
	// A read slide is not taken away; a reduced-motion viewer never sees one move on its own.
	assertEquals(advancePlan({ ...base, slide: still("a"), paused: true }), { kind: "none" });
	assertEquals(advancePlan({ ...base, slide: still("a"), reduced: true }), { kind: "none" });
	assertEquals(advancePlan({ ...base, slide: undefined }), { kind: "none" });
});
