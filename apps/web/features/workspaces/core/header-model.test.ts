import { assert, assertEquals } from "@std/assert";
import type {
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceStatus,
} from "@projective/types/workspace";
import {
	type FilledTier,
	headerBand,
	type HeaderBandInput,
	headerFilledCount,
	headerMenu,
	isFilledTier,
	type ModuleCommit,
} from "./header-model.ts";
import { MEMBERS_CHART, subViewsFor } from "./sub-views.ts";

/**
 * The workspace header band (Teams work order L2): Decision #220's three regions, at most one filled
 * control, the kebab's rows (which a right-click on the band also opens, Decision #222), and Archive
 * only for an `archive_entity` holder.
 */

// #region Fixtures
const MODULES = [
	"overview",
	"projects",
	"catalogue",
	"calendar",
	"messages",
	"members",
	"roles",
	"invitations",
	"finance",
	"payouts",
	"spend",
	"billing",
	"talent",
	"analytics",
	"standing",
	"profile",
	"verification",
	"settings",
] as const;

const OWNER: readonly WorkspaceCapability[] = [
	"invite_members",
	"remove_members",
	"manage_roles",
	"edit_profile",
	"manage_settings",
	"manage_projects",
	"manage_finances",
	"archive_entity",
];
const NO_ARCHIVE = OWNER.filter((c) => c !== "archive_entity");
const MEMBER: readonly WorkspaceCapability[] = [];

function commit(tier: FilledTier): ModuleCommit {
	return { key: "publish", label: "Publish team", tier, run: () => {} };
}

function input(overrides: Partial<HeaderBandInput> = {}): HeaderBandInput {
	const kind = overrides.kind ?? "team";
	const module = overrides.module ?? "members";
	const capabilities = overrides.capabilities ?? OWNER;
	return {
		kind,
		title: "Members",
		module,
		name: "North Loop",
		handle: "north-loop",
		status: "active",
		acting: false,
		owner: true,
		capabilities,
		subViews: subViewsFor(module, kind, capabilities),
		view: null,
		commit: null,
		...overrides,
	};
}

const NOOP = { copyHandle: () => {}, archive: () => {} };
const keys = (rows: { key?: string; separator?: boolean }[]) =>
	rows.filter((r) => !r.separator).map((r) => r.key);
// #endregion

// #region One filled control
Deno.test("header: at most ONE filled action in any module, for any viewer and commit", () => {
	const commits: (ModuleCommit | null)[] = [null, commit(1), commit(2), commit(3)];
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const module of MODULES) {
			for (const capabilities of [OWNER, NO_ARCHIVE, MEMBER]) {
				for (const status of ["draft", "active", "archived"] as WorkspaceStatus[]) {
					for (const c of commits) {
						const model = headerBand(input({ kind, module, capabilities, status, commit: c }));
						const filled = headerFilledCount(model);
						assert(filled <= 1, `${kind}/${module}/${status}: ${filled} filled`);
						assertEquals(filled, c ? 1 : 0);
					}
				}
			}
		}
	}
});

Deno.test("header: the utilities never fill — Share profile is tier 4, to the public profile", () => {
	const model = headerBand(input());
	assertEquals(model.utilities, [
		{ key: "share-profile", label: "Share profile", tier: 4, href: "/@north-loop" },
	]);
	assert(model.utilities.every((u) => !isFilledTier(u.tier)));
});

Deno.test("header: the module's commit is the band's, untouched (Members publishes none)", () => {
	assertEquals(headerBand(input()).commit, null);
	const publish = commit(3);
	assertEquals(headerBand(input({ module: "settings", commit: publish })).commit, publish);
});
// #endregion

// #region Archive and the kebab
Deno.test("header: Archive… only with archive_entity, never on an archived entity", () => {
	for (const module of MODULES) {
		for (const status of ["draft", "active", "archived"] as WorkspaceStatus[]) {
			for (const capabilities of [OWNER, NO_ARCHIVE, MEMBER]) {
				const model = headerBand(input({ module, status, capabilities, viewerCanArchive: null }));
				const rows = headerMenu(model, NOOP);
				const offered = rows.some((r) => r.key === "archive");
				const expected = capabilities.includes("archive_entity") && status !== "archived";
				assertEquals(offered, expected, `${module}/${status}`);
				assertEquals(model.menu.archive, expected);
			}
		}
	}
});

Deno.test("header: a business offers Archive… only when the server says it would go through", () => {
	// The server's `viewerCan.archive` already folds in archive_entity, the status and the blockers —
	// an owner with a wallet balance holds archive_entity yet must not be offered a confirm that fails.
	for (const status of ["draft", "active", "archived"] as WorkspaceStatus[]) {
		for (const viewerCanArchive of [true, false, null]) {
			const model = headerBand(
				input({
					kind: "business",
					module: "overview",
					status,
					capabilities: OWNER,
					viewerCanArchive,
				}),
			);
			const offered = headerMenu(model, NOOP).some((r) => r.key === "archive");
			assertEquals(offered, viewerCanArchive === true, `${status}/${viewerCanArchive}`);
			assertEquals(model.menu.archive, viewerCanArchive === true);
		}
	}
	// A team ignores the business-only flag: its rule is the capability, the status and its blockers.
	const team = headerBand(input({ module: "overview", viewerCanArchive: false }));
	assert(headerMenu(team, NOOP).some((r) => r.key === "archive"));
});

Deno.test("header: a team with a held escrow or live work is not offered Archive… (C6)", () => {
	for (const status of ["draft", "active"] as WorkspaceStatus[]) {
		const blocked = headerBand(input({ module: "overview", status, archiveBlocked: true }));
		assert(!headerMenu(blocked, NOOP).some((r) => r.key === "archive"), status);
		assertEquals(blocked.menu.archive, false);
		const clear = headerBand(input({ module: "overview", status, archiveBlocked: false }));
		assert(headerMenu(clear, NOOP).some((r) => r.key === "archive"), status);
	}
	assert(/archiveBlocked: ws\.archiveBlockers\.length > 0/.test(BAND), "the band reads the list");
	// …and a refusal Settings has had since the read, for this entity, so a failed re-read never
	// leaves the kebab offering an Archive… the server has just refused.
	assert(
		/archiveBlocked: ws\.archiveBlockers\.length > 0 \|\| archiveRefusal\.value\?\.id === ws\.id/
			.test(BAND),
		"the band honours a raced refusal",
	);
});

Deno.test("header: the kebab carries the public profile, Copy handle, the way out, then Archive…", () => {
	const rows = headerMenu(headerBand(input({ module: "overview" })), NOOP);
	assertEquals(keys(rows), [
		"view-profile",
		"link-open-new-tab",
		"copy-handle",
		"members",
		"archive",
	]);
	const byKey = Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r]));
	assertEquals(byKey["view-profile"].url, "/@north-loop");
	assertEquals(byKey["view-profile"].label, "View public profile");
	assertEquals(byKey["link-open-new-tab"].target, "_blank");
	assertEquals(byKey["copy-handle"].hint, "@north-loop");
	assertEquals(byKey["members"].url, "/teams/north-loop/members");
	assertEquals(byKey["members"].label, "Hand over ownership…");
	assertEquals(byKey["archive"].danger, true);
	assertEquals(byKey["archive"].label, "Archive…");
	// Groups are separated, never run together.
	assertEquals(rows.filter((r) => r.separator).length, 3);
});

Deno.test("header: a member leaves; on Members the row is left to the viewer's own roster row", () => {
	const member = headerMenu(headerBand(input({ module: "roles", owner: false })), NOOP);
	assertEquals(member.find((r) => r.key === "members")?.label, "Leave team…");
	const biz = headerMenu(
		headerBand(input({ kind: "business", module: "billing", owner: false })),
		NOOP,
	);
	assertEquals(biz.find((r) => r.key === "members")?.url, "/businesses/north-loop/members");
	assertEquals(biz.find((r) => r.key === "members")?.label, "Leave business…");
	assert(
		!headerMenu(headerBand(input({ module: "members" })), NOOP).some((r) => r.key === "members"),
	);
});

Deno.test("header: the kebab's rows run the band's handlers", () => {
	let copied = 0;
	let asked = 0;
	const rows = headerMenu(headerBand(input()), {
		copyHandle: () => copied++,
		archive: () => asked++,
	});
	const event = { originalEvent: new Event("click"), item: {} } as never;
	rows.find((r) => r.key === "copy-handle")?.command?.(event);
	rows.find((r) => r.key === "archive")?.command?.(event);
	assertEquals([copied, asked], [1, 1]);
});
// #endregion

// #region Regions
Deno.test("header: identity is the module title over name · @handle (· acting)", () => {
	const model = headerBand(input());
	assertEquals(model.title, "Members");
	assertEquals(model.meta, ["North Loop", "@north-loop"]);
	assertEquals(headerBand(input({ acting: true })).meta, [
		"North Loop",
		"@north-loop",
		"Acting as team",
	]);
	assertEquals(headerBand(input({ kind: "business" })).menuLabel, "Business actions");
});

Deno.test("header: the centred TabMenu appears only when the module partitions its body", () => {
	const members = headerBand(input({ view: MEMBERS_CHART }));
	assertEquals(members.tabs?.views.map((v) => v.value), ["people", "pending", "chart"]);
	assertEquals(members.tabs?.active, 2);
	for (const module of MODULES.filter((m) => m !== "members")) {
		assertEquals(headerBand(input({ module })).tabs, null, `${module} drew tabs`);
	}
	// Without the invite right the queue is not a tab.
	const plain = headerBand(input({ capabilities: MEMBER }));
	assertEquals(plain.tabs?.views.map((v) => v.value), ["people", "chart"]);
});
// #endregion

// #region Rendered band — source scan
/*
 * The island cannot be rendered under `deno test` (every `@projective/ui` component imports CSS), so
 * these read its source: what it draws, and that the kebab and the right-click open ONE model.
 */
function source(file: string): string {
	return Deno.readTextFileSync(new URL(file, import.meta.url))
		.replaceAll("\r\n", "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/.*$/gm, "$1");
}

const BAND = source("../islands/WorkspaceHeaderBand.island.tsx");

Deno.test("header band: no raw <button>, no action-styled anchor, no hand-rolled tab strip", () => {
	assert(!/<button\b/.test(BAND), "the band renders a raw <button>");
	assert(!/<a\b[^>]*class="[^"]*action/.test(BAND), "the band renders an action-styled <a>");
	assert(!/<a\b/.test(BAND), "the band renders a raw <a>");
	assert(!/wsp-headerband__tab\b|<nav\b/.test(BAND), "the hand-rolled tab strip is back");
	assert(!/<Popover\b/.test(BAND), "the Popover menu is back");
	assertEquals(BAND.match(/<TabMenu\b/g)?.length, 1);
});

Deno.test("header band: the kebab and a right-click on the band open the same ActionMenu rows", () => {
	const menus = [...BAND.matchAll(/<ActionMenu\b[\s\S]*?\n\t\t\t\t\/>/g)].map((m) => m[0]);
	assertEquals(menus.length, 1, "exactly one ActionMenu");
	assert(/\bmodel=\{menu\}/.test(menus[0]));
	assert(/\bsurface=\{bandRef\}/.test(menus[0]), "the band is the menu's surface");
	assert(/\btrigger=\{/.test(menus[0]), "the kebab triggers it");
	assert(/<Button\b[\s\S]*?\btriggerRef=\{api\.ref\}[\s\S]*?\biconOnly\b/.test(menus[0]));
	assert(/variant="text"/.test(menus[0]), "the kebab is a tier-5 text Button");
	assert(/const menu = headerMenu\(model,/.test(BAND), "the rows are the model's");
	assert(/ref=\{bandRef\}\s+class="wsp-headerband"/.test(BAND), "the surface is the band root");
});

/** Every `<Button … />` element in a source, read to its own `/>` (JSX inside `{…}` skipped). */
function buttonElements(text: string): string[] {
	const out: string[] = [];
	for (let at = text.indexOf("<Button"); at >= 0; at = text.indexOf("<Button", at + 1)) {
		let depth = 0;
		for (let i = at + 1; i < text.length; i++) {
			const ch = text[i];
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (depth === 0 && ch === "/" && text[i + 1] === ">") {
				out.push(text.slice(at, i + 2));
				break;
			}
		}
	}
	return out;
}

Deno.test("header band: only the commit can fill — every other Button is outlined or text", () => {
	const [body, commitButton] = BAND.split("function CommitButton");
	assert(buttonElements(body).length >= 3, "the band's Buttons were not found");
	for (const element of buttonElements(body)) {
		assert(
			/\bvariant="(outlined|text)"/.test(element),
			`a filled <Button> outside the commit: ${element}`,
		);
	}
	assert(/<CommitButton commit=\{model\.commit\} \/>/.test(body));
	assert(/severity="accent" rounded/.test(commitButton), "tier 1 is the amber pill");
	assert(/\bstructural\b/.test(commitButton), "tier 2 is the structural tone");
});

Deno.test("header band: Archive confirms as a danger before anything changes", () => {
	assert(/<ConfirmDialog\b[\s\S]*?acceptSeverity="danger"/.test(BAND));
	assert(/archive: \(\) => \{\s*confirmArchive\.value = true;/.test(BAND));
	assert(/viewerCanArchive: ws\.viewerCan\?\.archive/.test(BAND), "a business asks the server");
});

Deno.test("header band: its state, actions, kebab and render regions are grouped (§7)", () => {
	const raw = Deno.readTextFileSync(
		new URL("../islands/WorkspaceHeaderBand.island.tsx", import.meta.url),
	);
	const opened = raw.match(/#region\b/g)?.length ?? 0;
	assert(opened >= 6, `only ${opened} regions`);
	assertEquals(opened, raw.match(/#endregion\b/g)?.length);
});
// #endregion
