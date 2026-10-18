import type { ComponentChildren, JSX } from "preact";
import {
	DocumentNotice,
	type DocumentNoticeAction,
} from "@features/marketing/components/DocumentNotice.tsx";
import { LEGAL_HUB_HREF } from "../core/versions.ts";

/** The document an address named, when the document exists but the version it asked for does not. */
export interface LegalMissingDocument {
	title: string;
	/** Its bare address — the version in effect today. */
	href: string;
}

/** Props for {@link LegalMissingView}. */
export interface LegalMissingViewProps {
	/** Set when the slug names a document and `?v=` or `?compare=` names no version of it. */
	document: LegalMissingDocument | null;
	/** The legal surface's style anchor island; omitted in tests. */
	carrier?: ComponentChildren;
}

/**
 * LegalMissingView — `/legal/<unknown>`, or a known document with an unknown `?v=` / `?compare=`
 * (Decision #270: versions are never removed, so an unknown one is a typo, not an old link): a 404
 * in the reading frame with one `<h1>` and the ways back — the version in effect today when the
 * document exists, and the legal hub.
 */
export function LegalMissingView({ document, carrier }: LegalMissingViewProps): JSX.Element {
	const hub: DocumentNoticeAction = { href: LEGAL_HUB_HREF, label: "Every legal document" };
	return document
		? (
			<DocumentNotice
				block="lgl-notice"
				eyebrow="Legal"
				title="That version doesn't exist"
				summary={`The ${document.title} has no version by that number. Versions are never removed, so the address was probably mistyped.`}
				actions={[{ href: document.href, label: "Read the current version" }, hub]}
				carrier={carrier}
			/>
		)
		: (
			<DocumentNotice
				block="lgl-notice"
				eyebrow="Legal"
				title="That legal document doesn't exist"
				summary="There is no legal document at this address. Every policy that governs Projective is listed on the legal hub."
				actions={[hub]}
				carrier={carrier}
			/>
		);
}
