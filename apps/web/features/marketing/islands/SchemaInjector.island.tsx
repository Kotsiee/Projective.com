import { useEffect } from "preact/hooks";
import { landingJsonLd } from "../core/seo.ts";

/**
 * SchemaInjector — guarantees the schema.org graph is present in the *live* (post-hydration) DOM.
 *
 * The SSR pass already ships the JSON-LD in the raw HTML response (read by non-JS crawlers), but
 * Fresh's client runtime strips inline `<script>` bodies after hydration. This island re-appends a
 * populated, persistent `application/ld+json` node into `<head>` — a node created dynamically, so it
 * is never patched away. Renders only a hidden hydration anchor (an island that returns `null` is
 * never mounted, so it needs a DOM root to attach its effect to).
 */
const SCHEMA_ID = "projective-jsonld";

export default function SchemaInjector() {
	useEffect(() => {
		if (document.getElementById(SCHEMA_ID)) return;
		const el = document.createElement("script");
		el.type = "application/ld+json";
		el.id = SCHEMA_ID;
		el.textContent = landingJsonLd();
		document.head.appendChild(el);
		return () => {
			document.getElementById(SCHEMA_ID)?.remove();
		};
	}, []);

	return <span hidden aria-hidden="true" data-schema-anchor />;
}
