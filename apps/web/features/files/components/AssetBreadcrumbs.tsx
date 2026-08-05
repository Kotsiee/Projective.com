import type { JSX } from "preact";
import { Breadcrumb } from "@projective/ui/navigation";
import "../styles/files-hub.css";
import type { AssetCrumb } from "../types/file-types.ts";

/**
 * AssetBreadcrumbs — the location trail above the hub workspace.
 *
 * It reuses the shared `@projective/ui` {@link Breadcrumb} (extended for a per-crumb `command`, the
 * Submissions-explorer precedent) and gives every crumb but the last BOTH a deep-link `url` and a
 * `command`. That pairing is the point: the `command` drives the in-place navigation with no page
 * load, while the `url` keeps middle-click, `Cmd`-click and "copy link address" working — a trail
 * built only from click handlers silently removes three interactions people expect from a path.
 *
 * The trailing crumb carries neither, so `Breadcrumb` renders it as the current location
 * (`aria-current`) rather than a link to where the reader already is.
 *
 * ## Why the path is recovered from the href
 *
 * The crumbs arrive from the SERVER with their hrefs already scope-correct, but the client navigator
 * works in path SEGMENTS. Those segments are recovered by stripping the scope base off each href
 * rather than by pairing crumbs positionally against the current path: the two can legitimately differ
 * for a moment — a deep link whose tail folder has moved resolves to the deepest node that still
 * exists, so the server's trail is SHORTER than the URL that asked for it — and a positional pairing
 * would then navigate to a prefix of a path that is no longer real.
 *
 * Dumb: no data access, no state.
 */
export interface AssetBreadcrumbsProps {
	crumbs: AssetCrumb[];
	/** The scope base the crumb hrefs hang off (`/files`, `/teams/{id}/files`). */
	base: string;
	/** Navigate to a path, in place. */
	onNavigate: (path: string[]) => void;
	/** Accessible name for the trail's `nav` landmark. */
	"aria-label"?: string;
}

/**
 * The path segments a crumb's href addresses, relative to the scope base.
 *
 * Percent-decoded, because `folderHref` encodes each segment before joining — so a folder literally
 * named `a/b` survives the round trip as one segment instead of splitting into two.
 */
export function segmentsOfCrumb(href: string, base: string): string[] {
	const trimmedBase = base.replace(/\/+$/, "");
	const path = href.split("?")[0].split("#")[0];
	if (!path.startsWith(trimmedBase)) return [];
	return path
		.slice(trimmedBase.length)
		.split("/")
		.filter(Boolean)
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		});
}

export function AssetBreadcrumbs(props: AssetBreadcrumbsProps): JSX.Element {
	const { crumbs, base, onNavigate } = props;

	const model = crumbs.map((crumb, index) => {
		const isLast = index === crumbs.length - 1;
		return {
			key: crumb.id ?? `crumb-${index}`,
			label: crumb.label,
			url: isLast ? undefined : crumb.href,
			command: isLast ? undefined : () => onNavigate(segmentsOfCrumb(crumb.href, base)),
		};
	});

	return (
		<div class="fh-crumbs">
			<Breadcrumb
				model={model}
				separator="chevron"
				aria-label={props["aria-label"] ?? "File path"}
				class="fh-crumbs__bar"
			/>
		</div>
	);
}
