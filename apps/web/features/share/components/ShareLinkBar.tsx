import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import {
	composeShareText,
	externalShareUrl,
	INSTAGRAM_HOME,
	type ShareTargetSpec,
} from "../core/share-targets.ts";
import { ShareBrandIcon } from "./share-brand-icons.tsx";

/**
 * ShareLinkBar — the link at the top of the share and invite modals (Decision #145): the URL in a
 * selectable field with one-click Copy, the external shortcuts beneath it, and the device's own share
 * sheet where `navigator.share` exists (a control that opens nothing is never rendered, §3 gate 11).
 *
 * With no `url` the bar renders `emptyNote` and, when given, the `onCreate` control in place of Copy —
 * a stage's invite link is created by an explicit act, not by opening a modal. `actions` is a slot
 * for the caller's own link controls (reset · turn off).
 */

// #region Props
export interface ShareLinkBarProps {
	/** The absolute URL to share, or `null` when there is none yet. */
	url: string | null;
	/** The shared thing's name — the share sheet's title and the start of the composed text. */
	title: string;
	/** An optional sentence carried into apps that take text. */
	text?: string;
	/** The external shortcuts, in order. */
	targets: readonly ShareTargetSpec[];
	/** The field's accessible name. */
	label: string;
	/** What the bar says while there is no URL. */
	emptyNote?: string;
	/** Create the URL (an invite link); rendered as the primary control while `url` is null. */
	onCreate?: () => void;
	/** The create control's label. */
	createLabel?: string;
	/** A create or link action is in flight. */
	busy?: boolean;
	/** The caller's own link controls, under the field. */
	actions?: ComponentChildren;
}
// #endregion

export function ShareLinkBar(props: ShareLinkBarProps): JSX.Element {
	const { url, targets } = props;
	const status = useSignal("");
	const canNativeShare = useSignal(false);

	useEffect(() => {
		canNativeShare.value = typeof navigator !== "undefined" &&
			typeof navigator.share === "function";
	}, []);

	async function copy(): Promise<void> {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			status.value = "Link copied";
		} catch {
			status.value = "Couldn't copy — select the link and copy it";
		}
	}

	async function nativeShare(): Promise<void> {
		if (!url) return;
		try {
			await navigator.share({
				title: props.title,
				text: composeShareText({ title: props.title, text: props.text }) || undefined,
				url,
			});
			status.value = "Shared";
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return;
			status.value = "Couldn't open the share sheet";
		}
	}

	function openTarget(target: ShareTargetSpec): void {
		if (!url) return;
		const href = externalShareUrl(target.key, { url, title: props.title, text: props.text });
		if (href?.startsWith("mailto:")) {
			globalThis.location.href = href;
			return;
		}
		if (href) {
			globalThis.open(href, "_blank", "noopener,noreferrer");
			return;
		}
		if (canNativeShare.value) {
			void nativeShare();
			return;
		}
		void copy().then(() => {
			globalThis.open(INSTAGRAM_HOME, "_blank", "noopener,noreferrer");
			status.value = "Link copied — paste it into your post or story";
		});
	}

	return (
		<div class="share-link">
			<div class="share-link__row">
				<span class="share-link__glyph" aria-hidden="true">
					<Icon name="link" size="sm" />
				</span>
				<input
					class="share-link__field"
					type="text"
					readOnly
					value={url ?? ""}
					placeholder={props.emptyNote}
					aria-label={props.label}
					onFocus={(e) => (e.target as HTMLInputElement).select()}
				/>
				{url
					? (
						<Button
							label="Copy link"
							size="sm"
							icon={<Icon name="copy" size="sm" />}
							disabled={props.busy}
							onClick={() => void copy()}
						/>
					)
					: props.onCreate && (
						<Button
							label={props.createLabel ?? "Create link"}
							size="sm"
							icon={<Icon name="plus" size="sm" />}
							loading={props.busy}
							onClick={props.onCreate}
						/>
					)}
			</div>

			{url && (
				<ul class="share-link__targets" aria-label="Share the link">
					{targets.map((target) => (
						<li key={target.key}>
							<Tooltip content={target.label} placement="top">
								<button
									type="button"
									class="share-link__target"
									data-target={target.key}
									aria-label={`Share to ${target.label}`}
									onClick={() => openTarget(target)}
								>
									<ShareBrandIcon target={target.key} class="share-link__mark" />
									<span class="share-link__target-label">{target.label}</span>
								</button>
							</Tooltip>
						</li>
					))}
					{canNativeShare.value && (
						<li>
							<Tooltip content="More apps" placement="top">
								<button
									type="button"
									class="share-link__target"
									data-target="native"
									aria-label="More apps — your device's share sheet"
									onClick={() => void nativeShare()}
								>
									<Icon name="kebab-horizontal" size="md" />
									<span class="share-link__target-label">More</span>
								</button>
							</Tooltip>
						</li>
					)}
				</ul>
			)}

			{props.actions && <div class="share-link__actions">{props.actions}</div>}
			<p class="share-link__status" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}
