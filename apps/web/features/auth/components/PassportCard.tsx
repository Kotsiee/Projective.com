import type { JSX } from "preact";
import type { JoinStore } from "../core/wizardStore.ts";
import { PURPOSE_LABELS, SKILL_LABELS } from "../core/onboarding-data.ts";

/**
 * PassportCard — the glassmorphic "virtual badge" in the summary panel. It reads the wizard store's
 * signals and fills in live as the user types on the right: name, @handle, email, an account/intent
 * badge, and up to a few purpose/skill chips. Discrete milestones (initials, badge, each chip)
 * remount with a `.pop` elastic ease; free-text fields update smoothly without per-keystroke jitter.
 */
export function PassportCard({ store }: { store: JoinStore }): JSX.Element {
	const name = store.displayName.value;
	const handle = store.displayHandle.value;
	const email = store.displayEmail.value;
	const org = store.isOrg.value;
	const intent = store.intent.value;
	const initials = store.initials.value;
	const avatar = !org ? store.prefill?.avatar : undefined;

	const accountLabel = org ? "Organization" : "Individual";
	const intentLabel = intent === "freelancer" ? "Freelancer" : intent === "client" ? "Client" : "";

	// Up to three tag chips: skills (freelancer) then purposes.
	const tags: string[] = [
		...store.skills.value.map((s) => SKILL_LABELS[s] ?? s),
		...store.purpose.value.map((p) => PURPOSE_LABELS[p] ?? p),
	].slice(0, 3);

	return (
		<div class="passport" aria-hidden="true">
			<div class="passport__head">
				<div class="passport__avatar pop" key={avatar ?? initials}>
					{avatar ? <img src={avatar} alt="" width={48} height={48} /> : initials}
				</div>
				<div class="passport__brand">
					<span class="passport__brand-label">Projective ID</span>
					<span class="passport__badge pop" key={`${accountLabel}-${intentLabel}`}>
						{accountLabel}
						{intentLabel ? ` · ${intentLabel}` : ""}
					</span>
				</div>
			</div>

			<div class={`passport__name${name ? "" : " passport__name--ghost"}`}>
				{name || (org ? "Your company" : "Your name")}
			</div>
			<div class="passport__handle">{handle ? `@${handle}` : "@handle"}</div>
			<div class="passport__email">{email || "you@example.com"}</div>

			<div class="passport__divider" />

			<div class="passport__chips">
				{tags.length
					? tags.map((t) => <span class="passport__chip pop" key={t}>{t}</span>)
					: <span class="passport__chip passport__chip--empty">Your highlights appear here</span>}
			</div>

			<div class="passport__meta">
				<span>
					Status: <strong>Draft</strong>
				</span>
				<span>Projective</span>
			</div>
		</div>
	);
}
