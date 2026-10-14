import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	type ListingOffer,
	ListingOfferSchema,
	type OneOffOffer,
	type PipelineOffer,
} from "@projective/types/catalogue";
import {
	addAttachments,
	addItem,
	attachmentOf,
	bytesLabel,
	checklistKey,
	cleanLines,
	deliveryLabel,
	formatLabel,
	insertItem,
	moveItem,
	nearestStop,
	newMilestone,
	newTeamRole,
	offerProblem,
	problemRow,
	sanitiseOffer,
	SCOPE_MAX,
	switchSessionFormat,
} from "./offer-model.ts";

const ONE_OFF: OneOffOffer = {
	archetype: "one_off",
	milestones: [newMilestone(1, "Milestone")],
	turnaroundDays: 5,
	scope: ["Two logo concepts", "", "  Source files  "],
	teamRoles: [],
};

Deno.test("list ops respect caps and leave out-of-range moves alone", () => {
	const list = ["a", "b", "c"];
	assertStrictEquals(addItem(list, "d", 3), list);
	assertEquals(addItem(list, "d", 4), ["a", "b", "c", "d"]);
	assertEquals(insertItem(list, 1, "x", 4), ["a", "x", "b", "c"]);
	assertEquals(moveItem(list, 0, 2), ["b", "c", "a"]);
	assertEquals(moveItem(list, 2, 0), ["c", "a", "b"]);
	assertStrictEquals(moveItem(list, 0, 5), list);
});

Deno.test("checklist: Enter opens a row below, Backspace on an empty row removes it", () => {
	assertEquals(checklistKey(["a", "b"], 0, "Enter", SCOPE_MAX), {
		lines: ["a", "", "b"],
		focus: 1,
	});
	assertEquals(checklistKey(["a", "", "b"], 1, "Backspace", SCOPE_MAX), {
		lines: ["a", "b"],
		focus: 0,
	});
	assertEquals(
		checklistKey(["a"], 0, "Backspace", SCOPE_MAX),
		null,
		"a filled row keeps Backspace",
	);
	assertEquals(checklistKey([""], 0, "Backspace", SCOPE_MAX), null, "the last row stays");
	assertEquals(checklistKey(["a", "b"], 1, "Enter", 2), null, "a full list opens no row");
	assertEquals(checklistKey(["a"], 0, "x", SCOPE_MAX), null);
});

Deno.test("sanitiseOffer drops empty rows and trims, and the result parses", () => {
	const clean = sanitiseOffer(ONE_OFF);
	assert(clean.archetype === "one_off");
	assertEquals(clean.scope, ["Two logo concepts", "Source files"]);
	assert(ListingOfferSchema.safeParse(clean).success);
	assertEquals(cleanLines(["  ", "x "]), ["x"]);
});

Deno.test("offerProblem names an unnamed milestone, stage or role in its own words", () => {
	const unnamedMilestone: OneOffOffer = {
		...ONE_OFF,
		milestones: [newMilestone(1, "Milestone"), { ...newMilestone(2, "Milestone"), name: "  " }],
	};
	assertEquals(offerProblem(unnamedMilestone), {
		path: "milestones.1.name",
		message: "Name milestone 2.",
	});
	const pipeline: PipelineOffer = {
		archetype: "pipeline",
		stages: [newMilestone(1, "Stage")],
		teamRoles: [{ ...newTeamRole(1), name: "" }],
	};
	assertEquals(offerProblem(pipeline)?.path, "teamRoles.0.name");
	assertEquals(offerProblem(ONE_OFF), null);
});

Deno.test("problemRow places a problem on its row", () => {
	const problem = { path: "milestones.1.name", message: "Name milestone 2." };
	assertEquals(problemRow(problem, "milestones"), { index: 1, message: "Name milestone 2." });
	assertEquals(problemRow(problem, "teamRoles"), null);
	assertEquals(problemRow(null, "milestones"), null);
});

Deno.test("offerProblem falls back to the schema for anything else", () => {
	const tooLong: ListingOffer = { ...ONE_OFF, turnaroundDays: 400 };
	assertEquals(offerProblem(tooLong)?.path, "turnaroundDays");
});

Deno.test("deliveryLabel follows the offer and stays silent where the offer decides nothing", () => {
	assertEquals(deliveryLabel(ONE_OFF), "5-day delivery");
	assertEquals(deliveryLabel({ ...ONE_OFF, turnaroundDays: null }), null);
	assertEquals(
		deliveryLabel({ archetype: "session", minutes: 45, count: 1, meetingProvider: null }),
		"45-minute session",
	);
	assertEquals(deliveryLabel({ archetype: "pipeline", stages: [], teamRoles: [] }), null);
});

Deno.test("switchSessionFormat keeps the sitting and adds or drops the cohort facts", () => {
	const session = { archetype: "session", minutes: 90, count: 4, meetingProvider: "zoom" } as const;
	const cohort = switchSessionFormat(session, "cohort");
	assertEquals(cohort, {
		archetype: "cohort",
		minutes: 90,
		count: 4,
		meetingProvider: "zoom",
		maxSeatsPerCohort: 10,
		continuousEnrollment: false,
	});
	assertEquals(switchSessionFormat(cohort, "session"), session);
	assert(ListingOfferSchema.safeParse(cohort).success);
});

Deno.test("nearestStop snaps a stored turnaround onto the slider's stops", () => {
	assertEquals(nearestStop(4), 3);
	assertEquals(nearestStop(6), 5);
	assertEquals(nearestStop(90), 30);
	assertEquals(nearestStop(14), 14);
});

Deno.test("attachments: one row per file, extension-derived labels, uuid-only file ids", () => {
	const zip = attachmentOf({
		id: "0b5f7c62-8e3b-4bd2-9f53-1f2b8a7c9d10",
		name: "Brand kit",
		ext: "ZIP",
		sizeBytes: 2_516_582,
	});
	assertEquals(zip, {
		name: "Brand kit",
		label: "ZIP archive",
		extension: ".zip",
		bytes: 2_516_582,
		fileId: "0b5f7c62-8e3b-4bd2-9f53-1f2b8a7c9d10",
	});
	const fixture = attachmentOf({ id: "asset-7", name: "Notes", ext: "md", sizeBytes: 10 });
	assertEquals(fixture?.fileId, undefined);
	assertEquals(attachmentOf({ id: "x", name: "Link", ext: "", sizeBytes: 0 }), null);
	assertEquals(formatLabel(".psd"), "Photoshop document");
	assertEquals(formatLabel("xyz"), "XYZ file");
	const list = addAttachments([], [zip!, zip!, fixture!], 2);
	assertEquals(list.length, 2);
	assertEquals(addAttachments(list, [fixture!], 24).length, 2);
	assertEquals(bytesLabel(2_516_582), "2.4 MB");
	assertEquals(bytesLabel(512), "512 B");
});
