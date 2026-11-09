import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { AssetVisibility } from "@projective/types/files";
import ShareDialog, { type ShareSubject } from "@features/files/islands/ShareDialog.island.tsx";
import { absoluteLink } from "../../core/inspector-model.ts";
import { useInspectorActions } from "../InspectorContext.ts";

/** Props for {@link ShareLinkRow}. */
export interface ShareLinkRowProps {
	itemId: string;
	name: string;
	/** The tier as saved: a link can only be made for a file already saved as shared. */
	savedVisibility: AssetVisibility;
	/** The live share link's path, or `null`. */
	shareUrl: string | null;
	/** The share link or its terms changed; re-read the file's access. */
	onChanged: () => void;
}

function slugOf(shareUrl: string | null): string | null {
	if (!shareUrl) return null;
	const slug = shareUrl.split("?")[0].split("/").filter(Boolean).at(-1);
	return slug && slug.length > 0 ? slug : null;
}

/**
 * The owner's share link for a link or public file: the address with Copy, or a way to make one. The
 * link's terms (expiry, download cap) and revoking stay in the hub's share dialog, opened from here, so
 * a link is never minted on defaults nobody chose. A link made earlier keeps opening the file whatever
 * its tier, so on Only you or Specific people a live one is said, with the way to revoke it.
 */
export function ShareLinkRow(props: ShareLinkRowProps): JSX.Element {
	const actions = useInspectorActions();
	const dialogOpen = useSignal(false);
	const shared = props.savedVisibility === "link" || props.savedVisibility === "public";
	const slug = slugOf(props.shareUrl);

	const subject: ShareSubject = {
		kind: "asset",
		id: props.itemId,
		name: props.name,
		visibility: props.savedVisibility,
		shareSlug: slug,
		canManage: true,
	};

	const copy = () => {
		if (!props.shareUrl) return;
		void actions.copy(
			absoluteLink(globalThis.location.origin, props.shareUrl),
			"Share link copied",
		);
	};

	return (
		<div class="ins-access__group ins-access__link">
			<h3 class="ins-access__subtitle">Share link</h3>
			{!shared && props.shareUrl
				? (
					<>
						<Message
							severity="warning"
							text="A share link made earlier still opens this file for anyone who has it. Revoke it if it should stop working."
						/>
						<div class="ins-access__link-actions">
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name="settings" size="sm" />}
								label="Link settings…"
								onClick={() => (dialogOpen.value = true)}
							/>
						</div>
					</>
				)
				: !shared
				? <p class="ins-access__note">Save first, then make a link to send.</p>
				: props.shareUrl
				? (
					<>
						<code class="ins-access__url">
							{absoluteLink(globalThis.location?.origin ?? "", props.shareUrl)}
						</code>
						<div class="ins-access__link-actions">
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name="copy" size="sm" />}
								label="Copy link"
								onClick={copy}
							/>
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name="settings" size="sm" />}
								label="Link settings…"
								onClick={() => (dialogOpen.value = true)}
							/>
						</div>
					</>
				)
				: (
					<>
						<p class="ins-access__note">No link yet.</p>
						<div class="ins-access__link-actions">
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name="link" size="sm" />}
								label="Create link…"
								onClick={() => (dialogOpen.value = true)}
							/>
						</div>
					</>
				)}
			<ShareDialog
				open={dialogOpen.value}
				subject={subject}
				onClose={() => (dialogOpen.value = false)}
				onChanged={props.onChanged}
			/>
		</div>
	);
}
