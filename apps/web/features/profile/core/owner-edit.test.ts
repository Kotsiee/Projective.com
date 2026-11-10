import { assertEquals } from "@std/assert";
import {
	availabilityHrefFor,
	EDIT_ANCHORS,
	editAnchorsFor,
	editHrefFor,
	ownerEditFor,
} from "./owner-edit.ts";

const owned = { isOwner: true, follows: false };

Deno.test("each kind links only to the sections its editor draws", () => {
	assertEquals(editAnchorsFor("freelancer"), [...EDIT_ANCHORS]);
	assertEquals(editAnchorsFor("client"), [
		"showcase",
		"basics",
		"about",
		"location",
		"languages",
		"experience",
		"privacy",
	]);
	assertEquals(editAnchorsFor("team"), ["showcase", "basics", "about", "privacy"]);
	assertEquals(editAnchorsFor("business"), ["showcase", "basics", "about", "location", "privacy"]);
	assertEquals(editAnchorsFor("enterprise"), ["showcase", "basics", "location", "privacy"]);
});

Deno.test("a visitor gets no links at all", () => {
	const visitor = ownerEditFor(
		{ handle: "@mari", kind: "freelancer", viewer: { isOwner: false, follows: false } },
		{ scheduling: true },
	);
	assertEquals(visitor, null);
	assertEquals(ownerEditFor({ handle: "@mari", kind: "freelancer" }, { scheduling: true }), null);
	assertEquals(editHrefFor(visitor, "about"), null);
	assertEquals(availabilityHrefFor(visitor), null);
});

Deno.test("an owner's links land on the editor's anchors under the canonical @handle", () => {
	const edit = ownerEditFor({ handle: "mari", kind: "freelancer", viewer: owned }, {
		scheduling: true,
	});
	assertEquals(editHrefFor(edit, "skills"), "/@mari/edit#skills");
	assertEquals(editHrefFor(edit, "showcase"), "/@mari/edit#showcase");
	assertEquals(availabilityHrefFor(edit), "/@mari/edit/availability");
});

Deno.test("a missing section and an under-18 owner's hours have no link", () => {
	const team = ownerEditFor({ handle: "@studio", kind: "team", viewer: owned }, {
		scheduling: true,
	});
	assertEquals(editHrefFor(team, "skills"), null);
	assertEquals(editHrefFor(team, "location"), null);
	const minor = ownerEditFor({ handle: "@kim", kind: "client", viewer: owned }, {
		scheduling: false,
	});
	assertEquals(availabilityHrefFor(minor), null);
	assertEquals(editHrefFor(minor, "languages"), "/@kim/edit#languages");
});
