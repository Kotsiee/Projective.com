import { linkActionItems, linkOpenItem, type MenuItem } from "@projective/ui/navigation";
import type { ListingAction } from "./console-actions.ts";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * A listing's actions as menu rows: Edit (the split `linkOpenItem` row on `href`, the workspace link
 * the card opens, so it unfolds Open · Open in new tab · Open in new window) · Copy link · Duplicate
 * · View public page (published) · then the lifecycle step (Pause / Publish / Restore to draft) ·
 * Archive (not archived) · Delete (only when the server allows it). Archive and Delete go through
 * `onAction`, which is the canvas's `requestAction`, so both confirm before anything runs.
 */
export function listingMenu(
	listing: ListingSummary,
	onAction: (action: ListingAction, listing: ListingSummary) => void,
	href: string,
): MenuItem[] {
	const run = (action: ListingAction) => () => onAction(action, listing);
	const rows: MenuItem[] = [
		linkOpenItem({ href, label: "Edit", icon: "edit", copy: false }),
		...linkActionItems({ href, title: listing.title, include: ["copy-link"] }),
		{ label: "Duplicate", icon: "copy", command: run("duplicate") },
	];
	if (listing.status === "published") {
		rows.push({ label: "View public page", icon: "eye", command: run("preview") });
	}
	rows.push({ separator: true });
	if (listing.status === "published") {
		rows.push({ label: "Pause", icon: "pause", command: run("pause") });
	} else if (listing.status !== "archived") {
		rows.push({ label: "Publish", icon: "upload", command: run("publish") });
	} else rows.push({ label: "Restore to draft", icon: "history", command: run("restore") });
	if (listing.status !== "archived") {
		rows.push({ label: "Archive", icon: "archive-box", command: run("archive") });
	}
	if (listing.deletable) {
		rows.push({ label: "Delete", icon: "trash", danger: true, command: run("delete") });
	}
	return rows;
}
