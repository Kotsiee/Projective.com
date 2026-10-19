import type { JSX } from "preact";
import {
	FAQ_COPY,
	FAQ_SECTION_ID,
	FAQ_TITLE_ID,
	faqEntries,
	type FaqEntry,
} from "@features/landing/core/faq.ts";

// #region Component
/** Props for {@link Faq}. */
export interface FaqProps {
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`), or
	 * `null` when it is unavailable — then every fee clause drops (`flows/LANDING.md` §4).
	 */
	feeBp: number | null;
	/**
	 * The questions to print, when the page controller already built them for the FAQPage JSON-LD
	 * (so both print one list); built from `feeBp` otherwise.
	 */
	entries?: readonly FaqEntry[];
}

/**
 * Faq — the landing's common questions, `#faq` (`flows/LANDING.md` §2.1 note 23, §2.3 note 21,
 * §4.10). A server component with no island: the section header "FAQ" and the h2 the section is
 * labelled by, then the eight questions as native `<details>` disclosures — the `<summary>` is the
 * question and the keyboard's control, the paragraph under it the answer — the first one open, so
 * the section shows an answer before anything is pressed. The text is {@link faqEntries}', the same
 * strings the page's FAQPage JSON-LD carries. "More answers in Help" (`/help`) follows the list.
 */
export function Faq({ feeBp, entries }: FaqProps): JSX.Element {
	const questions = entries ?? faqEntries(feeBp);
	return (
		<section id={FAQ_SECTION_ID} class="lp-faq" aria-labelledby={FAQ_TITLE_ID}>
			<div class="lp-faq__inner">
				<header class="lp-faq__head">
					<p class="lp-eyebrow">{FAQ_COPY.eyebrow}</p>
					<h2 id={FAQ_TITLE_ID} class="lp-display lp-display--section lp-faq__title">
						{FAQ_COPY.title}
					</h2>
				</header>
				<div class="lp-faq__list">
					{questions.map((entry, index) => (
						<details
							key={entry.id}
							id={`faq-${entry.id}`}
							class="lp-faq__item"
							open={index === 0}
						>
							<summary class="lp-faq__q">
								<span>{entry.question}</span>
								<span class="lp-faq__icon" aria-hidden="true" />
							</summary>
							<p class="lp-faq__a">{entry.answer}</p>
						</details>
					))}
				</div>
				<a class="lp-faq__more" href={FAQ_COPY.moreHref}>{FAQ_COPY.more}</a>
			</div>
		</section>
	);
}
// #endregion
