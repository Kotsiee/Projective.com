import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { ScrollRail } from "@projective/ui/layout";
import {
	composeShareText,
	externalShareUrl,
	INSTAGRAM_HOME,
	type ShareTargetSpec,
} from "../core/share-targets.ts";
import { ShareBrandIcon } from "./share-brand-icons.tsx";

/**
 * ShareLinkBar — the link at the top of the share modal (Decision #145, re-cut by #401): the URL in a
 * selectable field with an icon-only Copy beside it, then the external destinations as one rail of
 * circular icon buttons, and the device's own share sheet where `navigator.share` exists (a control
 * that opens nothing is never rendered, §3 gate 11). The rail scrolls, with arrows, once the modal is
 * too narrow for it ({@link ScrollRail}).
 *
 * Copy confirms in place: its glyph turns into a check and its tooltip reads "Copied!" for
 * {@link COPIED_MS}, while the status line announces the outcome to assistive technology.
 *
 * With `external` off the rail is left out: an address only the people with access can open is
 * copied, never posted to an app (Decision #402).
 *
 * With no `url` the bar renders `emptyNote` and, when given, the `onCreate` control in place of Copy —
 * a link that must be created is created by an explicit act, not by opening a modal. `actions` is a
 * slot for the caller's own link controls (reset · turn off).
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
	/**
	 * Offer the external apps and the device's share sheet (default `true`). Off for an address only
	 * the people who already have access can open, which no app can widen (Decision #402).
	 */
	external?: boolean;
	/** A line said directly under the link, such as who it opens for. */
	note?: ComponentChildren;
}
// #endregion

/** How long Copy shows its check and "Copied!" before it reverts. */
export const COPIED_MS = 1600;

/** How long a success line ("Link copied") stays before it clears itself (Decision #406). */
export const STATUS_MS = 2200;

export function ShareLinkBar(props: ShareLinkBarProps): JSX.Element {
	const { url, targets } = props;
	const status = useSignal("");
	const copied = useSignal(false);
	const canNativeShare = useSignal(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		canNativeShare.value = typeof navigator !== "undefined" &&
			typeof navigator.share === "function";
		return () => {
			if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
			if (statusTimer.current !== null) clearTimeout(statusTimer.current);
		};
	}, []);

	/** Say how it went: a success clears after {@link STATUS_MS}; a failure stays until the next act. */
	function say(text: string, success: boolean): void {
		if (statusTimer.current !== null) clearTimeout(statusTimer.current);
		statusTimer.current = null;
		status.value = text;
		if (!success) return;
		statusTimer.current = setTimeout(() => {
			status.value = "";
			statusTimer.current = null;
		}, STATUS_MS);
	}

	function settleCopied(): void {
		if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
		copied.value = true;
		copiedTimer.current = setTimeout(() => {
			copied.value = false;
			copiedTimer.current = null;
		}, COPIED_MS);
	}

	async function copy(): Promise<boolean> {
		if (!url) return false;
		try {
			await navigator.clipboard.writeText(url);
			say("Link copied", true);
			settleCopied();
			return true;
		} catch {
			copied.value = false;
			say("Couldn't copy — select the link and copy it", false);
			return false;
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
			say("Shared", true);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return;
			say("Couldn't open the share sheet", false);
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
		void copy().then((done) => {
			if (!done) return;
			globalThis.open(INSTAGRAM_HOME, "_blank", "noopener,noreferrer");
			say("Link copied — paste it into your post or story", true);
		});
	}

	const isCopied = copied.value;

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
						<Tooltip content={isCopied ? "Copied!" : "Copy link"}>
							<Button
								iconOnly
								rounded
								size="md"
								severity="neutral"
								variant="outlined"
								class="share-link__copy"
								data-copied={isCopied ? "true" : undefined}
								icon={
									<span class="share-link__copy-glyph" aria-hidden="true">
										<Icon name="copy" size="sm" class="share-link__copy-icon" />
										<Icon name="check" size="sm" class="share-link__copy-check" />
									</span>
								}
								aria-label="Copy link"
								disabled={props.busy}
								onClick={() => void copy()}
							/>
						</Tooltip>
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

			{props.note}

			{url && props.external !== false && (
				<ScrollRail
					label="Share the link"
					backLabel="Previous apps"
					forwardLabel="Next apps"
					class="share-link__rail"
				>
					{targets.map((target) => (
						<li key={target.key} class="share-link__item">
							<Tooltip content={target.label} placement="top">
								<button
									type="button"
									class="share-link__target"
									data-target={target.key}
									aria-label={`Share to ${target.label}`}
									onClick={() => openTarget(target)}
								>
									<ShareBrandIcon target={target.key} class="share-link__mark" />
								</button>
							</Tooltip>
						</li>
					))}
					{canNativeShare.value && (
						<li key="native" class="share-link__item">
							<Tooltip content="More apps" placement="top">
								<button
									type="button"
									class="share-link__target"
									data-target="native"
									aria-label="More apps — your device's share sheet"
									onClick={() => void nativeShare()}
								>
									<Icon name="kebab-horizontal" size="md" />
								</button>
							</Tooltip>
						</li>
					)}
				</ScrollRail>
			)}

			{props.actions && <div class="share-link__actions">{props.actions}</div>}
			<p class="share-link__status" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}
