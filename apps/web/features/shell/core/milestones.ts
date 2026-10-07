import { signal } from "@preact/signals";
import { stampRank, type VerificationStamp, VerificationStampSchema } from "@projective/types/org";
import type { AccountSetup } from "@projective/types/user";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * milestones — the account's high-stakes moments (a verification stamp landing, setup reaching 100%)
 * and the shared state that lets the header celebrate them in place (Decision #155): no blocking
 * modal, a stamp animation on the crest that is already there plus one transient toast.
 *
 * The account popover publishes the setup it renders to {@link accountSetupSnapshot}; the
 * `MilestoneCelebration` island compares it with the last mark this device saw and, on a raise,
 * sets {@link celebrating} for one animation and announces it.
 */

// #region Shared state
/** The setup the account popover is rendering (after any dev simulation), or `null` before it loads. */
export const accountSetupSnapshot = signal<AccountSetup | null>(null);

/** The milestone being celebrated right now, or `null`. Drives the crest's one-shot stamp animation. */
export const celebrating = signal<MilestoneKind | null>(null);
// #endregion

// #region The rule
/** A milestone worth celebrating. */
export type MilestoneKind =
	| "id_verified"
	| "vault_verified"
	| "corporate_verified"
	| "setup_complete";

/** What a device remembers about a person's milestones. */
export interface MilestoneMark {
	stamp: VerificationStamp;
	complete: boolean;
}

/** The mark a setup read stands for. */
export function markOf(setup: AccountSetup): MilestoneMark {
	return { stamp: setup.verificationStamp, complete: setup.progress.score >= 100 };
}

/**
 * The milestone `next` reached over `prev`, or `null`. A first sighting (`prev` null) only sets the
 * baseline — a person is never congratulated for a state they already held. A stamp raise outranks
 * setup reaching 100%; a lowered stamp or setup is never celebrated.
 */
export function milestoneReached(
	prev: MilestoneMark | null,
	next: MilestoneMark,
): MilestoneKind | null {
	if (!prev) return null;
	if (next.stamp !== "none" && stampRank(next.stamp) > stampRank(prev.stamp)) return next.stamp;
	if (next.complete && !prev.complete) return "setup_complete";
	return null;
}

/** The toast each milestone announces. States only what the milestone actually unlocks. */
export const MILESTONE_TOAST: Readonly<Record<MilestoneKind, { summary: string; detail: string }>> =
	{
		id_verified: {
			summary: "Identity verified",
			detail: "Your profile now carries the identity crest. Add a payout account to start earning.",
		},
		vault_verified: {
			summary: "Payout account verified",
			detail:
				"Clients can now hire you onto escrow-backed stages, and released escrow is paid out to you.",
		},
		corporate_verified: {
			summary: "Business verified",
			detail: "Your business profile now carries the corporate crest.",
		},
		setup_complete: {
			summary: "Profile set up",
			detail: "Every setup step is done.",
		},
	};
// #endregion

// #region Device memory
type SeenMarks = Record<string, MilestoneMark>;

function parseMark(raw: unknown): MilestoneMark | null {
	if (!raw || typeof raw !== "object") return null;
	const value = raw as { stamp?: unknown; complete?: unknown };
	const stamp = VerificationStampSchema.safeParse(value.stamp);
	if (!stamp.success || typeof value.complete !== "boolean") return null;
	return { stamp: stamp.data, complete: value.complete };
}

function readMarks(): SeenMarks {
	const raw = readStored("local", LocalKeys.SEEN_MILESTONES);
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		const marks: SeenMarks = {};
		for (const [handle, value] of Object.entries(parsed as Record<string, unknown>)) {
			const mark = parseMark(value);
			if (mark) marks[handle] = mark;
		}
		return marks;
	} catch {
		return {};
	}
}

/** The last mark this device saw for a person, or `null` on a first visit. */
export function seenMark(handle: string): MilestoneMark | null {
	return readMarks()[handle] ?? null;
}

/** Remember the mark this device has now seen for a person. */
export function rememberMark(handle: string, mark: MilestoneMark): void {
	writeStored(
		"local",
		LocalKeys.SEEN_MILESTONES,
		JSON.stringify({ ...readMarks(), [handle]: mark }),
	);
}
// #endregion
