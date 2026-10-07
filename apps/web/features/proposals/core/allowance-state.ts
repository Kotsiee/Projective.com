import { computed, signal } from "@preact/signals";
import type { SentApplication } from "@projective/types/projects";
import { type DevProposalAllowance, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { AllowanceService } from "./AllowanceService.ts";
import { type AllowanceSnapshot, simulateAllowance } from "./allowance-model.ts";

/**
 * allowance-state — the ONE client copy of the viewer's proposal allowance and sent proposals, shared
 * by every surface that shows them: the header account popover's meter, the conversion lane's
 * disclosure, the apply modal and the `/projects` proposal list.
 *
 * They live in different islands, so they meet here, at module level — the same bridge `view-state`
 * and `basket-state` use. That is what makes a withdrawal on `/projects` move the popover's count, and
 * an application in the modal move the lane's "N ready", with no reload: each write re-reads the store
 * once and every reader re-renders from it.
 *
 * The Dev Context Switcher's `proposalAllowance` axis is applied HERE, on the way out
 * ({@link effectiveAllowance}), so no surface knows it is being simulated.
 */

// #region Stores
/** The acting subject's allowance as last read; `null` until read (or for a guest). */
export const allowanceSnapshot = signal<AllowanceSnapshot | null>(null);
/** Whether the last read failed (the meter hides rather than showing a stale figure as current). */
export const allowanceUnavailable = signal(false);
/** The viewer's sent proposals, newest first; `null` until read. */
export const sentProposals = signal<readonly SentApplication[] | null>(null);
/** A 1-second clock every countdown reads; it only ticks while something is showing one. */
export const allowanceClock = signal(Date.now());
// #endregion

// #region Dev simulation
const devPosition = signal<{ position: DevProposalAllowance; anchor: number }>({
	position: "auto",
	anchor: 0,
});
let devBound = false;

function bindDevSeam(): void {
	if (devBound || typeof document === "undefined") return;
	devBound = true;
	devPosition.value = { position: readDevSeam()?.proposalAllowance ?? "auto", anchor: Date.now() };
	subscribeDevSeam((state) => {
		const position = state?.proposalAllowance ?? "auto";
		if (position !== devPosition.peek().position) {
			devPosition.value = { position, anchor: Date.now() };
		}
	});
}

/** Whether a Dev Context Switcher position is replacing the real status. */
export const allowanceSimulated = computed(() => {
	bindDevSeam();
	return devPosition.value.position !== "auto";
});

/** Apply the simulated position (if any) to a snapshot — also used for a team read in the modal. */
export function simulated(snapshot: AllowanceSnapshot | null): AllowanceSnapshot | null {
	bindDevSeam();
	const { position, anchor } = devPosition.value;
	if (position === "auto") return snapshot;
	const status = simulateAllowance(position, snapshot?.status ?? null, anchor);
	return status ? { status, receivedAt: anchor } : null;
}

/** The snapshot every surface renders: the real read, or the simulated one. */
export const effectiveAllowance = computed(() => simulated(allowanceSnapshot.value));
// #endregion

// #region Reads
let inflight: Promise<void> | null = null;

/** (Re)read the acting subject's allowance. Concurrent callers share one request. */
export function refreshAllowance(): Promise<void> {
	if (inflight) return inflight;
	inflight = AllowanceService.status().then((read) => {
		if (read.ok && read.status) {
			allowanceSnapshot.value = { status: read.status, receivedAt: Date.now() };
			allowanceUnavailable.value = false;
		} else {
			allowanceUnavailable.value = true;
		}
	}).finally(() => {
		inflight = null;
	});
	return inflight;
}

/** Read the allowance once per page, the first time any surface needs it. */
export function ensureAllowance(): void {
	if (allowanceSnapshot.peek() === null && !inflight) void refreshAllowance();
}

let sentInflight: Promise<void> | null = null;

/** (Re)read the viewer's sent proposals. */
export function refreshSentProposals(): Promise<void> {
	if (sentInflight) return sentInflight;
	sentInflight = AllowanceService.sent().then((res) => {
		if (res.ok && res.data) sentProposals.value = res.data;
	}).finally(() => {
		sentInflight = null;
	});
	return sentInflight;
}
// #endregion

// #region Writes
/**
 * Withdraw a pending proposal, then re-read the allowance so every meter on the page shows the
 * returned unit. The row flips to `withdrawn` at once (the server has answered by then).
 */
export async function withdrawProposal(id: string): Promise<{ ok: boolean; message: string }> {
	const res = await AllowanceService.withdraw(id);
	if (!res.ok) {
		return { ok: false, message: res.message ?? "That proposal couldn't be withdrawn just now." };
	}
	const rows = sentProposals.peek();
	if (rows) {
		sentProposals.value = rows.map((row) =>
			row.id === id ? { ...row, status: "withdrawn", canWithdraw: false } : row
		);
	}
	await refreshAllowance();
	return { ok: true, message: res.message ?? "Proposal withdrawn — 1 proposal returned." };
}

/** After an application lands: the allowance and the sent list both moved. */
export function afterApplied(): void {
	void refreshAllowance();
	void refreshSentProposals();
}
// #endregion

// #region Clock
let clockUsers = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let lastRefillTarget: string | null = null;

/**
 * Keep {@link allowanceClock} ticking while a countdown is on screen; returns the release. When a real
 * refill instant passes, the store re-reads once, so "Next token in 0m" becomes the new figure rather
 * than sitting at zero.
 */
export function retainAllowanceClock(): () => void {
	clockUsers += 1;
	if (!clockTimer) {
		clockTimer = setInterval(() => {
			const now = Date.now();
			allowanceClock.value = now;
			const snap = allowanceSnapshot.peek();
			const at = snap?.status.nextBufferRefillAt ?? null;
			if (snap && at && at !== lastRefillTarget) {
				const skew = Date.parse(snap.status.serverNow) - snap.receivedAt;
				if (Date.parse(at) <= now + skew) {
					lastRefillTarget = at;
					void refreshAllowance();
				}
			}
		}, 1000);
	}
	return () => {
		clockUsers = Math.max(0, clockUsers - 1);
		if (clockUsers === 0 && clockTimer) {
			clearInterval(clockTimer);
			clockTimer = null;
		}
	};
}
// #endregion
