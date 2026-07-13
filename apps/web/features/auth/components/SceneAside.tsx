import type { JSX } from "preact";
import { StepMotif, SummaryAura } from "./illustrations.tsx";
import type { StepId } from "../core/wizardStore.ts";

/**
 * SceneAside — the static summary panel for the single-screen auth surfaces (login, forgot-password,
 * verify). Mirrors the onboarding summary's language (aura + motif + copy + a glass reassurance
 * card) so the whole auth experience feels like one system.
 */
type SceneVariant = "login" | "forgot" | "verify";

const COPY: Record<SceneVariant, { eyebrow: string; title: string; lede: string; motif: StepId }> =
	{
		login: {
			eyebrow: "Welcome back",
			title: "Pick up where you left off.",
			lede: "Sign in to your projects, escrow, and messages — all in one place.",
			motif: "identity",
		},
		forgot: {
			eyebrow: "Account recovery",
			title: "Let's get you back in.",
			lede: "We'll email a 6-digit code so you can set a fresh password.",
			motif: "credentials",
		},
		verify: {
			eyebrow: "One quick check",
			title: "Confirm it's you.",
			lede: "Enter the 6-digit code we emailed to activate your account.",
			motif: "credentials",
		},
	};

export function SceneAside({ variant }: { variant: SceneVariant }): JSX.Element {
	const c = COPY[variant];
	return (
		<div class="auth-summary">
			<div class="auth-summary__illustration">
				<SummaryAura />
			</div>

			<div class="auth-summary__copy">
				<div class="auth-motif-wrap">
					<StepMotif step={c.motif} />
				</div>
				<p class="auth-summary__eyebrow">{c.eyebrow}</p>
				<h2 class="auth-summary__title">{c.title}</h2>
				<p class="auth-summary__lede">{c.lede}</p>
			</div>

			<div class="auth-summary__spacer" />

			<div class="passport">
				<div class="passport__head">
					<div class="passport__avatar" aria-hidden="true">◆</div>
					<div class="passport__brand">
						<span class="passport__brand-label">Why Projective</span>
						<span class="passport__badge">Escrow-backed</span>
					</div>
				</div>
				<div class="passport__note">
					Funds and work stay protected at every stage.
				</div>
				<div class="passport__divider" />
				<div class="passport__meta">
					<span>
						A transparent <strong>5%</strong> fee
					</span>
					<span>Projective</span>
				</div>
			</div>
		</div>
	);
}
