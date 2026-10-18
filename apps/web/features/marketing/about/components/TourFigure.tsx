import type { JSX } from "preact";
import {
	NARROW,
	narrowNode,
	TOUR_ZONES,
	type TourStep,
	WIDE,
	wideNode,
	zoneRuns,
} from "../core/delivery-tour.ts";

/** Props for {@link TourFigure}. */
export interface TourFigureProps {
	/** `wide`: one row of eight; `narrow`: two rows of four with a U-turn. */
	layout: "wide" | "narrow";
	steps: readonly TourStep[];
	/** The selected step's index. */
	active: number;
	/** Prefix for the `<title>` / `<desc>` ids (one figure per layout per page). */
	idBase: string;
}

/** Node radius, halo radius and the token's offset above its node, in user units. */
const R = 11;
const HALO = 17;
const TOKEN_LIFT = 32;

/**
 * How far a zone bracket extends past its outer nodes — less on the narrow layout, whose first-row
 * bracket must clear the U-turn curving down at the right edge.
 */
const BRACKET_PAD = { wide: 22, narrow: 18 } as const;

/** A node's centre on a layout. */
function nodeAt(layout: TourFigureProps["layout"], i: number): { x: number; y: number } {
	return layout === "wide" ? wideNode(i) : narrowNode(i);
}

/** The path joining node `i` to node `i + 1` — straight, except the narrow layout's U-turn. */
function segmentPath(layout: TourFigureProps["layout"], i: number): string {
	const a = nodeAt(layout, i);
	const b = nodeAt(layout, i + 1);
	if (layout === "narrow" && i === 3) {
		const bend = a.x + 34;
		return `M ${a.x + R} ${a.y} C ${bend} ${a.y}, ${bend} ${b.y}, ${b.x + R} ${b.y}`;
	}
	if (a.y === b.y && b.x > a.x) return `M ${a.x + R} ${a.y} L ${b.x - R} ${b.y}`;
	if (a.y === b.y) return `M ${a.x - R} ${a.y} L ${b.x + R} ${b.y}`;
	return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

/**
 * The zone runs a layout brackets: the wide layout names each place once; the narrow one splits a
 * run where it crosses from the first row to the second, so every bracket is a straight line.
 */
function bracketRuns(layout: TourFigureProps["layout"], steps: readonly TourStep[]) {
	const runs = zoneRuns(steps);
	if (layout === "wide") return runs;
	return runs.flatMap((run) =>
		run.from <= 3 && run.to >= 4 ? [{ ...run, to: 3 }, { ...run, from: 4 }] : [run]
	);
}

/**
 * TourFigure — one layout of the delivery walkthrough's diagram: a rail of eight numbered nodes, the
 * place the money sits bracketed and named beneath them, and a token marking the selected step.
 * Pure SVG in tokens (the island's sheet colours every part by class; the markup names no colour),
 * `role="img"` with a `<title>` and `<desc>`, the step-by-step text equivalent living beside it in
 * the island. Server-safe: imports no stylesheet, so it renders under `deno test`.
 */
export function TourFigure(props: TourFigureProps): JSX.Element {
	const { layout, steps, active, idBase } = props;
	const geo = layout === "wide" ? WIDE : NARROW;
	const titleId = `${idBase}-${layout}-title`;
	const descId = `${idBase}-${layout}-desc`;
	const activeZone = steps[active]?.zone;
	const start = nodeAt(layout, 0);
	const bracketDy = layout === "wide" ? 38 : 40;
	const labelDy = layout === "wide" ? 66 : 64;

	return (
		<svg
			class={`abt-tour__fig abt-tour__fig--${layout}`}
			viewBox={`0 0 ${geo.width} ${geo.height}`}
			role="img"
			aria-labelledby={`${titleId} ${descId}`}
			data-step={String(active)}
			focusable="false"
		>
			<title id={titleId}>How one stage's money moves</title>
			<desc id={descId}>
				{`${steps.length} steps in order: ${
					steps.map((s) => s.label).join(", ")
				}. The money is with the Client until it is funded, held in escrow until the stage is accepted and released, pending for seven days, and then available to the Freelancer. Step ${
					active + 1
				}, ${steps[active]?.label ?? ""}, is selected.`}
			</desc>

			<g class="abt-tour__rail">
				{steps.slice(0, -1).map((step, i) => (
					<path
						key={`seg-${step.id}`}
						class={`abt-tour__seg${i < active ? " abt-tour__seg--done" : ""}`}
						d={segmentPath(layout, i)}
					/>
				))}
			</g>

			<g class="abt-tour__brackets">
				{bracketRuns(layout, steps).map((run) => {
					const a = nodeAt(layout, run.from);
					const b = nodeAt(layout, run.to);
					const left = Math.min(a.x, b.x) - BRACKET_PAD[layout];
					const right = Math.max(a.x, b.x) + BRACKET_PAD[layout];
					const y = a.y + bracketDy;
					const on = run.zone === activeZone;
					return (
						<g key={`zone-${run.zone}-${run.from}`}>
							<path
								class={`abt-tour__bracket${on ? " abt-tour__bracket--active" : ""}`}
								d={`M ${left} ${y - 6} L ${left} ${y} L ${right} ${y} L ${right} ${y - 6}`}
							/>
							<text
								class={`abt-tour__zone${on ? " abt-tour__zone--active" : ""}`}
								x={(left + right) / 2}
								y={a.y + labelDy}
							>
								{TOUR_ZONES[run.zone].label}
							</text>
						</g>
					);
				})}
			</g>

			<g class="abt-tour__nodes">
				{steps.map((step, i) => {
					const { x, y } = nodeAt(layout, i);
					const state = i < active ? "done" : i === active ? "active" : "next";
					return (
						<g key={`node-${step.id}`}>
							<circle
								class={`abt-tour__halo${state === "active" ? " abt-tour__halo--active" : ""}`}
								cx={x}
								cy={y}
								r={HALO}
							/>
							<circle class={`abt-tour__node abt-tour__node--${state}`} cx={x} cy={y} r={R} />
							<text class={`abt-tour__num abt-tour__num--${state}`} x={x} y={y}>
								{i + 1}
							</text>
						</g>
					);
				})}
			</g>

			<g class="abt-tour__token">
				<circle class="abt-tour__token-coin" cx={start.x} cy={start.y - TOKEN_LIFT} r={9} />
				<circle class="abt-tour__token-core" cx={start.x} cy={start.y - TOKEN_LIFT} r={5} />
			</g>
		</svg>
	);
}
