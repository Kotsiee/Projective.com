import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { OrderLine } from "../types/checkout-types.ts";

/**
 * DownloadAction — the hand-over control for a purchased digital deliverable, and the facts that make
 * it safe to press: how big the file is, what format it arrives in, and which licence it is granted
 * under.
 *
 * **A real anchor, not a button.** The href is a same-origin path the browser downloads directly, so
 * the control is a link and behaves like one — middle-click, open-in-new-tab, copy-link-address and
 * the download manager all work without a line of script. A `<button>` here would take all four away
 * to gain nothing.
 *
 * **Same origin only.** `OrderLine.downloadHref` is documented as a path on this origin, which is
 * also what makes `download` honour the filename: a cross-origin `download` attribute is ignored by
 * every browser, so a third-party href would silently navigate away instead of saving.
 *
 * **Outlined, never filled.** §B.8.2 caps one `filled` control per decision region, and an order with
 * five downloadable lines would otherwise ship five competing commitments down one list. The step's
 * commitment already happened; nothing on this page advances a flow.
 *
 * The size, format and licence are SERVER-formatted strings sitting beside a server-supplied byte
 * count — the label and the count can never disagree, because this component derives neither.
 */

// #region Props
/** Props for {@link DownloadAction}. */
export interface DownloadActionProps {
	/** The purchased line. Its `downloadHref` is required by the caller's `fulfilmentKindOf` check. */
	line: OrderLine;
}
// #endregion

/** Render the download control and its delivery facts. */
export function DownloadAction(props: DownloadActionProps): JSX.Element | null {
	const { line } = props;
	// The caller resolves fulfilment through `fulfilmentKindOf`, which already refuses a `download`
	// line with no href. This guard is the type narrowing, not a second policy.
	if (!line.downloadHref) return null;

	const facts = [line.downloadSizeLabel, line.downloadFormat, line.licence].filter(
		(fact): fact is string => Boolean(fact),
	);
	const spoken = [`Download ${line.title}`, line.downloadFormat, line.downloadSizeLabel]
		.filter(Boolean)
		.join(", ");

	return (
		<div class="cko-order__fulfil">
			<a
				class="cko-order__act"
				href={line.downloadHref}
				download={line.downloadName ?? undefined}
				aria-label={spoken}
			>
				<Icon name="download" />
				<span>Download asset</span>
			</a>

			{facts.length > 0
				? (
					<p class="cko-order__actmeta">
						{facts.map((fact) => <span key={fact}>{fact}</span>)}
					</p>
				)
				: null}
		</div>
	);
}
