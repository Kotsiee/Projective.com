import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Skeleton } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { AccessContainer, AssetVisibility } from "@projective/types/files";
import { VisibilityMark } from "@features/files/components/file-hub-glyphs.tsx";
import { tierLabel, tierNote } from "../../core/access-draft.ts";

/** Said to everyone who may not change who has access. */
const NOT_YOURS = "Only the owner and people who can edit decide who has access.";

/** A signed-out visitor: who has access is for signed-in people, with the way back to this file. */
export function AccessSignedOut({ returnTo }: { returnTo: string }): JSX.Element {
	return (
		<div class="ins-access__state">
			<p class="ins-access__note">Sign in to see who has access.</p>
			<a class="ins-access__signin" href={`/login?redirectTo=${encodeURIComponent(returnTo)}`}>
				Sign in
			</a>
		</div>
	);
}

/** The read in flight. */
export function AccessLoading(): JSX.Element {
	return (
		<div class="ins-access__state" aria-busy="true">
			<p class="ins-access__note" role="status">Loading who has access…</p>
			<Skeleton shape="text" lines={3} />
		</div>
	);
}

/** The read failed: its message and Retry. */
export function AccessError(
	{ message, onRetry }: { message: string; onRetry: () => void },
): JSX.Element {
	return (
		<div class="ins-access__state">
			<p class="ins-access__error" role="alert">
				<Icon name="warning" size="xs" aria-hidden="true" />
				{message}
			</p>
			<Button
				size="sm"
				variant="text"
				severity="secondary"
				icon={<Icon name="refresh" size="sm" />}
				label="Retry"
				onClick={onRetry}
			/>
		</div>
	);
}

/** Props for {@link AccessReadOnly}. */
export interface AccessReadOnlyProps {
	visibility: AssetVisibility;
	/** The library, when the server said; a file the viewer may not inspect has none. */
	container: AccessContainer | null;
	/** The label to show when there is no container to phrase the tier against. */
	fallbackLabel: string;
}

/** A viewer's Access tab: the tier as a fact, what it means, and who decides it. No grantees. */
export function AccessReadOnly(
	{ visibility, container, fallbackLabel }: AccessReadOnlyProps,
): JSX.Element {
	return (
		<div class="ins-access__group">
			<h3 class="ins-access__subtitle">Who can open it</h3>
			<p class="ins-access__fact">
				<span class="ins-access__glyph" aria-hidden="true">
					<VisibilityMark visibility={visibility} />
				</span>
				{container ? tierLabel(visibility, container, false) : fallbackLabel}
			</p>
			{container ? <p class="ins-access__note">{tierNote(visibility, container, false)}</p> : null}
			<p class="ins-access__note">{NOT_YOURS}</p>
		</div>
	);
}
