import { composeMenu, linkActionItems, type MenuItem } from "@projective/ui/navigation";
import { listingHref } from "./catalogue-model.ts";
import type { ListingAction } from "./console-actions.ts";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * A listing's actions as menu rows: Open in new tab · Copy link (the workspace link; Edit is the plain
 * open), then Edit · Duplicate · View public page
 * (published) · then the lifecycle step (Pause / Publish / Restore to draft) · Archive (not archived)
 * · Delete (only when the server allows it). Archive and Delete go through `onAction`, which is the
 * canvas's `requestAction`, so both confirm before anything runs.
 */
export function listingMenu(
	listing: ListingSummary,
	onAction: (action: ListingAction, listing: ListingSummary) => void,
): MenuItem[] {
	const run = (action: ListingAction) => () => onAction(action, listing);
	const rows: MenuItem[] = [
		{ label: "Edit", icon: "edit", command: run("edit") },
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
	const links = linkActionItems({
		href: listingHref(listing.id),
		title: listing.title,
		include: ["open-new-tab", "copy-link"],
	});
	return composeMenu(links, rows);
}
