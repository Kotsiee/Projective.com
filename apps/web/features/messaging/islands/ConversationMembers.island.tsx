import type { JSX } from "preact";
import "../styles/conversation.css";
import { Avatar } from "@projective/ui/display";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { openAddMembers } from "../core/messaging-state.ts";
import { profileHref } from "@web/features/projects/core/routing.ts";
import type { ConversationDetail, ConversationParticipant } from "../types/messaging-types.ts";

/**
 * ConversationMembers — the conversation Members tab body (`/messages/[conversationId]/members`), the
 * third of the strict Chat · Files · Members mirror (task §2C). It lists the participants (the acting
 * viewer + the others, each linking to their `/@handle`) and, when permitted, an **Add members** action
 * that opens the shared contact picker in `add` mode — the mechanism that converts a DM into a group
 * chat (task §2B). Dumb island: the add is a stub until the backend owns the membership write.
 */
export default function ConversationMembers(
	{ detail }: { detail: ConversationDetail },
): JSX.Element {
	const viewer: ConversationParticipant = {
		id: "you",
		name: "You",
		avatar: null,
		handle: null,
		roleLabel: "You",
		online: true,
	};
	const roster: ConversationParticipant[] = [viewer, ...detail.participants];

	return (
		<div class="conv-members">
			<div class="conv-members__head">
				<span class="conv-members__count">
					{roster.length} {roster.length === 1 ? "member" : "members"}
				</span>
				{detail.canAddMembers && (
					<button
						type="button"
						class="conv-members__add"
						onClick={() => openAddMembers(detail.id)}
					>
						<MessagingIcon name="addMember" />
						<span>Add members</span>
					</button>
				)}
			</div>

			{detail.kind === "dm" && detail.canAddMembers && (
				<p class="conv-members__hint">
					Add someone to turn this direct message into a group chat.
				</p>
			)}

			<ul class="conv-members__list" aria-label="Members">
				{roster.map((m) => {
					const href = m.handle ? profileHref(m.handle) : null;
					const inner = (
						<>
							<span class="conv-member__avatar">
								<Avatar image={m.avatar ?? undefined} label={m.name} size={38} shape="circle" />
								{m.online && <span class="conv-member__online" aria-label="Online" />}
							</span>
							<span class="conv-member__text">
								<span class="conv-member__name">{m.name}</span>
								{m.roleLabel && <span class="conv-member__role">{m.roleLabel}</span>}
							</span>
						</>
					);
					return (
						<li key={m.id} class="conv-member">
							{href
								? <a class="conv-member__link" href={href}>{inner}</a>
								: <div class="conv-member__link conv-member__link--plain">{inner}</div>}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
