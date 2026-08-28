import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import {
	type ProjectStage,
	revisionAllowanceKind,
	type StageRevisions,
} from "@projective/types/explore";
import { MetaLine, ScopeChecklist } from "./entity-view-parts.tsx";

/**
 * StageProgressLedger — the unboxed, hairline-separated stage progression track.
 *
 * The Pipeline and One-Off archetypes' primary evaluation block (`DESIGN_SYSTEM.md` §D.8.1). It is a
 * **continuous vertical timeline**: one hairline running the full height of the run, with each
 * stage's step number in a small circular outline sitting ON it.
 *
 * Three decisions in here are rules rather than preferences, and each was a real defect first:
 *
 * **1. It is not an `Accordion`.** That component brings a bordered panel per tab, which is precisely
 * the boxed accordion §D.8.1 exists to prevent — a card, inside a card, inside a section.
 *
 * **2. Expansion is native `<details>`/`<summary>`, so this stays a SERVER component.** No island, no
 * hydration, no signal, and it works with JavaScript disabled. The public footer's link stacks
 * established the pattern (Decision #13). An island here would also have been wrong for a second
 * reason: an SSR-painted stage run that only becomes expandable after hydration is a surface whose
 * primary evaluation control is missing during exactly the window a first-time visitor is reading it.
 *
 * **3. The track runs BEHIND the expansion, not between the rows.** A line drawn as a border on each
 * row breaks at every open stage, and a sequence that visibly discontinues stops reading as a
 * sequence — which is the only thing the track was drawn to communicate. It is therefore one
 * absolutely-positioned rule on the list, inset to the step-node axis, with the nodes painted over
 * it. Adding a stage or opening one cannot break it because neither touches the line.
 *
 * **4. The numeral sits on a `--primary` RING, never on a `--primary` FILL.** `--on-primary` on
 * `--primary` measures **3.57:1 in dark** — a theme-engine defect flagged in root CLAUDE.md §8
 * Decisions #64/#65/#74/#76/#77 and still unfixed at the token layer. A ring puts the numeral on the
 * surface pair instead, which measures cleanly in both themes.
 */

// #region Status
/** The status glyph + accessible word for a stage's lifecycle position. */
const STATUS_META: Record<
	ProjectStage["status"],
	{ icon: "check" | "clock" | "hourglass"; word: string }
> = {
	completed: { icon: "check", word: "Completed" },
	active: { icon: "clock", word: "In progress" },
	upcoming: { icon: "hourglass", word: "Upcoming" },
};
// #endregion

export interface StageProgressLedgerProps {
	stages: readonly ProjectStage[];
	/**
	 * A One-Off collapses to a single "Full delivery" stage, so the step column carries no useful
	 * ordinal. Hiding the numerals leaves the track as a plain deliverables spine, which is what a
	 * single-stage engagement actually is.
	 */
	hideOrdinals?: boolean;
	/**
	 * Whether the stage carries seats/roles. A SERVICE stage sets `seatsTotal: 0` — it is scope, not
	 * a recruitment posting — so the seat facts are suppressed rather than rendered as "0 of 0".
	 */
	showSeats?: boolean;
	/** The viewer's display currency, threaded from the lane so both regions agree. */
	currency?: string;
}

export function StageProgressLedger(
	{ stages, hideOrdinals, showSeats, currency }: StageProgressLedgerProps,
): JSX.Element | null {
	if (!stages.length) return null;

	/*
	 * WHICH STAGES OPEN, and why it is derived rather than fixed.
	 *
	 * A stage run has two completely different readings depending on whether the thing exists yet. A
	 * PROJECT in flight has one active stage and that is the one worth opening; a SERVICE being
	 * evaluated has no active stage at all — every stage is prospective scope — so keying the default
	 * on `status === "active"` opened nothing and the entire "what you get" collapsed behind four
	 * one-line summaries. Measured on `sv-brand-identity-sprint`: four stages, all `upcoming`, each
	 * 33px tall, with no deliverable visible anywhere on the page.
	 *
	 * So: open the active stage when there is one, otherwise open everything.
	 */
	const hasProgression = stages.some((s) => s.status === "active");

	/*
	 * A status word that is identical on every row distinguishes nothing and is pure noise — four
	 * consecutive "UPCOMING" labels on a service listing tell the reader precisely as much as zero of
	 * them would. It is printed only when the run actually has more than one state in it.
	 */
	const showStatus = new Set(stages.map((s) => s.status)).size > 1;

	return (
		<ol class="evp-track" data-count={stages.length}>
			{/* The continuous rule. One element for the whole run, so no row can interrupt it. */}
			<span class="evp-track__rule" aria-hidden="true" />

			{stages.map((stage) => {
				const status = STATUS_META[stage.status];
				const hasSeats = showSeats && stage.seatsTotal > 0;
				const facts: string[] = [];
				if (stage.turnaround) facts.push(stage.turnaround);
				if (stage.dependency) facts.push(stage.dependency);
				if (hasSeats) {
					facts.push(
						stage.seatKind === "roles"
							? `${stage.roles.length} open roles`
							: `${stage.openSeats} of ${stage.seatsTotal} seats open`,
					);
				}

				const expandable = !!stage.deliverables?.length || !!stage.skills.length ||
					(hasSeats && stage.seatKind === "roles");

				return (
					<li class="evp-track__item" key={stage.id} id={`stage-${stage.id}`}>
						<span class="evp-track__node" data-status={stage.status} aria-hidden="true">
							{hideOrdinals
								? <Icon name={status.icon} size="xs" class="evp-track__nodeicon" />
								: <span class="evp-track__ordinal">{stage.index}</span>}
						</span>

						{
							/*
						  `<details>` is the expansion mechanism and `open` on the ACTIVE stage is the
						  default state, because the stage a reader most wants to see is the one running.
						  A `<summary>` is focusable and Enter/Space-activatable natively, so the keyboard
						  path costs nothing and cannot be forgotten.
						*/
						}
						<details
							class="evp-track__body"
							open={hasProgression ? stage.status === "active" : true}
						>
							<summary class="evp-track__summary" role={expandable ? undefined : "presentation"}>
								<span class="evp-track__heads">
									<span class="evp-track__name">{stage.name}</span>
									{showStatus && (
										<span class="evp-track__status" data-status={stage.status}>
											{status.word}
										</span>
									)}
								</span>
								{
									/*
								  ONE figure per stage — the INITIAL per-ticket price, never the 0.5×–2.0×
								  workload range around it.

								  The range is real (a pipeline bills per ticket at variable intensity), but two
								  numbers in a summary row read as two prices, and the row a buyer scans is the one
								  they will quote back. The upper bound is not lost: it belongs with the intensity
								  that produces it, which is a ticket-level fact and lives in the ticket composer.

								  `stage.price.min` and not a re-derivation, so this row and the lane's stage list
								  are the same number from the same field and cannot round apart.
								*/
								}
								<span class="evp-track__price">
									<MoneyView
										minor={Math.round(stage.price.min * 100)}
										currency={currency ?? "USD"}
										size="key"
										hideOrigin
									/>
									<span class="evp-track__priceunit">/ ticket</span>
								</span>
								{expandable && (
									<Icon
										name="chevron-down"
										size="sm"
										class="evp-track__caret"
										aria-hidden
									/>
								)}
							</summary>

							<div class="evp-track__detail">
								<p class="evp-track__desc">{stage.description}</p>
								{facts.length > 0 && <MetaLine items={facts} class="evp-track__facts" />}

								{stage.revisions && (
									<StageRevisionLine revisions={stage.revisions} currency={currency} />
								)}

								{stage.deliverables?.length
									? (
										<>
											<h3 class="evp-track__subhead">Deliverables</h3>
											<ScopeChecklist items={stage.deliverables} dense />
										</>
									)
									: null}

								{hasSeats && stage.seatKind === "roles" && stage.roles.length > 0 && (
									<>
										<h3 class="evp-track__subhead">Open roles</h3>
										<ul class="evp-track__roles">
											{stage.roles.map((role) => (
												<li class="evp-track__role" key={role.name}>
													<span class="evp-track__rolename">{role.name}</span>
													<span class="evp-track__rolemeta">
														{role.openSeats} open · {role.price.label}
													</span>
												</li>
											))}
										</ul>
									</>
								)}

								{hasSeats && stage.seatKind === "seats" && stage.seatSummary && (
									<p class="evp-track__seatsummary">{stage.seatSummary}</p>
								)}

								{
									/*
								  Required skills are metadata, so they are an inline middot line and not the
								  tag cluster this block used to render (§B.11.2). The set is small enough to
								  print whole — it is a requirement, and truncating a requirement changes it.
								*/
								}
								{stage.skills.length > 0 && (
									<MetaLine
										items={stage.skills.map((s) => s.label)}
										class="evp-track__skills"
									/>
								)}
							</div>
						</details>
					</li>
				);
			})}
		</ol>
	);
}

/**
 * The stage's revision allowance — what is included, and what one more costs.
 *
 * Two facts on one line, because they are one offer: "2 free revisions" without a price for the third
 * is half a commitment, and it is the half that reads generously.
 *
 * The three shapes are classified by the SSOT's own {@link revisionAllowanceKind} rather than by
 * branching on the fields here, because the two numbers interact: an included count means nothing once
 * further rounds are free, and printing both anyway produces "2 free revisions, then free" — a sentence
 * that argues with itself. The lane and the listing's trust row ask the same function.
 *
 * No glyph. Its neighbours in this block are `MetaLine` facts and a `ScopeChecklist`, and the check
 * mark there means "included in what you get" — a second, different mark on the line immediately below
 * would read as a third category of thing rather than as one more fact about the stage. The figure goes
 * through `MoneyView` like every other amount on the page, so it converts with the viewer's display
 * currency instead of staying quoted in whatever the listing was written in.
 */
function StageRevisionLine(
	{ revisions, currency }: { revisions: StageRevisions; currency?: string },
): JSX.Element {
	const kind = revisionAllowanceKind(revisions);
	const price = (
		<MoneyView
			minor={Math.round(revisions.extraPrice.min * 100)}
			currency={currency ?? "USD"}
			size="micro"
			hideOrigin
		/>
	);

	if (kind === "unlimited") {
		return (
			<p class="evp-track__revisions">
				<span class="evp-track__revfree">Unlimited revisions</span>
				<span class="evp-track__revsep" aria-hidden="true">·</span>
				<span class="evp-track__revextra">further rounds are never charged</span>
			</p>
		);
	}

	if (kind === "metered") {
		return (
			<p class="evp-track__revisions">
				<span class="evp-track__revfree">Revisions billed per round</span>
				<span class="evp-track__revsep" aria-hidden="true">·</span>
				<span class="evp-track__revextra">{price} each</span>
			</p>
		);
	}

	return (
		<p class="evp-track__revisions">
			<span class="evp-track__revfree">
				{revisions.free} free revision{revisions.free === 1 ? "" : "s"} included
			</span>
			<span class="evp-track__revsep" aria-hidden="true">·</span>
			<span class="evp-track__revextra">then {price} per further round</span>
		</p>
	);
}
