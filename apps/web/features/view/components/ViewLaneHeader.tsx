import { type JSX, type RefObject } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { ProfileIcon } from "@features/profile/components/profile-glyphs.tsx";
import { backHrefFor, backLabelFor, laneMenuActionsFor } from "../core/view-model.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ViewLaneHeader — the shared `pf-lane__header` for the Entity View side-nav lanes (the transactional
 * {@link ViewActionLane} and the {@link ProjectViewLane}). It replaces the old creator link with the
 * "Back to Explore" button (`vw__back`, routing to the render-context back target) on the left, and a
 * Share · Save · contextual **kebab** cluster on the right. The kebab menu is tailored to the entity
 * type via {@link laneMenuActionsFor} — Copy link · Share to socials · Embed code (embeddable listings)
 * · Save to collection · `Report {noun}`. Reuses the profile lane's `.pf-menu` compact-popover style, so
 * items render directly inside `ui-popover__content`. Dumb: share/copy/embed touch the clipboard/native
 * share sheet; collection + report are optimistic client stubs until their write paths land.
 */
export interface ViewLaneHeaderProps {
	item: ExploreItem;
	/** The render context (public Explore vs a profile namespace) — drives the back target. */
	ctx: HrefContext;
	/** The quick-favourite state, owned by the parent lane (a local or a shared cross-island signal). */
	saved: Signal<boolean>;
	/** Toggle the favourite state. */
	onToggleSaved: () => void;
	/** Optional labels for the favourite tooltip/aria (defaults to Saved ⁄ Save). */
	saveLabel?: { on: string; off: string };
	/** Optional status announcer, so a lane with a live status line can echo "Link copied" etc. */
	onStatus?: (message: string) => void;
}

/** The global site sidebar the header's `bottom-end` kebab menu must never slide under. */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

function pageUrl(): string {
	try {
		return globalThis.location?.href ?? "";
	} catch {
		return "";
	}
}

export function ViewLaneHeader(
	{ item, ctx, saved, onToggleSaved, saveLabel, onStatus }: ViewLaneHeaderProps,
): JSX.Element {
	const menuOpen = useSignal(false);
	const collected = useSignal(false);
	const onLabel = saveLabel?.on ?? "Saved";
	const offLabel = saveLabel?.off ?? "Save";

	function share(): void {
		try {
			const url = pageUrl();
			const nav = globalThis.navigator as Navigator & {
				share?: (d: { title: string; url: string }) => Promise<void>;
			};
			if (nav?.share) nav.share({ title: item.title, url }).catch(() => {});
			else {
				nav?.clipboard?.writeText(url).catch(() => {});
				onStatus?.("Link copied");
			}
		} catch { /* non-fatal */ }
	}

	function copyLink(): void {
		try {
			globalThis.navigator?.clipboard?.writeText(pageUrl()).catch(() => {});
			onStatus?.("Link copied");
		} catch { /* clipboard unavailable — non-fatal */ }
	}

	function copyEmbed(): void {
		try {
			const snippet = `<iframe src="${pageUrl()}" title="${item.title}" width="480" height="640" ` +
				`style="border:0;border-radius:12px" loading="lazy"></iframe>`;
			globalThis.navigator?.clipboard?.writeText(snippet).catch(() => {});
			onStatus?.("Embed code copied");
		} catch { /* clipboard unavailable — non-fatal */ }
	}

	function runAction(key: string): void {
		menuOpen.value = false;
		switch (key) {
			case "copy-link":
				copyLink();
				break;
			case "socials":
				share();
				break;
			case "embed":
				copyEmbed();
				break;
			case "collection":
				collected.value = !collected.value;
				onStatus?.(collected.value ? "Saved to collection" : "Removed from collection");
				break;
			case "report":
				onStatus?.("Report submitted — our team will review it");
				break;
		}
	}

	const menuActions = laneMenuActionsFor(item);

	return (
		<div class="pf-lane__header vw-lane__header">
			<a
				class="vw__back vw-lane__back"
				href={backHrefFor(ctx)}
				aria-label={backLabelFor(ctx)}
			>
				<Icon name="arrow-left" size="sm" class="vw-lane__back-arrow vw__back-arrow" />
				<span class="vw-lane__back-label">{backLabelFor(ctx)}</span>
			</a>
			<div class="pf-lane__header-actions">
				<Tooltip content="Share" placement="bottom">
					<button type="button" class="pf-lane__headbtn" aria-label="Share" onClick={share}>
						<ProfileIcon name="share" />
					</button>
				</Tooltip>
				<Tooltip content={saved.value ? onLabel : offLabel} placement="bottom">
					<button
						type="button"
						class="pf-lane__headbtn"
						data-on={saved.value ? "true" : undefined}
						aria-pressed={saved.value}
						aria-label={saved.value ? onLabel : offLabel}
						onClick={onToggleSaved}
					>
						<ProfileIcon name="star" />
					</button>
				</Tooltip>
				<Popover
					open={menuOpen}
					placement="bottom-end"
					class="pf-menu"
					avoid={SHELL_AVOID}
					allowOverflow={["bottom"]}
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="pf-lane__headbtn"
							data-open={api.expanded ? "true" : undefined}
							aria-label="More actions"
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							<ProfileIcon name="kebab" />
						</button>
					)}
				>
					{menuActions.map((action) => (
						<button
							key={action.key}
							type="button"
							role="menuitem"
							class="pf-lane__menu-item"
							data-danger={action.danger ? "true" : undefined}
							onClick={() => runAction(action.key)}
						>
							<ProfileIcon name={action.glyph} />
							<span>{action.label}</span>
						</button>
					))}
				</Popover>
			</div>
		</div>
	);
}
