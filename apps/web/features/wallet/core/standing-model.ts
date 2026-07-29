import type { StandingRung, WalletStanding } from "../types/wallet-types.ts";

/**
 * standing-model — the geometry and the two-gate logic behind the Standing arc.
 *
 * Pure and SSR-safe, so the server and the hydrated island produce identical paths.
 *
 * The hard problem this module exists to solve honestly: **a rung has TWO conditions**, a minimum
 * Reliability-Index score AND a minimum count of completed stages (finance-model.md §16.3, where the
 * stage floor exists precisely so a flawless single engagement cannot vault a subject to the top).
 * An arc can only encode one continuous quantity. Drawing the score alone would imply promotion the
 * moment the needle passes a threshold, which is a lie whenever the volume floor is short — so
 * everything beyond the STAGE-GATED CEILING is drawn as an inert hatched veil, and the stage
 * requirement gets its own, deliberately different, linear form. There is never a second dial.
 */

// #region Geometry constants
/** The arc's coordinate space. Kept here so the component and the model cannot drift. */
export const ARC = {
	viewBox: "0 0 260 180",
	cx: 130,
	cy: 118,
	r: 96,
	strokeWidth: 14,
	/** The sweep, in degrees, that score 0→100 maps onto. 150°→390° leaves a 120° gap at the base. */
	from: 150,
	to: 390,
} as const;

/** `2πr` for `r = 96`. The dash maths is expressed against the full circumference, not the sweep. */
export const ARC_LENGTH = 2 * Math.PI * ARC.r;
/** The fraction of the full circle the visible sweep occupies. */
const SWEEP_FRACTION = (ARC.to - ARC.from) / 360;
/** The drawn length of the full 0→100 sweep. */
export const SWEEP_LENGTH = ARC_LENGTH * SWEEP_FRACTION;
// #endregion

// #region Scales
/** Map a 0–100 score onto its angle in degrees. */
export function angleFor(score: number): number {
	const t = Math.max(0, Math.min(100, score)) / 100;
	return ARC.from + t * (ARC.to - ARC.from);
}

/** The point on the arc's centre-line at a given score. */
export function pointFor(score: number): { x: number; y: number } {
	const rad = (angleFor(score) * Math.PI) / 180;
	return { x: ARC.cx + Math.cos(rad) * ARC.r, y: ARC.cy + Math.sin(rad) * ARC.r };
}

/** The drawn length from the sweep's start to a score. */
export function lengthFor(score: number): number {
	return (Math.max(0, Math.min(100, score)) / 100) * SWEEP_LENGTH;
}
// #endregion

// #region The two gates
/**
 * The highest rung the subject's COMPLETED-STAGE COUNT permits, regardless of score. This is the
 * ceiling: no amount of score improvement can promote past it until more stages are delivered.
 */
export function ceilingLevel(s: WalletStanding): number {
	let level = 1;
	for (const rung of s.ladder) {
		if (s.stagesCompleted >= rung.minStages) level = Math.max(level, rung.level);
	}
	return level;
}

/**
 * The score at which the arc becomes inert — the `minScore` of the first rung the stage floor
 * blocks. `100` when the stage floor blocks nothing (the score is the only live constraint).
 */
export function ceilingScore(s: WalletStanding): number {
	const ceiling = ceilingLevel(s);
	const blocked = s.ladder.find((r) => r.level === ceiling + 1);
	return blocked ? blocked.minScore : 100;
}
// #endregion

// #region Arc geometry
/** One rung threshold marked on the arc. */
export interface Notch {
	level: number;
	score: number;
	x: number;
	y: number;
	/** `passed` — already earned · `next` — the rung being climbed · `gated` — beyond the ceiling. */
	state: "passed" | "next" | "gated";
	label: string;
}

/** Everything the gauge needs to draw itself. */
export interface ArcGeometry {
	/** `stroke-dasharray` for the full track. */
	trackDash: string;
	/** `stroke-dasharray` for the earned fill. */
	fillDash: string;
	/** The hatched ceiling veil, or `null` when the stage floor blocks nothing. */
	veilDash: string | null;
	veilOffset: number;
	notches: Notch[];
	/** Whether the score has already run past what the stage floor permits. */
	capped: boolean;
	ceiling: number;
	ceilingAt: number;
}

/**
 * Build the arc. The track, the fill and the veil are all expressed as `stroke-dasharray` pairs on
 * one full circle, offset so only the intended segment paints — this keeps a single `<circle>` per
 * layer rather than three hand-computed `A` paths, and makes the fill animatable by transitioning a
 * single `stroke-dashoffset`.
 */
export function arcGeometry(s: WalletStanding): ArcGeometry {
	const ceiling = ceilingLevel(s);
	const ceilingAt = ceilingScore(s);
	const fill = lengthFor(s.score);
	const veilStart = lengthFor(ceilingAt);
	const veilLength = Math.max(0, SWEEP_LENGTH - veilStart);

	const notches: Notch[] = s.ladder
		.filter((r) => r.minScore > 0)
		.map((r) => {
			const p = pointFor(r.minScore);
			const state: Notch["state"] = r.level <= s.level
				? "passed"
				: r.level > ceiling
				? "gated"
				: "next";
			return { level: r.level, score: r.minScore, x: p.x, y: p.y, state, label: r.label };
		});

	return {
		trackDash: `${SWEEP_LENGTH} ${ARC_LENGTH}`,
		fillDash: `${fill} ${ARC_LENGTH}`,
		veilDash: veilLength > 0.5 ? `${veilLength} ${ARC_LENGTH}` : null,
		veilOffset: -veilStart,
		notches,
		capped: s.score > ceilingAt,
		ceiling,
		ceilingAt,
	};
}
// #endregion

// #region Formatting
/** Basis points as a percentage: `750` → `"7.5%"`. Trailing zeros trimmed. */
export function bp(value: number): string {
	const pct = value / 100;
	return `${Number.isInteger(pct) ? pct.toFixed(1) : String(pct)}%`;
}

/** The rung's short code: `3` → `"L3"`. */
export function rungCode(level: number): string {
	return `L${level}`;
}

/** The rung above the current one, or `null` at the top. */
export function nextRung(s: WalletStanding): StandingRung | null {
	return s.next;
}

/**
 * The one-sentence explanation of what is holding the subject back. Returns `null` at the top of the
 * ladder. Each branch names a REAL number the server sent — nothing here is inferred or rounded up.
 */
export function gateSentence(s: WalletStanding): string | null {
	if (!s.next || s.blockedBy === "none") return null;
	const stages = `${s.stagesToNext} more ${s.stagesToNext === 1 ? "stage" : "stages"}`;
	const score = `${s.scoreToNext.toFixed(1)} more points`;
	switch (s.blockedBy) {
		case "stages":
			return `Complete ${stages} to reach ${s.next.label}.`;
		case "score":
			return `Earn ${score} to reach ${s.next.label}.`;
		case "both":
			return `${score} and ${stages} to reach ${s.next.label}.`;
	}
	return null;
}
// #endregion
