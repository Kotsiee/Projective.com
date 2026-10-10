import "../../styles/inspector.css";
import "../../styles/viewer-image.css";
import "../../styles/viewer-media.css";
import "../../styles/viewer-text.css";
import "../../styles/code-theme.css";
import "../../styles/viewer-pdf.css";
import "../../styles/inspector-print.css";
import "../../styles/viewer-model.css";
import "../../styles/viewer-document.css";
import type { JSX } from "preact";
import { EMBED_FACTS_OMIT, embedDetails } from "../../core/inspector-model.ts";
import type { InspectorHost } from "../../hooks/use-inspector-host.ts";
import { OwnerFact, PlainFact, UploadedFact } from "../panel/facts.tsx";

/** Props for {@link InspectorEmbedFacts}. */
export interface InspectorEmbedFactsProps {
	host: InspectorHost;
	/**
	 * Rows to leave out, by `EmbedFactKey`: `name`, `type`, `format`, `size`, `dimensions`,
	 * `duration`, `pages`, `facts` (every canvas fact), `uploaded`, `owner`. Default `["name"]`.
	 */
	omit?: readonly string[];
}

/**
 * The file's facts for a host's side panel: the Details list without the page-only rows
 * (visibility, downloads, content hash), the canvas's own facts included as they arrive.
 */
export function InspectorEmbedFacts(
	{ host, omit = EMBED_FACTS_OMIT }: InspectorEmbedFactsProps,
): JSX.Element {
	const { asset } = host.shell;
	const rows = embedDetails(asset, host.shell.facts.value, omit);
	return (
		<dl class="ins-facts">
			{rows.map((row) => <PlainFact key={row.key} row={row} />)}
			{omit.includes("uploaded") ? null : <UploadedFact asset={asset} />}
			{omit.includes("owner") ? null : <OwnerFact asset={asset} />}
		</dl>
	);
}
