import type { MenuItem } from "@ui/types/mod.ts";
import { composeMenu, linkActionItems, linkOpenItem } from "@ui/navigation/core/link-actions.ts";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { offerFor } from "@features/view/core/entity-archetype.ts";
import { messageHrefFor, messageRecipient, signInHref } from "@features/view/core/view-model.ts";
import { withViewIntent } from "@features/view/core/view-intent.ts";
import { type HrefContext, itemHref, profileHref } from "./routing.ts";
import type {
	ExploreEntity,
	ExploreItem,
	ExploreOwner,
	ServiceType,
} from "../types/explore-types.ts";

/**
 * card-menu — the rows an Explore card's right-click menu offers (Decisions #222, #373, #422).
 *
 * Three groups, in this order:
 *
 * 1. **The link rows every card and list item shares** — the split Open row (a profile card's reads
 *    View profile), Copy link, Share, Save. Fixed first, so they sit in the same place on every menu
 *    in the product whatever the card's type.
 * 2. **The item's own verbs** — what its `/view` page leads with, where a row can start it without a
 *    write: Book session and Contact seller open the page's own panel through `?intent=`; Apply to
 *    project likewise; Message reaches a person — a team's or a business's owner (Decision #422 (b)).
 * 3. **The creator** — View profile, naming them, for every item that is not itself a profile.
 */

// #region Types
/** The serialisable facts a card hands its menu island. */
export interface CardMenuFacts {
	id: string;
	type: ExploreEntity;
	title: string;
	/** The card's href for its render context (the click matrix's answer). */
	href: string;
	/** A service's delivery model; absent on every other type. */
	serviceType?: ServiceType;
	owner: Pick<ExploreOwner, "handle" | "name" | "kind" | "messageTo">;
	/** Where the card renders — a profile page offers no row back to itself. */
	ctx: HrefContext;
}

/** The state and handlers the link rows need from the island that owns them. */
export interface CardMenuHandlers {
	authed: boolean;
	onShare: () => void;
	/** Save state, its toggle and the save-to-list rows; omitted (no Save row) for a guest. */
	save?: { saved: boolean; onToggle: () => void; lists?: MenuItem[] };
	onCopied: (ok: boolean) => void;
}
// #endregion

const PROFILE_TYPES: ReadonlySet<ExploreEntity> = new Set([
	"users",
	"freelancers",
	"teams",
	"businesses",
]);

function bareHandle(handle: string): string {
	return handle.replace(/^@+/, "").toLowerCase();
}

/** The facts a card passes its menu island, picked from the item so the island props stay small. */
export function cardMenuFacts(item: ExploreItem, ctx: HrefContext): CardMenuFacts {
	return {
		id: item.id,
		type: item.type,
		title: item.title,
		href: itemHref(item, ctx),
		serviceType: item.type === "services" ? item.serviceType : undefined,
		owner: {
			handle: item.owner.handle,
			name: item.owner.name,
			kind: item.owner.kind,
			messageTo: item.owner.messageTo,
		},
		ctx,
	};
}

// #region Rows
/**
 * The Message row, or `null` when nobody answers for the owner. A row that reaches a team's or a
 * business's owner names that person as its hint, so the reader knows who the DM is with.
 */
function messageRow(
	facts: CardMenuFacts,
	label: string,
	guestHref: string,
	authed: boolean,
): MenuItem | null {
	const to = messageRecipient(facts.owner);
	const href = messageHrefFor(facts);
	if (!to || href === null) return null;
	return {
		key: "item-message",
		label,
		icon: "message",
		url: authed ? href : guestHref,
		hint: to.handle === facts.owner.handle ? undefined : to.name,
	};
}

/**
 * The item's own verbs. A row is offered only where pressing it is safe from a URL — Buy now, Add to
 * projects and Reserve seat write on press, so their cards offer Open instead — and where it reaches
 * someone: a team's or a business's Message goes to its owner, and an entity that names none gets no
 * Message row, because `dm-{slug}` reaches nobody.
 */
export function itemActionRows(facts: CardMenuFacts, authed: boolean): MenuItem[] {
	const contact: MenuItem = {
		key: "item-contact",
		label: "Contact seller",
		icon: "message",
		url: withViewIntent(facts.href, "contact"),
	};
	switch (facts.type) {
		case "services":
			return facts.serviceType === "Session"
				? [
					{
						key: "item-book",
						label: offerFor("session").primaryLabel,
						icon: "calendar",
						url: withViewIntent(facts.href, "book"),
					},
					contact,
				]
				: [contact];
		case "products":
			return [contact];
		case "projects": {
			const apply: MenuItem = {
				key: "item-apply",
				label: offerFor("project").primaryLabel,
				icon: "user-plus",
				url: withViewIntent(facts.href, "apply"),
			};
			const message = messageRow(
				facts,
				"Message client",
				signInHref(facts, facts.ctx),
				authed,
			);
			return message ? [apply, message] : [apply];
		}
		case "users":
		case "freelancers":
		case "teams":
		case "businesses": {
			const message = messageRow(facts, "Message", withRedirect("/login", facts.href), authed);
			return message ? [message] : [];
		}
		default:
			return [];
	}
}

/** View profile for the creator, unless the card is a profile or already sits on the creator's page. */
export function creatorRows(facts: CardMenuFacts, onCopied: (ok: boolean) => void): MenuItem[] {
	if (PROFILE_TYPES.has(facts.type)) return [];
	if (
		facts.ctx.scope === "profile" && bareHandle(facts.ctx.handle) === bareHandle(facts.owner.handle)
	) {
		return [];
	}
	return [
		linkOpenItem({
			key: "creator-profile",
			href: profileHref(facts.owner.handle),
			label: "View profile",
			icon: "user",
			hint: facts.owner.name,
			onCopied,
		}),
	];
}

/** The card's whole right-click menu. */
export function cardMenu(facts: CardMenuFacts, handlers: CardMenuHandlers): MenuItem[] {
	const profile = PROFILE_TYPES.has(facts.type);
	return composeMenu(
		[
			linkOpenItem({
				href: facts.href,
				label: profile ? "View profile" : "Open",
				icon: profile ? "user" : undefined,
				copy: false,
			}),
			...linkActionItems({
				href: facts.href,
				title: facts.title,
				include: ["copy-link", "share", "save"],
				onShare: handlers.onShare,
				save: handlers.save,
				onCopied: handlers.onCopied,
			}),
		],
		itemActionRows(facts, handlers.authed),
		creatorRows(facts, handlers.onCopied),
	);
}
// #endregion
