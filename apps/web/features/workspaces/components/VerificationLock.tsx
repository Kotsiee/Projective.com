import type { ComponentChildren, JSX, VNode } from "preact";
import { cx } from "@ui/core/cx.ts";
import { kindCopy, type VerificationState, type WorkspaceKind } from "@projective/types/workspace";

/**
 * VerificationLock — the shared KYC/KYB gate for the `/teams` and `/businesses` console.
 *
 * ## The distinction this component exists to encode
 *
 * Two kinds of gate sit on this surface and they behave **differently on purpose**:
 *
 *   - A **capability** the viewer does not hold is **ABSENT**. A member never sees Access, never sees
 *     Distribute, never sees the approval ladder. There is no locked shadow of it, because a permission
 *     they will not be given is not a path they can walk, and showing it would only advertise a wall.
 *   - A **verification** step they are permitted to complete is **RENDERED AND LOCKED**, with the lock
 *     glyph and the next step attached. Removing it would hide the route to getting paid; locking it
 *     teaches that route.
 *
 * That is why this component is only ever mounted where the viewer *may* act, and why it always names a
 * next step — including when the person who must act is somebody else. A lock without a way out is a
 * dead end, and a dead end on the path to being paid is the worst failure this surface can have.
 *
 * ## The one lock on the surface
 *
 * `.wsp-lock` is the only block in the feature's stylesheets that draws a lock, and `LockGlyph` is the
 * only padlock the feature draws at all. It marks a **process step the viewer can finish** — never money
 * they hold, and never a permission they lack. Everything else that is unavailable is simply not there.
 *
 * ## Verified renders nothing
 *
 * A cleared gate is not a green tick to be collected; it is the absence of an obstacle. Once
 * `verification === "verified"` (or the server stops sending a prompt) this component returns `null`, so
 * a finished entity's console carries no residue of the setup it has already completed.
 */

// #region The lock glyph
/**
 * The padlock.
 *
 * Deliberately local rather than added to `core/workspace-glyphs.tsx`: the shared register is a
 * navigation and module vocabulary, and a lock is not a destination. Keeping it here means the one place
 * that draws a lock is also the one place that owns it, and a future contributor cannot casually reach
 * for a padlock to decorate something that is merely unavailable.
 *
 * Drawn on the register's own terms — a `0 0 24 24` box at `1em` in `currentColor`, `stroke-width: 1.8`
 * — so it sits in the same icon system as every other glyph on the surface (§B.6).
 */
const LockGlyph: VNode = (
	<svg
		viewBox="0 0 24 24"
		width="1em"
		height="1em"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
		<path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
		<path d="M12 14v2.5" />
	</svg>
);
// #endregion

// #region Copy
/**
 * The fallback headline, when the server sent no prompt but the gate is genuinely open.
 *
 * Phrased as what is WITHHELD rather than as a fault, and per kind: a team's members verify themselves
 * so the team can be paid; a business verifies the company so its pooled wallet can operate.
 */
function fallbackText(kind: WorkspaceKind): string {
	return kind === "team"
		? "Payouts are on hold until identity checks are finished."
		: "The pooled wallet is on hold until the company is verified.";
}

/** What "pending" means, which is emphatically not "something is wrong". */
function pendingText(kind: WorkspaceKind): string {
	const copy = kindCopy(kind);
	return `${copy.verification} is with our reviewers.`;
}

/**
 * The next step, always named.
 *
 * Three cases, and none of them is a dead end:
 *   - **Pending** — nothing to do, so the step is "wait", stated as a duration rather than as silence.
 *   - **Actionable** — the viewer can finish it, so the step is the link beside this text.
 *   - **Somebody else's** — the viewer cannot open Verification, so the step names WHO can. A member
 *     staring at a locked payout needs to know who to ask, not merely that they personally cannot.
 */
function promptFor(kind: WorkspaceKind, state: VerificationState, canManage: boolean): string {
	const copy = kindCopy(kind);
	if (state === "pending") {
		return `Most ${copy.verification} reviews finish within two working days. ` +
			"Nothing else is needed from you meanwhile.";
	}
	if (canManage) {
		return kind === "team"
			? "Everything else keeps working — only the payout itself waits on this."
			: "You can set limits and compose spend rules now; only moving money waits on this.";
	}
	return `An owner or admin can finish ${copy.verification} from the ${copy.noun}'s Verification page.`;
}

/** The link's label — an instruction, never a bare "Continue". */
function linkLabel(kind: WorkspaceKind, state: VerificationState): string {
	const copy = kindCopy(kind);
	if (state === "pending") return "See what's outstanding";
	return `Finish ${copy.verification}`;
}
// #endregion

// #region Component
export interface VerificationLockProps {
	/** The entity kind — decides whether the instrument is KYC or KYB, and whose identity is checked. */
	kind: WorkspaceKind;
	/** The gate's state. `verified` renders nothing. */
	verification: VerificationState;
	/**
	 * The server's own explanation of what clears the gate (`WorkspaceDetail.verificationPrompt`). It is
	 * preferred over any copy composed here, because the backend knows *which* check is outstanding.
	 */
	prompt: string | null;
	/** Where the verification module lives for this entity — the actionable next step. */
	href: string;
	/**
	 * Whether the viewer may open that module (`manage_settings`). When `false` the lock still renders —
	 * the fact is theirs to know — but the link is replaced by the name of who can act.
	 */
	canManage?: boolean;
	/** `band` is the full-width strip in a band; `inline` is the compact variant inside another block. */
	tone?: "band" | "inline";
}

/**
 * The lock. See the module header for the capability-versus-verification distinction it encodes.
 *
 * `role="status"`: the lock explains why something nearby is unavailable, so it is announced when it
 * appears without stealing focus. It is deliberately not an `alert` — nothing has gone wrong, and an
 * assertive announcement would frame a normal onboarding step as a failure.
 */
export function VerificationLock(props: VerificationLockProps): JSX.Element | null {
	const { kind, verification, prompt, href, canManage = true, tone = "band" } = props;
	if (verification === "verified") return null;

	const headline = prompt ??
		(verification === "pending" ? pendingText(kind) : fallbackText(kind));

	return (
		<div
			class={cx("wsp-lock", tone === "inline" && "wsp-lock--inline")}
			data-state={verification}
			data-kind={kind}
			role="status"
		>
			<span class="wsp-lock__glyph">{LockGlyph}</span>
			<div class="wsp-lock__body">
				<p class="wsp-lock__text">{headline}</p>
				<p class="wsp-lock__prompt">{promptFor(kind, verification, canManage)}</p>
			</div>
			{canManage && <a class="wsp-lock__link" href={href}>{linkLabel(kind, verification)}</a>}
		</div>
	);
}
// #endregion

// #region Locked region
export interface LockedRegionProps {
	/** Whether the gate is closed. When `false` the region renders untouched. */
	locked: boolean;
	children: ComponentChildren;
	class?: string;
}

/**
 * Wrap a region whose CONTROLS are gated but whose CONTENT must stay readable.
 *
 * The stylesheet dims it and makes it inert with `opacity` and `pointer-events` alone — never a blur and
 * never an overlay. An admin composing a split or a spend rule before their verification clears must be
 * able to read exactly what they are about to be allowed to operate; obscuring it would turn a temporary
 * gate into a permanent mystery.
 *
 * `aria-disabled` rather than `inert`: the content is still worth reading and navigating with a screen
 * reader, it simply cannot be actioned yet.
 */
export function LockedRegion(props: LockedRegionProps): JSX.Element {
	return (
		<div
			class={cx("wsp-lock-region", props.class)}
			data-locked={props.locked ? "true" : "false"}
			aria-disabled={props.locked ? "true" : undefined}
		>
			{props.children}
		</div>
	);
}
// #endregion
