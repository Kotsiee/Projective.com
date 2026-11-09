import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { MessageAttachmentMode } from "@projective/types/projects";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { ContactsService } from "@features/messaging/core/ContactsService.ts";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import type { ShareRequest } from "../core/share-request.ts";
import { SHARE_TARGETS } from "../core/share-targets.ts";
import { defaultShareMode, type ShareFile, shareMessage } from "../core/share-mode.ts";
import type { PersonActionState } from "../core/people-picker.ts";
import { ShareLinkBar } from "./ShareLinkBar.tsx";
import { QuickAddRail } from "./QuickAddRail.tsx";
import { UserSearchPopover } from "./UserSearchPopover.tsx";
import { ResizeFrame, SelectButton } from "@projective/ui/fields";
import { useToast } from "@projective/ui/feedback";

/**
 * ShareModalBody — the unified share surface, in the layout the invite modal shares (Decision #145):
 *
 *  1. **The link** — Copy, the external shortcuts (WhatsApp · LinkedIn · X · Email · …) and the
 *     device's own share sheet where it exists ({@link ShareLinkBar}).
 *  2. **Send to people on Projective** — a search whose matches open in a popover
 *     ({@link UserSearchPopover}) over a Quick Add rail of the viewer's ranked relationships
 *     ({@link QuickAddRail}). Send is one click per person: it posts the optional note + link as a
 *     message through `ContactsService.createConversation`, which reopens the pair's DM or opens one,
 *     and each person keeps their own outcome — a share that reached three of four says so. A stored
 *     file is sent as a link or a copy instead of its URL (Decision #401, `core/share-mode.ts`).
 *
 * A request whose address only the people with access can open (`reach: "with-access"`, a private or
 * restricted file) keeps Copy, leaves out the apps, and says so, with the way to change who has access
 * when the trigger has one (Decision #402). A copy is confirmed by a toast where the page has a stack.
 *
 * A guest cannot send inside the platform (a conversation is a claim on their own inbox), so the
 * second tier offers the standard sign-in route instead of a picker that would 401 on Send.
 */

// #region Props
export interface ShareModalBodyProps {
	request: ShareRequest;
	/** Whether the viewer is signed in — decides whether the people tier is a picker or a sign-in. */
	authed: boolean;
	/** The page to return to after signing in (a guest). */
	returnTo: string;
}
// #endregion

/** Toast the copy when the page has a toast stack to show it on; answers whether it did. */
function toastCopied(): boolean {
	if (typeof document === "undefined" || !document.querySelector(".ui-toast")) return false;
	useToast().show({ severity: "success", summary: "Link copied" });
	return true;
}

/**
 * Said under the link when only the people who already have access can open it (Decision #402): the
 * apps are left out, and the sharer is offered the place to change who that is, when there is one.
 */
function ReachNote({ manageAccess }: { manageAccess?: () => void }): JSX.Element {
	return (
		<p class="share__reach">
			Only people who already have access can open this link.
			{manageAccess
				? (
					<>
						{" "}
						<button type="button" class="share__reach-action" onClick={manageAccess}>
							Manage access
						</button>
					</>
				)
				: null}
		</p>
	);
}

export function ShareModalBody({ request, authed, returnTo }: ShareModalBodyProps): JSX.Element {
	const signIn = `/login?redirectTo=${encodeURIComponent(returnTo)}`;
	const withAccess = request.reach === "with-access";

	return (
		<div class="share">
			<section class="share__section" aria-labelledby="share-link-title">
				<h3 class="share__heading" id="share-link-title">Share the link</h3>
				<ShareLinkBar
					url={request.url}
					title={request.title}
					text={request.text}
					targets={SHARE_TARGETS}
					label="Link to share"
					external={!withAccess}
					note={withAccess ? <ReachNote manageAccess={request.manageAccess} /> : null}
					onCopied={toastCopied}
				/>
			</section>

			{authed
				? <SendToPeople request={request} />
				: (
					<section class="share__section" aria-labelledby="share-internal-title">
						<h3 class="share__heading" id="share-internal-title">Send to people on Projective</h3>
						<p class="share__guest">
							<a class="share__signin" href={signIn}>Sign in</a>{" "}
							to send this straight to somebody's inbox.
						</p>
					</section>
				)}
		</div>
	);
}

const MODE_OPTIONS = [
	{
		value: "link",
		label: "Send a link",
		description: "They open your file. Set it to Only you to take their access away.",
	},
	{
		value: "copy",
		label: "Send a copy",
		description: "They get the file to keep and download.",
	},
];

/**
 * How a file goes to people (Decision #401). A file the sender does not own in their own library can
 * only travel as a copy, which is said rather than offered as a choice that would be refused.
 */
function ShareModeChoice(
	{ file, mode }: { file: ShareFile; mode: Signal<MessageAttachmentMode> },
): JSX.Element {
	if (!file.canLink) {
		return (
			<p class="share__mode-note">
				This file isn't in your own library, so it goes as a copy they can keep.
			</p>
		);
	}
	return (
		<SelectButton
			class="share__mode"
			options={MODE_OPTIONS}
			value={mode.value}
			aria-label="How to send this file"
			onValueChange={(next) => (mode.value = next === "copy" ? "copy" : "link")}
		/>
	);
}

/** The signed-in people tier: a note, the search, and the rail — one Send per person. */
function SendToPeople({ request }: { request: ShareRequest }): JSX.Element {
	const suggestions = useContactSearch({ limit: 20 });
	const note = useSignal("");
	const mode = useSignal<MessageAttachmentMode>(
		request.file ? defaultShareMode(request.file) : "copy",
	);
	const sent = useSignal<Record<string, PersonActionState>>({});
	const failed = useSignal<string | null>(null);
	const live = useRef(true);

	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);

	function stateOf(person: RankedContact): PersonActionState {
		return sent.value[person.id] ?? "idle";
	}

	async function send(person: RankedContact): Promise<void> {
		if (stateOf(person) !== "idle") return;
		sent.value = { ...sent.value, [person.id]: "busy" };
		failed.value = null;
		const res = await ContactsService.createConversation({
			contactIds: [person.id],
			...shareMessage(request, note.value, mode.value),
		});
		if (!live.current) return;
		const ok = res.ok && res.data?.messageAccepted;
		sent.value = { ...sent.value, [person.id]: ok ? "done" : "idle" };
		if (!ok) failed.value = res.message ?? `Couldn't reach ${person.name} — try again.`;
	}

	return (
		<section class="share__section" aria-labelledby="share-internal-title">
			<h3 class="share__heading" id="share-internal-title">Send to people on Projective</h3>
			{request.file ? <ShareModeChoice file={request.file} mode={mode} /> : null}
			<ResizeFrame>
				<textarea
					class="share__note"
					rows={2}
					maxLength={1000}
					placeholder="Add a note (optional) — it goes with every send"
					aria-label="Note to send with the link"
					value={note.value}
					onInput={(e) => (note.value = (e.target as HTMLTextAreaElement).value)}
				/>
			</ResizeFrame>
			<UserSearchPopover
				label="Search people to send this to"
				placeholder="Search by name or @handle"
				actionLabel="Send"
				doneLabel="Sent"
				busyLabel="Sending…"
				stateOf={stateOf}
				onAct={(person) => void send(person)}
			/>
			<QuickAddRail
				heading="Quick send"
				people={suggestions.contacts.value}
				loading={suggestions.loading.value}
				error={suggestions.error.value}
				onRetry={suggestions.retry}
				actionLabel="Send"
				doneLabel="Sent"
				stateOf={stateOf}
				onAct={(person) => void send(person)}
				emptyNote="No suggestions yet. Search by name or @handle to find someone."
			/>
			{failed.value && (
				<p class="share__outcome share__outcome-failed" role="alert">{failed.value}</p>
			)}
		</section>
	);
}
