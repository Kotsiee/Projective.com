import type { JSX } from "preact";
import type { StepId } from "../core/wizardStore.ts";

/**
 * Auth illustrations — large, soft, token-tinted abstract art for the summary panel. `SummaryAura`
 * is the constant floating backdrop the glass card blurs over; `StepMotif` is a line-art motif that
 * crossfades as the active step changes (keyed remount replays the enter animation). All shapes read
 * `var(--primary)`/`var(--tertiary)` so they recolor with the theme.
 */

/** Constant floating aura — soft blurred blobs behind the summary content. */
export function SummaryAura(): JSX.Element {
	return (
		<svg
			class="auth-aura"
			viewBox="0 0 400 600"
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
		>
			<defs>
				<filter id="aura-blur" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="34" />
				</filter>
			</defs>
			<g filter="url(#aura-blur)" opacity="0.55">
				<circle cx="80" cy="120" r="90" fill="var(--primary)" opacity="0.5">
					<animate
						attributeName="cy"
						values="120;150;120"
						dur="9s"
						repeatCount="indefinite"
					/>
				</circle>
				<circle cx="320" cy="430" r="110" fill="var(--tertiary, var(--primary))" opacity="0.4">
					<animate
						attributeName="cx"
						values="320;290;320"
						dur="11s"
						repeatCount="indefinite"
					/>
				</circle>
				<circle cx="240" cy="220" r="70" fill="var(--secondary, var(--primary))" opacity="0.35">
					<animate
						attributeName="cy"
						values="220;190;220"
						dur="8s"
						repeatCount="indefinite"
					/>
				</circle>
			</g>
		</svg>
	);
}

const STROKE = {
	fill: "none",
	stroke: "var(--primary)",
	"stroke-width": 6,
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
} as const;

/** Per-step line-art motif (64px). Distinct scene per step id; crossfades on change. */
export function StepMotif({ step }: { step: StepId }): JSX.Element {
	return (
		<svg class="auth-motif" viewBox="0 0 96 96" role="img" aria-hidden="true">
			{motif(step)}
		</svg>
	);
}

function motif(step: StepId): JSX.Element {
	switch (step) {
		case "account":
			return (
				<g {...STROKE}>
					<circle cx="34" cy="34" r="14" />
					<path d="M18 78c0-11 7-18 16-18s16 7 16 18" />
					<rect x="56" y="30" width="26" height="48" rx="4" />
					<path d="M63 40h4M71 40h4M63 50h4M71 50h4M63 60h4M71 60h4" stroke-width="4" />
				</g>
			);
		case "intent":
			return (
				<g {...STROKE}>
					<path d="M16 40h44l-12-12M80 56H36l12 12" />
				</g>
			);
		case "purpose":
			return (
				<g {...STROKE}>
					<circle cx="48" cy="48" r="30" />
					<circle cx="48" cy="48" r="16" />
					<circle cx="48" cy="48" r="3" fill="var(--primary)" />
				</g>
			);
		case "specialize":
			return (
				<g {...STROKE}>
					<circle cx="28" cy="30" r="7" />
					<circle cx="66" cy="24" r="7" />
					<circle cx="72" cy="62" r="7" />
					<circle cx="34" cy="68" r="7" />
					<path d="M35 33l24-6M69 31l2 24M65 66l-24 3M31 61l-2-24" stroke-width="4" opacity="0.7" />
				</g>
			);
		case "identity":
			return (
				<g {...STROKE}>
					<rect x="16" y="24" width="64" height="48" rx="6" />
					<circle cx="36" cy="44" r="8" />
					<path d="M26 62c0-6 4-10 10-10s10 4 10 10" />
					<path d="M56 40h16M56 50h12" stroke-width="4" />
				</g>
			);
		case "credentials":
			return (
				<g {...STROKE}>
					<path d="M48 14l26 10v20c0 18-13 30-26 38-13-8-26-20-26-38V24z" />
					<path d="M38 48l7 7 14-15" stroke-width="5" />
				</g>
			);
	}
}
