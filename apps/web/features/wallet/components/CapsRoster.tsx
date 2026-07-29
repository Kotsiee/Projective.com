import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import { Money } from "./Money.tsx";
import type { BusinessExtras, MoneyView } from "../types/wallet-types.ts";

/**
 * CapsRoster — per-member spending caps and what is left of them.
 *
 * The meter escalates its tint past 80% and again past 95%, but **never on colour alone**: each
 * threshold also swaps the row's status glyph and its tooltip, so the state survives every CVD
 * overlay, high-contrast mode and greyscale print (RULE C-3). §B.6 keeps the explanation in the
 * tooltip rather than as inline row text.
 */
export interface CapsRosterProps {
	caps: BusinessExtras["caps"];
	invoicesDue: number;
	invoicesDueAmount: MoneyView | null;
}

type CapState = "ok" | "warn" | "over";

function capState(utilizationBp: number): CapState {
	if (utilizationBp >= 9500) return "over";
	if (utilizationBp >= 8000) return "warn";
	return "ok";
}

const STATE_MARK: Record<CapState, string> = { ok: "●", warn: "◐", over: "◼" };
const STATE_WORDS: Record<CapState, string> = {
	ok: "Within cap",
	warn: "Approaching the cap",
	over: "At or over the cap",
};

export function CapsRoster(props: CapsRosterProps): JSX.Element {
	return (
		<section class="wlt-caps" aria-labelledby="wlt-caps-title">
			<h3 class="wlt-caps__title wlt-label" id="wlt-caps-title">Spending caps</h3>

			<ul class="wlt-caps__list" role="list">
				{props.caps.map((c) => {
					const state = capState(c.utilizationBp);
					return (
						<li class="wlt-caps__row" key={c.id} data-state={state}>
							<span class="wlt-caps__who">
								<Avatar
									image={c.avatar ?? undefined}
									label={c.memberName}
									size="sm"
									shape="circle"
								/>
								<span class="wlt-caps__name">
									{c.memberHandle
										? <a class="wlt-link" href={`/@${c.memberHandle}`}>{c.memberName}</a>
										: c.memberName}
								</span>
							</span>

							<Tooltip content={`${STATE_WORDS[state]} · ${c.interval}`} placement="top">
								<span
									class="wlt-caps__mark"
									role="img"
									aria-label={`${STATE_WORDS[state]}, ${c.interval}`}
								>
									{STATE_MARK[state]}
								</span>
							</Tooltip>

							<span
								class="wlt-caps__meter"
								style={styleVars({ "--wlt-fill": `${Math.min(100, c.utilizationBp / 100)}%` })}
								role="meter"
								aria-valuenow={c.spent.minor}
								aria-valuemin={0}
								aria-valuemax={c.cap.minor}
								aria-label={`${c.memberName} spend against cap`}
							>
								<span class="wlt-caps__fill" />
							</span>

							<span class="wlt-caps__amounts wlt-num">
								<Money value={c.spent} size="body" showFx={false} />
								<span class="wlt-caps__of">/ {c.cap.display}</span>
							</span>

							{c.resetsLabel && <span class="wlt-caps__resets">{c.resetsLabel}</span>}
						</li>
					);
				})}
			</ul>

			{props.invoicesDue > 0 && props.invoicesDueAmount && (
				<p class="wlt-caps__invoices">
					<a class="wlt-link" href="/wallet/invoices">
						{props.invoicesDue} {props.invoicesDue === 1 ? "invoice" : "invoices"} due
					</a>{" "}
					<Money value={props.invoicesDueAmount} size="body" tone="debit" showFx={false} />
				</p>
			)}
		</section>
	);
}
