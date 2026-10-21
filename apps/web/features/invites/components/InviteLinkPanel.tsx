import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import {
	externalShareUrl,
	INVITE_SHARE_TARGETS,
	type ShareTargetSpec,
} from "@features/share/core/share-targets.ts";
import { ShareBrandIcon } from "@features/share/components/share-brand-icons.tsx";
import type { InviteRoleOption } from "../core/invite-queue.ts";

/**
 * InviteLinkPanel — the Universal Invite modal's bottom section (Decision #318): one sentence saying
 * what the link does, Copy with a copied state, the share shortcuts, and the link's own controls.
 *
 * **A link asks; it never seats** — on a project stage (Decision #145) and on a team or business
 * alike, so the sentence says "ask to join", never "join". On a workspace the role the request asks
 * for is a compact Select inside the sentence; on a project the sentence names the stage. With no
 * link yet, Copy is replaced by Create link — a link exists only once somebody makes it.
 *
 * The share row is the external shortcuts (`INVITE_SHARE_TARGETS`) plus the device's own share sheet
 * where `navigator.share` exists — a control that opens nothing is never rendered (§3 gate 11).
 */

// #region Props
export interface InviteLinkPanelProps {
	/** The absolute URL, or `null` while no link is active. */
	url: string | null;
	/** The thing the link asks to join — a stage's name on a project, the entity's on a workspace. */
	targetName: string;
	/** A workspace link's role, chosen in the sentence; absent on a project (the stage decides). */
	roles?: readonly InviteRoleOption[];
	roleId?: string | null;
	onRoleChange?: (roleId: string) => void;
	/** Who answers a request, in a few words ("You approve each request in Requests."). */
	hint: string;
	/** The share sheet's title and the text carried into apps that take it. */
	shareTitle: string;
	shareText: string;
	busy?: boolean;
	error?: string | null;
	notice?: string | null;
	onCreate?: () => void;
	onReset?: () => void;
	onRevoke?: () => void;
}
// #endregion

/** How long Copy reads "Copied" before it returns. */
const COPIED_MS = 2000;

export function InviteLinkPanel(props: InviteLinkPanelProps): JSX.Element {
	const { url, roles } = props;
	const copied = useSignal(false);
	const status = useSignal("");
	const canNativeShare = useSignal(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// `navigator.share` is a device capability, read once on the client so SSR never offers it.
	useEffect(() => {
		canNativeShare.value = typeof navigator !== "undefined" &&
			typeof navigator.share === "function";
		return () => {
			if (timer.current !== null) clearTimeout(timer.current);
		};
	}, []);

	async function copy(): Promise<void> {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			copied.value = true;
			status.value = "Link copied";
			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				copied.value = false;
				timer.current = null;
			}, COPIED_MS);
		} catch {
			status.value = "Couldn't copy — select the link and copy it";
		}
	}

	async function nativeShare(): Promise<void> {
		if (!url) return;
		try {
			await navigator.share({ title: props.shareTitle, text: props.shareText, url });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return;
			status.value = "Couldn't open the share sheet";
		}
	}

	function openTarget(target: ShareTargetSpec): void {
		if (!url) return;
		const href = externalShareUrl(target.key, {
			url,
			title: props.shareTitle,
			text: props.shareText,
		});
		if (!href) return;
		if (href.startsWith("mailto:")) globalThis.location.href = href;
		else globalThis.open(href, "_blank", "noopener,noreferrer");
	}

	const shareTargets = INVITE_SHARE_TARGETS.filter((t) =>
		externalShareUrl(t.key, { url: "https://x.test", title: "", text: "" }) !== null
	);
	const role = roles?.find((r) => r.id === props.roleId) ?? null;

	return (
		<section class="inv-link" aria-labelledby="inv-link-lead">
			<div class="inv-link__row">
				<span class="inv-link__glyph" aria-hidden="true">
					<Icon name="link" size="sm" />
				</span>
				<p class="inv-link__lead" id="inv-link-lead">
					{roles && roles.length > 0 && props.onRoleChange
						? (
							<>
								<span>Anyone with the link can ask to join as</span>
								<Select
									size="sm"
									class="inv-link__role"
									options={roles.map((r) => ({ label: r.name, value: r.id }))}
									value={props.roleId ?? ""}
									onValueChange={(next) => next && props.onRoleChange?.(next)}
									disabled={props.busy}
									panelWidth="auto"
									aria-label="Role a request through the link asks for"
								/>
							</>
						)
						: (
							<span>
								Anyone with the link can ask to join <strong>{props.targetName}</strong>
								{role ? ` as ${role.name}` : ""}
							</span>
						)}
				</p>
				{!url && props.onCreate && (
					<Button
						variant="outlined"
						severity="secondary"
						size="sm"
						label="Create link"
						icon={<Icon name="plus" size="sm" />}
						loading={props.busy}
						onClick={props.onCreate}
					/>
				)}
			</div>

			{url && (
				<div class="inv-link__row">
					{
						/*
						 * The URL itself, selectable — the fallback when the clipboard refuses (an unfocused
						 * window, a locked-down browser), and proof of what Copy copies.
						 */
					}
					<input
						class="inv-link__url"
						type="text"
						readOnly
						value={url}
						aria-label={`Invite link for ${props.targetName}`}
						onFocus={(e) => (e.target as HTMLInputElement).select()}
					/>
					<Button
						variant="outlined"
						severity="secondary"
						size="sm"
						class="inv-link__copy"
						data-copied={copied.value ? "true" : undefined}
						label={copied.value ? "Copied" : "Copy link"}
						icon={<Icon name={copied.value ? "check" : "copy"} size="sm" />}
						disabled={props.busy}
						onClick={() => void copy()}
					/>
				</div>
			)}

			{url && (
				<div class="inv-link__share">
					<ul class="inv-link__targets" aria-label="Share the link">
						{shareTargets.map((target) => (
							<li key={target.key}>
								<Tooltip content={target.label} placement="top">
									<button
										type="button"
										class="inv-link__target"
										data-target={target.key}
										aria-label={`Share to ${target.label}`}
										onClick={() => openTarget(target)}
									>
										<ShareBrandIcon target={target.key} class="inv-link__mark" />
									</button>
								</Tooltip>
							</li>
						))}
						{canNativeShare.value && (
							<li>
								<Tooltip content="More apps" placement="top">
									<button
										type="button"
										class="inv-link__target"
										data-target="native"
										aria-label="More apps — your device's share sheet"
										onClick={() => void nativeShare()}
									>
										<Icon name="share" size="sm" />
									</button>
								</Tooltip>
							</li>
						)}
					</ul>
					<div class="inv-link__controls">
						{props.onReset && (
							<Button
								variant="text"
								severity="secondary"
								size="sm"
								label="Reset"
								disabled={props.busy}
								onClick={props.onReset}
							/>
						)}
						{props.onRevoke && (
							<Button
								variant="text"
								severity="secondary"
								size="sm"
								label="Turn off"
								disabled={props.busy}
								onClick={props.onRevoke}
							/>
						)}
					</div>
				</div>
			)}

			<p class="inv-link__hint">{props.hint}</p>
			{props.error && <p class="inv-link__error" role="alert">{props.error}</p>}
			<p class="inv-link__status" role="status" aria-live="polite">
				{props.notice ?? status.value}
			</p>
		</section>
	);
}
