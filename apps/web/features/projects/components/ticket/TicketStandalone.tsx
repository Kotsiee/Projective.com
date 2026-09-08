import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
// The ticket modal's stylesheets ride an ISLAND bundle (Decision #39). On a board or timeline page
// their island carries them; on any other page this lazily-loaded chunk is the carrier, which is
// the whole reason the sheets are imported here and not in the host — the host mounts on every
// page and must not ship the ticket surface's CSS and code to a page that never opens a ticket.
import "../../styles/board.css";
import "../../styles/ticket-pipeline.css";
import "../../styles/ticket-view.css";
import "../../styles/file-explorer.css";
import "../../styles/file-table.css";
import "../../styles/submission-explorer.css";
import "../../styles/submission-card.css";
import "../../styles/file-card.css";
import type { BoardCard, BoardPage } from "../../types/projects-types.ts";
import { TicketView } from "./TicketView.tsx";
import { BoardService } from "../../core/BoardService.ts";
import { reconcileCard, ticketCommitPayload } from "../../core/ticket-model.ts";
import { ticketSubmissionHref } from "../../core/ticket-view.ts";
import {
	type BoardAccess,
	readDevSeam,
	resolveBoardAccess,
	watchDevSeam,
} from "../../core/board-access.ts";
import { resolveSessionKind } from "../../core/session-model.ts";

/**
 * TicketStandalone — the View Ticket modal rendered from a FETCHED board rather than a page's own.
 *
 * The deep-link host mounts this on a page that holds no board of its own (the inbox, a profile,
 * the wallet): it carries the page the `/api/projects/ticket` read returned, resolves the viewer's
 * capabilities through the SAME `board-access.ts` the board uses (so a persona flip in the Dev
 * Context Switcher moves this modal exactly as it moves the board's), and commits an edit through
 * the SAME endpoint. It is deliberately `view`-only: composing a ticket needs a board to land on.
 *
 * Submission actions hand over to their canonical addresses rather than mounting a second review
 * workspace here — the timeline island makes the same call, for the same reason.
 */
export interface TicketStandaloneProps {
	uid: number;
	page: BoardPage;
	card: BoardCard;
	onClose: () => void;
	/** The card as the server saw it after a save, for the host's copy. */
	onSaved: (page: BoardPage, card: BoardCard) => void;
	/** A save was refused; the host reports it. */
	onRefused: (message: string) => void;
}

export function TicketStandalone(props: TicketStandaloneProps): JSX.Element {
	const { uid, page, card, onClose, onSaved, onRefused } = props;

	const baseline = {
		viewerIsClient: page.viewerIsClient,
		sessionKind: resolveSessionKind(page.format, null),
	};
	const access = useSignal<BoardAccess>(resolveBoardAccess(baseline, null));
	useEffect(() => {
		const apply = () => (access.value = resolveBoardAccess(baseline, readDevSeam()));
		apply();
		return watchDevSeam(apply);
	}, [baseline.viewerIsClient, baseline.sessionKind]);

	async function commit(next: BoardCard): Promise<void> {
		const working = reconcileCard({ ...next, updatedAt: new Date().toISOString() }, page.stages);
		const res = await BoardService.commit(ticketCommitPayload(page.projectId, card.id, working));
		if (res.ok && res.data) {
			const saved = res.data.card;
			onSaved(
				{ ...page, cards: page.cards.map((c) => (c.id === saved.id ? saved : c)) },
				saved,
			);
			return;
		}
		onRefused(res.message ?? "That ticket could not be saved.");
	}

	return (
		<TicketView
			key={uid}
			uid={uid}
			mode="view"
			card={card}
			stages={page.stages}
			cards={page.cards}
			canEdit={access.value.canEditTicket}
			isClient={access.value.isClient}
			isFreelancer={access.value.isFreelancer}
			workspaceKind={page.workspaceKind}
			workspaceLabel={page.workspaceLabel}
			clientMembers={page.clientMembers}
			projectId={page.projectId}
			onClose={onClose}
			onSubmit={(next) => void commit(next)}
			onOpenSubmission={(path) => {
				globalThis.location.href = ticketSubmissionHref(page.projectId, path, { review: true });
			}}
			onCreateSubmission={(stageId) => {
				globalThis.location.href = ticketSubmissionHref(page.projectId, [stageId]);
			}}
		/>
	);
}
