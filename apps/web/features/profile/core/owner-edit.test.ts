import { assertEquals } from "@std/assert";
import {
	anchorOfHash,
	canEditBlock,
	EDIT_ANCHORS,
	editAnchorsFor,
	ownerBlockHref,
	ownerEditFor,
} from "./owner-edit.ts";

const owned = { isOwner: true, follows: false };
const scheduling = { scheduling: true };

Deno.test("each kind offers only the blocks its save path takes", () => {
	assertEquals(editAnchorsFor("freelancer", scheduling), [...EDIT_ANCHORS]);
	assertEquals(editAnchorsFor("client", scheduling), [
		"showcase",
		"basics",
		"about",
		"location",
		"availability",
		"languages",
		"experience",
	]);
	assertEquals(editAnchorsFor("team", scheduling), ["showcase", "basics", "about", "availability"]);
	assertEquals(editAnchorsFor("business", scheduling), [
		"showcase",
		"basics",
		"about",
		"location",
		"availability",
	]);
	assertEquals(editAnchorsFor("enterprise", scheduling), [
		"showcase",
		"basics",
		"location",
		"availability",
	]);
});

Deno.test("an under-18 owner has no availability block", () => {
	assertEquals(editAnchorsFor("client", { scheduling: false }).includes("availability"), false);
});

Deno.test("a visitor may edit nothing", () => {
	const visitor = ownerEditFor(
		{ handle: "@mari", kind: "freelancer", viewer: { isOwner: false, follows: false } },
		scheduling,
	);
	assertEquals(visitor, null);
	assertEquals(ownerEditFor({ handle: "@mari", kind: "freelancer" }, scheduling), null);
	assertEquals(canEditBlock(visitor, "about"), false);
});

Deno.test("an owner's rights carry the canonical @handle and the kind's blocks", () => {
	const edit = ownerEditFor({ handle: "mari", kind: "freelancer", viewer: owned }, scheduling);
	assertEquals(edit?.handle, "@mari");
	assertEquals(canEditBlock(edit, "work"), true);
	const team = ownerEditFor({ handle: "@studio", kind: "team", viewer: owned }, scheduling);
	assertEquals(canEditBlock(team, "skills"), false);
	assertEquals(canEditBlock(team, "location"), false);
});

Deno.test("a hash names a block only when it is one", () => {
	assertEquals(anchorOfHash("#skills"), "skills");
	assertEquals(anchorOfHash("availability"), "availability");
	assertEquals(anchorOfHash("#privacy"), null);
	assertEquals(anchorOfHash(""), null);
});

Deno.test("a block's address opens it on the owner's page", () => {
	assertEquals(ownerBlockHref("mari", "about"), "/@mari#about");
	assertEquals(ownerBlockHref("@mari", "availability"), "/@mari#availability");
	assertEquals(ownerBlockHref("mari", "experience"), "/@mari/experience#experience");
});
