import { define } from "@web/utils/state.ts";
import CatalogueConsole from "../islands/CatalogueConsole.island.tsx";
import { handler } from "./console-handler.ts";

/**
 * `/catalogue` — the seller console, re-exported by `routes/(dashboard)/catalogue/index.tsx`. The
 * handler ({@link handler}) redirects a listing-scoped URL and reads the first page; the page hands
 * it to the {@link CatalogueConsole} canvas.
 */
export { handler };

export default define.page<typeof handler>(function CatalogueConsolePage({ data }) {
	return (
		<CatalogueConsole
			initial={data.listings}
			initialError={data.error}
			url={data.url}
			defaultCurrency={data.defaultCurrency}
		/>
	);
});
