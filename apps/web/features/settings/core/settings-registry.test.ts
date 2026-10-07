import { assert, assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { SettingsSectionKey } from "@projective/types/settings";
import {
	anchorId,
	entryByAnchor,
	normalizeQuery,
	resolveSectionKey,
	searchSettings,
	sectionEntries,
	sectionOfPath,
	SETTINGS_REGISTRY,
	SETTINGS_SECTION_KEYS,
	SETTINGS_SECTIONS,
	settingsHref,
	topSearchTarget,
	visibleSections,
} from "./settings-registry.ts";

const person = (patch: Partial<UserContext> = {}): UserContext => ({
	contextType: "personal",
	contextId: null,
	role: "member",
	isClient: true,
	isFreelancer: false,
	handle: "theo",
	onboarded: true,
	userId: "00000000-0000-4000-8000-000000000001",
	displayCurrency: "GBP",
	locale: "en-GB",
	...patch,
} as UserContext);

// #region Integrity
Deno.test("registry — the sections mirror the key enum, in order", () => {
	assertEquals(SETTINGS_SECTIONS.map((s) => s.key), [...SettingsSectionKey.options]);
	assertEquals([...SETTINGS_SECTION_KEYS], [...SettingsSectionKey.options]);
});

Deno.test("registry — entry keys and anchors are unique, and every entry names a real section", () => {
	const keys = new Set(SETTINGS_REGISTRY.map((e) => e.key));
	const anchors = new Set(SETTINGS_REGISTRY.map((e) => e.anchor));
	assertEquals(keys.size, SETTINGS_REGISTRY.length);
	assertEquals(anchors.size, SETTINGS_REGISTRY.length);
	for (const entry of SETTINGS_REGISTRY) {
		assert(SettingsSectionKey.options.includes(entry.section), entry.key);
		assert(entry.key.startsWith(`${entry.section}.`), entry.key);
		assert(/^[a-z][a-z0-9-]*$/.test(entry.anchor), entry.anchor);
	}
});

Deno.test("registry — every section has at least one entry for everyone signed in", () => {
	for (const key of SETTINGS_SECTION_KEYS) assert(sectionEntries(key, person()).length > 0, key);
});

Deno.test("registry — entries are grouped in section display order", () => {
	const order = SETTINGS_REGISTRY.map((e) => SETTINGS_SECTION_KEYS.indexOf(e.section));
	assertEquals(order, [...order].sort((a, b) => a - b));
});

Deno.test("registry — an entry inherits a page-only section's surface or narrows it", () => {
	for (const entry of SETTINGS_REGISTRY) {
		const section = SETTINGS_SECTIONS.find((s) => s.key === entry.section)!;
		if (section.surface !== "modal") assertEquals(entry.surface, section.surface, entry.key);
	}
});
// #endregion

// #region Gates
Deno.test("gates — a buyer sees no call, payout or identity-check entries; a freelancer does", () => {
	const buyer = sectionEntries("scheduling", person()).map((e) => e.anchor);
	assertEquals(buyer, ["working-hours"]);
	const seller = sectionEntries("scheduling", person({ isFreelancer: true })).map((e) => e.anchor);
	assertEquals(seller, ["working-hours", "calls", "courtesy", "buffers"]);
	assertEquals(sectionEntries("verification", person()).map((e) => e.anchor), [
		"business-verification",
	]);
});

Deno.test("gates — acting as a team admits the seller entries", () => {
	const team = person({ contextType: "team", contextId: "t1" });
	assert(sectionEntries("workspaces", team).some((e) => e.anchor === "teams"));
	assert(sectionEntries("scheduling", team).some((e) => e.anchor === "calls"));
});

Deno.test("gates — every section stays visible (a gated entry never hides its page)", () => {
	assertEquals(visibleSections(person()).length, SETTINGS_SECTIONS.length);
	assertEquals(visibleSections(null).length, SETTINGS_SECTIONS.length);
});
// #endregion

// #region Search
Deno.test("search — 'dark mode' finds Appearance alone, at the theme entry", () => {
	const hits = searchSettings("dark mode", person());
	assertEquals(hits.map((h) => h.section.key), ["appearance"]);
	assertEquals(hits[0].entries.map((e) => e.anchor), ["theme"]);
	assertEquals(topSearchTarget("dark mode", person()), { section: "appearance", anchor: "theme" });
});

Deno.test("search — every token must match: 'dark' alone still finds the theme, 'dark sms' finds nothing", () => {
	assertEquals(searchSettings("dark", person())[0].section.key, "appearance");
	assertEquals(searchSettings("dark sms", person()), []);
});

Deno.test("search — a section-name hit keeps the whole section", () => {
	const [hit] = searchSettings("notifications", person());
	assertEquals(hit.section.key, "notifications");
	assertEquals(hit.entries.length, sectionEntries("notifications", person()).length);
});

Deno.test("search — case, accents and punctuation are ignored; prefixes match", () => {
	assertEquals(searchSettings("OUT-OF-OFFICE", person())[0].section.key, "messaging");
	assertEquals(searchSettings("réad receipt", person())[0].entries[0].anchor, "message-privacy");
	assertEquals(searchSettings("passw", person())[0].entries[0].anchor, "password");
});

Deno.test("search — a gated entry is not findable by someone it does not admit", () => {
	assertEquals(searchSettings("courtesy call", person()), []);
	assertEquals(
		searchSettings("courtesy call", person({ isFreelancer: true }))[0].entries[0].anchor,
		"courtesy",
	);
});

Deno.test("search — an empty query lists everything visible, in display order", () => {
	const hits = searchSettings("   ", person());
	assertEquals(hits.map((h) => h.section.key), [...SETTINGS_SECTION_KEYS]);
	assertEquals(topSearchTarget("", person()), { section: "account", anchor: null });
});

Deno.test("normalizeQuery — folds case, accents and punctuation", () => {
	assertEquals(normalizeQuery("  Colour-Blind  Ünited! "), "colour blind united");
});
// #endregion

// #region Addresses
Deno.test("addresses — hrefs, path parsing and anchors", () => {
	assertEquals(settingsHref("appearance"), "/settings/appearance");
	assertEquals(settingsHref("appearance", "contrast"), "/settings/appearance#contrast");
	assertEquals(sectionOfPath("/settings"), "index");
	assertEquals(sectionOfPath("/settings/"), "index");
	assertEquals(sectionOfPath("/settings/messaging"), "messaging");
	assertEquals(sectionOfPath("/settings/integrations/"), "integrations");
	assertEquals(sectionOfPath("/settings/nope"), null);
	assertEquals(sectionOfPath("/wallet"), null);
	assertEquals(resolveSectionKey("nope"), "account");
	assertEquals(resolveSectionKey("billing"), "billing");
	assertEquals(anchorId("theme"), "stg-theme");
	assertEquals(entryByAnchor("theme")?.section, "appearance");
	assertEquals(entryByAnchor("missing"), null);
});
// #endregion
