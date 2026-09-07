/**
 * @projective/ui/gantt — the palette PROBE: the bridge between the token contract and a canvas.
 *
 * Every drawing value is authored in `gantt.css` on this hidden subtree as an ordinary declaration
 * against `var(--*)`, and `core/theme-bridge.ts` reads the engine's RESOLVED result back. Nothing is
 * drawn from here; no number ever moves into TypeScript.
 *
 * ACCENTS ARE DATA. The fixed swatches cover the lattice and the chrome, but an item's accent is
 * whatever custom property the consumer put on it — so the caller passes the set actually present in
 * the scene and gets one swatch each, with `--gantt-accent` / `--gantt-accent-on` written inline as
 * token REFERENCES so every mix in the stylesheet is resolved by the engine, exactly as it is for a
 * DOM element.
 */
import type { JSX, RefObject } from "preact";
import { styleVars } from "../../core/style.ts";
import { onAccentTokenFor } from "../core/theme-bridge.ts";

export interface GanttProbeProps {
	probeRef: RefObject<HTMLDivElement>;
	/** Accent custom-property NAMES to resolve an item paint for. */
	accents: readonly string[];
}

const SWATCHES = [
	"rule",
	"rule-major",
	"row-rule",
	"row",
	"row-hover",
	"row-selected",
	"weekend",
	"today",
	"label",
	"meta",
	"bar",
	"milestone",
	"link",
	"draft",
	"focus",
	"fly",
] as const;

export function GanttProbe({ probeRef, accents }: GanttProbeProps): JSX.Element {
	return (
		<div ref={probeRef} class="gantt-probe" aria-hidden="true">
			{SWATCHES.map((name) => (
				<span key={name} class={`gantt-probe__swatch gantt-probe__swatch--${name}`} />
			))}
			{accents.map((token) => (
				<span
					key={token}
					class="gantt-probe__swatch gantt-probe__swatch--accent"
					data-accent={token}
					style={styleVars({
						"--gantt-accent": `var(${token})`,
						"--gantt-accent-on": `var(${onAccentTokenFor(token)}, var(--on-surface))`,
					})}
				/>
			))}
		</div>
	);
}
