import { assert, assertEquals } from "@std/assert";
import type { BenchEntry } from "@projective/types/workspace";
import type { MenuItem } from "@ui/types/mod.ts";
import {
	BENCH_KIND_LABEL,
	benchAddToProjectHref,
	benchClosedReason,
	benchManagedReason,
	benchMenu,
	type BenchMenuContext,
	benchProfileHref,
	benchRowHref,
	benchSelfReason,
	benchSummary,
} from "./bench-model.ts";

/**
 * The Talent module's bench rules (Decision #230 (i), #241): every row action lands somewhere real, a
 * refused one says why, and the summary counts what the table shows.
 */

// #region Fixtures
const MARIS: BenchEntry = {
	kind: "freelancer",
	handle: "marisdelacroix",
	name: "Maris Delacroix",
	avatar: "",
	contact: { handle: "marisdelacroix", name: "Maris Delacroix" },
	profileVisible: true,
	viewerManages: false,
	engagements: 2,
	liveNow: true,
	lastWorkedAt: "2026-10-02T14:14:10.690Z",
	lastWorkedLabel: "Now",
	rating: { average: 5, count: 1 },
};

const NOVA: BenchEntry = {
	kind: "team",
	handle: "ateliernova",
	name: "Atelier Nova",
	avatar: "",
	contact: { handle: "inesduarte", name: "Inês Duarte" },
	profileVisible: true,
	viewerManages: false,
	engagements: 1,
	liveNow: false,
	lastWorkedAt: null,
	lastWorkedLabel: "–",
	rating: { average: null, count: 0 },
};

function ctx(over: Partial<BenchMenuContext> = {}): BenchMenuContext & { messaged: BenchEntry[] } {
	const messaged: BenchEntry[] = [];
	return {
		businessName: "Helia Finance",
		canHire: true,
		viewerHandle: "priyaraman",
		onMessage: (entry) => messaged.push(entry),
		messaged,
		...over,
	};
}

const row = (items: MenuItem[], key: string): MenuItem => {
	const found = items.find((i) => i.key === key);
	assert(found, `menu row ${key}`);
	return found;
};
// #endregion

Deno.test("bench: profile and re-hire addresses are the party's own profile", () => {
	assertEquals(benchProfileHref("marisdelacroix"), "/@marisdelacroix");
	assertEquals(benchAddToProjectHref("marisdelacroix"), "/@marisdelacroix?add=1");
	assertEquals(BENCH_KIND_LABEL.team, "Team");
});

Deno.test("bench: a freelancer's menu is View profile · Message · Add to project, each live", () => {
	const c = ctx();
	const menu = benchMenu(MARIS, c);
	assertEquals(menu.map((i) => i.label), ["View profile", "Message", "Add to project"]);
	assertEquals(row(menu, "profile").url, "/@marisdelacroix");
	assertEquals(row(menu, "add").url, "/@marisdelacroix?add=1");
	assertEquals(menu.some((i) => i.disabled), false);
	const message = row(menu, "message");
	assertEquals(message.hint, undefined);
	message.command?.({ item: message, originalEvent: new Event("click") });
	assertEquals(c.messaged, [MARIS]);
});

Deno.test("bench: a team's Message says it reaches the owner", () => {
	const message = row(benchMenu(NOVA, ctx()), "message");
	assertEquals(message.hint, "Reaches Inês Duarte, who runs Atelier Nova");
	assertEquals(message.disabled, undefined);
});

Deno.test("bench: a business that cannot hire refuses Add to project, with the reason", () => {
	const add = row(benchMenu(MARIS, ctx({ canHire: false })), "add");
	assertEquals(add.disabled, true);
	assertEquals(add.url, undefined);
	assertEquals(add.disabledReason, "Helia Finance isn't active, so it can't hire yet.");
});

Deno.test("bench: the viewer's own row, or their own team's, is not offered to them", () => {
	assertEquals(benchSelfReason(MARIS, "marisdelacroix"), "That's you.");
	assertEquals(benchSelfReason(NOVA, "inesduarte"), "You run Atelier Nova.");
	assertEquals(benchSelfReason(MARIS, null), null);
	const menu = benchMenu(MARIS, ctx({ viewerHandle: "marisdelacroix" }));
	assertEquals(row(menu, "message").disabledReason, "That's you.");
	assertEquals(row(menu, "add").disabledReason, "That's you.");
	assertEquals(row(menu, "profile").disabled, undefined);
	const owner = benchMenu({ ...NOVA, viewerManages: true }, ctx({ viewerHandle: "inesduarte" }));
	assertEquals(row(owner, "message").disabledReason, "You run Atelier Nova.");
	assertEquals(row(owner, "add").disabledReason, "You run Atelier Nova.");
});

Deno.test("bench: a team the viewer administers refuses Add to project — its profile offers them no picker", () => {
	const admin: BenchEntry = { ...NOVA, viewerManages: true };
	assertEquals(benchManagedReason(admin, "lenamueller"), "You manage Atelier Nova.");
	assertEquals(benchManagedReason(NOVA, "lenamueller"), null);
	const menu = benchMenu(admin, ctx({ viewerHandle: "lenamueller" }));
	const add = row(menu, "add");
	assertEquals(add.disabled, true);
	assertEquals(add.url, undefined);
	assertEquals(add.disabledReason, "You manage Atelier Nova.");
	// Messaging the owner, another person, still works; so does opening the profile.
	assertEquals(row(menu, "message").disabled, undefined);
	assertEquals(row(menu, "profile").url, "/@ateliernova");
});

Deno.test("bench: a profile that does not open for the viewer is no link, and only Message stays", () => {
	const hidden: BenchEntry = { ...NOVA, profileVisible: false };
	assertEquals(benchClosedReason(hidden), "Atelier Nova's profile isn't public.");
	assertEquals(benchClosedReason(NOVA), null);
	assertEquals(benchRowHref(hidden), null);
	assertEquals(benchRowHref(NOVA), "/@ateliernova");
	const menu = benchMenu(hidden, ctx());
	assertEquals(row(menu, "profile").disabled, true);
	assertEquals(row(menu, "profile").url, undefined);
	assertEquals(row(menu, "profile").disabledReason, "Atelier Nova's profile isn't public.");
	assertEquals(row(menu, "add").disabled, true);
	assertEquals(row(menu, "add").url, undefined);
	assertEquals(row(menu, "add").disabledReason, "Atelier Nova's profile isn't public.");
	assertEquals(row(menu, "message").disabled, undefined);
	// The business's own gate speaks first.
	assertEquals(
		row(benchMenu(hidden, ctx({ canHire: false })), "add").disabledReason,
		"Helia Finance isn't active, so it can't hire yet.",
	);
});

Deno.test("bench: a team nobody can be messaged at says so", () => {
	const message = row(benchMenu({ ...NOVA, contact: null }, ctx()), "message");
	assertEquals(message.disabled, true);
	assertEquals(message.disabledReason, "Nobody at Atelier Nova can be messaged yet.");
});

Deno.test("bench: the summary counts the bench and who is working now", () => {
	assertEquals(benchSummary([MARIS, NOVA]), ["2 on the bench", "1 working now"]);
	assertEquals(benchSummary([NOVA]), ["1 on the bench"]);
	assertEquals(benchSummary([]), []);
});
