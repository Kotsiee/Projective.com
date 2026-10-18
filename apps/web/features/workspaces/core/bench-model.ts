import type { MenuItem } from "@ui/types/mod.ts";
import type { BenchEntry, BenchPartyKind } from "@projective/types/workspace";
import { profileHref } from "@features/projects/core/routing.ts";
import { BUSINESS_REFUSAL_COPY } from "./refusal-copy.ts";

/**
 * bench-model — the pure rules of the Talent module's bench (Decision #230 (i), #241): where a row's
 * actions go, when one is refused and why, and the one-line summary over the table. No I/O, no CSS in
 * the import graph, so it is unit-tested directly.
 *
 * Every row action lands on a working surface (§3.11), or is refused with the reason:
 *   - **View profile** — the party's `/@handle` profile; refused when it does not open for the viewer
 *     (`profileVisible` — a team starts invite-only, a person may go private).
 *   - **Message** — the viewer's direct conversation with the freelancer, or with a team's OWNER (a
 *     conversation is between two people), opened by the caller's `onMessage`; refused when that
 *     person is the viewer.
 *   - **Add to project** — the re-hire: the party's profile with its own Add-to-project picker open
 *     (`?add=1`, read once by the profile hero), the platform's one working flow for bringing a
 *     freelancer or team onto a project. Refused, with the reason, while the business cannot hire,
 *     when the viewer manages the party's profile (the profile offers its manager no picker), and when
 *     the profile does not open for them.
 */

// #region Labels & addresses
/** A bench party's kind, as the Kind column prints it (text, never a tag — §B.11). */
export const BENCH_KIND_LABEL: Readonly<Record<BenchPartyKind, string>> = {
	freelancer: "Freelancer",
	team: "Team",
};

/** The party's public profile: `/@handle`. */
export function benchProfileHref(handle: string): string {
	return profileHref(handle);
}

/**
 * The re-hire: the party's profile with its Add-to-project popover open on arrival. The profile hero
 * reads `?add=1` once and strips it (ROUTING.md — the profile's deep links).
 */
export function benchAddToProjectHref(handle: string): string {
	return `${profileHref(handle)}?add=1`;
}
// #endregion

// #region Row menu
/** What a row's menu needs to know about the viewer and the business. */
export interface BenchMenuContext {
	/** The business's display name, for the refusal sentence. */
	businessName: string;
	/** `viewerCan.hire` — the capability AND an active business (Decision #236). */
	canHire: boolean;
	/** The viewer's own handle, so their own row (or their own team's) is not offered to them. */
	viewerHandle: string | null;
	/** Opens the conversation with the row's contact. */
	onMessage: (entry: BenchEntry) => void;
}

/**
 * Why the row's Message would reach the viewer themself — it is them, or a team they own (a team is
 * messaged through its owner) — else `null`.
 */
export function benchSelfReason(entry: BenchEntry, viewerHandle: string | null): string | null {
	if (!viewerHandle) return null;
	if (entry.kind === "freelancer" && entry.handle === viewerHandle) return "That's you.";
	if (entry.kind === "team" && entry.contact?.handle === viewerHandle) {
		return `You run ${entry.name}.`;
	}
	return null;
}

/**
 * Why the viewer cannot bring this party onto a project from its profile because they manage that
 * profile — it is them, a team they own, or one they administer — else `null`. The profile hero offers
 * no Add-to-project picker to whoever manages it, so the row must not send them there.
 */
export function benchManagedReason(entry: BenchEntry, viewerHandle: string | null): string | null {
	const self = benchSelfReason(entry, viewerHandle);
	if (self) return self;
	if (!entry.viewerManages) return null;
	return entry.kind === "team"
		? `You manage ${entry.name}.`
		: `You manage ${entry.name}'s profile.`;
}

/** Why the party's profile does not open for the viewer, else `null`. */
export function benchClosedReason(entry: BenchEntry): string | null {
	return entry.profileVisible ? null : `${entry.name}'s profile isn't public.`;
}

/** The row's link: the party's profile, or `null` when it does not open for the viewer. */
export function benchRowHref(entry: BenchEntry): string | null {
	return entry.profileVisible ? benchProfileHref(entry.handle) : null;
}

/** The row's three actions — View profile · Message · Add to project — each doing something or saying why not. */
export function benchMenu(entry: BenchEntry, ctx: BenchMenuContext): MenuItem[] {
	const self = benchSelfReason(entry, ctx.viewerHandle);
	const closed = benchClosedReason(entry);
	const contact = entry.contact;

	const messageRefusal = self ??
		(contact ? null : `Nobody at ${entry.name} can be messaged yet.`);
	const message: MenuItem = messageRefusal
		? {
			key: "message",
			label: "Message",
			icon: "message",
			disabled: true,
			disabledReason: messageRefusal,
		}
		: {
			key: "message",
			label: "Message",
			icon: "message",
			command: () => ctx.onMessage(entry),
			...(entry.kind === "team" && contact
				? { hint: `Reaches ${contact.name || `@${contact.handle}`}, who runs ${entry.name}` }
				: {}),
		};

	const addRefusal = !ctx.canHire
		? BUSINESS_REFUSAL_COPY.business_not_active.sentence({ business: ctx.businessName })
		: benchManagedReason(entry, ctx.viewerHandle) ?? closed;
	const add: MenuItem = addRefusal
		? {
			key: "add",
			label: "Add to project",
			icon: "plus",
			disabled: true,
			disabledReason: addRefusal,
		}
		: {
			key: "add",
			label: "Add to project",
			icon: "plus",
			url: benchAddToProjectHref(entry.handle),
		};

	const profile: MenuItem = closed
		? {
			key: "profile",
			label: "View profile",
			icon: "user",
			disabled: true,
			disabledReason: closed,
		}
		: { key: "profile", label: "View profile", icon: "user", url: benchProfileHref(entry.handle) };

	return [profile, message, add];
}
// #endregion

// #region Summary
/**
 * The facts over the table, for a MetaLine: how many sit on the bench and how many are working now.
 * `[]` for an empty bench (the empty state says it instead).
 */
export function benchSummary(entries: readonly BenchEntry[]): string[] {
	if (entries.length === 0) return [];
	const live = entries.filter((e) => e.liveNow).length;
	return [`${entries.length} on the bench`, ...(live > 0 ? [`${live} working now`] : [])];
}
// #endregion
