import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/proposals.css";
import type { ApplicationStatus, SentApplication } from "@projective/types/projects";
import { meterLine } from "../core/allowance-model.ts";
import {
	effectiveAllowance,
	ensureAllowance,
	refreshSentProposals,
	sentProposals,
	withdrawProposal,
} from "../core/allowance-state.ts";

/** The lifecycle words a proposal shows (PRODUCT_SPEC §The Hiring Process). */
const STATUS_LABEL: Record<ApplicationStatus, string> = {
	pending: "Awaiting approval",
	accepted: "Accepted",
	rejected: "Not selected",
	withdrawn: "Withdrawn",
};

const SENT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/**
 * ProposalList — "Your proposals" on `/projects`: every proposal the viewer has sent (and those filed for
 * a team they belong to), newest first, each with its lifecycle status and — while it is still pending —
 * one quiet text action, **Withdraw proposal (refunds 1 proposal)**.
 *
 * Layout follows the portfolio it sits under: rows on the page's ground divided by single hairlines, a
 * middot meta line, and containment only for the lifecycle STATUS (§B.11). The section header carries
 * the live allowance line, so the refund a withdrawal makes is visible where it was made.
 *
 * Withdrawing is two presses — the action, then a confirm in its place — because it cannot be taken
 * back: re-applying spends a buffer token again. The confirmed write re-reads the shared allowance
 * store, so the header popover's meter and this line move together with no reload.
 *
 * Renders nothing until the list has loaded, and nothing for a viewer who has never sent one: a buyer's
 * portfolio has no use for an empty proposals section.
 */
export default function ProposalList(): JSX.Element | null {
	const confirming = useSignal<string | null>(null);
	const busy = useSignal<string | null>(null);
	const announcement = useSignal("");

	// One external read each, on mount; the stores coalesce with any other surface on the page.
	useEffect(() => {
		void refreshSentProposals();
		ensureAllowance();
	}, []);

	const rows = sentProposals.value;
	if (!rows || rows.length === 0) return null;
	const snapshot = effectiveAllowance.value;
	const pending = rows.filter((row) => row.status === "pending").length;

	async function withdraw(row: SentApplication): Promise<void> {
		busy.value = row.id;
		const result = await withdrawProposal(row.id);
		busy.value = null;
		confirming.value = null;
		announcement.value = result.ok
			? `Withdrew your proposal for ${row.projectTitle}. One proposal returned to this week's allowance.`
			: result.message;
	}

	return (
		<section class="prop-list" id="proposals" aria-labelledby="prop-list-head">
			<header class="prop-list__head">
				<h2 class="prop-list__eyebrow" id="prop-list-head">Your proposals</h2>
				<p class="prop-list__meta">
					<span class="prop-list__num">{pending}</span> awaiting approval
					{snapshot
						? (
							<>
								<span aria-hidden="true">·</span>
								<span class="prop-list__num">{meterLine(snapshot.status)}</span>
							</>
						)
						: null}
				</p>
			</header>

			<ul class="prop-list__rows">
				{rows.map((row) => {
					const meta = [
						row.stageName ?? row.stageSlug,
						row.roleTitle,
						row.applicantType === "team" ? `as ${row.teamName ?? "your team"}` : null,
						`sent ${SENT_DATE.format(new Date(row.createdAt))}`,
					].filter(Boolean).join(" · ");
					const canWithdraw = row.status === "pending" && row.canWithdraw;
					const isBusy = busy.value === row.id;
					return (
						<li key={row.id} class="prop-list__row" data-status={row.status}>
							<a class="prop-list__link" href={`/projects/${row.projectSlug}`}>
								<span class="prop-list__name">{row.projectTitle}</span>
								<span class="prop-list__rowmeta">{meta}</span>
							</a>

							<span class="prop-list__status" data-status={row.status}>
								<span class="prop-list__dot" aria-hidden="true" />
								{STATUS_LABEL[row.status]}
							</span>

							<span class="prop-list__action">
								{canWithdraw && confirming.value !== row.id
									? (
										<button
											type="button"
											class="prop-list__btn"
											onClick={() => (confirming.value = row.id)}
										>
											Withdraw proposal (refunds 1 proposal)
										</button>
									)
									: null}
								{canWithdraw && confirming.value === row.id
									? (
										<>
											<button
												type="button"
												class="prop-list__btn prop-list__btn--danger"
												disabled={isBusy}
												aria-busy={isBusy}
												onClick={() => void withdraw(row)}
											>
												{isBusy ? "Withdrawing…" : "Confirm withdraw"}
											</button>
											<button
												type="button"
												class="prop-list__btn"
												disabled={isBusy}
												onClick={() => (confirming.value = null)}
											>
												Keep
											</button>
										</>
									)
									: null}
							</span>
						</li>
					);
				})}
			</ul>

			<p class="ui-visually-hidden" role="status" aria-live="polite">{announcement.value}</p>
		</section>
	);
}
