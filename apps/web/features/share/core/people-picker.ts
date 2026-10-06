import type { ContactTier, RankedContact } from "@projective/types/messaging";

/**
 * people-picker — the pure rules behind the share and invite modals' person rows (Decision #145):
 * the Quick Add rail and the search popover. Both render ranked contacts from the same server
 * ranking; these helpers decide what a row says about the relationship, who is left out, and which
 * action a row offers right now.
 */

// #region Row state
/**
 * Where one person's action stands: `idle` offers it, `busy` is in flight, `done` succeeded this
 * session, `blocked` is already true of them (an open invitation) — the last two render disabled.
 */
export type PersonActionState = "idle" | "busy" | "done" | "blocked";

/** Whether a row in this state can be acted on. */
export function canAct(state: PersonActionState): boolean {
	return state === "idle";
}
// #endregion

// #region Relationship line
/**
 * The short relationship phrase each tier earns, rendered as inline meta text (never a chip — the
 * row's only control is its action, DESIGN_SYSTEM §B.11). `none` is a directory hit and says nothing.
 */
const RELATION_PHRASE: Readonly<Record<ContactTier, string | null>> = {
	shared_entity: "In your workspace",
	mutual_follow: "Follow each other",
	follows: "Following",
	collaborated: "Worked together",
	conversed: "Messaged",
	none: null,
};

/** The row's meta line — `@handle · relationship`, whichever parts exist. */
export function contactMeta(contact: Pick<RankedContact, "handle" | "tier">): string {
	const handle = contact.handle ? `@${normaliseHandle(contact.handle)}` : null;
	return [handle, RELATION_PHRASE[contact.tier]].filter((part): part is string => !!part).join(
		" · ",
	);
}
// #endregion

// #region Identity
/** A handle compared the way the server compares it: without the `@`, case-insensitively. */
export function normaliseHandle(handle: string | null | undefined): string | null {
	const bare = (handle ?? "").trim().replace(/^@+/, "").toLowerCase();
	return bare.length > 0 ? bare : null;
}

/** The handles of a list of parties, normalised — the exclusion set a roster yields. */
export function handleSet(
	parties: Iterable<{ handle?: string | null } | null | undefined>,
): Set<string> {
	const out = new Set<string>();
	for (const party of parties) {
		const handle = normaliseHandle(party?.handle);
		if (handle) out.add(handle);
	}
	return out;
}

/** The contacts not already in `handles`. A contact with no handle cannot be addressed, so it goes too. */
export function withoutHandles(
	contacts: readonly RankedContact[],
	handles: ReadonlySet<string>,
): RankedContact[] {
	return contacts.filter((contact) => {
		const handle = normaliseHandle(contact.handle);
		return handle !== null && !handles.has(handle);
	});
}
// #endregion

// #region Free-text addresses
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The query as an email address an invitation can be sent to, or `null`. */
export function emailFromQuery(query: string): string | null {
	const value = query.trim().toLowerCase();
	return EMAIL_RE.test(value) && value.length <= 160 ? value : null;
}
// #endregion
