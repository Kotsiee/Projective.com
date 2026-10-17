import type { JSX } from "preact";
import SchemaInjector from "../islands/SchemaInjector.island.tsx";
import { type JsonLdGraph, serializeJsonLd } from "../core/seo.ts";

/** Props for {@link JsonLd}. */
export interface JsonLdProps {
	/** The page's graph (`jsonLdGraph(...)`). */
	graph: JsonLdGraph;
	/** The script node's id — unique per page (default `page-jsonld`). */
	id?: string;
}

/**
 * JsonLd — the one way a page emits structured data. Renders the graph twice over, for two readers:
 * a server `<script type="application/ld+json">` in the HTML response for crawlers that do not run
 * JavaScript, and the {@link SchemaInjector} island, which keeps a copy in the live DOM after
 * hydration (and adds nothing when the server copy survived). The body is {@link serializeJsonLd}'s
 * script-safe JSON — the single `dangerouslySetInnerHTML` this path needs, since a `<script>` body is
 * raw text that an escaped child would corrupt.
 */
export function JsonLd({ graph, id = "page-jsonld" }: JsonLdProps): JSX.Element {
	const json = serializeJsonLd(graph);
	return (
		<>
			<script type="application/ld+json" id={id} dangerouslySetInnerHTML={{ __html: json }} />
			<SchemaInjector json={json} id={id} />
		</>
	);
}
