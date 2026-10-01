import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/conversation-context.css";
import { Drawer } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { useMediaQuery } from "@projective/ui/navigation";
import { RequestService } from "@web/features/projects/core/RequestService.ts";
import { ConversationContextDrawer } from "../components/ConversationContextDrawer.tsx";
import { MessagingService } from "../core/MessagingService.ts";
import { moveConversation } from "../core/folder-moves.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import type {
	ContextAction,
	ContextActionKind,
	ConversationContext,
	InboxFolder,
} from "../types/messaging-types.ts";

/**
 * ConversationContextPanel — the right edge of a DM thread (`/messages/[conversationId]`). The layout
 * registers it as the middle-nav frame's PANEL (`conversationPanelFor`), so from 1280px it docks at full
 * frame height beside the header, thread and composer — resizable, and opened/closed from the header's
 * Details toggle through the shell's shared panel state; below that it is a slide-over {@link Drawer}.
 * Both present the same {@link ConversationContextDrawer}.
 *
 * Runs the rig's actions: answering an invitation also files the thread (Accept → Primary, Decline →
 * Archived); confirming an applicant's seat lands the client where the seat is funded. Every write
 * goes through the thin services; the context is re-read after an answer so the rig reflects what
 * the server now allows.
 */

// #region Props
export interface ConversationContextPanelProps {
	conversationId: string;
	/** The SSR read, or null when it failed. */
	initial: ConversationContext | null;
	/** The viewer's folder for this conversation. */
	folder: InboxFolder;
}
// #endregion

const PANEL_ID = "msg-ctx-panel";

export default function ConversationContextPanel(
	props: ConversationContextPanelProps,
): JSX.Element {
	const context = useSignal<ConversationContext | null>(props.initial);
	const folder = useSignal<InboxFolder>(props.folder);
	const busy = useSignal<ContextActionKind | null>(null);
	const error = useSignal<string | null>(null);
	const loadFailed = useSignal(props.initial === null);
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);

	async function reload(): Promise<void> {
		const res = await MessagingService.context(props.conversationId);
		if (res.ok && res.data) {
			context.value = res.data.context;
			loadFailed.value = false;
		} else if (!context.value) {
			loadFailed.value = true;
		}
	}

	async function fileTo(to: InboxFolder): Promise<string | null> {
		if (folder.value === to) return null;
		const refused = await moveConversation(props.conversationId, folder.value, to);
		if (!refused) folder.value = to;
		return refused;
	}

	async function run(action: ContextAction): Promise<void> {
		busy.value = action.kind;
		error.value = null;
		try {
			if (action.kind === "accept_invitation" || action.kind === "decline_invitation") {
				const accept = action.kind === "accept_invitation";
				const res = await RequestService.respond(action.engagementIds, accept);
				if (!res.ok) {
					error.value = res.message ?? "That answer didn't go through. Try again.";
					return;
				}
				error.value = await fileTo(accept ? "primary" : "archived");
				await reload();
				return;
			}
			if (action.kind === "confirm_seat") {
				const res = await RequestService.acceptApplication(action.engagementIds[0]);
				if (!res.ok || !res.data) {
					error.value = res.message ?? "The seat couldn't be confirmed. Try again.";
					return;
				}
				await fileTo("primary");
				globalThis.location.assign(res.data.fundHref);
			}
		} finally {
			busy.value = null;
		}
	}

	const body = () =>
		context.value
			? (
				<ConversationContextDrawer
					context={context.value}
					busy={busy.value}
					error={error.value}
					onAction={(a) => void run(a)}
				/>
			)
			: (
				<div class="msg-ctx msg-ctx--failed">
					<p class="msg-ctx__empty" role="alert">
						{loadFailed.value ? "This conversation's details couldn't be loaded." : "Loading…"}
					</p>
					<Button
						label="Try again"
						variant="text"
						severity="secondary"
						size="sm"
						onClick={() => void reload()}
					/>
				</div>
			);

	return (
		<>
			<aside id={PANEL_ID} class="msg-ctx-panel" aria-label="Conversation details">
				{body()}
			</aside>
			{!inflow && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header="Details"
					size="min(24rem, 100vw)"
					class="msg-ctx-drawer"
				>
					{body()}
				</Drawer>
			)}
		</>
	);
}
