import type { JSX } from "preact";
import { CONTACT_INTENTS } from "@projective/types/contact";
import { Logo } from "@web/components/Logo.tsx";
import { ENTITY_FACTS, ENTITY_PLACEHOLDER, INTENT_COPY } from "../core/contact-copy.ts";

/**
 * ContactRail — `/contact`'s operational-transparency rail (Decision #276; DESIGN_SYSTEM §C.1): who
 * a reader is contacting (the legal entity's facts — `XXXX-XXXX` until the owner supplies them, never
 * invented), how fast each intent is answered (stated as targets), and where answers live without
 * waiting (the help centre, the legal documents). A server component, zero JavaScript; its styles
 * ride the `ContactIntake` island.
 *
 * It is the page's one tonal region — a solid `--surface-1`, not a card (no border, no shadow, no
 * card inside it) — with its content separated by spacing and one hairline. There is no platform
 * status line: no health endpoint exists to read one from, and a status that is not read from
 * anything is a fabricated one. Below 64rem of page it stacks under the intake, moved, not copied.
 */
export function ContactRail(): JSX.Element {
	return (
		<aside class="ctc-rail" aria-labelledby="ctc-rail-title">
			<div class="ctc-rail__section">
				<div class="ctc-rail__brand">
					<Logo class="ctc-rail__mark" />
					<h2 class="ctc-rail__title" id="ctc-rail-title">Who you're contacting</h2>
				</div>
				<dl class="ctc-rail__facts">
					{ENTITY_FACTS.map((fact) => (
						<div class="ctc-rail__fact" key={fact.term}>
							<dt>{fact.term}</dt>
							<dd>
								{fact.value === ENTITY_PLACEHOLDER
									? (
										<>
											<span class="ctc-rail__placeholder">{ENTITY_PLACEHOLDER}</span>
											<span class="ui-visually-hidden">(not yet published)</span>
										</>
									)
									: fact.value}
							</dd>
						</div>
					))}
				</dl>
			</div>

			<section
				class="ctc-rail__section ctc-rail__section--ruled"
				aria-labelledby="ctc-rail-replies"
			>
				<h2 class="ctc-rail__heading" id="ctc-rail-replies">When you'll hear back</h2>
				<dl class="ctc-rail__facts">
					{CONTACT_INTENTS.map((intent) => (
						<div class="ctc-rail__fact" key={intent}>
							<dt>{INTENT_COPY[intent].label}</dt>
							<dd>{INTENT_COPY[intent].replyTarget}</dd>
						</div>
					))}
				</dl>
			</section>

			<section class="ctc-rail__section" aria-labelledby="ctc-rail-answers">
				<h2 class="ctc-rail__heading" id="ctc-rail-answers">Answers without waiting</h2>
				<ul class="ctc-rail__links">
					<li>
						<a class="ctc-rail__link" href="/help">
							<span class="ctc-rail__link-text">Help centre</span>
							<span class="ctc-rail__link-meta">Guides for accounts, payments and projects</span>
						</a>
					</li>
					<li>
						<a class="ctc-rail__link" href="/legal">
							<span class="ctc-rail__link-text">Legal</span>
							<span class="ctc-rail__link-meta">Terms, privacy and acceptable use</span>
						</a>
					</li>
				</ul>
			</section>
		</aside>
	);
}
