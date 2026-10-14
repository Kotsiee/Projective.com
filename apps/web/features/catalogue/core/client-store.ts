import { signal } from "@preact/signals";
import { catalogueSim } from "@web/utils/dev-seam.ts";
import {
	contextDrawerOpen,
	contextPanelDocked,
	contextPanelInflow,
} from "@web/features/shell/core/context-panel-state.ts";
import { getCatalogue } from "./api.ts";
import { consoleUrl, setConsoleUrl } from "./console-store.ts";
import { setWorkspaceUrl } from "./workspace-store.ts";
import {
	clientDetailPath,
	clientPipelinePath,
	type ClientReadScope,
	closeFocusTarget,
} from "./client-model.ts";
import { consoleHref } from "../types/catalogue-types.ts";
import type { ClientDetail, ClientPipeline } from "../types/catalogue-types.ts";
import type { CatalogueResult } from "../types/results.ts";

/**
 * client-store — the Clients surfaces' shared state: which surface holds the board (the console's
 * Clients view or the workspace's Clients tab), choosing and dismissing a buyer through that
 * surface's own URL setter, revealing the panel the drawer lives in, the reads behind the board and
 * the drawer, and where focus returns when the drawer closes.
 *
 * The buyer itself lives only in the URL (`?client=@handle`); nothing here holds a second copy.
 */

/** Which surface a board or drawer belongs to. */
export type ClientSurface = "console" | "workspace";

// #region Reads
/** Bumped after a write the drawer made, so the board re-reads lanes that write may have moved. */
export const pipelineRevision = signal(0);

/** The board for a scope, with the `clientPipeline` dev axis when one is set. */
export function readPipeline(scope: ClientReadScope): Promise<CatalogueResult<ClientPipeline>> {
	return getCatalogue<ClientPipeline>(clientPipelinePath(scope, catalogueSim("clientPipeline")));
}

/** One buyer for the drawer. */
export function readClient(
	handle: string,
	scope: ClientReadScope,
): Promise<CatalogueResult<ClientDetail>> {
	return getCatalogue<ClientDetail>(
		clientDetailPath(handle, scope, catalogueSim("clientPipeline")),
	);
}
// #endregion

// #region Panel
let consolePanelMounted = false;

/** The console's client drawer says this page's frame carries a panel column for it. */
export function markClientPanelMounted(): void {
	consolePanelMounted = true;
}

/** Show the panel the drawer lives in, in whichever form the viewport presents it. */
export function revealClientPanel(): void {
	if (contextPanelInflow()) contextPanelDocked.value = true;
	else contextDrawerOpen.value = true;
}
// #endregion

// #region Choose and dismiss
/**
 * Choose a buyer: `?client=@handle` as a pushed entry, so Back closes the drawer again. The console
 * resolves its panel on the server, so a console page rendered without one navigates instead (the
 * workspace's own setter does the same for its panel).
 */
export function chooseClient(surface: ClientSurface, handle: string): void {
	if (surface === "workspace") {
		setWorkspaceUrl({ client: handle }, "push");
	} else if (!consolePanelMounted) {
		globalThis.location?.assign(consoleHref({ ...consoleUrl.peek(), client: handle }));
		return;
	} else {
		setConsoleUrl({ client: handle }, "push");
	}
	revealClientPanel();
}

/** The element focus falls back to when no row is on the board: the canvas. */
export const CLIENTS_CANVAS_ID = "cat-cl-canvas";

/**
 * Close the drawer: drop `?client=` in place (closing is not a step Back should replay), shut the
 * slide-over, and hand focus back to the row that opened it once the DOM has settled.
 */
export function dismissClient(surface: ClientSurface, handle: string | undefined): void {
	if (surface === "workspace") setWorkspaceUrl({ client: undefined }, "replace");
	else setConsoleUrl({ client: undefined }, "replace");
	contextDrawerOpen.value = false;
	setTimeout(() => focusRow(handle), 0);
}

function focusRow(handle: string | undefined): void {
	const doc = globalThis.document;
	if (!doc) return;
	const ids = [...doc.querySelectorAll<HTMLElement>(".cat-cl__row")].map((el) => el.id);
	const target = doc.getElementById(closeFocusTarget(handle, ids, CLIENTS_CANVAS_ID));
	target?.focus({ preventScroll: false });
}

// #endregion
