import { assertEquals } from "@std/assert";
import type { ProfileEditModel } from "@projective/types/profile";
import { draftOf, errorFor, errorsFromIssues, isDirty, patchOf } from "./edit-model.ts";

const SECTIONS = {
	identity: true,
	about: true,
	languages: true,
	skills: true,
	experience: true,
	location: true,
	visibility: true,
};

function model(): ProfileEditModel {
	return {
		handle: "@ada",
		kind: "freelancer",
		ownerType: "user",
		firstName: "Ada",
		lastName: "Lovelace",
		name: "",
		headline: "Engines",
		story: "Notes.",
		city: "London",
		country: "UK",
		timezone: "Europe/London",
		visibility: "public",
		languages: [{ code: "EN", level: "native" }],
		skills: ["Mathematics"],
		experience: [{
			id: "8a8b2d8e-2f7a-4cbc-9a5f-8a4f7d1f0c11",
			orgName: "Analytical Engine",
			role: "Programmer",
			startYear: "1842",
			endYear: null,
			isCurrent: true,
			summary: "",
		}],
		education: [],
		certifications: [{
			id: "0b8e7c1d-5a86-4bde-8a9f-3c3f5e5d7a22",
			name: "Cert",
			issuer: "Body",
			issuedYear: "2020",
			expiresYear: null,
			credentialUrl: null,
			verified: true,
		}],
		settings: { allowAvatarExpand: false, showLocation: true, showLocalTime: true },
		avatar: null,
		showcase: [],
		sections: SECTIONS,
	};
}

Deno.test("an untouched draft sends nothing", () => {
	const base = draftOf(model());
	assertEquals(patchOf(base, draftOf(model()), SECTIONS, true), {});
	assertEquals(isDirty(base, draftOf(model()), SECTIONS, true), false);
});

Deno.test("only the changed fields and sections travel", () => {
	const base = draftOf(model());
	const draft = { ...base, headline: " Analytical engines ", skills: ["Mathematics", " Poetry "] };
	assertEquals(patchOf(base, draft, SECTIONS, true), {
		headline: "Analytical engines",
		skills: ["Mathematics", "Poetry"],
	});
});

Deno.test("a current role drops its end year, and verification never travels", () => {
	const base = draftOf(model());
	const draft = {
		...base,
		experience: base.experience.map((e) => ({ ...e, endYear: "1843" })),
		certifications: base.certifications.map((c) => ({ ...c, name: "Cert II" })),
	};
	const patch = patchOf(base, draft, SECTIONS, true);
	assertEquals(patch.experience?.[0].endYear, null);
	assertEquals("verified" in (patch.certifications?.[0] ?? {}), false);
	assertEquals(patch.certifications?.[0].name, "Cert II");
});

Deno.test("an entity edits its name, never first/last", () => {
	const base = draftOf({ ...model(), ownerType: "team", name: "Crew" });
	const draft = { ...base, name: "Crew Two", firstName: "Ignored" };
	assertEquals(patchOf(base, draft, SECTIONS, false), { name: "Crew Two" });
});

Deno.test("a section this kind cannot edit is never sent", () => {
	const base = draftOf(model());
	const draft = { ...base, skills: ["New"] };
	assertEquals(patchOf(base, draft, { ...SECTIONS, skills: false }, true), {});
});

Deno.test("errors resolve by field, then by row", () => {
	const errors = errorsFromIssues([
		{ path: ["experience", 0, "startYear"], message: "Use a four-digit year." },
		{ path: ["certifications", 1], message: "Check the link." },
	]);
	assertEquals(errorFor(errors, "experience.0.startYear"), "Use a four-digit year.");
	assertEquals(errorFor(errors, "certifications.1.credentialUrl"), "Check the link.");
	assertEquals(errorFor(errors, "experience.1.role"), undefined);
});
