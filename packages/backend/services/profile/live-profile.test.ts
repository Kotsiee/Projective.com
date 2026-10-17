import { assertEquals, assertStrictEquals } from "@std/assert";
import { ProfileViewSchema } from "@projective/types/profile";
import {
	mapProfileView,
	type RawProfile,
	type RawRoster,
	rosterOf,
	standingFactorsOf,
	visibilityOf,
} from "./live-profile.ts";

/**
 * live-profile_test — the profile document's mapping onto the `ProfileView` SSOT for a business
 * (BP1, Decision #244): the member-facing facts are the viewer's own seat's, a Message reaches the
 * owner, a buyer carries no Standing and no adornments — and for a team (Teams P1): the same facts
 * with the team console's doors, a Message that reaches the owner, its Standing with the factors
 * behind it, and a public roster row of role · since · two skills. A person grows none of the
 * workspace fields.
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

// #region Team facts (Teams P1)
/** A raw team document — the seller arm of the same read. */
function teamRaw(overrides: Partial<RawProfile> = {}): RawProfile {
	return raw({
		owner_type: "team",
		kind: "team",
		handle: "northloop",
		name: "North Loop",
		rating: { as_helper: { value: "4.80", count: 1 }, as_client: { value: 0, count: 0 } },
		standing: { level: 1, label: "New" },
		...overrides,
	});
}

Deno.test("mapProfileView — a team editor's facts: Manage team + Settings hrefs and the reason", () => {
	const view = mapProfileView(teamRaw({
		viewer_is_owner: true,
		workspace: { hidden_reason: "draft", viewer_edits: true, viewer_settings: true },
		contact: { handle: "kwamemensah", name: "Kwame Mensah" },
	}));
	assertEquals(view.workspace, {
		hiddenReason: "draft",
		consoleHref: "/teams/northloop",
		settingsHref: "/teams/northloop/settings",
	});
	assertStrictEquals(ProfileViewSchema.safeParse(view).success, true);
});

Deno.test("mapProfileView — a team lead or member holds no doors; a stranger is told nothing", () => {
	const member = mapProfileView(teamRaw({
		workspace: { hidden_reason: "archived", viewer_edits: false, viewer_settings: false },
	}));
	assertEquals(member.workspace, {
		hiddenReason: "archived",
		consoleHref: null,
		settingsHref: null,
	});
	const stranger = mapProfileView(teamRaw({
		workspace: { hidden_reason: null, viewer_edits: false, viewer_settings: false },
	}));
	assertEquals(stranger.workspace, { hiddenReason: null, consoleHref: null, settingsHref: null });
});

Deno.test("mapProfileView — a team's Message reaches its owner; no owner on the read, no target", () => {
	// `dm-northloop` resolves nobody — a DM is person-to-person — so the owner is the recipient.
	const view = mapProfileView(
		teamRaw({ contact: { handle: "kwamemensah", name: "Kwame Mensah" } }),
	);
	assertEquals(view.messageTo, { handle: "@kwamemensah", name: "Kwame Mensah" });
	assertStrictEquals(mapProfileView(teamRaw({ contact: null })).messageTo, undefined);
	assertStrictEquals(mapProfileView(teamRaw()).messageTo, undefined);
});

Deno.test("mapProfileView — a team's and a business's invite_only read as private; a person's scale is its own", () => {
	assertStrictEquals(mapProfileView(raw({ visibility: "invite_only" })).visibility, "private");
	assertStrictEquals(mapProfileView(teamRaw({ visibility: "invite_only" })).visibility, "private");
	assertStrictEquals(mapProfileView(teamRaw({ visibility: "unlisted" })).visibility, "unlisted");
	assertStrictEquals(visibilityOf("private", "user"), "private");
	assertStrictEquals(visibilityOf("invite_only", "user"), "public");
});

Deno.test("mapProfileView — a team keeps its Standing, with the factors behind the rung", () => {
	const view = mapProfileView(teamRaw({
		standing: {
			level: 2,
			label: "Established",
			factors: {
				stages_completed: 4,
				completion_rate: "1.0000",
				on_time_rate: "0.7500",
				dispute_rate: "0.0000",
			},
		},
	}));
	assertEquals(view.stats.standing, {
		level: 2,
		label: "Established",
		factors: { stagesCompleted: 4, completionRate: 1, onTimeRate: 0.75, disputeRate: 0 },
	});
	assertStrictEquals(view.rating.asHelper?.count, 1);
	assertStrictEquals(ProfileViewSchema.safeParse(view).success, true);
});

Deno.test("standingFactorsOf — no row, or an unreadable figure, cites no factor at all", () => {
	assertStrictEquals(standingFactorsOf(undefined), undefined);
	assertStrictEquals(standingFactorsOf(null), undefined);
	assertStrictEquals(
		standingFactorsOf({
			stages_completed: 2,
			completion_rate: "x",
			on_time_rate: 1,
			dispute_rate: 0,
		}),
		undefined,
	);
	assertStrictEquals(
		standingFactorsOf({
			stages_completed: 2,
			completion_rate: 1.5,
			on_time_rate: 1,
			dispute_rate: 0,
		}),
		undefined,
	);
	const bare = mapProfileView(teamRaw({ standing: { level: 1, label: "New" } }));
	assertEquals(bare.stats.standing, { level: 1, label: "New" });
});
// #endregion

// #region Other kinds unchanged
Deno.test("mapProfileView — a freelancer grows no workspace facts and no message target", () => {
	const freelancer = mapProfileView(raw({
		owner_type: "user",
		kind: "freelancer",
		handle: "marisdelacroix",
		workspace: { hidden_reason: "draft", viewer_edits: true, viewer_settings: true },
		contact: { handle: "someone", name: "Someone" },
	}));
	assertStrictEquals(freelancer.workspace, undefined);
	assertStrictEquals(freelancer.messageTo, undefined);
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
	assertStrictEquals("skills" in members[0], false);
});

Deno.test("rosterOf — a team row carries its public role, since and at most two skill labels", () => {
	const doc: RawRoster = {
		departments: [],
		members: [
			{
				handle: "kwamemensah",
				name: "Kwame Mensah",
				avatar: null,
				role: "Owner",
				since: "2025-10-17T16:18:58.912969+00:00",
				skills: ["Deno", " Postgres ", "TypeScript", 7],
				is_freelancer: true,
				departments: [],
			},
			{
				handle: "tomaszwojcik",
				name: "Tomasz Wójcik",
				avatar: null,
				role: "Member",
				since: "2026-04-20T16:18:58.912969+00:00",
				skills: [],
				is_freelancer: true,
				departments: [],
			},
		],
	};
	const { members } = rosterOf(doc);
	assertEquals(members[0].skills, ["Deno", "Postgres"]);
	assertStrictEquals(members[0].role, "Owner");
	assertStrictEquals(members[0].since, "2025-10-17T16:18:58.912969+00:00");
	// No skills on record: the row carries no skills key, so nothing renders for it.
	assertStrictEquals("skills" in members[1], false);
});
// #endregion
