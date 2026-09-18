import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { ContactList } from "@features/messaging/components/ContactList.tsx";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { ContactsService } from "@features/messaging/core/ContactsService.ts";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import type { ShareRequest } from "../core/share-request.ts";
import {
	composeInternalMessage,
	composeShareText,
	type ExternalShareTarget,
	externalShareUrl,
	INSTAGRAM_HOME,
	SHARE_TARGETS,
} from "../core/share-targets.ts";
import { ShareBrandIcon } from "./share-brand-icons.tsx";

/**
 * ShareModalBody — the unified share surface, in two tiers:
 *
 *  1. **Send to people on Projective** (primary). The SAME ranked {@link ContactList} the messaging
 *     picker renders — relationships ordered shared-workspace → mutual follow → follow →
 *     collaboration → conversation, then a global search — with an optional note. "Send" posts the
 *     note + link as a message to EACH picked person through `ContactsService.createConversation`,
 *     which reopens the pair's DM or opens one, so a share lands in the inbox exactly where a
 *     conversation would. One request per recipient, reported per recipient: a share that reached
 *     three of four people says so rather than rounding to success.
 *  2. **Share elsewhere**: Snapchat · WhatsApp · Facebook · Instagram · X · Telegram · Copy link,
 *     plus a `•••` that hands the request to the device's own share sheet (`navigator.share`) —
 *     rendered only where the sheet exists, because a control that opens nothing is a defect (§3
 *     gate 11). Instagram has no web intent (see `share-targets.ts`) and is honest about it.
 *
 * A guest cannot send inside the platform (a conversation is a claim on their own inbox), so the
 * first tier offers the standard sign-in route instead of a picker that would 401 on Send.
 */

// #region Props
export interface ShareModalBodyProps {
	request: ShareRequest;
	/** Whether the viewer is signed in — decides whether the internal tier is a picker or a sign-in. */
	authed: boolean;
	/** The page to return to after signing in (a guest). */
	returnTo: string;
}
// #endregion

type SendState = "idle" | "sending" | "done";

export function ShareModalBody({ request, authed, returnTo }: ShareModalBodyProps): JSX.Element {
	const search = useContactSearch({ limit: 30 });
	const picked = useSignal<RankedContact[]>([]);
	const note = useSignal("");
	const sendState = useSignal<SendState>("idle");
	const sentTo = useSignal<string[]>([]);
	const failedTo = useSignal<string[]>([]);
	const status = useSignal(""); // polite live region — "Link copied", "Shared"
	const canNativeShare = useSignal(false);
	const live = useRef(true);

	useEffect(() => {
		live.current = true;
		try {
			canNativeShare.value = typeof navigator !== "undefined" &&
				typeof navigator.share === "function";
		} catch { /* no navigator — SSR */ }
		return () => {
			live.current = false;
		};
	}, []);

	const selectedIds = useComputed(() => picked.value.map((c) => c.id));
	const canSend = useComputed(() => picked.value.length > 0 && sendState.value !== "sending");

	function toggle(id: string): void {
		const current = picked.value;
		if (current.some((c) => c.id === id)) {
			picked.value = current.filter((c) => c.id !== id);
			return;
		}
		const contact = search.contacts.value.find((c) => c.id === id);
		if (contact) picked.value = [...current, contact];
	}

	/** One create-with-message per recipient, settled together, reported per recipient. */
	async function send(): Promise<void> {
		if (!canSend.value) return;
		sendState.value = "sending";
		const message = composeInternalMessage(request, note.value);
		const targets = picked.value;
		const results = await Promise.all(
			targets.map((c) => ContactsService.createConversation({ contactIds: [c.id], message })),
		);
		if (!live.current) return;
		const ok: string[] = [];
		const failed: string[] = [];
		results.forEach((res, i) => {
			(res.ok && res.data?.messageAccepted ? ok : failed).push(targets[i].name);
		});
		sentTo.value = ok;
		failedTo.value = failed;
		sendState.value = "done";
		if (ok.length > 0) picked.value = picked.value.filter((c) => failed.includes(c.name));
	}

	function announce(message: string): void {
		status.value = message;
	}

	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(request.url);
			announce("Link copied");
		} catch {
			announce("Couldn't copy — select the link below and copy it");
		}
	}

	function openExternal(target: ExternalShareTarget): void {
		const url = externalShareUrl(target, request);
		if (url) {
			globalThis.open(url, "_blank", "noopener,noreferrer");
			announce("");
			return;
		}
		// Instagram: no web intent. The device's share sheet lists it where it is installed; else copy
		// the link and open Instagram for the viewer to paste into.
		if (canNativeShare.value) {
			void nativeShare();
			return;
		}
		void copyLink().then(() => {
			globalThis.open(INSTAGRAM_HOME, "_blank", "noopener,noreferrer");
			announce("Link copied — paste it into your Instagram post or story");
		});
	}

	async function nativeShare(): Promise<void> {
		try {
			await navigator.share({
				title: request.title,
				text: composeShareText(request) || undefined,
				url: request.url,
			});
			announce("Shared");
		} catch (error) {
			// A dismissed sheet is not a failure; anything else is stated.
			if (error instanceof Error && error.name === "AbortError") return;
			announce("Couldn't open the share sheet");
		}
	}

	const signIn = `/login?redirectTo=${encodeURIComponent(returnTo)}`;

	return (
		<div class="share">
			{/* Tier 1 — inside Projective. */}
			<section class="share__section" aria-labelledby="share-internal-title">
				<h3 class="share__heading" id="share-internal-title">Send to people on Projective</h3>
				{authed
					? (
						<>
							<ContactList
								search={search}
								selected={selectedIds.value}
								onToggle={toggle}
								label="People to send this to"
								placeholder="Search by name or @handle"
								emptyNote="No suggestions yet. Search by name or @handle to find someone."
								autoFocus
							/>
							{picked.value.length > 0 && (
								<div class="share__compose">
									<textarea
										class="share__note"
										rows={2}
										maxLength={1000}
										placeholder="Add a note (optional)"
										aria-label="Note to send with the link"
										value={note.value}
										onInput={(e) => (note.value = (e.target as HTMLTextAreaElement).value)}
									/>
									<Button
										label={picked.value.length === 1
											? "Send"
											: `Send to ${picked.value.length} people`}
										icon={<Icon name="send" size="sm" />}
										disabled={!canSend.value}
										loading={sendState.value === "sending"}
										onClick={() => void send()}
									/>
								</div>
							)}
							{sendState.value === "done" && (
								<p class="share__outcome" role="status">
									{sentTo.value.length > 0 && <span>Sent to {sentTo.value.join(", ")}.</span>}
									{failedTo.value.length > 0 && (
										<span class="share__outcome-failed">
											Couldn't reach {failedTo.value.join(", ")} — try again.
										</span>
									)}
								</p>
							)}
						</>
					)
					: (
						<p class="share__guest">
							<a class="share__signin" href={signIn}>Sign in</a>{" "}
							to send this straight to somebody's inbox.
						</p>
					)}
			</section>

			{/* Tier 2 — external apps + copy + the device's own sheet. */}
			<section class="share__section" aria-labelledby="share-external-title">
				<h3 class="share__heading" id="share-external-title">Share elsewhere</h3>
				<ul class="share__apps" aria-label="Share destinations">
					{SHARE_TARGETS.map((t) => (
						<li key={t.key}>
							<Tooltip content={t.label} placement="top">
								<button
									type="button"
									class="share__app"
									data-target={t.key}
									aria-label={`Share to ${t.label}`}
									onClick={() => openExternal(t.key)}
								>
									<ShareBrandIcon target={t.key} class="share__app-mark" />
									<span class="share__app-label">{t.label}</span>
								</button>
							</Tooltip>
						</li>
					))}
					<li>
						<Tooltip content="Copy link" placement="top">
							<button
								type="button"
								class="share__app"
								data-target="copy"
								aria-label="Copy link"
								onClick={() => void copyLink()}
							>
								<span class="share__app-mark share__app-mark--glyph">
									<Icon name="link" size="md" />
								</span>
								<span class="share__app-label">Copy link</span>
							</button>
						</Tooltip>
					</li>
					{canNativeShare.value && (
						<li>
							<Tooltip content="More apps" placement="top">
								<button
									type="button"
									class="share__app"
									data-target="native"
									aria-label="More apps — your device's share sheet"
									onClick={() => void nativeShare()}
								>
									<span class="share__app-mark share__app-mark--glyph">
										<Icon name="kebab-horizontal" size="md" />
									</span>
									<span class="share__app-label">More</span>
								</button>
							</Tooltip>
						</li>
					)}
				</ul>

				{/* The link itself — selectable, for the copy that a clipboard refusal falls back to. */}
				<div class="share__link">
					<input
						class="share__link-field"
						type="text"
						readOnly
						value={request.url}
						aria-label="Link to share"
						onFocus={(e) => (e.target as HTMLInputElement).select()}
					/>
					<Button
						label="Copy"
						variant="outlined"
						severity="secondary"
						size="sm"
						onClick={() => void copyLink()}
					/>
				</div>
				<p class="share__status" role="status" aria-live="polite">{status.value}</p>
			</section>
		</div>
	);
}
