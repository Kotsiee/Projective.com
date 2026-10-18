import { useEffect } from "preact/hooks";
import { landingJsonLd } from "../core/seo.ts";

/** Props for {@link SchemaInjector}. */
export interface SchemaInjectorProps {
	/** The serialised graph (`serializeJsonLd`). Omitted: the landing page's graph. */
	json?: string;
	/** The node's id — the same id the server copy carries. Omitted: `projective-jsonld`. */
	id?: string;
}

const LANDING_SCHEMA_ID = "projective-jsonld";

/**
 * SchemaInjector — guarantees a page's schema.org graph is present in the *live* (post-hydration) DOM.
 *
 * The SSR pass already ships the JSON-LD in the raw HTML response (read by non-JS crawlers), but
 * Fresh's client runtime strips inline `<script>` bodies after hydration. This island re-appends a
 * populated, persistent `application/ld+json` node into `<head>` — a node created dynamically, so it
 * is never patched away. Renders only a hidden hydration anchor (an island that returns `null` is
 * never mounted, so it needs a DOM root to attach its effect to).
 *
 * Two callers:
 *  - **The `JsonLd` component** (every page but the landing) passes the serialised graph and the id
 *    its server copy carries. If that copy survived hydration intact the island adds nothing — one
 *    graph, never two; if it was emptied, the island replaces it with a head node.
 *  - **The landing page** renders it with no props, which keeps its original behaviour: the landing
 *    graph under `projective-jsonld`.
 */
export default function SchemaInjector({ json, id }: SchemaInjectorProps) {
	useEffect(() => {
		const nodeId = id ?? LANDING_SCHEMA_ID;
		const payload = json ?? landingJsonLd();
		const existing = document.getElementById(nodeId);
		if (existing?.textContent === payload) return;
		existing?.remove();
		const el = document.createElement("script");
		el.type = "application/ld+json";
		el.id = nodeId;
		el.textContent = payload;
		document.head.appendChild(el);
		return () => {
			el.remove();
		};
	}, [json, id]);

	return <span hidden aria-hidden="true" data-schema-anchor />;
}
