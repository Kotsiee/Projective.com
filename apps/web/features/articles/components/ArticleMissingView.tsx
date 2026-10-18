import type { ComponentChildren, JSX } from "preact";
import { DocumentNotice } from "@features/marketing/components/DocumentNotice.tsx";
import { articlesIndexHref } from "../core/index-query.ts";

/**
 * ArticleMissingView — `/articles/<slug>` naming no visible article (P6): a 404 in the reading frame
 * with one `<h1>` and the way back to the index. The words are the same for every reason (never
 * written, a draft, future-dated, retracted), so a hidden article is never confirmed to exist.
 */
export function ArticleMissingView({ carrier }: { carrier?: ComponentChildren }): JSX.Element {
	return (
		<DocumentNotice
			block="artl-notice"
			eyebrow="Articles"
			title="That article doesn't exist"
			summary="There is no published article at this address. The link may be mistyped, or the article may have been taken down."
			actions={[{ href: articlesIndexHref(), label: "See every article" }]}
			carrier={carrier}
		/>
	);
}
