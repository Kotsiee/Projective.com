import type { JSX } from "preact";
import { HeroScene } from "./JoinArt.tsx";
import type { StepId } from "../core/wizardStore.ts";

/**
 * SceneAside — the left column for the single-screen auth surfaces (login, forgot-password, verify).
 *
 * It now mirrors the `/join` experience exactly: the same **deep-primary field** (`.join-aside`), the
 * same large adaptive {@link HeroScene} line-art, and the same expressive two-tone titles — so the
 * whole auth suite reads as one premium system rather than two visual languages. The glass "passport"
 * card is intentionally gone here too; the illustration is the single focal point.
 */
type SceneVariant = "login" | "forgot" | "verify";

interface SceneCopy {
	/** All-caps kicker. */
	kicker: string;
	/** Light lead-in of the title. */
	lead: string;
	/** Bold, emphasised phrase of the title. */
	strong: string;
	/** Supporting line. */
	lede: string;
	/** Which HeroScene glyph anchors the panel. */
	motif: StepId;
	/** Fixed fill (0–1) for the hero's progress ring — a static, decorative "state". */
	progress: number;
}

const COPY: Record<SceneVariant, SceneCopy> = {
	login: {
		kicker: "Welcome back",
		lead: "Pick up",
		strong: "where you left off.",
		lede: "Your projects, escrow, and messages — right where you left them.",
		motif: "identity",
		progress: 1,
	},
	forgot: {
		kicker: "Account recovery",
		lead: "Let's get",
		strong: "you back in.",
		lede: "We'll email a 6-digit code so you can set a fresh password.",
		motif: "credentials",
		progress: 0.4,
	},
	verify: {
		kicker: "One quick check",
		lead: "Confirm",
		strong: "it's really you.",
		lede: "Enter the 6-digit code we emailed to activate your account.",
		motif: "credentials",
		progress: 0.7,
	},
};

export function SceneAside({ variant }: { variant: SceneVariant }): JSX.Element {
	const c = COPY[variant];
	return (
		<div class="join-aside">
			<a class="join-aside__brand" href="/" aria-label="Projective — home">
				<span class="join-aside__mark" aria-hidden="true" />
				<span>Projective</span>
			</a>

			<div class="join-aside__scene">
				<HeroScene step={c.motif} progress={c.progress} />
			</div>

			<div class="join-aside__copy">
				<p class="join-aside__kicker">{c.kicker}</p>
				<h2 class="join-aside__title">
					<span class="join-aside__title-lead">{c.lead}</span>
					<span class="join-aside__title-strong">{c.strong}</span>
				</h2>
				<p class="join-aside__lede">{c.lede}</p>
			</div>

			<div class="join-aside__foot">
				<p class="join-aside__trust">Escrow-backed · funds and work protected at every stage.</p>
			</div>
		</div>
	);
}
