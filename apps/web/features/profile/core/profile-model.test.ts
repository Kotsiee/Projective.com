import { assertEquals } from "@std/assert";
import type { ServiceItem } from "../types/profile-types.ts";
import type { ProfileView } from "@projective/types/profile";
import {
	consultationPriceLabel,
	estimatedSpendFor,
	hiddenNoticeText,
	hireProjectsFrom,
	isFastResponder,
	memberNoticeFor,
	memberSinceLabel,
	messageReachable,
	parseReviewStance,
	previewNoteFor,
	responseLabel,
	reviewsForStance,
	reviewStanceCounts,
	reviewStanceOf,
	reviewSummaryFor,
	rigFills,
	rigFor,
	rosterMetaFacts,
	SETTINGS_PUBLISHES,
	standingFactorFacts,
	teamHiddenNoticeText,
} from "./profile-model.ts";

Deno.test("rigFor: a restricted (13–17) viewer gets neither Hire nor Add-to-project, and Message leads", () => {
	assertEquals(
		rigFor("freelancer", { hasServices: true, offersConsultation: true, authed: true, restricted: true }),
		{ layout: "seller", hire: false, addToProject: false, message: true, primary: "message" },
	);
});

Deno.test("rigFor: a seller with something to hire for leads with Hire; Add-to-project is there for a member", () => {
	// A listing or a consultation is something the Hire popover can show.
	assertEquals(
		rigFor("freelancer", { hasServices: true, offersConsultation: false, authed: true }),
		{
			layout: "seller",
			hire: true,
			addToProject: true,
			message: true,
			primary: "hire",
		},
	);
	assertEquals(rigFor("team", { hasServices: false, offersConsultation: true, authed: true }), {
		layout: "seller",
		hire: true,
		addToProject: true,
		message: true,
		primary: "hire",
	});
	// Neither: no Hire (an empty popover is not a control), and Add-to-project takes the primary.
	assertEquals(
		rigFor("freelancer", { hasServices: false, offersConsultation: false, authed: true }),
		{
			layout: "seller",
			hire: false,
			addToProject: true,
			message: true,
			primary: "add",
		},
	);
	// A guest keeps Hire (the press is what opens the sign-in prompt) and never sees Add-to-project.
	assertEquals(
		rigFor("freelancer", { hasServices: true, offersConsultation: false, authed: false }),
		{
			layout: "seller",
			hire: true,
			addToProject: false,
			message: true,
			primary: "hire",
		},
	);
	// A client or an enterprise cannot be hired or assigned, whatever it offers.
	for (const kind of ["client", "enterprise"] as const) {
		assertEquals(rigFor(kind, { hasServices: true, offersConsultation: true, authed: true }), {
			layout: "buyer",
			hire: false,
			addToProject: false,
			message: true,
			primary: "message",
		});
	}
});

Deno.test("rigFor: a business leads with Message, and its editors get Manage business instead (BP1)", () => {
	// Never Hire or Add-to-project, whatever it offers and whoever looks.
	assertEquals(rigFor("business", { hasServices: true, offersConsultation: true, authed: true }), {
		layout: "business",
		hire: false,
		addToProject: false,
		message: true,
		primary: "message",
	});
	assertEquals(
		rigFor("business", { hasServices: false, offersConsultation: false, authed: false }),
		{
			layout: "business",
			hire: false,
			addToProject: false,
			message: true,
			primary: "message",
		},
	);
	assertEquals(
		rigFor("business", {
			hasServices: false,
			offersConsultation: false,
			authed: true,
			manages: true,
		}),
		{ layout: "business", hire: false, addToProject: false, message: false, primary: "manage" },
	);
	// `manages` changes nothing for a client or an enterprise.
	assertEquals(
		rigFor("client", { hasServices: false, offersConsultation: false, authed: true, manages: true })
			.layout,
		"buyer",
	);
});

Deno.test("rigFor: a business with nobody for Message to reach offers no Message (BP1)", () => {
	const input = { hasServices: false, offersConsultation: false, authed: true };
	assertEquals(rigFor("business", { ...input, messageable: false }).primary, "none");
	assertEquals(rigFor("business", { ...input, messageable: false }).message, false);
	// An editor's console link does not depend on a contact.
	assertEquals(
		rigFor("business", { ...input, messageable: false, manages: true }).primary,
		"manage",
	);
	// `messageable` is an entity fact: a client keeps its Message.
	assertEquals(rigFor("client", { ...input, messageable: false }).primary, "message");
	assertEquals(rigFor("client", { ...input, messageable: false }).message, true);
});

Deno.test("rigFor: a team's editor sees Manage team in Hire's place; Add to project stays (Teams P1)", () => {
	const editor = rigFor("team", {
		hasServices: true,
		offersConsultation: true,
		authed: true,
		manages: true,
	});
	assertEquals(editor, {
		layout: "seller",
		hire: false,
		addToProject: true,
		message: true,
		primary: "manage",
	});
	// The one fill left is Add to project's tier-2 monochrome pill — Manage team is a tier-4 link.
	assertEquals(rigFills(editor), ["add"]);
	// A member without edit_profile — or a visitor — is offered Hire as any visitor is.
	const visitor = rigFor("team", { hasServices: true, offersConsultation: false, authed: true });
	assertEquals(visitor.primary, "hire");
	assertEquals(rigFills(visitor), ["hire", "add"]);
	// `manages` is a team rule on the seller side: a freelancer's own page never reads it.
	const input = { hasServices: true, offersConsultation: false, authed: true, manages: true };
	assertEquals(rigFor("freelancer", input).primary, "hire");
});

Deno.test("rigFor: a team whose read names no owner withholds its Message icon (Teams P1)", () => {
	const input = { hasServices: false, offersConsultation: false, authed: true };
	assertEquals(rigFor("team", { ...input, messageable: false }).message, false);
	assertEquals(rigFor("team", input).message, true);
});

Deno.test("rigFills: never two tier-3 fills; a business editor and a guest on a bare seller draw none", () => {
	const base = { hasServices: false, offersConsultation: false };
	assertEquals(rigFills(rigFor("business", { ...base, authed: true })), ["message"]);
	assertEquals(rigFills(rigFor("business", { ...base, authed: true, manages: true })), []);
	assertEquals(rigFills(rigFor("freelancer", { ...base, authed: false })), []);
	assertEquals(rigFills(rigFor("client", { ...base, authed: true })), []);
	for (const kind of ["freelancer", "team", "business", "client", "enterprise"] as const) {
		for (const manages of [false, true]) {
			const fills = rigFills(
				rigFor(kind, { hasServices: true, offersConsultation: true, authed: true, manages }),
			);
			assertEquals(fills.filter((f) => f !== "add").length <= 1, true, `${kind} ${manages}`);
		}
	}
});

Deno.test("messageReachable: a person always; a team or a business only through its owner", () => {
	const owner = { handle: "@kwamemensah", name: "Kwame Mensah" };
	assertEquals(messageReachable({ kind: "freelancer" }), true);
	assertEquals(messageReachable({ kind: "client" }), true);
	assertEquals(messageReachable({ kind: "team" }), false);
	assertEquals(messageReachable({ kind: "team", messageTo: owner }), true);
	assertEquals(messageReachable({ kind: "business" }), false);
	assertEquals(messageReachable({ kind: "business", messageTo: owner }), true);
});

Deno.test("hiddenNoticeText tells a member why outsiders cannot open the page", () => {
	// A fact, not a promise: publishing a draft alone leaves an invite-only business missing.
	assertEquals(
		hiddenNoticeText("draft", "Atlas Labs"),
		"Atlas Labs is a draft. Only members can see this page.",
	);
	assertEquals(
		hiddenNoticeText("archived", "Atlas Labs"),
		"Atlas Labs is archived. Only members can see this page.",
	);
	assertEquals(
		hiddenNoticeText("invite_only", "Atlas Labs"),
		"Atlas Labs is invite-only. Only members can see this page.",
	);
});

Deno.test("teamHiddenNoticeText: a draft opens on publishing; an invite-only draft needs both", () => {
	assertEquals(
		teamHiddenNoticeText("draft", "North Loop", "public"),
		"North Loop is a draft. Only members can see this until the team is published.",
	);
	assertEquals(
		teamHiddenNoticeText("draft", "North Loop", "unlisted"),
		"North Loop is a draft. Only members can see this until the team is published.",
	);
	assertEquals(
		teamHiddenNoticeText("draft", "North Loop", "private"),
		"North Loop is a draft. Only members can see this until the team is published and no longer invite-only.",
	);
	assertEquals(
		teamHiddenNoticeText("archived", "North Loop", "public"),
		"North Loop is archived. Only members can see this page.",
	);
	assertEquals(
		teamHiddenNoticeText("invite_only", "North Loop", "private"),
		"North Loop is invite-only. Only members can see this page.",
	);
});

/** A team or business profile with only the facts the member notice reads. */
function entity(
	kind: ProfileView["kind"],
	workspace: ProfileView["workspace"],
	visibility: ProfileView["visibility"] = "public",
): Pick<ProfileView, "kind" | "name" | "visibility" | "workspace"> {
	return { kind, name: kind === "team" ? "North Loop" : "Atlas Labs", visibility, workspace };
}

Deno.test("memberNoticeFor: a hidden team tells its member why, and links Settings, which publishes", () => {
	const doors = { consoleHref: "/teams/northloop", settingsHref: "/teams/northloop/settings" };
	const draft = entity("team", { hiddenReason: "draft", ...doors });
	// A team's Settings publishes for its settings holder (and restores and changes visibility for the
	// archive and profile rights' holders, Teams C6), so that holder gets the link beside the line; a
	// business's still cannot (#244 (d)).
	assertEquals(SETTINGS_PUBLISHES, { team: true, business: false });
	assertEquals(memberNoticeFor(draft), {
		text: "North Loop is a draft. Only members can see this until the team is published.",
		settingsHref: "/teams/northloop/settings",
	});
	// A kind whose Settings could not act would withhold it (root CLAUDE.md §3.11)…
	assertEquals(memberNoticeFor(draft, { team: false, business: false }), {
		text: "North Loop is a draft. Only members can see this until the team is published.",
		settingsHref: null,
	});
	const c6 = SETTINGS_PUBLISHES;
	// …and a member who may not open Settings still reads the line alone.
	assertEquals(
		memberNoticeFor(
			entity("team", { hiddenReason: "archived", consoleHref: null, settingsHref: null }),
			c6,
		),
		{ text: "North Loop is archived. Only members can see this page.", settingsHref: null },
	);
	// Nothing to tell on a page anybody may open, or on a kind with no workspace facts.
	assertEquals(memberNoticeFor(entity("team", { hiddenReason: null, ...doors })), null);
	assertEquals(memberNoticeFor(entity("team", undefined)), null);
	assertEquals(memberNoticeFor(entity("freelancer", undefined)), null);
});

Deno.test("memberNoticeFor: a hidden business keeps BP1's line and withholds Settings (#244 (d))", () => {
	const hidden = entity("business", {
		hiddenReason: "invite_only",
		consoleHref: "/businesses/atlaslabs",
		settingsHref: "/businesses/atlaslabs/settings",
	}, "private");
	const line = "Atlas Labs is invite-only. Only members can see this page.";
	assertEquals(memberNoticeFor(hidden), { text: line, settingsHref: null });
	// A team's Settings learning to publish does not open the business's link.
	assertEquals(memberNoticeFor(hidden, { team: true, business: false }), {
		text: line,
		settingsHref: null,
	});
	assertEquals(memberNoticeFor(hidden, { team: false, business: true }), {
		text: line,
		settingsHref: "/businesses/atlaslabs/settings",
	});
});

Deno.test("previewNoteFor: a workspace editor's preview says what visitors do not see", () => {
	const editor = { hiddenReason: null, consoleHref: "/teams/northloop", settingsHref: null };
	assertEquals(
		previewNoteFor({ kind: "team", workspace: editor }),
		"This is how your team looks to visitors, who never see Manage team.",
	);
	assertEquals(
		previewNoteFor({
			kind: "business",
			workspace: { ...editor, consoleHref: "/businesses/atlaslabs" },
		}),
		"This is how your business looks to visitors. They see Message where you see Manage business.",
	);
	// No console door (a platform admin, a person's own page): the owner nav's plain note.
	assertEquals(
		previewNoteFor({ kind: "team", workspace: { ...editor, consoleHref: null } }),
		undefined,
	);
	assertEquals(previewNoteFor({ kind: "freelancer" }), undefined);
});

Deno.test("memberSinceLabel is the join year, and nothing for an unreadable date", () => {
	assertEquals(memberSinceLabel("2026-02-19T14:14:10.589473+00:00"), "Since 2026");
	// The UTC year: a New Year's Eve join late in the evening west of UTC is next year's.
	assertEquals(memberSinceLabel("2025-12-31T23:30:00-05:00"), "Since 2026");
	assertEquals(memberSinceLabel(undefined), null);
	assertEquals(memberSinceLabel(""), null);
	assertEquals(memberSinceLabel("not a date"), null);
});

Deno.test("rosterMetaFacts: a team row is role · since · two skills, all text (Teams P1)", () => {
	const member = {
		role: "Lead",
		since: "2025-03-01T10:00:00Z",
		skills: ["Deno", "Postgres", "TypeScript"],
	};
	assertEquals(rosterMetaFacts(member, "team"), [
		"Lead",
		{ text: "Since 2025", tabular: true },
		"Deno",
		"Postgres",
	]);
	// No skills and no readable date: the role alone.
	assertEquals(rosterMetaFacts({ role: "Member", since: "nope" }, "team"), ["Member"]);
	// A business row is role · since — never skills (BP1).
	assertEquals(rosterMetaFacts(member, "business"), [
		"Lead",
		{ text: "Since 2025", tabular: true },
	]);
	// An enterprise keeps its plain role line. (That the facts render as one MetaLine and never as a
	// chip is `components/work/WorkRoster.test.tsx`'s, on the rendered markup.)
	assertEquals(rosterMetaFacts(member, "enterprise"), null);
});

Deno.test("standingFactorFacts: a team's on time · completion · disputes, never a person's", () => {
	const record = { stagesCompleted: 6, completionRate: 1, onTimeRate: 0.957, disputeRate: 0 };
	assertEquals(standingFactorFacts(record, "team"), [
		{ text: "96% on time", tabular: true },
		{ text: "100% completion", tabular: true },
		"No disputes",
	]);
	// A person's rates are not published, whatever the read carries; a buyer has no Standing.
	assertEquals(standingFactorFacts(record, "freelancer"), []);
	assertEquals(standingFactorFacts(record, "business"), []);
	// A tiny dispute rate never rounds to a claim of none.
	assertEquals(
		standingFactorFacts({
			stagesCompleted: 300,
			completionRate: 0.99,
			onTimeRate: 0.9,
			disputeRate: 0.003,
		}, "team")[2],
		{ text: "1% disputed", tabular: true },
	);
	// No factors in the read (below the volume floor, or no Standing row), or none counted: nothing.
	assertEquals(
		standingFactorFacts(
			{ stagesCompleted: 0, completionRate: 0, onTimeRate: 0, disputeRate: 0 },
			"team",
		),
		[],
	);
	assertEquals(standingFactorFacts(undefined, "team"), []);
});

Deno.test("reviewSummaryFor: a team draws one aggregate with a count badge and no stance filter", () => {
	const track = { value: 4.8, count: 3 };
	assertEquals(reviewSummaryFor("team", { asHelper: track }), {
		tracks: [{ label: "Team rating", track }],
		countBadge: true,
		stances: false,
	});
	// A team has no client track to show, whatever the read carried.
	assertEquals(
		reviewSummaryFor("team", { asHelper: track, asClient: { value: 5, count: 1 } }).tracks.length,
		1,
	);
	assertEquals(reviewSummaryFor("team", {}).tracks, []);
	// A person: both tracks and the stance filter; a business: no filter (BP1).
	assertEquals(
		reviewSummaryFor("freelancer", { asHelper: track, asClient: track }),
		{
			tracks: [{ label: "As a freelancer", track }, { label: "As a client", track }],
			countBadge: false,
			stances: true,
		},
	);
	assertEquals(reviewSummaryFor("business", { asClient: track }).stances, false);
	assertEquals(reviewSummaryFor("business", { asClient: track }).countBadge, false);
});

Deno.test("consultationPriceLabel: Free whenever a courtesy call exists, else the paid fee", () => {
	assertEquals(consultationPriceLabel(null), null);
	assertEquals(
		consultationPriceLabel({
			courtesyEnabled: true,
			paidEnabled: true,
			feeAmountMinor: 7500,
			feeCurrency: "GBP",
		}),
		"Free",
	);
	assertEquals(
		consultationPriceLabel({
			courtesyEnabled: false,
			paidEnabled: true,
			feeAmountMinor: 7500,
			feeCurrency: "GBP",
		}),
		"£75.00",
	);
	assertEquals(
		consultationPriceLabel({
			courtesyEnabled: false,
			paidEnabled: false,
			feeAmountMinor: null,
			feeCurrency: null,
		}),
		null,
	);
});

Deno.test("hireProjectsFrom keeps only open engagements, published first, as slim rows", () => {
	const row = (slug: string, status: "draft" | "active" | "on_hold" | "completed" | "cancelled") =>
		({ slug, title: `Project ${slug}`, scopeLabel: "Personal", status }) as never;
	const rows = hireProjectsFrom([
		row("prj-c", "draft"),
		row("prj-a", "active"),
		row("prj-b", "completed"),
		row("prj-d", "cancelled"),
		row("prj-e", "on_hold"),
	]);
	// Published (active · on hold) lead in feed order; the draft follows rather than leading the list.
	assertEquals(rows.map((r) => r.slug), ["prj-a", "prj-e", "prj-c"]);
	assertEquals(rows[0], {
		slug: "prj-a",
		title: "Project prj-a",
		scopeLabel: "Personal",
		status: "active",
		published: true,
		cooldownUntil: null,
	});
	assertEquals(rows[2].published, false);
});

Deno.test("hireProjectsFrom keeps a locked project in the list and carries its cooldown", () => {
	const row = (slug: string, status: "draft" | "active") =>
		({ slug, title: `Project ${slug}`, scopeLabel: "Personal", status }) as never;
	const until = "2026-09-04T16:20:00.000Z";
	const rows = hireProjectsFrom([row("prj-a", "active"), row("prj-c", "draft")], {
		"prj-a": until,
	});
	// Locked, not hidden: an absent row would read as "you have no such project".
	assertEquals(rows.map((r) => [r.slug, r.cooldownUntil]), [["prj-a", until], ["prj-c", null]]);
});

Deno.test("review stance is the author's role inverted", () => {
	// The author was the CLIENT → the profile was reviewed as a freelancer.
	assertEquals(reviewStanceOf({ role: "client" }), "freelancer");
	assertEquals(reviewStanceOf({ role: "freelancer" }), "client");

	const reviews = [
		{ id: "a", role: "client" as const },
		{ id: "b", role: "freelancer" as const },
		{ id: "c", role: "client" as const },
	];
	assertEquals(reviewsForStance(reviews, "all").map((r) => r.id), ["a", "b", "c"]);
	assertEquals(reviewsForStance(reviews, "freelancer").map((r) => r.id), ["a", "c"]);
	assertEquals(reviewsForStance(reviews, "client").map((r) => r.id), ["b"]);
	assertEquals(reviewStanceCounts(reviews), { all: 3, freelancer: 2, client: 1 });
});

Deno.test("parseReviewStance accepts only the two stances", () => {
	assertEquals(parseReviewStance("freelancer"), "freelancer");
	assertEquals(parseReviewStance("client"), "client");
	assertEquals(parseReviewStance("all"), "all");
	assertEquals(parseReviewStance("evil"), "all");
	assertEquals(parseReviewStance(null), "all");
});

Deno.test("responseLabel rounds to the unit a reader plans around", () => {
	assertEquals(responseLabel(45), "~45 min");
	assertEquals(responseLabel(60), "~1 hr");
	assertEquals(responseLabel(120), "~2 hrs");
	assertEquals(responseLabel(240), "~4 hrs");
	assertEquals(responseLabel(1440), "~1 day");
	assertEquals(responseLabel(4320), "~3 days");
});

Deno.test("isFastResponder is the card's threshold and never fires unmeasured", () => {
	assertEquals(isFastResponder(45), true);
	assertEquals(isFastResponder(60), true);
	assertEquals(isFastResponder(61), false);
	assertEquals(isFastResponder(null), false);
	assertEquals(isFastResponder(undefined), false);
});

const service = (over: Partial<ServiceItem>): ServiceItem => ({
	id: "sv-1",
	type: "services",
	title: "Service",
	owner: { handle: "@x", name: "X", avatar: "", kind: "freelancer" },
	price: "$500",
	delivery: "5 days",
	category: "design",
	serviceType: "One-Off",
	createdAt: "2026-01-01",
	...over,
} as ServiceItem);

Deno.test("estimatedSpendFor is the cheapest structured floor and its unit", () => {
	const spend = estimatedSpendFor([
		service({ id: "a", serviceType: "One-Off", priceMinor: 50_000, currency: "USD" }),
		service({
			id: "b",
			serviceType: "Pipeline",
			ticketPrice: 240,
			priceMinor: 24_000,
			currency: "USD",
		}),
		service({ id: "c", serviceType: "Session", sessionPrice: 180, currency: "USD" }),
	]);
	// The pipeline's floor is 0.5× its ticket price → $120 / ticket, the cheapest start.
	assertEquals(spend, { amount: { minor: 12_000, currency: "USD" }, unit: "ticket" });
});

Deno.test("estimatedSpendFor invents nothing for an unpriced catalogue", () => {
	assertEquals(estimatedSpendFor([]), null);
	assertEquals(estimatedSpendFor([service({ price: "Contact us" })]), null);
});
