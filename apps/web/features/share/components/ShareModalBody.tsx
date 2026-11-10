import type { JSX } from "preact";
import { batch, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { MessageAttachmentMode } from "@projective/types/projects";
import { InputText } from "@projective/ui/fields";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import { shareOpen, type ShareRequest } from "../core/share-request.ts";
import { SHARE_TARGETS } from "../core/share-targets.ts";
import { defaultShareMode } from "../core/share-mode.ts";
import { pinnedPeople, toggleRecipient } from "../core/share-select.ts";
import { useShareSend } from "../hooks/useShareSend.ts";
import { ShareLinkBar } from "./ShareLinkBar.tsx";
import { ShareContactGrid } from "./ShareContactGrid.tsx";
import { ShareSendBar } from "./ShareSendBar.tsx";

/**
 * ShareModalBody — the share surface (Decisions #145, #401, #406), Instagram's direct share:
 *
 *  1. **Send to…** (signed in) — a search field under the header and the people it finds, ranked by
 *     relationship (`useContactSearch`), as a grid of cards ({@link ShareContactGrid}). A press
 *     chooses a person; it never sends.
 *  2. **The link** — the URL read-only with Copy inline, then the external shortcuts and the device's
 *     own share sheet ({@link ShareLinkBar}).
 *  3. **The send footer** ({@link ShareSendBar}) — only while somebody is chosen: a note and
 *     **Send to {n}**, one direct message per person. Everyone reached closes the surface with a
 *     toast (`onSent`); a refusal keeps who is left, chosen, with the reason.
 *
 * A guest sees the link alone. A request whose address only the people with access can open
 * (`reach: "with-access"`) keeps Copy, leaves out the apps and says so, with the way to change who
 * has access when the trigger has one (Decision #402). Escape dismisses the surface (§B.10.6), and a
 * dismissed surface forgets its selection.
 */

// #region Props
export interface ShareModalBodyProps {
	request: ShareRequest;
	/** Whether the viewer is signed in — only a signed-in viewer can send inside the platform. */
	authed: boolean;
	/** Everyone was reached: close the surface and say so. */
	onSent: (summary: string) => void;
	/**
	 * The room, px, on the side an anchored surface opened on: the people's grid gives way inside it
	 * rather than the surface outgrowing its side. `null` in the dialog.
	 */
	room?: number | null;
}
// #endregion

/** People the picker loads. */
const PEOPLE_LIMIT = 24;

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

export function ShareModalBody(
	{ request, authed, onSent, room }: ShareModalBodyProps,
): JSX.Element {
	const withAccess = request.reach === "with-access";
	const link = (
		<section class="share__section share__link" aria-label="Share the link">
			<ShareLinkBar
				url={request.url}
				title={request.title}
				text={request.text}
				targets={SHARE_TARGETS}
				label="Link to share"
				external={!withAccess}
				note={withAccess ? <ReachNote manageAccess={request.manageAccess} /> : null}
			/>
		</section>
	);

	if (!authed) return <div class="share">{link}</div>;
	return <SendTo request={request} onSent={onSent} link={link} room={room ?? null} />;
}

/** The signed-in surface: search, the people, the link, and the send footer while anyone is chosen. */
function SendTo(
	{ request, onSent, link, room }: {
		request: ShareRequest;
		onSent: (s: string) => void;
		link: JSX.Element;
		room: number | null;
	},
): JSX.Element {
	const contacts = useContactSearch({ limit: PEOPLE_LIMIT });
	const query = useSignal("");
	const selectedRecipients = useSignal<string[]>([]);
	const known = useRef(new Map<string, RankedContact>());
	const pinned = useSignal<RankedContact[]>([]);
	const note = useSignal("");
	const mode = useSignal<MessageAttachmentMode>(
		request.file ? defaultShareMode(request.file) : "copy",
	);
	const error = useSignal<string | null>(null);
	const { sending, send } = useShareSend(request);
	const root = useRef<HTMLDivElement>(null);

	// The body arrives after the surface has opened (a lazy chunk), so the surface's own initial focus
	// finds nothing yet; the search is where a reader starts, so it takes focus once it exists.
	useEffect(() => {
		const timer = setTimeout(() => {
			const field = root.current?.querySelector<HTMLInputElement>(".share__search input");
			const panel = root.current?.closest<HTMLElement>("[role=dialog]");
			const focus = document.activeElement;
			const parked = !focus || focus === document.body || focus === panel ||
				focus.classList.contains("ui-dialog__close");
			if (field && parked) field.focus();
		}, 0);
		return () => clearTimeout(timer);
	}, []);

	// A new result set re-reads who is pinned; a press never does, so a card stays where it was.
	const results = contacts.contacts.value;
	useEffect(() => {
		pinned.value = pinnedPeople(results, selectedRecipients.peek(), known.current);
	}, [results]);

	// A dismissed surface forgets its selection, so the next open starts clean.
	useSignalEffect(() => {
		if (shareOpen.value) return;
		batch(() => {
			selectedRecipients.value = [];
			pinned.value = [];
			note.value = "";
			error.value = null;
		});
	});

	function toggle(person: RankedContact): void {
		const next = toggleRecipient(selectedRecipients.peek(), person.id);
		known.current.set(person.id, person);
		batch(() => {
			selectedRecipients.value = next.selected;
			error.value = next.refused;
		});
	}

	async function commit(): Promise<void> {
		const chosen = selectedRecipients.peek()
			.map((id) => known.current.get(id))
			.filter((c): c is RankedContact => c !== undefined);
		error.value = null;
		const summary = await send(chosen, note.peek(), mode.peek());
		if (!summary) return;
		if (summary.toast) {
			batch(() => {
				selectedRecipients.value = [];
				note.value = "";
			});
			onSent(summary.toast);
			return;
		}
		batch(() => {
			selectedRecipients.value = selectedRecipients.peek().filter((id) =>
				summary.failed.includes(id)
			);
			error.value = summary.error;
		});
	}

	const people = [
		...pinned.value,
		...results.filter((r) => !pinned.value.some((p) => p.id === r.id)),
	];
	const count = selectedRecipients.value.length;

	return (
		<div
			class="share share--send"
			ref={root}
			style={room === null ? undefined : `--share-room: ${room}px`}
		>
			<InputText
				size="sm"
				class="share__search"
				value={query}
				onValueChange={(next) => contacts.setQuery(next)}
				placeholder="Search by name or @handle…"
				aria-label="Search people to send this to"
				aria-controls="share-people"
				autoComplete="off"
				autoCapitalize="none"
				spellcheck={false}
				block
			/>
			<ShareContactGrid
				id="share-people"
				people={people}
				selected={selectedRecipients.value}
				onToggle={toggle}
				loading={contacts.loading.value}
				error={contacts.error.value}
				onRetry={contacts.retry}
				query={query.value}
			/>
			{link}
			{count > 0 && (
				<ShareSendBar
					count={count}
					note={note}
					sending={sending.value}
					error={error.value}
					onSend={() => void commit()}
					file={request.file}
					mode={mode}
				/>
			)}
		</div>
	);
}
