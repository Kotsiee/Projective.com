import { signal } from "@preact/signals";
import type { RankedContact } from "@projective/types/messaging";
import { useToast } from "@projective/ui/feedback";
import type { MenuItem } from "@projective/ui/navigation";
import { ContactsService } from "@features/messaging/core/ContactsService.ts";
import { recentRecipients } from "./recent-recipients.ts";
import { absoluteUrl, requestShare } from "./share-request.ts";
import { composeInternalMessage } from "./share-targets.ts";

/**
 * share-menu — the Share row every file menu carries (Decision #400). Pressed, it opens the one share
 * modal through {@link requestShare}. Hovered, it unfolds the three people the viewer last messaged or
 * worked with, and picking one sends them the link in a direct message, as the modal's own Send does.
 * The outcome is a toast on the page's shared stack.
 */

// #region Recipients
/** The ranked contacts read before picking the most recent: the ranking leads with tier, not time. */
const POOL = 30;

interface RecentState {
	/** `null` until the read answers. */
	people: RankedContact[] | null;
	failed: boolean;
}

const recent = signal<RecentState>({ people: null, failed: false });
let asked = false;

/** The recent people, read once per page by the first menu that asks; a failed read is retried. */
function recentPeople(): RecentState {
	if (!asked && typeof document !== "undefined") {
		asked = true;
		void ContactsService.suggestions({ limit: POOL })
			.catch(() => null)
			.then((res) => {
				const ok = res?.ok === true && res.data !== undefined;
				if (!ok) asked = false;
				recent.value = {
					people: ok ? recentRecipients(res.data!.contacts.contacts) : [],
					failed: !ok,
				};
			});
	}
	return recent.value;
}
// #endregion

// #region Row
/** What a Share row shares. */
export interface ShareTarget {
	/** The file's name: the share sheet's title and the opening of a sent message. */
	title: string;
	/** Where the link points; a relative address is resolved against the page. */
	href: string;
}

/**
 * The Share row. Signed out it only opens the modal, which offers sign-in in place of sending. Reads a
 * signal, so the menu that renders it repaints when the recent people arrive.
 */
export function shareRow(target: ShareTarget, signedIn: boolean): MenuItem {
	const row: MenuItem = {
		key: "share",
		label: "Share",
		icon: "share",
		command: () => requestShare({ href: target.href, title: target.title, noun: "file" }),
	};
	if (!signedIn) return row;
	const { people, failed } = recentPeople();
	return {
		...row,
		items: (people ?? []).map((person) => ({
			key: `share-${person.id}`,
			label: person.name,
			image: person.avatar,
			hint: person.lastInteractionLabel ?? undefined,
			command: () => void sendTo(person, target),
		})),
		emptyLabel: people === null
			? "Loading people…"
			: failed
			? "Couldn't load people"
			: "No one recent yet",
	};
}

async function sendTo(person: RankedContact, target: ShareTarget): Promise<void> {
	const res = await ContactsService.createConversation({
		contactIds: [person.id],
		message: composeInternalMessage({ title: target.title, url: absoluteUrl(target.href) }, ""),
	}).catch(() => null);
	const sent = res?.ok === true && res.data?.messageAccepted === true;
	useToast().show(
		sent ? { severity: "success", summary: `Sent to ${person.name}` } : {
			severity: "danger",
			summary: `Couldn't send to ${person.name}`,
			detail: "Try again from Share.",
		},
	);
}
// #endregion
