/**
 * delivery-tour — the content and the rules of `/about`'s "How delivery works" walkthrough: the
 * eight steps of one stage's money (Fund → Prepaid escrow → Claim → In progress → Submit → Accept &
 * release → 7-day clearing → Withdraw), the place the money sits at each step, the stepper's
 * keyboard model and the autoplay sequence. Pure, so the island stays a thin binding and every rule
 * is unit-tested. Client-reachable: imports nothing.
 *
 * Every sentence states shipped behaviour (PRODUCT_SPEC §Escrow, Wallets & Finance; finance-model.md
 * §7; Decisions #191 / #197 / #212) — the walkthrough is a claim about the product, not a pitch.
 */

// #region Content
/** Where a stage's money is at a step. */
export type TourZone = "client" | "escrow" | "pending" | "available";

/** How each place is named: on the diagram, and in the step panel's "where the money is" line. */
export const TOUR_ZONES: Readonly<Record<TourZone, { label: string; where: string }>> = {
	client: { label: "Client", where: "With the Client" },
	escrow: { label: "Escrow", where: "Held in escrow" },
	pending: { label: "Pending", where: "In the Freelancer's pending balance" },
	available: { label: "Available", where: "In the Freelancer's available balance" },
};

/** The order the places sit along the diagram's rail. */
export const TOUR_ZONE_ORDER: readonly TourZone[] = ["client", "escrow", "pending", "available"];

/** One step of the walkthrough. */
export interface TourStep {
	/** A stable kebab id — the DOM id suffix and the analytics key. */
	id: string;
	/** The stepper button's label. */
	label: string;
	/** Where the money is during this step. */
	zone: TourZone;
	/** The two-line explanation. */
	lines: readonly [string, string];
}

/**
 * The eight steps, with the platform fee (`5%`, already formatted from the live
 * `platform_fee_bp`) written into the release step, so the walkthrough and the metrics row can
 * never state two different fees.
 */
export function tourSteps(feePercent: string): TourStep[] {
	return [
		{
			id: "fund",
			label: "Fund",
			zone: "client",
			lines: [
				"The Client pays for the stage before any work starts, from their wallet or by card.",
				"The money goes into escrow, where it belongs to neither side until the stage is settled.",
			],
		},
		{
			id: "prepaid-escrow",
			label: "Prepaid escrow",
			zone: "escrow",
			lines: [
				"The stage's price is locked to that stage, before anyone is hired.",
				"A Freelancer can see the work is already paid for before they take it on.",
			],
		},
		{
			id: "claim",
			label: "Claim",
			zone: "escrow",
			lines: [
				"A Freelancer or a Team claims the work, and the held money is bound to them.",
				"If nobody has claimed it when the stage closes, that money goes back to the Client.",
			],
		},
		{
			id: "in-progress",
			label: "In progress",
			zone: "escrow",
			lines: [
				"The work happens in the project's own channels, files and board.",
				"Contact details in its messages stay masked while the project is in progress.",
			],
		},
		{
			id: "submit",
			label: "Submit",
			zone: "escrow",
			lines: [
				"The Freelancer submits the deliverable against the stage's milestone.",
				"The Client reviews it, asks for a revision or opens a dispute — the money stays held.",
			],
		},
		{
			id: "accept-release",
			label: "Accept & release",
			zone: "escrow",
			lines: [
				"The Client accepts the stage and its escrow is released at once.",
				`Projective's ${feePercent} platform fee is taken from the payment as it's released.`,
			],
		},
		{
			id: "clearing",
			label: "7-day clearing",
			zone: "pending",
			lines: [
				"Released money waits seven days in the Freelancer's pending balance.",
				"It can't be withdrawn or spent until the window has passed.",
			],
		},
		{
			id: "withdraw",
			label: "Withdraw",
			zone: "available",
			lines: [
				"After seven days it becomes available — for a Team, already split among its members.",
				"They withdraw it to their bank through Stripe Connect.",
			],
		},
	];
}
// #endregion

// #region Keyboard
/**
 * The stepper's roving-tabindex model (the WAI-ARIA tabs pattern, automatic activation): the arrow
 * keys move to the neighbouring step and wrap, Home / End jump to the ends. Up / Down mirror
 * Left / Right because the steps wrap onto two rows on a narrow frame. Any other key → `null`.
 */
export function stepperKeyTarget(key: string, index: number, total: number): number | null {
	if (total <= 0) return null;
	switch (key) {
		case "ArrowRight":
		case "ArrowDown":
			return (index + 1) % total;
		case "ArrowLeft":
		case "ArrowUp":
			return (index - 1 + total) % total;
		case "Home":
			return 0;
		case "End":
			return total - 1;
		default:
			return null;
	}
}
// #endregion

// #region Autoplay
/** How long each step is shown while the walkthrough plays itself. */
export const TOUR_AUTOPLAY_MS = 4500;

/** The fraction of the section that must be on screen before the walkthrough starts playing. */
export const TOUR_VISIBLE_RATIO = 0.35;

/**
 * Who is driving the walkthrough:
 *  - `auto` — it plays itself while it is on screen, the motion setting allows it and nothing holds it;
 *  - `paused` — the reader pressed Pause, or moved keyboard focus into it;
 *  - `manual` — the reader picked a step: it never plays itself again unless they press Play;
 *  - `done` — it played through to the last step once and rests there.
 */
export type TourMode = "auto" | "paused" | "manual" | "done";

/** The step after `index` while playing, or `null` at the last step — a single pass, never a loop. */
export function autoplayNext(index: number, total: number): number | null {
	return index + 1 < total ? index + 1 : null;
}

/** The inputs one autoplay tick depends on. */
export interface AutoplayGate {
	mode: TourMode;
	/** The motion setting (both channels) allows autoplay. */
	motionAllowed: boolean;
	/** The section is on screen. */
	inView: boolean;
	/** A pointer rests on it (a temporary hold). */
	hovered: boolean;
	/** The document is visible. */
	visible: boolean;
}

/** Whether the next autoplay tick may be scheduled. */
export function autoplayRuns(gate: AutoplayGate): boolean {
	return gate.mode === "auto" && gate.motionAllowed && gate.inView && !gate.hovered && gate.visible;
}

/** What the Play / Pause control does from a mode, and what it is called there. */
export interface TourControl {
	label: "Pause" | "Play" | "Replay";
	/** The mode the press moves to. */
	next: TourMode;
	/** Whether the press also rewinds to the first step. */
	rewind: boolean;
}

/** The control for `mode`, given whether the active step is the last. */
export function tourControl(mode: TourMode, atLast: boolean): TourControl {
	if (mode === "auto") return { label: "Pause", next: "paused", rewind: false };
	if (mode === "done" || atLast) return { label: "Replay", next: "auto", rewind: true };
	return { label: "Play", next: "auto", rewind: false };
}
// #endregion

// #region Diagram geometry
/** The wide diagram: one row of eight nodes. */
export const WIDE = Object.freeze({ width: 880, height: 150, x0: 55, gap: 110, railY: 58 });

/** The narrow diagram: two rows of four, the second running right to left (a U-turn). */
export const NARROW = Object.freeze({
	width: 400,
	height: 250,
	x0: 50,
	gap: 100,
	row0: 48,
	row1: 158,
});

/** A node's centre on the wide diagram. */
export function wideNode(index: number): { x: number; y: number } {
	return { x: WIDE.x0 + index * WIDE.gap, y: WIDE.railY };
}

/** A node's centre on the narrow diagram (indices 4–7 run back from the right). */
export function narrowNode(index: number): { x: number; y: number } {
	const row = index < 4 ? 0 : 1;
	const col = row === 0 ? index : 7 - index;
	return { x: NARROW.x0 + col * NARROW.gap, y: row === 0 ? NARROW.row0 : NARROW.row1 };
}

/** The contiguous runs of steps per zone — the diagram brackets each run and names it once. */
export function zoneRuns(
	steps: readonly TourStep[],
): Array<{ zone: TourZone; from: number; to: number }> {
	const runs: Array<{ zone: TourZone; from: number; to: number }> = [];
	steps.forEach((step, i) => {
		const last = runs[runs.length - 1];
		if (last && last.zone === step.zone && last.to === i - 1) last.to = i;
		else runs.push({ zone: step.zone, from: i, to: i });
	});
	return runs;
}
// #endregion
