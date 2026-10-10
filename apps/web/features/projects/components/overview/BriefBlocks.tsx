import type { JSX } from "preact";
import type { WorkspaceBrief } from "../../types/projects-types.ts";
import { Block, MetaFacts } from "../dashboard/DashboardBlocks.tsx";

/**
 * The brief every person on the engagement works against: what it is, how it is shaped and priced,
 * the skills it asks for — then the terms a freelancer is hired under. Server components over the
 * composed {@link WorkspaceBrief}; static prose and a hairline ledger, never a card (§B.4, §B.9).
 */

// #region Brief
/** The description as paragraphs, with the shape line above and the skills as one middot line. */
export function BriefBlock({ brief }: { brief: WorkspaceBrief }): JSX.Element {
	const facts = [brief.formatLabel, brief.deadlineLabel, brief.budgetLabel].filter(
		(fact): fact is string => !!fact,
	);
	const paragraphs = brief.description.split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean);
	return (
		<Block title="Brief" region="details">
			<div class="pjd-brief">
				<MetaFacts items={facts} />
				{paragraphs.length === 0
					? <p class="pjd-block__empty">No description yet.</p>
					: (
						<div class="pjd-brief__prose">
							{paragraphs.map((text, i) => <p key={i}>{text}</p>)}
						</div>
					)}
				{brief.tags.length > 0 && (
					<p class="pjd-brief__skills">
						<span class="pjd-brief__label">Skills</span>
						<MetaFacts items={brief.tags} />
					</p>
				)}
			</div>
		</Block>
	);
}
// #endregion

// #region Inclusions & terms
/**
 * The NDA and the operational terms as a definition ledger, one hairline between rows. The NDA leads:
 * it is the one term a freelancer must accept before seeing anything confidential.
 */
export function TermsBlock({ brief }: { brief: WorkspaceBrief }): JSX.Element {
	return (
		<Block title="Inclusions & terms">
			<dl class="pjd-terms">
				<div class="pjd-terms__row" data-nda={brief.nda.source}>
					<dt class="pjd-terms__term">NDA</dt>
					<dd class="pjd-terms__value">{brief.nda.label}</dd>
				</div>
				{brief.terms.map((term) => (
					<div class="pjd-terms__row" key={term.label}>
						<dt class="pjd-terms__term">{term.label}</dt>
						<dd class="pjd-terms__value">{term.value}</dd>
					</div>
				))}
			</dl>
		</Block>
	);
}
// #endregion
