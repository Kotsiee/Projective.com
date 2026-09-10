import type { JSX } from "preact";
import "../styles/profile.css";

/**
 * ProfileStyleAnchor — a zero-UI style anchor for the profile layout's not-found branch.
 *
 * This feature's sheets reach a page only through a CLIENT (island) bundle (the Explore
 * `CardStyleAnchor` / entity-view `ViewStyleAnchor` precedent). Every resolved profile mounts
 * `ProfileHero`, which carries the barrel; the not-found branch mounts no profile island at all, so
 * without this anchor `.pf` and `.pf-notfound__*` shipped with zero rules in the CSSOM. Renders a
 * `hidden`, `aria-hidden` stub.
 */
export default function ProfileStyleAnchor(): JSX.Element {
	return <div hidden aria-hidden="true" />;
}
