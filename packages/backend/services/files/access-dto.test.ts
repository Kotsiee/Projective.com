import { assertEquals, assertThrows } from "@std/assert";
import { accessRefusal, toAccessTargets, toItemAccess } from "./access-dto.ts";

const FILE = "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2";
const PERSON = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";

const ownerRead = {
	itemId: FILE,
	visibility: "restricted",
	standing: "owner",
	container: { kind: "personal" },
	grants: [
		{
			kind: "user",
			id: PERSON,
			role: "viewer",
			name: "Inès Duarte",
			detail: "@inesduarte",
			avatar: null,
			grantedAt: "2026-11-09T10:00:00+00:00",
		},
		{
			kind: "team",
			id: TEAM,
			role: "editor",
			name: "Northloop",
			detail: "Team",
			avatar: null,
			grantedAt: "2026-11-09T10:01:00+00:00",
		},
	],
	messageShares: 2,
	ownerId: "33333333-3333-4333-8333-333333333333",
};

Deno.test("the owner's read keeps the grants, the message shares and the live share link", () => {
	const access = toItemAccess(ownerRead, "slug1");
	assertEquals(access.standing, "owner");
	assertEquals(access.grants.map((g) => [g.kind, g.role]), [["user", "viewer"], ["team", "editor"]]);
	assertEquals(access.messageShares, 2);
	assertEquals(access.shareUrl, "/share/slug1");
	assertEquals(access.ownerId, "33333333-3333-4333-8333-333333333333");
	assertEquals(toItemAccess({ ...ownerRead, standing: "viewer", grants: [] }, null).ownerId, null);
});

Deno.test("an editor is never told the message shares or the share link, even if handed them", () => {
	const access = toItemAccess({ ...ownerRead, standing: "editor" }, "slug1");
	assertEquals(access.messageShares, null);
	assertEquals(access.shareUrl, null);
	assertEquals(access.grants.length, 2);
});

Deno.test("an entity's library carries its member switch; a drifted answer is a failure", () => {
	const access = toItemAccess({
		...ownerRead,
		grants: [],
		container: {
			kind: "entity",
			entityKind: "team",
			entityId: TEAM,
			name: "Northloop",
			memberAccess: false,
		},
	}, null);
	assertEquals(access.container, {
		kind: "entity",
		entityKind: "team",
		entityId: TEAM,
		name: "Northloop",
		memberAccess: false,
	});
	assertThrows(() => toItemAccess({ ...ownerRead, visibility: "everyone" }, null));
});

Deno.test("the picker's targets keep their kind and order", () => {
	const list = toAccessTargets([
		{ kind: "team", id: TEAM, name: "Northloop", detail: "Team", avatar: null },
		{ kind: "project", id: FILE, name: "Aurora rebrand", detail: "Project", avatar: null },
	]);
	assertEquals(list.targets.map((t) => t.kind), ["team", "project"]);
	assertEquals(toAccessTargets(null).targets, []);
});

Deno.test("each refusal is answered with what it means", () => {
	assertEquals(accessRefusal({ code: "PF404", message: "No such file" })?.status, 404);
	assertEquals(
		accessRefusal({ code: "42501", message: "Only the owner can change who can see this" }),
		{ status: 403, message: "Only the owner can change who can see this." },
	);
	assertEquals(
		accessRefusal({ code: "42501", message: "files: an archived library is read-only" })?.message,
		"This workspace is archived, so its files can't be changed.",
	);
	assertEquals(
		accessRefusal({ code: "22023", message: "You can share a file only with teams you belong to" }),
		{
			status: 422,
			message: "You can share a file only with teams you belong to.",
			errors: { grants: "refused" },
		},
	);
	assertEquals(accessRefusal({ code: "22P02" })?.status, 422);
	assertEquals(accessRefusal({ code: "XX000", message: "boom" }), null);
});
