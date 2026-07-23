import type { JSX } from "preact";
import { MessagingIcon } from "./messaging-glyphs.tsx";

/**
 * ConversationFilesView — the conversation Files tab body (`/messages/[conversationId]/files`): the
 * attachments shared in the conversation, a lean rounded-square grid (images preview inline; other files
 * show a category glyph + name). Server-rendered (zero JS) — derived from the latest message page (the
 * live path will page the full `messages.attachments` set behind `MESSAGING_BACKEND_LIVE`). Mirrors the
 * channel Files tab's role in the strict Chat · Files · Members mirror (task §2C), scoped to the inbox.
 */

// #region Types
export interface ConversationFileEntry {
	id: string;
	kind: "image" | "video" | "pdf" | "file";
	url: string;
	name: string;
	ext: string;
	from: string;
	dayLabel: string;
}
export interface ConversationFilesViewProps {
	files: ConversationFileEntry[];
}
// #endregion

export function ConversationFilesView({ files }: ConversationFilesViewProps): JSX.Element {
	if (files.length === 0) {
		return (
			<div class="conv-files conv-files--empty">
				<span class="conv-files__empty-glyph" aria-hidden="true">
					<MessagingIcon name="files" />
				</span>
				<p class="conv-files__empty-text">No files shared in this conversation yet.</p>
			</div>
		);
	}

	return (
		<div class="conv-files">
			<ul class="conv-files__grid" aria-label="Shared files">
				{files.map((f) => (
					<li key={f.id} class="conv-file" data-kind={f.kind}>
						{(f.kind === "image" || f.kind === "video") && f.url !== "#"
							? (
								<span class="conv-file__thumb">
									<img class="conv-file__img" src={f.url} alt={f.name} loading="lazy" />
								</span>
							)
							: (
								<span class="conv-file__thumb conv-file__thumb--generic" aria-hidden="true">
									<MessagingIcon name="files" />
									<span class="conv-file__ext">{f.ext || "file"}</span>
								</span>
							)}
						<span class="conv-file__meta">
							<span class="conv-file__name" title={f.name}>{f.name}</span>
							<span class="conv-file__sub">{f.from} · {f.dayLabel}</span>
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
