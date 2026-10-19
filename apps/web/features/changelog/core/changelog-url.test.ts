import { assertEquals } from "@std/assert";
import {
	feedHref,
	parseFeedQuery,
	readVersionSegment,
	releaseAnchorId,
	releaseFeedHref,
	releasePath,
	toggleCategoryHref,
} from "./changelog-url.ts";
import { formatImageParam, parseImageParam, withImageParam } from "./image-param.ts";

const at = (search: string) =>
	parseFeedQuery(new URL(`https://projective.test/changelog${search}`));

// #region Anchors & paths
Deno.test("a release's anchor is v + its version with dashes", () => {
	assertEquals(releaseAnchorId("0.12.0"), "v0-12-0");
	assertEquals(releaseAnchorId("1.0.0-rc.1"), "v1-0-0-rc-1");
	assertEquals(releaseAnchorId("2.10.3-beta-2.7"), "v2-10-3-beta-2-7");
	assertEquals(releasePath("0.12.0"), "/changelog/0.12.0");
	assertEquals(releaseFeedHref("0.12.0"), "/changelog#v0-12-0");
});

Deno.test("anchor ids are valid lower-case kebab anchors", () => {
	for (const version of ["0.1.0", "10.20.30", "1.0.0-alpha.beta.1"]) {
		assertEquals(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(releaseAnchorId(version)), true, version);
	}
});

Deno.test("a version segment: canonical as written, a leading v or upper case redirects", () => {
	assertEquals(readVersionSegment("0.12.0"), { version: "0.12.0", canonical: true });
	assertEquals(readVersionSegment("v0.12.0"), { version: "0.12.0", canonical: false });
	assertEquals(readVersionSegment("V1.0.0-RC.1"), { version: "1.0.0-rc.1", canonical: false });
	assertEquals(readVersionSegment("%76%30.1.0"), { version: "0.1.0", canonical: false });
});

Deno.test("a segment that is not a version is null (a 404, not a redirect)", () => {
	for (const bad of ["rss.xml", "0.12", "01.0.0", "latest", "", "%E0%A4%A", "1.0.0-"]) {
		assertEquals(readVersionSegment(bad), null, bad);
	}
	assertEquals(readVersionSegment(`1.0.0-${"a".repeat(64)}`), null);
});
// #endregion

// #region The feed query (the category filter and pagination)
Deno.test("the bare feed is canonical: no filter, page 1", () => {
	assertEquals(at(""), { categories: [], page: 1, redirect: null });
});

Deno.test("categories are a repeatable parameter, kept in filter order", () => {
	assertEquals(at("?category=escrow&category=ux"), {
		categories: ["escrow", "ux"],
		page: 1,
		redirect: null,
	});
	assertEquals(
		at("?category=ux&category=escrow").redirect,
		"/changelog?category=escrow&category=ux",
	);
	assertEquals(at("?category=ux&category=escrow").categories, ["escrow", "ux"]);
});

Deno.test("unknown, repeated and upper-case categories redirect to the canonical filter", () => {
	assertEquals(at("?category=gossip").redirect, "/changelog");
	assertEquals(at("?category=gossip").categories, []);
	assertEquals(at("?category=ux&category=ux").redirect, "/changelog?category=ux");
	assertEquals(at("?category=UX").redirect, "/changelog?category=ux");
});

Deno.test("page: 2 and up are canonical; 1, malformed and repeated pages redirect", () => {
	assertEquals(at("?page=2"), { categories: [], page: 2, redirect: null });
	for (const bad of ["?page=1", "?page=0", "?page=02", "?page=abc", "?page=-1", "?page=2&page=3"]) {
		assertEquals(at(bad).redirect, "/changelog", bad);
		assertEquals(at(bad).page, 1, bad);
	}
	assertEquals(at("?page=2&category=ux").redirect, "/changelog?category=ux&page=2");
	assertEquals(at("?category=ux&page=2").redirect, null);
});

Deno.test("parameters the feed does not own are kept, and never cause a redirect", () => {
	assertEquals(at("?image=v0-1-0:1").redirect, null);
	assertEquals(at("?utm_source=a%20b").redirect, null);
	assertEquals(at("?image=v0-1-0:1&page=1").redirect, "/changelog?image=v0-1-0:1");
});

Deno.test("feed hrefs: canonical order, page 1 implied", () => {
	assertEquals(feedHref([]), "/changelog");
	assertEquals(feedHref(["ux", "escrow"]), "/changelog?category=escrow&category=ux");
	assertEquals(feedHref(["ux"], 3), "/changelog?category=ux&page=3");
	assertEquals(feedHref([], 2), "/changelog?page=2");
});

Deno.test("a filter chip toggles its category and restarts at page 1", () => {
	assertEquals(toggleCategoryHref([], "ux"), "/changelog?category=ux");
	assertEquals(toggleCategoryHref(["ux"], "escrow"), "/changelog?category=escrow&category=ux");
	assertEquals(toggleCategoryHref(["escrow", "ux"], "ux"), "/changelog?category=escrow");
	assertEquals(toggleCategoryHref(["ux"], "ux"), "/changelog");
});
// #endregion

// #region The lightbox address
Deno.test("?image=<entry>:<n> parses and formats", () => {
	assertEquals(parseImageParam("v0-12-0:2"), { entry: "v0-12-0", index: 2 });
	assertEquals(formatImageParam("v0-12-0", 2), "v0-12-0:2");
	for (
		const bad of [null, "", "v0-12-0", "v0-12-0:0", "v0-12-0:x", "0-12-0:1", "v0-12-0:01", "V0:1"]
	) {
		assertEquals(parseImageParam(bad), null, String(bad));
	}
});

Deno.test("setting the image keeps every other parameter and the fragment", () => {
	assertEquals(withImageParam("/changelog", "v0-1-0:1"), "/changelog?image=v0-1-0:1");
	assertEquals(
		withImageParam("/changelog?category=ux&page=2#v0-1-0", "v0-1-0:2"),
		"/changelog?category=ux&page=2&image=v0-1-0:2#v0-1-0",
	);
	assertEquals(
		withImageParam("/changelog?image=v0-1-0:1&page=2", "v0-1-0:3"),
		"/changelog?image=v0-1-0:3&page=2",
	);
});

Deno.test("clearing the image removes only it", () => {
	assertEquals(withImageParam("/changelog?image=v0-1-0:1", null), "/changelog");
	assertEquals(
		withImageParam("/changelog?page=2&image=v0-1-0:1#v0-1-0", null),
		"/changelog?page=2#v0-1-0",
	);
	assertEquals(withImageParam("/changelog/0.1.0", null), "/changelog/0.1.0");
});
// #endregion
