import { assertEquals, assertStrictEquals } from "@std/assert";
import { ProfileViewSchema } from "@projective/types/profile";
import { mapProfileView, type RawProfile, type RawRoster, rosterOf } from "./live-profile.ts";

/**
 * live-profile_test — the profile document's mapping onto the `ProfileView` SSOT for a business
 * (BP1, Decision #244): the member-facing facts are the viewer's own seat's, a Message reaches the
 * owner, a buyer carries no Standing and no adornments, and no other kind grows the new fields.
 */

// #region Fixtures
/** A raw `org.get_profile_view` document, as the RPC returns it for `kind`. */
function raw(overrides: Partial<RawProfile> = {}): RawProfile {
	return {
		owner_type: "business",
		owner_id: "00000000-0000-4000-8000-000000000001",
		kind: "business",
		handle: "atlaslabs",
		name: "Atlas Labs",
		headline: "",
		bio: { text: "We commission product work." },
		visibility: "public",
		city: "Lagos",
		country: "NG",
		timezone: "Africa/Lagos",
		language_names: [],
		languages: [],
		skills: [],
		avatar: null,
		banner: null,
		member_since: "2026-01-01T00:00:00Z",
		rating: { as_helper: { value: 0, count: 0 }, as_client: { value: "5.00", count: 1 } },
		verified: false,
		verification_stamp: "none",
		hire_intake: [],
		viewer_is_owner: false,
		viewer_follows: false,
		followers: 0,
		following: 0,
		showcase: [],
		settings: null,
		completed_stages: 0,
		standing: null,
		architect: false,
		adornments: [],
		hours: null,
		free_consultation: false,
		...overrides,
	};
}
// #endregion

// #region Business facts
Deno.test("mapProfileView — a business editor's facts: console + settings hrefs, the reason, the owner", () => {
	const view = mapProfileView(raw({
		visibility: "invite_only",
		viewer_is_owner: true,
		workspace: { hidden_reason: "invite_only", viewer_edits: true, viewer_settings: true },
		contact: { handle: "danielokafor", name: "Daniel Okafor" },
	}));
	assertEquals(view.workspace, {
		hiddenReason: "invite_only",
		consoleHref: "/businesses/atlaslabs",
		settingsHref: "/businesses/atlaslabs/settings",
	});
	assertEquals(view.messageTo, { handle: "@danielokafor", name: "Daniel Okafor" });
	assertStrictEquals(view.visibility, "private");
	assertStrictEquals(ProfileViewSchema.safeParse(view).success, true);
});

Deno.test("mapProfileView — a stranger on a business holds no doors and is told nothing", () => {
	const view = mapProfileView(raw({
		workspace: { hidden_reason: null, viewer_edits: false, viewer_settings: false },
		contact: { handle: "danielokafor", name: null },
	}));
	assertEquals(view.workspace, { hiddenReason: null, consoleHref: null, settingsHref: null });
	// A nameless owner is addressed by their handle.
	assertEquals(view.messageTo, { handle: "@danielokafor", name: "danielokafor" });
	assertStrictEquals(view.visibility, "public");
});

Deno.test("mapProfileView — an unknown hidden reason reads as none, a missing owner as no target", () => {
	const view = mapProfileView(raw({
		workspace: { hidden_reason: "suspended", viewer_edits: false, viewer_settings: true },
		contact: { handle: null, name: null },
	}));
	assertStrictEquals(view.workspace?.hiddenReason, null);
	assertStrictEquals(view.workspace?.settingsHref, "/businesses/atlaslabs/settings");
	assertStrictEquals(view.messageTo, undefined);
});

Deno.test("mapProfileView — a business carries no Standing and no adornments, whatever the read says", () => {
	const view = mapProfileView(raw({
		standing: { level: 3, label: "Trusted" },
		adornments: ["top_rated"],
		verified: true,
		verification_stamp: "corporate_verified",
	}));
	assertStrictEquals(view.stats.standing, null);
	assertEquals(view.adornments, []);
	assertStrictEquals(view.verificationStamp, "corporate_verified");
	assertEquals(view.rating.asClient, { value: 5, count: 1 });
});
// #endregion

// #region Other kinds unchanged
Deno.test("mapProfileView — a freelancer and a team grow no workspace facts and no message target", () => {
	const freelancer = mapProfileView(raw({
		owner_type: "user",
		kind: "freelancer",
		handle: "marisdelacroix",
		workspace: { hidden_reason: "draft", viewer_edits: true, viewer_settings: true },
		contact: { handle: "someone", name: "Someone" },
	}));
	assertStrictEquals(freelancer.workspace, undefined);
	assertStrictEquals(freelancer.messageTo, undefined);

	const team = mapProfileView(raw({ owner_type: "team", kind: "team", handle: "northloop" }));
	assertStrictEquals(team.workspace, undefined);
	assertStrictEquals(team.messageTo, undefined);
});

Deno.test("mapProfileView — only a business's invite_only reads as private; a team's reads as before", () => {
	assertStrictEquals(mapProfileView(raw({ visibility: "invite_only" })).visibility, "private");
	const team = mapProfileView(raw({
		owner_type: "team",
		kind: "team",
		handle: "northloop",
		visibility: "invite_only",
	}));
	// A team's own scale is Teams P1's to map; until then it reads exactly as it did before BP1.
	assertStrictEquals(team.visibility, "public");
});
// #endregion

// #region Roster
Deno.test("rosterOf — a business row carries since; a row without one carries none", () => {
	const doc: RawRoster = {
		departments: [],
		members: [
			{
				handle: "danielokafor",
				name: "Daniel Okafor",
				avatar: null,
				role: "CTO",
				since: "2026-02-19T14:14:10.589473+00:00",
				is_freelancer: false,
				departments: [],
			},
			{
				handle: "kwamemensah",
				name: null,
				avatar: null,
				role: null,
				is_freelancer: true,
				departments: [],
			},
		],
	};
	const { members } = rosterOf(doc);
	assertStrictEquals(members[0].since, "2026-02-19T14:14:10.589473+00:00");
	assertStrictEquals(members[0].role, "CTO");
	assertStrictEquals("since" in members[1], false);
	assertStrictEquals(members[1].role, "Member");
	assertStrictEquals(members[1].name, "kwamemensah");
});
// #endregion
