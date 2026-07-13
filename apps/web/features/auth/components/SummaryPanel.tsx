import type { JSX, VNode } from "preact";
import type { JoinStore } from "../core/wizardStore.ts";
import { HeroScene } from "./JoinArt.tsx";

/**
 * SummaryPanel — the reimagined left column of the onboarding experience: a deep-primary field with
 * one large, adaptive {@link HeroScene} illustration that shifts to represent the active step, big
 * expressive typography (mixed thin/bold weights, never a literal "Step 1.2"), and a slim progress
 * track. It reacts to the same wizard store as the form, so the scene, copy, and progress all move in
 * lockstep with the user's choices. The old glass "passport" card is intentionally gone — the SVG is
 * now the single focal point.
 */

interface HeroCopy {
	/** Small all-caps kicker. */
	kicker: string;
	/** Expressive title — mixed thin/bold weight spans. */
	title: VNode;
	/** Supporting line. */
	lede: string;
}

/** Two-tone title helper: a light lead-in + a bold, emphasised phrase. */
function title(lead: string, strong: string): VNode {
	return (
		<>
			<span class="join-aside__title-lead">{lead}</span>
			<span class="join-aside__title-strong">{strong}</span>
		</>
	);
}

/** Imaginative, non-technical copy for each step + selection. */
function heroCopy(store: JoinStore): HeroCopy {
	const org = store.isOrg.value;
	const intent = store.intent.value;
	switch (store.current.value.id) {
		case "account":
			return {
				kicker: "Welcome to Projective",
				title: title("First,", "who are you?"),
				lede: "Tell us how you'll show up — as a person, or an organisation.",
			};
		case "intent":
			if (intent === "client") {
				return {
					kicker: "The hiring side",
					title: title("You're here", "to build."),
					lede: "Post work, fund escrow, and release it stage by approved stage.",
				};
			}
			if (intent === "freelancer") {
				return {
					kicker: "The making side",
					title: title("You're here", "to create."),
					lede: "Offer your craft and let stage-based escrow guard every milestone.",
				};
			}
			return {
				kicker: "Your intention",
				title: title("Choose", "your path."),
				lede: "Will you hire brilliant people, or be one? You can do both later.",
			};
		case "purpose":
			return org
				? {
					kicker: "Your scale",
					title: title("How big is", "your world?"),
					lede: "A rough size and sector so we can shape your workspace.",
				}
				: {
					kicker: "Your ambitions",
					title: title("What makes", "you tick?"),
					lede: "Pick what you're here to do — nothing's set in stone.",
				};
		case "specialize":
			return org
				? {
					kicker: "Your footprint",
					title: title("Map your", "organisation."),
					lede: "Where you're based and the teams that make it run.",
				}
				: {
					kicker: "Your craft",
					title: title("Show your", "superpowers."),
					lede: "A few skills so exactly the right clients find you.",
				};
		case "identity":
			return org
				? {
					kicker: "Your identity",
					title: title("Your company,", "named."),
					lede: "Legal name, brand, and the @handle the world will know.",
				}
				: {
					kicker: "Your identity",
					title: title("Make it", "yours."),
					lede: "Your name and @handle — this is how people find you.",
				};
		case "credentials":
			if (org) {
				return {
					kicker: "Almost there",
					title: title("Admin &", "access."),
					lede: "Corporate contact details and your admin password.",
				};
			}
			return store.isOAuth
				? {
					kicker: "One last thing",
					title: title("Nearly", "there."),
					lede: "Confirm your email and date of birth to finish up.",
				}
				: {
					kicker: "Almost there",
					title: title("Lock", "it in."),
					lede: "Your email, date of birth, and a password to keep it safe.",
				};
	}
}

export function SummaryPanel({ store }: { store: JoinStore }): JSX.Element {
	const steps = store.steps.value;
	const activeIndex = store.stepIndex.value;
	const current = store.current.value;
	const { kicker, title: heroTitle, lede } = heroCopy(store);

	return (
		<div class="join-aside">
			<a class="join-aside__brand" href="/" aria-label="Projective — home">
				<span class="join-aside__mark" aria-hidden="true" />
				<span>Projective</span>
			</a>

			<div class="join-aside__scene" key={current.id}>
				<HeroScene step={current.id} progress={store.progress.value} />
			</div>

			<div class="join-aside__copy">
				<p class="join-aside__kicker" key={`k-${kicker}`}>{kicker}</p>
				<h2 class="join-aside__title" key={`t-${current.id}`}>{heroTitle}</h2>
				<p class="join-aside__lede" key={`l-${lede}`}>{lede}</p>
			</div>

			<div class="join-aside__foot">
				<div
					class="join-aside__progress"
					role="progressbar"
					aria-valuenow={activeIndex + 1}
					aria-valuemin={1}
					aria-valuemax={steps.length}
				>
					{steps.map((s, i) => (
						<span
							key={s.id}
							class={`join-aside__tick${i === activeIndex ? " is-active" : ""}${
								i < activeIndex ? " is-done" : ""
							}`}
						/>
					))}
				</div>
				<p class="join-aside__trust">Escrow-backed · funds and work protected at every stage.</p>
			</div>
		</div>
	);
}
