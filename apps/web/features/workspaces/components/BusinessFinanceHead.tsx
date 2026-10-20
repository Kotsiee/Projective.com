import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { walletHrefFor, type WorkspaceDetail } from "@projective/types/workspace";
import type { WorkspaceModule } from "../core/module-registry.tsx";
import { walletBalanceFacts } from "../core/overview-model.ts";

/**
 * BusinessFinanceHead — a business's Finance module (BU6): a real screen head for the hand-off to its
 * pooled wallet, not a placeholder.
 *
 * The wallet (`/wallet?w=business:<id>`) already is the business's finance UI — balances, movements,
 * statements, top-ups — so this screen does not grow a second one. It states the balance per wallet
 * currency on one meta line (BB9's tiles, the same read as the Overview's money band, which the route
 * only opens for a viewer who may open Finance) and offers ONE tier-4 "Open the business wallet".
 * Following it is a page-local VIEW of the business's figures, never a switch of who the viewer acts
 * as.
 *
 * The balance line is one `MetaLine` whose entries carry their figure as a `node`, because a figure
 * must be isolated left-to-right and tabular on its own (DESIGN_SYSTEM §A Figures — "a hand-built
 * figure must too", as Billing's `.wsp-billing__num`). Each
 * figure is the server's `display` in its own currency, never converted — the Overview band pins its
 * tiles to the same currency, so one balance reads the same on both pages. It is not a `MoneyView`
 * because this is a server component: the app's currency sweep re-projects every server-rendered
 * `MoneyView` into the viewer's currency on a switch, which would undo the pin.
 *
 * There is no in-body title or subtitle: the header band already names the module (Decision #308).
 *
 * A server component: its stylesheet rules (`.wsp-*`, `ui-meta-line`, `ui-button`) reach the page
 * through the console's lane and header-band islands, which import the same sheets.
 */

export interface BusinessFinanceHeadProps {
	/** The business. */
	workspace: WorkspaceDetail;
	/** The Finance module's registry entry, for its label. */
	module: WorkspaceModule;
}

/** The Finance module's body for a business. */
export function BusinessFinanceHead(props: BusinessFinanceHeadProps): JSX.Element {
	const { workspace: ws, module } = props;
	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head wsp-band--tail" aria-label={module.label}>
					<div class="wsp-band__inner">
						<MetaLine
							class="wsp-financehead__balance"
							items={walletBalanceFacts(ws.moneyTiles).map((fact) => ({
								text: fact.figure === null ? fact.text : `${fact.figure} ${fact.text}`,
								node: fact.figure === null ? undefined : (
									<>
										<span class="wsp-financehead__num">{fact.figure}</span> {fact.text}
									</>
								),
							}))}
						/>
						<div class="wsp-financehead__act">
							<a
								class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md wsp-financehead__open"
								href={walletHrefFor("business", ws.id)}
							>
								<span class="ui-button__label">Open the business wallet</span>
							</a>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
