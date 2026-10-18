import type { JSX } from "preact";
import { DocumentDate } from "@projective/ui/display/editorial";

/** Props for {@link LegalDate}. */
export interface LegalDateProps {
	/** `YYYY-MM-DD`. */
	iso: string;
	/** The word before the date: `Effective`, `Updated`, `Reviewed`. */
	prefix: string;
}

/**
 * LegalDate — a dated fact (`Effective 17 October 2026`) for a Meta-register facts line: P0's
 * {@link DocumentDate} inside one inline wrapper. A facts item is an inline flex box, which makes the
 * bare prefix text its own flex item and trims the space after it ("Effective17 October 2026"); in one
 * wrapper the prefix and the `<time>` share a line box and the space stays.
 */
export function LegalDate({ iso, prefix }: LegalDateProps): JSX.Element {
	return (
		<span class="lgl-date">
			<DocumentDate prefix={prefix} iso={iso} />
		</span>
	);
}
