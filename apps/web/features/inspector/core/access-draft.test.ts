import { assertEquals } from "@std/assert";
import { ACCESS_GRANTS_MAX, type ItemAccess } from "@projective/types/files";
import {
	addGrantee,
	addRefusalText,
	containerWithDraft,
	draftOf,
	grantsActive,
	isDirty,
	rebaseDraft,
	removeGrantee,
	rowErrors,
	setGrantRole,
	shownStanding,
	tierLabel,
	tierNote,
	toSetItemAccess,
} from "./access-draft.ts";

const ITEM = "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2";
const ANA = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

const access = (over: Partial<ItemAccess> = {}): ItemAccess => ({
	itemId: ITEM,
	visibility: "restricted",
	standing: "owner",
	container: { kind: "personal" },
	grants: [
		{
			kind: "user",
			id: ANA,
			role: "viewer",
			name: "Ana Reyes",
			detail: "@ana",
			avatar: null,
			grantedAt: "2026-11-09T00:00:00Z",
		},
	],
	messageShares: 0,
	shareUrl: null,
	ownerId: PROJECT,
	...over,
});

const team = { kind: "team" as const, id: TEAM, name: "Northloop", detail: "Team", avatar: null };

Deno.test("a fresh draft is the saved state and is clean", () => {
	const saved = draftOf(access());
	assertEquals(saved.memberAccess, null);
	assertEquals(isDirty(saved, draftOf(access())), false);
});

Deno.test("a draft carried onto a newer state keeps its own edits and takes the rest", () => {
	const previous = draftOf(access());
	const next = draftOf(access({ visibility: "link" }));
	const edited = addGrantee(previous, team).draft;
	const rebased = rebaseDraft(previous, next, edited);
	assertEquals(rebased.visibility, "link");
	assertEquals(rebased.grants.map((g) => g.kind), ["user", "team"]);
	const ownTier = rebaseDraft(previous, next, { ...previous, visibility: "public" });
	assertEquals(ownTier.visibility, "public");
	assertEquals(ownTier.grants, next.grants);
});

Deno.test("an entity library's member switch is part of the draft", () => {
	const saved = draftOf(access({
		container: {
			kind: "entity",
			entityKind: "team",
			entityId: TEAM,
			name: "Northloop",
			memberAccess: true,
		},
	}));
	assertEquals(saved.memberAccess, true);
	assertEquals(isDirty(saved, { ...saved, memberAccess: false }), true);
});

Deno.test("adding a grantee starts at Can view; a second add is a no-op; the cap refuses", () => {
	const saved = draftOf(access());
	const added = addGrantee(saved, team);
	assertEquals(added.refusal, null);
	assertEquals(added.draft.grants.at(-1)?.role, "viewer");
	assertEquals(isDirty(saved, added.draft), true);
	assertEquals(addGrantee(added.draft, team).refusal, "duplicate");
	assertEquals(addRefusalText("duplicate"), null);

	const full = {
		...saved,
		grants: Array.from({ length: ACCESS_GRANTS_MAX }, (_, i) => ({
			kind: "user" as const,
			id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
			role: "viewer" as const,
			name: `P${i}`,
			detail: null,
			avatar: null,
		})),
	};
	const refused = addGrantee(full, team);
	assertEquals(refused.refusal, "full");
	assertEquals(refused.draft, full);
	assertEquals(typeof addRefusalText("full"), "string");
});

Deno.test("reordering grants is not a change; a level change and a removal are", () => {
	const saved = draftOf(access());
	const two = addGrantee(saved, team).draft;
	const swapped = { ...two, grants: [...two.grants].reverse() };
	assertEquals(isDirty(two, swapped), false);
	assertEquals(isDirty(two, setGrantRole(two, `team:${TEAM}`, "editor")), true);
	assertEquals(removeGrantee(two, `user:${ANA}`).grants.length, 1);
});

Deno.test("the save carries only what changed, and the grants as the whole list", () => {
	const saved = draftOf(access());
	assertEquals(toSetItemAccess(ITEM, saved, saved, "owner"), null);
	assertEquals(toSetItemAccess(ITEM, saved, { ...saved, visibility: "link" }, "owner"), {
		itemId: ITEM,
		visibility: "link",
	});
	const added = addGrantee(saved, team).draft;
	assertEquals(toSetItemAccess(ITEM, saved, added, "owner"), {
		itemId: ITEM,
		grants: [
			{ kind: "user", id: ANA, role: "viewer" },
			{ kind: "team", id: TEAM, role: "viewer" },
		],
	});
});

Deno.test("an editor never sends the tier or the member switch; a viewer sends nothing", () => {
	const saved = { ...draftOf(access()), memberAccess: true };
	const draft = { ...saved, visibility: "public" as const, memberAccess: false };
	assertEquals(toSetItemAccess(ITEM, saved, draft, "editor"), null);
	const withTeam = addGrantee(draft, team).draft;
	assertEquals(Object.keys(toSetItemAccess(ITEM, saved, withTeam, "editor") ?? {}), [
		"itemId",
		"grants",
	]);
	assertEquals(toSetItemAccess(ITEM, saved, withTeam, "viewer"), null);
});

Deno.test("grants open the file at every tier but Private", () => {
	assertEquals(grantsActive("private"), false);
	for (const tier of ["restricted", "link", "public"] as const) {
		assertEquals(grantsActive(tier), true);
	}
});

Deno.test("Private names who still opens the file, following the draft's member switch", () => {
	const container = {
		kind: "entity" as const,
		entityKind: "team" as const,
		entityId: TEAM,
		name: "Northloop",
		memberAccess: true,
	};
	assertEquals(tierNote("private", container, true), "You and everyone in Northloop.");
	const off = containerWithDraft(container, {
		visibility: "private",
		memberAccess: false,
		grants: [],
	});
	assertEquals(tierNote("private", off, true), "You and Northloop's admins.");
	assertEquals(tierNote("private", { kind: "personal" }, true), "Only you can open it.");
	assertEquals(
		tierNote("private", { kind: "project", projectId: PROJECT, name: "Aurora Rebrand" }, false),
		"Its owner and everyone on Aurora Rebrand.",
	);
});

Deno.test("Private reads Only you to the owner of a personal file alone", () => {
	assertEquals(tierLabel("private", { kind: "personal" }, true), "Only you");
	assertEquals(tierLabel("private", { kind: "personal" }, false), "Private");
	assertEquals(tierLabel("restricted", { kind: "personal" }, true), "Specific people");
});

Deno.test("a refused save's errors land on the rows they name", () => {
	const sent = {
		itemId: ITEM,
		grants: [
			{ kind: "user" as const, id: ANA, role: "viewer" as const },
			{ kind: "team" as const, id: TEAM, role: "viewer" as const },
		],
	};
	assertEquals(
		rowErrors({
			"grants.1": "You're not in that team.",
			[`user:${ANA}`]: "No such person.",
			itemId: "x",
		}, sent),
		{ [`team:${TEAM}`]: "You're not in that team.", [`user:${ANA}`]: "No such person." },
	);
	assertEquals(rowErrors(undefined, sent), {});
});

Deno.test("a simulation stands in for the server's standing; auto and signed-out leave it", () => {
	assertEquals(shownStanding("viewer", "owner"), "owner");
	assertEquals(shownStanding("owner", "auto"), "owner");
	assertEquals(shownStanding("editor", "signed-out"), "editor");
});
