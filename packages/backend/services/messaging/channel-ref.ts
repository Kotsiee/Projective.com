import { WorkspaceKind } from "@projective/types/workspace";

/**
 * channel-ref — the fixture address of an entity channel (Decision #306) while the messaging stack
 * answers from fixtures (`MESSAGING_BACKEND_LIVE` off, or `dev:mock`).
 *
 * Live, a channel's conversation id is its `comms.dm_threads` uuid. The fixture corpus holds no such
 * row, so the workspace console hands the chat island `ch-{kind}.{handle}.{slug}` instead, and the
 * conversation fixtures synthesise that room on demand. Neither a handle nor a channel slug can hold
 * a `.`, so the three parts split back unambiguously.
 */

// #region Address

const PREFIX = "ch-";

/** A channel's address as the conversation fixtures resolve it. */
export interface FixtureChannelRef {
	kind: WorkspaceKind;
	handle: string;
	slug: string;
}

/** The fixture conversation id of an entity channel. */
export function fixtureChannelConversationId(ref: FixtureChannelRef): string {
	return `${PREFIX}${ref.kind}.${ref.handle}.${ref.slug}`;
}

/** The channel a fixture conversation id names, or `null` when it is not one. */
export function parseFixtureChannelConversationId(id: string): FixtureChannelRef | null {
	if (!id.startsWith(PREFIX)) return null;
	const parts = id.slice(PREFIX.length).split(".");
	if (parts.length !== 3) return null;
	const [rawKind, handle, slug] = parts;
	const kind = WorkspaceKind.safeParse(rawKind);
	if (!kind.success || handle.length === 0 || slug.length === 0) return null;
	return { kind: kind.data, handle, slug };
}

// #endregion
