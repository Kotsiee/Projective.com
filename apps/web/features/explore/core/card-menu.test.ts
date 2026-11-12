import { assertEquals } from "@std/assert";
import type { MenuItem } from "@ui/types/mod.ts";
import { cardMenu, type CardMenuFacts, type CardMenuHandlers } from "./card-menu.ts";

/**
 * The Explore card menu (Decision #422), pinned: which verbs each card type offers, where each row
 * goes for a member and for a guest, and that a row never reaches a DM with nobody behind it.
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

Deno.test("a team or business profile card offers no Message", () => {
	const team = cardMenu(
		facts({
			id: "@studio",
			type: "teams",
			title: "Studio",
			href: "/@studio",
			serviceType: undefined,
			owner: { handle: "@studio", name: "Studio", kind: "team" },
		}),
		handlers(),
	);
	assertEquals(labels(team), ["View profile", "Copy link", "Share", "Save"]);
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
