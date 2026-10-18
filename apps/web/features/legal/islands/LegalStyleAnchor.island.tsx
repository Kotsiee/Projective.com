import "../styles/legal.css";

/**
 * LegalStyleAnchor — a zero-UI style anchor for the legal hub (the `CardStyleAnchor` pattern).
 *
 * The hub is server-rendered and a server component's own `import "x.css"` never reaches the page:
 * a stylesheet arrives only through an island's import graph. A legal document carries the sheet
 * through its version controls; the hub mounts no other island, so this one exists to keep
 * `legal.css` in its bundle. It renders a `hidden`, `aria-hidden` stub — never seen, never read.
 */
export default function LegalStyleAnchor() {
	return <div hidden aria-hidden="true" />;
}
