import { assertEquals } from "@std/assert";
import type { MenuItem } from "@ui/types/mod.ts";
import type { ProjectItem } from "@projective/types/explore";
import { cardMenu, type CardMenuFacts, cardMenuFacts, type CardMenuHandlers } from "./card-menu.ts";

/**
 * The Explore card menu (Decision #422), pinned: which verbs each card type offers, where each row
 * goes for a member and for a guest, that a team's or a business's Message reaches its owner, and that
 * a row never reaches a DM with nobody behind it.
 */

function facts(over: Partial<CardMenuFacts> = {}): CardMenuFacts {
	return {
		id: "sv-coaching",
		type: "services",
		title: "Coaching",
		href: "/view/sv-coaching?type=services",
		serviceType: "Session",
		owner: { handle: "@juno", name: "Juno Park", kind: "freelancer" },
		ctx: { scope: "explore" },
		...over,
	};
}

function handlers(over: Partial<CardMenuHandlers> = {}): CardMenuHandlers {
	return {
		authed: true,
		onShare: () => {},
		save: { saved: false, onToggle: () => {} },
		onCopied: () => {},
		...over,
	};
}

/** Each row as its label, `---` for a separator. */
function labels(menu: MenuItem[]): string[] {
	return menu.map((row) => row.separator ? "---" : row.label ?? "");
}

function row(menu: MenuItem[], label: string): MenuItem | undefined {
	return menu.find((r) => r.label === label);
}

Deno.test("a session service: link rows, then Book session and Contact seller, then the creator", () => {
	const menu = cardMenu(facts(), handlers());
	assertEquals(labels(menu), [
		"Open",
		"Copy link",
		"Share",
		"Save",
		"---",
		"Book session",
		"Contact seller",
		"---",
		"View profile",
	]);
	assertEquals(row(menu, "Book session")?.url, "/view/sv-coaching?type=services&intent=book");
	assertEquals(row(menu, "Book session")?.icon, "calendar");
	assertEquals(row(menu, "Contact seller")?.url, "/view/sv-coaching?type=services&intent=contact");
	assertEquals(row(menu, "View profile")?.url, "/@juno");
	assertEquals(row(menu, "View profile")?.hint, "Juno Park");
});

Deno.test("a service that writes on press offers Contact seller, never its primary", () => {
	for (
		const serviceType of ["Pipeline", "One-Off", "Direct Deliverable", "Group Session"] as const
	) {
		const menu = cardMenu(facts({ serviceType }), handlers());
		assertEquals(row(menu, "Book session"), undefined, serviceType);
		assertEquals(
			labels(menu).slice(5, 6),
			["Contact seller"],
			serviceType,
		);
	}
});

Deno.test("a product offers Contact seller and its creator", () => {
	const menu = cardMenu(
		facts({
			id: "pr-kit",
			type: "products",
			href: "/view/pr-kit?type=products",
			serviceType: undefined,
		}),
		handlers(),
	);
	assertEquals(labels(menu).slice(5), ["Contact seller", "---", "View profile"]);
});

Deno.test("a project offers Apply, and Message client only when a person posted it", () => {
	const project = facts({
		id: "prj-brief",
		type: "projects",
		href: "/view/prj-brief?type=projects",
		serviceType: undefined,
	});
	const member = cardMenu(project, handlers());
	assertEquals(labels(member).slice(5), [
		"Apply to project",
		"Message client",
		"---",
		"View profile",
	]);
	assertEquals(row(member, "Apply to project")?.url, "/view/prj-brief?type=projects&intent=apply");
	assertEquals(row(member, "Message client")?.url, "/messages/dm-juno");

	const guest = cardMenu(project, handlers({ authed: false, save: undefined }));
	assertEquals(
		row(guest, "Message client")?.url,
		`/login?redirectTo=${encodeURIComponent("/view/prj-brief?type=projects")}`,
	);

	assertEquals(row(member, "Message client")?.hint, undefined);

	const business = cardMenu(
		{ ...project, owner: { handle: "@acme", name: "Acme", kind: "business" } },
		handlers(),
	);
	assertEquals(row(business, "Message client"), undefined);
	assertEquals(
		row(business, "Apply to project")?.url,
		"/view/prj-brief?type=projects&intent=apply",
	);
});

Deno.test("a brief a business or a team posted messages its owner, named in the hint", () => {
	const project = facts({
		id: "prj-brief",
		type: "projects",
		href: "/view/prj-brief?type=projects",
		serviceType: undefined,
	});
	for (
		const owner of [
			{
				handle: "@heliafinance",
				name: "Helia Finance",
				kind: "business" as const,
				messageTo: { handle: "@priyaraman", name: "Priya Raman" },
			},
			{
				handle: "@northloop",
				name: "North Loop",
				kind: "team" as const,
				messageTo: { handle: "@kwamemensah", name: "Kwame Mensah" },
			},
		]
	) {
		const member = cardMenu({ ...project, owner }, handlers());
		assertEquals(labels(member).slice(5), [
			"Apply to project",
			"Message client",
			"---",
			"View profile",
		], owner.handle);
		const message = row(member, "Message client");
		assertEquals(message?.url, `/messages/dm-${owner.messageTo.handle.slice(1)}`, owner.handle);
		assertEquals(message?.hint, owner.messageTo.name, owner.handle);
		assertEquals(row(member, "View profile")?.url, `/${owner.handle}`, owner.handle);

		const guest = cardMenu({ ...project, owner }, handlers({ authed: false, save: undefined }));
		assertEquals(
			row(guest, "Message client")?.url,
			`/login?redirectTo=${encodeURIComponent("/view/prj-brief?type=projects")}`,
			owner.handle,
		);
	}
});

Deno.test("a person's profile card: the Open row reads View profile, plus Message, no twin row", () => {
	const person = facts({
		id: "@juno",
		type: "freelancers",
		title: "Juno Park",
		href: "/@juno",
		serviceType: undefined,
	});
	const menu = cardMenu(person, handlers());
	assertEquals(labels(menu), ["View profile", "Copy link", "Share", "Save", "---", "Message"]);
	assertEquals(menu[0].url, "/@juno");
	assertEquals(row(menu, "Message")?.url, "/messages/dm-juno");

	const guest = cardMenu(person, handlers({ authed: false, save: undefined }));
	assertEquals(row(guest, "Message")?.url, `/login?redirectTo=${encodeURIComponent("/@juno")}`);
});

Deno.test("a team or business profile card's Message reaches its owner", () => {
	for (
		const [type, kind] of [["teams", "team"], ["businesses", "business"]] as const
	) {
		const entity = facts({
			id: "@studio",
			type,
			title: "Studio",
			href: "/@studio",
			serviceType: undefined,
			owner: {
				handle: "@studio",
				name: "Studio",
				kind,
				messageTo: { handle: "@saoirsebyrne", name: "Saoirse Byrne" },
			},
		});
		const menu = cardMenu(entity, handlers());
		assertEquals(
			labels(menu),
			["View profile", "Copy link", "Share", "Save", "---", "Message"],
			kind,
		);
		assertEquals(row(menu, "Message")?.url, "/messages/dm-saoirsebyrne", kind);
		assertEquals(row(menu, "Message")?.hint, "Saoirse Byrne", kind);

		const guest = cardMenu(entity, handlers({ authed: false, save: undefined }));
		assertEquals(
			row(guest, "Message")?.url,
			`/login?redirectTo=${encodeURIComponent("/@studio")}`,
			kind,
		);
	}
});

Deno.test("a team or business that names no owner offers no Message, never dm-{slug}", () => {
	for (
		const [type, kind] of [["teams", "team"], ["businesses", "business"]] as const
	) {
		const menu = cardMenu(
			facts({
				id: "@studio",
				type,
				title: "Studio",
				href: "/@studio",
				serviceType: undefined,
				owner: { handle: "@studio", name: "Studio", kind },
			}),
			handlers(),
		);
		assertEquals(labels(menu), ["View profile", "Copy link", "Share", "Save"], kind);
		assertEquals(menu.some((r) => r.url?.startsWith("/messages/") ?? false), false, kind);
	}
});

Deno.test("cardMenuFacts carries the owner's message target to the island", () => {
	const owner = {
		handle: "@northloop",
		name: "North Loop",
		avatar: "",
		kind: "team" as const,
		messageTo: { handle: "@kwamemensah", name: "Kwame Mensah" },
	};
	const brief: ProjectItem = {
		id: "prj-brief",
		type: "projects",
		title: "Brand refresh",
		owner,
		skills: [],
		summary: "",
		createdAt: "2026-11-18T00:00:00.000Z",
		org: "North Loop",
		stage: "Discovery",
		budget: "",
		currency: "USD",
		classification: "one-off",
		roles: [],
		phases: [],
	};
	const out = cardMenuFacts(brief, { scope: "explore" });
	assertEquals(out.owner, {
		handle: "@northloop",
		name: "North Loop",
		kind: "team",
		messageTo: { handle: "@kwamemensah", name: "Kwame Mensah" },
	});
	assertEquals(row(cardMenu(out, handlers()), "Message client")?.url, "/messages/dm-kwamemensah");
});

Deno.test("an article offers only its author's profile after the link rows", () => {
	const menu = cardMenu(
		facts({
			id: "ar-guide",
			type: "articles",
			href: "/view/ar-guide?type=articles",
			serviceType: undefined,
		}),
		handlers(),
	);
	assertEquals(labels(menu), ["Open", "Copy link", "Share", "Save", "---", "View profile"]);
});

Deno.test("on the creator's own profile page the creator row is left out, and intents keep the namespace", () => {
	const menu = cardMenu(
		facts({
			href: "/@Juno/view/sv-coaching?type=services",
			ctx: { scope: "profile", handle: "@Juno" },
		}),
		handlers(),
	);
	assertEquals(row(menu, "View profile"), undefined);
	assertEquals(row(menu, "Book session")?.url, "/@Juno/view/sv-coaching?type=services&intent=book");

	const elsewhere = cardMenu(
		facts({ ctx: { scope: "profile", handle: "@someone-else" } }),
		handlers(),
	);
	assertEquals(row(elsewhere, "View profile")?.url, "/@juno");
});

Deno.test("a guest keeps the verbs (the page signs them in) and has no Save row", () => {
	const menu = cardMenu(facts(), handlers({ authed: false, save: undefined }));
	assertEquals(labels(menu), [
		"Open",
		"Copy link",
		"Share",
		"---",
		"Book session",
		"Contact seller",
		"---",
		"View profile",
	]);
});
