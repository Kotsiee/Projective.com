import { assert, assertEquals } from "@std/assert";
import type {
	MemberStagePicture,
	MemberViewerCaps,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { type MemberMenuInput, memberMenuModel } from "./member-menu.ts";

/**
 * The member kebab's model, pinned. Each item is a promise that the action exists for this viewer and
 * this person: an "Invite to stage" that cascades into a stage they already hold, or a "Remove from
 * stage" on someone who holds none, would render a control that does nothing (UI gate 11).
 */

const ALL: MemberViewerCaps = {
	canManage: true,
	canInvite: true,
	canAssign: true,
	canEditRoles: true,
	canRemove: true,
};

const member: ProjectMemberRow = {
	id: "m-juno",
	party: { name: "Juno Park", avatar: null, handle: "@juno" },
	email: "juno@example.com",
	role: "freelancer",
	assignment: null,
	presence: "offline",
	assignedStages: ["Discovery"],
	openTickets: 0,
	ticketsLabel: "—",
	joinedAt: "2026-07-01T00:00:00Z",
	joinedLabel: "Jul 1, 2026",
	isViewer: false,
};

const picture: MemberStagePicture = {
	held: [{ id: "s1", name: "Discovery" }],
	pending: [],
	available: [{ id: "s2", name: "Design" }, { id: "s3", name: "Build" }],
};

function input(overrides: Partial<MemberMenuInput> = {}): MemberMenuInput {
	return {
		member,
		stageChannel: false,
		picture,
		caps: ALL,
		manageable: true,
		onEdit: () => {},
		onInviteToStages: () => {},
		onRemove: () => {},
		...overrides,
	};
}

const keys = (model: ReturnType<typeof memberMenuModel>) => model.map((item) => item.key);

Deno.test("project scope cascades invite and remove into stage lists", () => {
	const model = memberMenuModel(input());
	assertEquals(keys(model), [
		"profile",
		"role",
		"invite-to-stage",
		"remove-from-stage",
		"sep-remove",
		"remove",
	]);
	const invite = model.find((item) => item.key === "invite-to-stage");
	assertEquals(invite?.items?.map((item) => item.label), ["Design", "Build"]);
	const remove = model.find((item) => item.key === "remove-from-stage");
	assertEquals(remove?.items?.map((item) => item.label), ["Discovery"]);
	assert(remove?.danger);
});

Deno.test("picking a stage invites to exactly that stage; removing names it", () => {
	const invited: string[][] = [];
	const removed: (string | null)[] = [];
	const model = memberMenuModel(input({
		onInviteToStages: (_m, ids) => invited.push(ids),
		onRemove: (_m, stage) => removed.push(stage?.id ?? null),
	}));
	const event = { item: {}, originalEvent: new Event("click") };
	model.find((i) => i.key === "invite-to-stage")?.items?.[1].command?.(event);
	model.find((i) => i.key === "remove-from-stage")?.items?.[0].command?.(event);
	model.find((i) => i.key === "remove")?.command?.(event);
	assertEquals(invited, [["s3"]]);
	assertEquals(removed, ["s1", null]);
});

Deno.test("a member on every stage gets an empty submenu that says so", () => {
	const full = memberMenuModel(input({
		picture: { held: picture.held, pending: [], available: [] },
	}));
	const invite = full.find((item) => item.key === "invite-to-stage");
	assertEquals(invite?.items, []);
	assertEquals(invite?.emptyLabel, "Already on every stage");
});

Deno.test("a stage channel names its one stage instead of cascading", () => {
	const offer = memberMenuModel(input({
		stageChannel: true,
		picture: { held: [], pending: [], available: [{ id: "s2", name: "Design" }] },
	}));
	assertEquals(offer.find((i) => i.key === "invite-s2")?.label, "Invite to Design");

	const holds = memberMenuModel(input({
		stageChannel: true,
		picture: { held: [{ id: "s2", name: "Design" }], pending: [], available: [] },
	}));
	assertEquals(holds.find((i) => i.key === "remove-s2")?.label, "Remove from Design");
	assertEquals(holds.some((i) => i.key?.startsWith("invite")), false);
});

Deno.test("no stage picture, no stage actions — and no management without the gate", () => {
	assertEquals(keys(memberMenuModel(input({ picture: null }))), [
		"profile",
		"role",
		"sep-remove",
		"remove",
	]);
	assertEquals(keys(memberMenuModel(input({ manageable: false }))), ["profile"]);
	assertEquals(
		keys(memberMenuModel(input({ caps: { ...ALL, canInvite: false, canRemove: false } }))),
		["profile", "role"],
	);
});
