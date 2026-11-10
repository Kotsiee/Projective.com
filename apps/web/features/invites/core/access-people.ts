import type { InviteRoleOption } from "./invite-queue.ts";

/**
 * access-people — the Invite modal's "People with access" list (Decision #405), as plain data each
 * surface builds from its own roster and rank rules. The modal renders what it is given and never
 * decides who may change whom: `roles` is present only where the surface's rule allows a role change,
 * `removable` only where it allows a removal.
 */

/** One person who already has access. */
export interface AccessPerson {
	/** The surface's member id — what a role change or a removal is addressed to. */
	key: string;
	name: string;
	/** Without the `@`, or `null` when the person has none. */
	handle: string | null;
	avatar: string | null;
	roleId: string;
	/** The role as read on a row that cannot be changed. */
	roleLabel: string;
	/** The roles this row may be moved to, its own included; `null` when it cannot be changed. */
	roles: readonly InviteRoleOption[] | null;
	removable: boolean;
	/** The viewer's own row. */
	self: boolean;
	/** The row holds the entity's top seat (an owner), listed first. */
	owner: boolean;
}

/** Owner first, then the viewer, then everyone else by name. */
export function sortAccess(people: readonly AccessPerson[]): AccessPerson[] {
	const rank = (p: AccessPerson) => (p.owner ? 0 : p.self ? 1 : 2);
	return [...people].sort((a, b) =>
		rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
	);
}

/** The roles a row's picker lists: its own role kept at the top when it is not on offer. */
export function rowRoleOptions(
	person: Pick<AccessPerson, "roleId" | "roleLabel">,
	offered: readonly InviteRoleOption[],
): InviteRoleOption[] {
	return offered.some((r) => r.id === person.roleId)
		? [...offered]
		: [{ id: person.roleId, name: person.roleLabel }, ...offered];
}
