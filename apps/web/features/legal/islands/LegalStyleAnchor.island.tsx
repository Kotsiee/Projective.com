import "../styles/legal.css";
import "@ui/fields/styles/button.css";

/**
 * LegalStyleAnchor — a zero-UI style anchor for the legal hub and the not-found notice (the
 * `CardStyleAnchor` pattern).
 *
 * Both are server-rendered and a server component's own `import "x.css"` never reaches the page: a
 * stylesheet arrives only through an island's import graph. A legal document carries the sheet
 * through its version controls; the hub and the not-found notice mount no other island, so this one
 * exists to keep `legal.css` — and the Button sheet the notice's ways back use — in their bundle. It
 * renders a `hidden`, `aria-hidden` stub — never seen, never read.
 */
export default function LegalStyleAnchor() {
	return <div hidden aria-hidden="true" />;
}
