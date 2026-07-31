import type { JSX } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { Tooltip } from "@projective/ui/feedback";
import { InfoGlyph } from "../core/glyphs.tsx";
import { ARC, arcGeometry, bp, gateSentence, rungCode } from "../core/standing-model.ts";
import { Money } from "./Money.tsx";
import type { WalletStanding } from "../types/wallet-types.ts";

/**
 * StandingGauge — the earned rung, rendered as what it PAYS.
 *
 * Consumer finance uses a credit-score arc. Projective has no credit score; it has an earned
 * Standing ladder whose direct, concrete benefit is the marketplace-commission taper (8% → 6.5%).
 * So the arc is the vehicle, but the payoff column is the point: the user should read this and
 * understand "climbing this ladder literally pays me more per job".
 *
 * Two things it deliberately does NOT do:
 *
 *  - **It never implies the rung is purchasable.** There is no button, no plan badge, no trophy, no
 *    streak, no upgrade affordance of any kind. A subscription accelerates capacity and can never
 *    buy a rung (finance-model.md §16.5); a visual suggesting otherwise would be a product lie, and
 *    the moment clients suspect a rung can be bought the signal is worthless to everyone.
 *  - **It never conflates the two rates.** The flat 5% platform service fee does not taper, and it
 *    is stated beside the commission precisely so the two cannot be read as one number.
 *
 * The stage floor gets its own linear form rather than a second dial — see `standing-model.ts` for
 * why an arc alone cannot express a two-condition gate honestly.
 */
export interface StandingGaugeProps {
	standing: WalletStanding;
}

export function StandingGauge(props: StandingGaugeProps): JSX.Element {
	const s = props.standing;
	const geo = arcGeometry(s);
	const gate = gateSentence(s);
	const stagePct = s.next && s.next.minStages > 0
		? Math.min(100, (s.stagesCompleted / s.next.minStages) * 100)
		: 100;

	const summary = s.next
		? `Standing ${rungCode(s.level)} ${s.label}. Reliability index ${s.score.toFixed(1)} out of ` +
			`100, ${s.stagesCompleted} stages completed. Marketplace commission ${bp(s.commissionBp)}` +
			(s.nextCommissionBp ? `, falling to ${bp(s.nextCommissionBp)} at ${s.next.label}.` : ".")
		: `Standing ${rungCode(s.level)} ${s.label}, the top rung. Marketplace commission ` +
			`${bp(s.commissionBp)}, the lowest rate on the platform.`;

	return (
		<section class="wlt-standing" aria-labelledby="wlt-standing-title">
			<header class="wlt-standing__head">
				<h3 class="wlt-standing__title wlt-label" id="wlt-standing-title">Standing</h3>
				<span class="wlt-standing__earned">Earned by delivery</span>
			</header>

			<div class="wlt-standing__body">
				<div class="wlt-standing__gauge">
					<svg
						class="wlt-standing__arc"
						viewBox={ARC.viewBox}
						role="img"
						aria-labelledby="wlt-standing-sr"
					>
						<title id="wlt-standing-sr">{summary}</title>
						<defs>
							{
								/*
								 * The ceiling veil's texture. A hatch rather than a tint, because the region it
								 * covers is INERT — score earned past the stage floor is real, but it cannot
								 * promote, and a solid colour would read as progress.
								 */
							}
							<pattern
								id="wlt-standing-hatch"
								width="6"
								height="6"
								patternUnits="userSpaceOnUse"
								patternTransform="rotate(45)"
							>
								<line x1="0" y1="0" x2="0" y2="6" stroke="var(--wlt-hatch)" stroke-width="1" />
							</pattern>
						</defs>

						<circle
							class="wlt-standing__arc-track"
							cx={ARC.cx}
							cy={ARC.cy}
							r={ARC.r}
							stroke-dasharray={geo.trackDash}
							transform={`rotate(${ARC.from} ${ARC.cx} ${ARC.cy})`}
						/>
						<circle
							class={`wlt-standing__arc-fill${geo.capped ? " wlt-standing__arc-fill--capped" : ""}`}
							cx={ARC.cx}
							cy={ARC.cy}
							r={ARC.r}
							stroke-dasharray={geo.fillDash}
							transform={`rotate(${ARC.from} ${ARC.cx} ${ARC.cy})`}
						/>
						{geo.veilDash && (
							<circle
								class="wlt-standing__arc-veil"
								cx={ARC.cx}
								cy={ARC.cy}
								r={ARC.r}
								stroke-dasharray={geo.veilDash}
								stroke-dashoffset={geo.veilOffset}
								transform={`rotate(${ARC.from} ${ARC.cx} ${ARC.cy})`}
							/>
						)}
						{geo.notches.map((n) => (
							<circle
								key={n.level}
								class="wlt-standing__notch"
								data-state={n.state}
								cx={n.x}
								cy={n.y}
								r="2"
							/>
						))}
					</svg>

					{/* HTML, not SVG text, so the readout inherits the display-numeric scale. */}
					<div class="wlt-standing__readout">
						<span class="wlt-standing__score wlt-num">{s.score.toFixed(1)}</span>
						<span class="wlt-standing__rung">{s.label}</span>
						<span class="wlt-standing__rung-code wlt-num">{rungCode(s.level)}</span>
					</div>
				</div>

				<div class="wlt-standing__payoff">
					<p class="wlt-standing__rates">
						<span class="wlt-standing__rate wlt-standing__rate--now wlt-num">
							{bp(s.commissionBp)}
						</span>
						<span class="wlt-standing__rate-label">now</span>
						{s.next && s.nextCommissionBp !== null && (
							<>
								<span class="wlt-standing__arrow wlt-icon--dir" aria-hidden="true">→</span>
								<span class="wlt-standing__rate wlt-standing__rate--next wlt-num">
									{bp(s.nextCommissionBp)}
								</span>
								<span class="wlt-standing__rate-label">at {s.next.label}</span>
							</>
						)}
						{!s.next && <span class="wlt-standing__rate-label">· lowest rate on the platform</span>}
					</p>
					<p class="wlt-standing__rate-caption">Marketplace commission</p>

					{
						/*
						 * The taper made concrete, and only where the server actually priced it. An L1
						 * subject has no earning history, so no figure is invented — the gate sentence
						 * takes the slot instead.
						 */
					}
					{s.commissionPaid && s.commissionAtNext && s.volumeWindow
						? (
							<p class="wlt-standing__gain">
								On {s.volumeWindow.display} earned over the {s.windowLabel.toLowerCase()} you paid
								{" "}
								<Money value={s.commissionPaid} size="body" tone="credit" showFx={false} />
								{" — at "}
								{s.next?.label ?? "this rate"} that would have been{" "}
								<Money value={s.commissionAtNext} size="body" tone="credit" showFx={false} />.
							</p>
						)
						: gate
						? <p class="wlt-standing__gain">{gate}</p>
						: null}

					{gate && s.commissionPaid && <p class="wlt-standing__gate">{gate}</p>}

					{
						/*
						 * Label and count flank the meter ABOVE it rather than beside it, and the source
						 * order matches that so nothing is visually reordered. The three were previously
						 * one `auto 1fr auto` row: the nowrap label took 128px of an 86px box, the meter's
						 * `1fr` collapsed to zero, and the count — the stage-gate figure, one of the two
						 * conditions this whole gauge exists to carry — was pushed 13px outside the
						 * surface's `overflow: clip` and cut, in LTR and RTL alike.
						 */
					}
					<div class="wlt-standing__stages">
						<span class="wlt-standing__stages-label wlt-label">Completed stages</span>
						<span class="wlt-standing__stage-count wlt-num">
							{s.stagesCompleted}
							{s.next ? ` / ${s.next.minStages}` : ""}
						</span>
						<span
							class="wlt-standing__stage-meter"
							style={styleVars({ "--wlt-fill": `${stagePct}%` })}
							role="meter"
							aria-valuenow={s.stagesCompleted}
							aria-valuemin={0}
							aria-valuemax={s.next?.minStages ?? s.stagesCompleted}
							aria-label="Completed stages toward the next rung"
						>
							<span class="wlt-standing__stage-fill" />
						</span>
					</div>
				</div>
			</div>

			<footer class="wlt-standing__fee">
				<p class="wlt-standing__fee-text">
					Platform service fee {bp(s.platformFeeBp)} — fixed at every rung, never tapers.
				</p>
				<Tooltip content="What moves this score" placement="top">
					<a class="wlt-standing__why" href="/settings/standing" aria-label="What moves this score">
						{InfoGlyph}
					</a>
				</Tooltip>
			</footer>
		</section>
	);
}
