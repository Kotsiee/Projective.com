import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { TicketMetric, TicketMoney, TicketTab } from "../../core/ticket-view.ts";

/**
 * TicketFooter — the ticket modal's footer: what the ticket costs and what it is made of at the
 * leading edge, then the one line of status and the decision's actions at the trailing edge.
 *
 * Two groups, so the actions keep the end of the row by `justify-content` alone (§B.8.6): nothing in
 * the row is a spacer, and a status line that renders or does not never moves them. Within the
 * actions the primary is last.
 */
export interface TicketFooterProps {
	money: TicketMoney;
	/** A ticket being created has spent nothing, so the Spent figure is not drawn. */
	creating: boolean;
	metrics: TicketMetric[];
	onOpenTab: (tab: TicketTab) => void;
	/** The trailing status — the readiness sentence or the funding line — or `null` for none. */
	status: JSX.Element | null;
	/** The decision's actions, secondary first and the primary last; `null` for none. */
	actions: JSX.Element | null;
}

export function TicketFooter(props: TicketFooterProps): JSX.Element {
	const { money } = props;
	return (
		<footer class="tkv__foot">
			<div class="tkv__lead">
				<div class="tkv-money">
					<span class="tkv-money__fig" data-role="total">
						<span class="tkv-money__k">Ticket cost</span>
						<span class="tkv-money__v" data-unpriced={money.totalLabel ? undefined : "true"}>
							{money.totalLabel ?? "Not priced"}
						</span>
					</span>
					{props.creating ? null : (
						<Tooltip content="Released to the freelancer and paid in platform fees. Escrow held against unaccepted work is not spent.">
							<span class="tkv-money__fig" data-role="spent" tabIndex={0}>
								<span class="tkv-money__k">Spent</span>
								<span class="tkv-money__v">{money.spentLabel}</span>
							</span>
						</Tooltip>
					)}
				</div>

				<ul class="tkv-metrics" aria-label="Ticket summary">
					{props.metrics.map((m) => {
						const content = (
							<>
								<Icon name={m.icon} size="xs" class="tkv-metric__mark" />
								<span class="tkv-metric__value">{m.value}</span>
							</>
						);
						return (
							<li key={m.key}>
								<Tooltip content={m.label}>
									{m.target
										? (
											<button
												type="button"
												class="tkv-metric"
												data-active={m.active ? "true" : undefined}
												aria-label={`${m.label}. Open the ${m.target} view.`}
												onClick={() => props.onOpenTab(m.target as TicketTab)}
											>
												{content}
											</button>
										)
										: (
											<span
												class="tkv-metric"
												data-static="true"
												aria-label={m.label}
												tabIndex={0}
											>
												{content}
											</span>
										)}
								</Tooltip>
							</li>
						);
					})}
				</ul>
			</div>

			<div class="tkv__trail">
				{props.status}
				{props.actions ? <div class="tkv__footacts">{props.actions}</div> : null}
			</div>
		</footer>
	);
}
