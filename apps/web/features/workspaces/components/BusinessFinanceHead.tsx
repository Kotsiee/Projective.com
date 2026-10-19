import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { walletHrefFor, type WorkspaceDetail } from "@projective/types/workspace";
import type { WorkspaceModule } from "../core/module-registry.tsx";
import { walletBalanceFacts } from "../core/overview-model.ts";
import { possessive } from "../core/refusal-copy.ts";

/**
 * BusinessFinanceHead — a business's Finance module (BU6): a real screen head for the hand-off to its
 * pooled wallet, not a placeholder.
 *
 * The wallet (`/wallet?w=business:<id>`) already is the business's finance UI — balances, movements,
 * statements, top-ups — so this screen does not grow a second one. It says where the money lives,
 * states the balance per wallet currency on one meta line (BB9's tiles, the same read as the
 * Overview's money band, which the route only opens for a viewer who may open Finance), and offers ONE
 * tier-4 "Open the business wallet". Following it is a page-local VIEW of the business's figures,
 * never a switch of who the viewer acts as, and the note says so.
 *
 * The balance line is one `MetaLine` whose entries carry their figure as a `node`, because a figure
 * must be isolated left-to-right and tabular on its own (DESIGN_SYSTEM §A Figures — "a hand-built
 * figure must too", as Billing's `.wsp-billing__num`). Each
 * figure is the server's `display` in its own currency, never converted — the Overview band pins its
 * tiles to the same currency, so one balance reads the same on both pages. It is not a `MoneyView`
 * because this is a server component: the app's currency sweep re-projects every server-rendered
 * `MoneyView` into the viewer's currency on a switch, which would undo the pin.
 *
 * The head is the title alone, as on every real module screen (Billing, Spend, Verification) — the
 * placeholder's leading glyph is the mark of a page that only hands off.
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
	const titleId = `wsp-mod-${module.key}`;
	// A view of the business's figures, never a switch of who the viewer acts as (brief §6.1).
	const note = `Balances, movements and statements for ${ws.name} live in its wallet. ` +
		`Opening it shows ${possessive(ws.name)} figures; it does not switch who you act as.`;
	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head wsp-band--tail" aria-labelledby={titleId}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title" id={titleId}>{module.label}</h1>
						</div>
						<p class="wsp-pagehead__note">{note}</p>
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
