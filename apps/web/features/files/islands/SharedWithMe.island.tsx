import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/files-hub.css";
import "../styles/files-shared.css";
import { MetaLine } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	fileInspectHref,
	grantRoleLabel,
	type SharedFile,
	sharedViaLabel,
} from "@projective/types/files";
import { folderHref } from "../core/asset-model.ts";
import { filesNavigate } from "../core/files-state.ts";

/**
 * SharedWithMe — the files other people shared with the viewer, on `/files?source=shared` (Decision
 * #570, ruling #402 (d)).
 *
 * Every file that reaches the viewer through a live grant, newest share first: one shared with them by
 * name, and one shared with a team, business or project they are in. Each row says who shared it,
 * through what, at what level and when, and opens the file in the inspector, which answers for whoever
 * may read it. A grant to a group tells nobody, so this list is how its members find the file.
 *
 * It renders in the library body's own box (`.fh-hub`) under the same lane, as the purchases view does.
 * The lane's rows navigate through {@link filesNavigate}, which the library body owns; with no body
 * mounted here, this view registers a navigator that leaves for the library by a full page load.
 *
 * Dumb island: the files arrive as props, resolved server-side by the route.
 */

// #region Props
export interface SharedWithMeProps {
	files: SharedFile[];
	/** A read that failed, in the reader's words; the list is then empty. */
	error: string | null;
}
// #endregion

// #region Formatting
function sizeLabel(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function dateLabel(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ""
		: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
// #endregion

/** The Shared with me view. */
export default function SharedWithMe(props: SharedWithMeProps): JSX.Element {
	useEffect(() => {
		// The lane moves through the library body's navigator; with no body here, it leaves by a load.
		filesNavigate.value = {
			toPath: (path: string[]) => globalThis.location.assign(folderHref("/files", path)),
			toHref: (href: string) => globalThis.location.assign(href),
		};
		return () => {
			filesNavigate.value = null;
		};
	}, []);

	const count = props.files.length;

	return (
		<div class="fh-hub fh-shared">
			<header class="fh-shared__head">
				<h1 class="fh-shared__title">Shared with me</h1>
				<MetaLine
					items={[
						{ text: count === 1 ? "1 file" : `${count} files`, tabular: true },
						count > 0 && "Newest first",
					]}
				/>
			</header>

			{props.error && <InlineNotice text={props.error} />}

			{!props.error && count === 0
				? (
					<p class="fh-shared__note fh-shared__empty">
						Nothing shared with you yet. Files people share with you, or with a team, business or
						project you are in, appear here.
					</p>
				)
				: (
					<ol class="fh-shared__list" aria-label="Files shared with you">
						{props.files.map((f) => (
							<li key={f.itemId} class="fh-shared__item">
								<span class="fh-shared__text">
									<h2 class="fh-shared__name">{f.name}</h2>
									<MetaLine
										as="span"
										size="xs"
										items={[
											f.sharedByName ? `From ${f.sharedByName}` : null,
											sharedViaLabel(f),
											grantRoleLabel(f.role),
											dateLabel(f.sharedAt),
											{ text: sizeLabel(f.sizeBytes), tabular: true },
										]}
									/>
								</span>
								<a
									class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
									href={fileInspectHref(f.itemId)}
									aria-label={`Open ${f.name}`}
								>
									<Icon name="eye" />
									<span>Open</span>
								</a>
							</li>
						))}
					</ol>
				)}
		</div>
	);
}
