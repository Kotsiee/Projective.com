import { assertEquals } from "@std/assert";
import type { MemberRosterPage } from "../types/projects-types.ts";
import {
	memberContextFor,
	memberSectionHref,
	memberSectionsFor,
	resolveMemberSection,
	sessionSeatLine,
} from "./member-sections.ts";

/**
 * The Members tab's section and project-type rules, pinned. A wrong answer here offers a management
 * queue to someone who cannot act on it, shows stage controls on an engagement without stages, or
 * states a seat figure the roster does not support.
 */

const MANAGER = {
	canManage: true,
	canInvite: true,
	canAssign: true,
	canEditRoles: true,
	canRemove: true,
};
const OBSERVER = {
	canManage: false,
	canInvite: false,
	canAssign: false,
	canEditRoles: false,
	canRemove: false,
};

function page(overrides: Partial<MemberRosterPage> = {}): MemberRosterPage {
	return {
		scope: "project",
		projectId: "prj-test000001",
		channelId: null,
		channelName: null,
		channelKind: null,
		stageId: null,
		projectTitle: "Helia",
		format: "pipeline",
		members: [],
		invites: [],
		requests: [],
		session: null,
		stages: [{ id: "stg-a", name: "Discovery" }],
		viewerId: "m-1",
		viewerRole: "client",
		viewerCaps: MANAGER,
		total: 0,
		...overrides,
	};
}

Deno.test("only a viewer who can invite is offered the two management queues", () => {
	assertEquals(memberSectionsFor(page()), ["members", "requests", "invitations"]);
	assertEquals(memberSectionsFor(page({ viewerCaps: OBSERVER })), ["members"]);
	assertEquals(memberSectionsFor(page({ scope: "conversation" })), ["members"]);
	assertEquals(memberSectionsFor(null), ["members"]);
});

Deno.test("an address naming a section the viewer is not offered lands on Members", () => {
	assertEquals(
		resolveMemberSection("requests", ["members", "requests", "invitations"]),
		"requests",
	);
	assertEquals(resolveMemberSection("requests", ["members"]), "members");
	assertEquals(resolveMemberSection("nonsense", ["members", "requests"]), "members");
	assertEquals(resolveMemberSection(null, ["members", "requests"]), "members");
});

Deno.test("the section is written to the address, every other parameter kept", () => {
	const base = "https://projective.test/projects/prj-a/members?tkv=tkt-1";
	assertEquals(
		memberSectionHref(base, "requests"),
		"/projects/prj-a/members?tkv=tkt-1&view=requests",
	);
	assertEquals(
		memberSectionHref(`${base}&view=requests`, "members"),
		"/projects/prj-a/members?tkv=tkt-1",
	);
});

Deno.test("stages are a dimension on a pipeline only", () => {
	assertEquals(memberContextFor(page()).showStages, true);
	assertEquals(memberContextFor(page({ format: "one_off" })).showStages, false);
	assertEquals(memberContextFor(page({ format: "session" })).showStages, false);
	assertEquals(memberContextFor(page({ stages: [] })).showStages, false);
});

Deno.test("a session's mode follows the server, and the dev service type can re-shape it", () => {
	const session = page({
		format: "session",
		session: { mode: "group", seatCap: 12, seatsTaken: 8, nextSlotLabel: null },
	});
	assertEquals(memberContextFor(session).session, "group");
	assertEquals(memberContextFor(session, "normal_session").session, "solo");
	assertEquals(memberContextFor(page()).session, null);
});

Deno.test("the seat line states capacity in words, and nothing without a seat picture", () => {
	const capped = page({
		format: "session",
		session: { mode: "group", seatCap: 12, seatsTaken: 8, nextSlotLabel: null },
	});
	assertEquals(sessionSeatLine(capped, "group"), "8 of 12 seats · 4 open");
	const open = page({
		format: "session",
		session: { mode: "group", seatCap: null, seatsTaken: 5, nextSlotLabel: null },
	});
	assertEquals(sessionSeatLine(open, "group"), "5 attending");
	assertEquals(sessionSeatLine(page(), null), null);
});
