import type { JSX } from "preact";
import type { StepId } from "../core/wizardStore.ts";

/**
 * JoinArt — the large, expressive artwork for the redesigned `/join` experience.
 *
 * Two families live here:
 *  - {@link HeroScene}: a single big illustration that anchors the deep-primary sidebar and *shifts*
 *    to represent the active step — a persistent orbital frame + a progress arc + a per-step glyph
 *    that crossfades on change (keyed remount replays the enter animation).
 *  - {@link ChoiceArt}: the four full-bleed card illustrations (Individual / Organisation / Client /
 *    Freelancer) that replace the old small badge-icons as the primary focal point of each choice.
 *
 * Everything is token-only: the hero draws in `var(--on-primary)` (it sits on the primary field) and
 * the card art draws in `var(--primary)` (it sits on a light surface), so both recolour with theme.
 */

// #region Hero scene (sidebar)
/** Stroke preset for the on-primary hero line-art. */
const HERO_STROKE = {
	fill: "none",
	stroke: "var(--on-primary)",
	"stroke-width": 4,
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
} as const;

/**
 * The big adaptive sidebar illustration. `progress` (0–1) drives the outer arc; `step` selects the
 * central glyph. The wrapping element is keyed on `step` by the caller so React replays the mount
 * animation as the scene shifts between steps.
 */
export function HeroScene({ step, progress }: { step: StepId; progress: number }): JSX.Element {
	return (
		<svg
			class="join-hero"
			viewBox="0 0 320 360"
			role="img"
			aria-hidden="true"
			style={{ "--hero-progress": progress }}
		>
			<defs>
				<filter id="join-hero-soft" x="-40%" y="-40%" width="180%" height="180%">
					<feGaussianBlur stdDeviation="26" />
				</filter>
			</defs>

			{/* Soft floating aura — constant, low-contrast light on the primary field. */}
			<g filter="url(#join-hero-soft)" opacity="0.28">
				<circle
					class="join-hero__blob join-hero__blob--a"
					cx="96"
					cy="120"
					r="78"
					fill="var(--on-primary)"
				/>
				<circle
					class="join-hero__blob join-hero__blob--b"
					cx="236"
					cy="238"
					r="92"
					fill="var(--on-primary)"
				/>
			</g>

			{/* Persistent orbital frame — a slow spin conveys life without motion sickness. */}
			<g class="join-hero__orbit" opacity="0.35">
				<circle
					cx="160"
					cy="176"
					r="128"
					fill="none"
					stroke="var(--on-primary)"
					stroke-width="1.5"
					stroke-dasharray="2 10"
					stroke-linecap="round"
				/>
			</g>

			{/* Progress ring — grows with the wizard. pathLength=100 keeps the dash math clean. */}
			<circle
				class="join-hero__track"
				cx="160"
				cy="176"
				r="104"
				fill="none"
				stroke="var(--on-primary)"
				stroke-width="3"
				opacity="0.18"
			/>
			<circle
				class="join-hero__progress"
				cx="160"
				cy="176"
				r="104"
				pathLength={100}
				fill="none"
				stroke="var(--on-primary)"
				stroke-width="3"
				stroke-linecap="round"
				transform="rotate(-90 160 176)"
			/>

			{/* Per-step central glyph. Keyed remount (from the caller) crossfades scenes. */}
			<g class="join-hero__glyph" key={step}>{heroGlyph(step)}</g>
		</svg>
	);
}

/** The central line-art glyph for each step, drawn large around (160, 176). */
function heroGlyph(step: StepId): JSX.Element {
	switch (step) {
		case "account":
			// Two identities, side by side — "who are you?"
			return (
				<g {...HERO_STROKE}>
					<circle cx="132" cy="150" r="22" />
					<path d="M100 214c0-20 14-34 32-34s32 14 32 34" />
					<circle cx="196" cy="162" r="16" opacity="0.6" />
					<path d="M172 210c0-15 11-25 24-25s24 10 24 25" opacity="0.6" />
				</g>
			);
		case "intent":
			// A path that forks — "choose your path."
			return (
				<g {...HERO_STROKE}>
					<path d="M160 232V176" />
					<path d="M160 176C160 148 132 140 116 124" />
					<path d="M160 176C160 148 188 140 204 124" />
					<circle cx="116" cy="120" r="12" />
					<circle cx="204" cy="120" r="12" />
					<circle cx="160" cy="240" r="6" fill="var(--on-primary)" />
				</g>
			);
		case "purpose":
			// A target / compass — "what brings you here?"
			return (
				<g {...HERO_STROKE}>
					<circle cx="160" cy="176" r="46" />
					<circle cx="160" cy="176" r="24" opacity="0.6" />
					<path d="M160 176l30-30" stroke-width="5" />
					<circle cx="160" cy="176" r="5" fill="var(--on-primary)" />
				</g>
			);
		case "specialize":
			// A small constellation — "what you do best."
			return (
				<g {...HERO_STROKE}>
					<path
						d="M122 138l40 8 34-20M162 146l14 44-40 18M176 190l-54-24"
						opacity="0.5"
						stroke-width="2.5"
					/>
					<circle cx="122" cy="138" r="9" />
					<circle cx="196" cy="126" r="9" />
					<circle cx="176" cy="190" r="9" />
					<circle cx="122" cy="214" r="9" />
					<circle cx="162" cy="146" r="6" fill="var(--on-primary)" />
				</g>
			);
		case "identity":
			// A profile card — "make it yours."
			return (
				<g {...HERO_STROKE}>
					<rect x="108" y="140" width="104" height="76" rx="12" />
					<circle cx="138" cy="168" r="13" />
					<path d="M120 196c0-10 8-17 18-17s18 7 18 17" />
					<path d="M170 160h28M170 176h20" opacity="0.7" stroke-width="3" />
				</g>
			);
		case "credentials":
			// A shield with a check — "secure it."
			return (
				<g {...HERO_STROKE}>
					<path d="M160 130l40 16v30c0 28-20 46-40 58-20-12-40-30-40-58v-30z" />
					<path d="M144 176l12 12 22-24" stroke-width="5" />
				</g>
			);
	}
}
// #endregion

// #region Choice-card art (form column)
/** The account/intent options that get a full illustration. */
export type ChoiceArtKind = "individual" | "organization" | "client" | "freelancer";

/**
 * Full-bleed card illustration used as the focal point of a choice card. Drawn in `var(--primary)`
 * over a light surface; the card's `.is-active` state lifts the accent via CSS.
 */
export function ChoiceArt({ kind }: { kind: ChoiceArtKind }): JSX.Element {
	return (
		<svg class="join-choice-art" viewBox="0 0 160 128" role="img" aria-hidden="true">
			{choiceArt(kind)}
		</svg>
	);
}

const ART_STROKE = {
	fill: "none",
	stroke: "var(--primary)",
	"stroke-width": 4,
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
} as const;

const TINT = "color-mix(in srgb, var(--primary) 16%, transparent)";
const TINT_SOFT = "color-mix(in srgb, var(--primary) 9%, transparent)";

function choiceArt(kind: ChoiceArtKind): JSX.Element {
	switch (kind) {
		case "individual":
			// A single, confident figure with an orbiting spark.
			return (
				<g>
					<ellipse cx="80" cy="96" rx="52" ry="20" fill={TINT_SOFT} />
					<circle cx="80" cy="52" r="34" fill={TINT} />
					<g {...ART_STROKE}>
						<circle cx="80" cy="46" r="15" />
						<path d="M56 84c0-14 11-23 24-23s24 9 24 23" />
						<circle cx="116" cy="30" r="4" fill="var(--primary)" stroke="none" />
						<path d="M110 20c2 4 2 8 0 12" opacity="0.5" stroke-width="3" />
					</g>
				</g>
			);
		case "organization":
			// A small city of buildings — a workspace with teams.
			return (
				<g>
					<ellipse cx="80" cy="104" rx="58" ry="16" fill={TINT_SOFT} />
					<rect x="40" y="46" width="34" height="58" rx="5" fill={TINT} />
					<rect x="80" y="30" width="40" height="74" rx="5" fill={TINT} />
					<g {...ART_STROKE}>
						<rect x="40" y="46" width="34" height="58" rx="5" />
						<rect x="80" y="30" width="40" height="74" rx="5" />
						<path
							d="M50 62h14M50 78h14M92 46h16M92 64h16M92 82h16"
							opacity="0.6"
							stroke-width="3"
						/>
					</g>
				</g>
			);
		case "client":
			// A figure with a spotlight/target — bringing on talent.
			return (
				<g>
					<ellipse cx="80" cy="100" rx="54" ry="18" fill={TINT_SOFT} />
					<circle cx="72" cy="54" r="32" fill={TINT} />
					<g {...ART_STROKE}>
						<circle cx="72" cy="48" r="14" />
						<path d="M50 86c0-13 10-22 22-22s22 9 22 22" />
						<circle cx="116" cy="40" r="14" />
						<path d="M116 33v14M109 40h14" stroke-width="3" />
					</g>
				</g>
			);
		case "freelancer":
			// A figure lifting off — offering services, getting hired.
			return (
				<g>
					<ellipse cx="80" cy="102" rx="54" ry="16" fill={TINT_SOFT} />
					<circle cx="72" cy="56" r="32" fill={TINT} />
					<g {...ART_STROKE}>
						<circle cx="72" cy="50" r="14" />
						<path d="M50 88c0-13 10-22 22-22s22 9 22 22" />
						<path d="M112 30l6 6-6 6-6-6z" fill="var(--primary)" stroke="none" />
						<path d="M112 48v10M104 26l-4-4M124 26l4-4" opacity="0.55" stroke-width="3" />
					</g>
				</g>
			);
	}
}
// #endregion
