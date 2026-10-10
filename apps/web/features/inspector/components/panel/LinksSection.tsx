import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { InspectorShell } from "../../core/inspector-shell.ts";
import { absoluteLink, inspectorLink } from "../../core/inspector-model.ts";
import { useInspectorActions } from "../InspectorContext.ts";

/** Props for {@link LinksSection}. */
export interface LinksSectionProps {
	shell: InspectorShell;
	titleId: string;
}

type CopyTarget = "inspector" | "share";

const COPIED_MS = 2000;

/** Copyable links to this page and its share link, and the original download. */
export function LinksSection({ shell, titleId }: LinksSectionProps): JSX.Element {
	const { asset } = shell;
	const actions = useInspectorActions();
	const copied = useSignal<CopyTarget | null>(null);

	const copy = async (target: CopyTarget) => {
		const origin = globalThis.location.origin;
		const text = target === "inspector"
			? inspectorLink(origin, asset)
			: absoluteLink(origin, asset.shareUrl ?? "");
		const done = await actions.copy(
			text,
			target === "inspector" ? "Inspector link copied" : "Share link copied",
		);
		if (!done) return;
		copied.value = target;
		setTimeout(() => {
			if (copied.peek() === target) copied.value = null;
		}, COPIED_MS);
	};

	const copyButton = (target: CopyTarget, label: string) => (
		<Button
			size="sm"
			variant="text"
			severity="secondary"
			class="ins-links__action"
			icon={<Icon name={copied.value === target ? "check" : "link"} size="sm" />}
			label={copied.value === target ? "Copied" : label}
			onClick={() => void copy(target)}
		/>
	);

	return (
		<section class="ins-panel__section" aria-labelledby={titleId}>
			<h2 id={titleId} class="ins-panel__title">Links</h2>
			<div class="ins-links">
				{copyButton("inspector", "Copy inspector link")}
				{asset.shareUrl ? copyButton("share", "Copy share link") : null}
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					class="ins-links__action"
					icon={<Icon name="download" size="sm" />}
					label="Download original"
					onClick={actions.download}
				/>
			</div>
		</section>
	);
}
