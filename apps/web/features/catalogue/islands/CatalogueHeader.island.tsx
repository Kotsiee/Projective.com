import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/console.css";
import "../styles/header-band.css";
import { TabStrip, type TabStripItem } from "@projective/ui/navigation";
import { CatalogueHealth, CatalogueSales } from "../components/CatalogueRollups.tsx";
import { CONSOLE_CANVAS_ID } from "../core/catalogue-model.ts";
import { consoleView, rollups, setConsoleUrl, startConsoleSync } from "../core/console-store.ts";
import type { CatalogueStats, ConsoleUrlState, ConsoleView } from "../types/catalogue-types.ts";

/**
 * CatalogueHeader — the console's header band, laid out like every middle-nav header band (and like
 * the workspace's, {@link ListingHeader}): identity at the start (the title over the catalogue's
 * health — how much is live, how it is rated), the view switch (Listings · Analytics · Clients)
 * centred, and the sales figures for the window at the end. Search, the type, sort and New listing
 * live in the canvas's sticky toolbar (`CatalogueToolbar`) (Decisions #221, #309).
 */

// #region Props
export interface CatalogueHeaderProps {
	url: ConsoleUrlState;
	/** The server's rollups, for the first byte. */
	initialStats: CatalogueStats;
	/** The band's title; a team's catalogue names the team (Decision #312). */
	title?: string;
}
// #endregion

const VIEW_TABS: readonly TabStripItem<ConsoleView>[] = [
	{ key: "listings", label: "Listings" },
	{ key: "analytics", label: "Analytics" },
	{ key: "clients", label: "Clients" },
];

export default function CatalogueHeader(props: CatalogueHeaderProps): JSX.Element {
	const state = consoleView(props.url);

	useEffect(() => startConsoleSync(), []);

	const stats = rollups.value ?? props.initialStats;

	return (
		<header class="cat-band cat-hdr">
			<div class="cat-band__start">
				<div class="cat-band__idblock">
					<h1 class="cat-band__title">{props.title ?? "Catalogue"}</h1>
					<p class="cat-band__meta">
						<CatalogueHealth stats={stats} />
					</p>
				</div>
			</div>

			<TabStrip<ConsoleView>
				label="Catalogue view"
				activeKey={state.view}
				items={VIEW_TABS}
				onSelect={(view) => setConsoleUrl({ view })}
				panelId={CONSOLE_CANVAS_ID}
			/>

			<div class="cat-band__end">
				<CatalogueSales stats={stats} />
			</div>
		</header>
	);
}
