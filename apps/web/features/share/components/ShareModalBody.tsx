import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { ContactsService } from "@features/messaging/core/ContactsService.ts";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import type { ShareRequest } from "../core/share-request.ts";
import { composeInternalMessage, SHARE_TARGETS } from "../core/share-targets.ts";
import type { PersonActionState } from "../core/people-picker.ts";
import { ShareLinkBar } from "./ShareLinkBar.tsx";
import { QuickAddRail } from "./QuickAddRail.tsx";
import { UserSearchPopover } from "./UserSearchPopover.tsx";

/**
 * ShareModalBody — the unified share surface, in the layout the invite modal shares (Decision #145):
 *
 *  1. **The link** — Copy, the external shortcuts (WhatsApp · LinkedIn · X · Email · …) and the
 *     device's own share sheet where it exists ({@link ShareLinkBar}).
 *  2. **Send to people on Projective** — a search whose matches open in a popover
 *     ({@link UserSearchPopover}) over a Quick Add rail of the viewer's ranked relationships
 *     ({@link QuickAddRail}). Send is one click per person: it posts the optional note + link as a
 *     message through `ContactsService.createConversation`, which reopens the pair's DM or opens one,
 *     and each person keeps their own outcome — a share that reached three of four says so.
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

export function ShareModalBody({ request, authed, returnTo }: ShareModalBodyProps): JSX.Element {
	const signIn = `/login?redirectTo=${encodeURIComponent(returnTo)}`;

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

/** The signed-in people tier: a note, the search, and the rail — one Send per person. */
function SendToPeople({ request }: { request: ShareRequest }): JSX.Element {
	const suggestions = useContactSearch({ limit: 20 });
	const note = useSignal("");
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
			message: composeInternalMessage(request, note.value),
		});
		if (!live.current) return;
		const ok = res.ok && res.data?.messageAccepted;
		sent.value = { ...sent.value, [person.id]: ok ? "done" : "idle" };
		if (!ok) failed.value = `Couldn't reach ${person.name} — try again.`;
	}

	return (
		<section class="share__section" aria-labelledby="share-internal-title">
			<h3 class="share__heading" id="share-internal-title">Send to people on Projective</h3>
			<textarea
				class="share__note"
				rows={2}
				maxLength={1000}
				placeholder="Add a note (optional) — it goes with every send"
				aria-label="Note to send with the link"
				value={note.value}
				onInput={(e) => (note.value = (e.target as HTMLTextAreaElement).value)}
			/>
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
