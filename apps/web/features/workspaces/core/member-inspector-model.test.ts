import { assertEquals } from "@std/assert";
import type { WorkspaceMember } from "@projective/types/workspace";
import {
	inspectedMember,
	MEMBER_PARAM,
	memberOfSearch,
	memberSearch,
} from "./member-inspector-model.ts";

/**
 * The member inspector's address (Decision #322): `?member=<handle>` set and dropped without touching
 * the surface's other parameters, and resolved only to an active member.
 */

type Person = Pick<WorkspaceMember, "id" | "handle" | "state">;

function person(handle: string, state: WorkspaceMember["state"] = "active"): Person {
	return { id: `id-${handle}`, handle, state };
}

Deno.test("inspector address: ?member= set and dropped, the rest kept", () => {
	assertEquals(MEMBER_PARAM, "member");
	assertEquals(memberSearch("", "ana"), "?member=ana");
	assertEquals(memberSearch("?view=chart", "ana"), "?view=chart&member=ana");
	assertEquals(memberSearch("?view=chart&member=ana", "bo"), "?view=chart&member=bo");
	assertEquals(memberSearch("?view=chart&member=ana", null), "?view=chart");
	assertEquals(memberSearch("?member=ana", null), "");
});

Deno.test("inspector address: a blank parameter names nobody", () => {
	assertEquals(memberOfSearch("?member=ana"), "ana");
	assertEquals(memberOfSearch("?member=%20"), null);
	assertEquals(memberOfSearch("?view=chart"), null);
});

Deno.test("inspector address: resolves an active member by handle, case- and @-insensitive", () => {
	const people = [person("Ana"), person("bo", "left")];
	assertEquals(inspectedMember(people, "ana")?.id, "id-Ana");
	assertEquals(inspectedMember(people, "@ANA")?.id, "id-Ana");
	assertEquals(inspectedMember(people, "bo"), null, "a member who left names nobody");
	assertEquals(inspectedMember(people, "ghost"), null);
	assertEquals(inspectedMember(people, null), null);
});
