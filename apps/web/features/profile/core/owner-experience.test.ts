import { assertEquals } from "@std/assert";
import type { ProfileEditModel } from "@projective/types/profile";
import { blockPatch } from "./edit-model.ts";
import {
	appendIndex,
	blankDraft,
	draftOfRow,
	entriesOf,
	logosOf,
	removeRowPatch,
	rowErrors,
	saveRowPatch,
} from "./owner-experience.ts";

const ROLE_A = "11111111-1111-4111-8111-111111111111";
const ROLE_B = "22222222-2222-4222-8222-222222222222";
const CERT = "33333333-3333-4333-8333-333333333333";

function model(): ProfileEditModel {
	return {
		handle: "@mari",
		kind: "freelancer",
		ownerType: "user",
		firstName: "Mari",
		lastName: "Delacroix",
		name: "",
		headline: "Brand designer",
		story: "",
		city: "Lyon",
		country: "France",
		timezone: "Europe/Paris",
		visibility: "public",
		languages: [{ code: "FR", level: "native" }],
		skills: ["branding"],
		experience: [
			{
				id: ROLE_A,
				orgName: "Atelier",
				role: "Lead",
				startYear: "2020",
				endYear: null,
				isCurrent: true,
				summary: "",
			},
			{
				id: ROLE_B,
				orgName: "Nova",
				role: "Designer",
				startYear: "2016",
				endYear: "2020",
				isCurrent: false,
				summary: "x",
			},
		],
		education: [],
		certifications: [{
			id: CERT,
			name: "UX",
			issuer: "NN/g",
			issuedYear: "2021",
			expiresYear: null,
			credentialUrl: null,
			verified: true,
		}],
		settings: { allowAvatarExpand: false, showLocation: true, showLocalTime: true },
		avatar: null,
		showcase: [],
		sections: {
			identity: true,
			about: true,
			languages: true,
			skills: true,
			experience: true,
			location: true,
			visibility: true,
		},
	};
}

Deno.test("a block sends only the field it changed", () => {
	assertEquals(blockPatch(model(), { headline: "Brand designer" }), {});
	assertEquals(blockPatch(model(), { headline: "Identity designer" }), {
		headline: "Identity designer",
	});
	assertEquals(blockPatch(model(), { city: " Paris " }), { city: "Paris" });
});

Deno.test("a block outside the kind's sections sends nothing", () => {
	const team = { ...model(), kind: "team" as const, ownerType: "team" as const };
	team.sections = { ...team.sections, skills: false };
	assertEquals(blockPatch(team, { skills: ["x"] }), {});
});

Deno.test("the visitor's rows come from the stored model, with the read's logos", () => {
	const entries = entriesOf(
		model(),
		logosOf({
			experience: [{
				id: ROLE_A,
				org: "Atelier",
				role: "Lead",
				start: "2020",
				summary: "",
				logo: "/a.png",
			}],
			education: [],
			certifications: [],
		}),
	);
	assertEquals(entries.experience[0], {
		id: ROLE_A,
		org: "Atelier",
		role: "Lead",
		start: "2020",
		end: undefined,
		current: true,
		summary: "",
		logo: "/a.png",
	});
	assertEquals(entries.experience[1].end, "2020");
	assertEquals(entries.certifications[0].verified, true);
});

Deno.test("editing one row sends the whole list with the row replaced in place", () => {
	const patch = saveRowPatch(model(), {
		ledger: "experience",
		row: {
			orgName: "Nova",
			role: "Senior designer",
			startYear: "2016",
			endYear: "2020",
			isCurrent: false,
			summary: "x",
		},
	}, ROLE_B);
	assertEquals(patch.experience?.map((e) => [e.id, e.role]), [[ROLE_A, "Lead"], [
		ROLE_B,
		"Senior designer",
	]]);
});

Deno.test("adding appends a row with no id, at the index a refusal will name", () => {
	const m = model();
	const blank = blankDraft("experience");
	if (blank.ledger !== "experience") throw new Error("blank draft ledger");
	const patch = saveRowPatch(m, {
		ledger: "experience",
		row: { ...blank.row, orgName: "Fern", role: "Founder", startYear: "2024" },
	}, null);
	assertEquals(patch.experience?.length, 3);
	assertEquals(patch.experience?.[2].id, undefined);
	assertEquals(appendIndex(m, "experience"), 2);
});

Deno.test("removing drops the row and keeps the platform's verified claim off the wire", () => {
	assertEquals(removeRowPatch(model(), "experience", ROLE_A).experience?.map((e) => e.id), [
		ROLE_B,
	]);
	const found = draftOfRow(model(), "certifications", CERT);
	if (found?.draft.ledger !== "certifications") throw new Error("certification not found");
	const certs = saveRowPatch(model(), {
		ledger: "certifications",
		row: { ...found.draft.row, name: "UX Cert" },
	}, CERT);
	assertEquals("verified" in (certs.certifications?.[0] ?? {}), false);
});

Deno.test("a refusal is re-keyed to the row's own fields", () => {
	assertEquals(
		rowErrors(
			{ "experience.1.role": "Too long", "experience.1": "Check it", "education.1.school": "x" },
			"experience",
			1,
		),
		{ role: "Too long", form: "Check it" },
	);
	assertEquals(rowErrors({ experience: "Up to 30 roles" }, "experience", 4), {
		form: "Up to 30 roles",
	});
});
