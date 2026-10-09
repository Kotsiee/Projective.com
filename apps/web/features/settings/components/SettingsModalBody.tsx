import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { UserContext } from "@projective/types/auth";
import type { SettingsSectionKey } from "@projective/types/settings";
import { isEditableTarget, isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { sectionMeta } from "../core/settings-registry.ts";
import { type SettingsLocation, SettingsNavigator } from "./SettingsNavigator.tsx";
import { useAttention } from "../hooks/useAttention.ts";
import { SettingsSectionView } from "./SettingsSectionView.tsx";

// #region Stylesheet carrier
// This module is lazily imported by the global host on first open, so the Settings stylesheets reach
// a page only once somebody opens Settings there.
import "../styles/settings.css";
import "../styles/settings-modal.css";
// #endregion

/**
 * SettingsModalBody — the inside of the contextual Settings modal (Decision #150): a header (the
 * "Settings" title, the active section as meta text, Expand to full page, Close) over a `Splitter`
 * whose left pane is the search + section tree and whose right pane is the active section.
 *
 * Loaded on demand by `SettingsModalHost` — so the eleven sections never ship with a page that only
 * wants a gear — and rendered inside the host's `Dialog` through `headerTemplate` and children.
 *
 * Below the modal's own container breakpoint the split becomes a drill-down: the tree fills the pane,
 * choosing a section slides to it, and "All settings" returns — the splitter's gutter is hidden
 * because there is nothing beside the pane to resize.
 */

export interface SettingsModalBodyProps {
	context: UserContext;
	location: SettingsLocation;
	/** Bumped when the person asked to move INTO the section. */
	focusRequest: number;
	onNavigate: (location: SettingsLocation, focus: boolean) => void;
	onExpand: () => void;
	onClose: () => void;
	/** The element the Dialog's initial focus resolves into (the search field). */
	searchRef: { current: HTMLDivElement | null };
}

/** The modal's header row — rendered through the Dialog's `headerTemplate`. */
export function SettingsModalHeader(
	props: {
		section: SettingsSectionKey;
		titleId: string;
		onExpand: () => void;
		onClose: () => void;
	},
): JSX.Element {
	return (
		<div class="stg-modal__head">
			<div class="stg-modal__titles">
				<h2 id={props.titleId} class="stg-modal__title">Settings</h2>
				<span class="stg-modal__meta" aria-live="polite">{sectionMeta(props.section).label}</span>
			</div>
			<div class="stg-modal__tools">
				<Tooltip content="Expand to full page" placement="top">
					<Button
						variant="text"
						severity="secondary"
						iconOnly
						icon={<Icon name="expand" size="sm" />}
						aria-label="Expand to full page"
						onClick={props.onExpand}
					/>
				</Tooltip>
				<Tooltip content="Close" placement="top">
					<Button
						variant="text"
						severity="secondary"
						iconOnly
						icon={<Icon name="close" size="sm" />}
						aria-label="Close settings"
						onClick={props.onClose}
					/>
				</Tooltip>
			</div>
		</div>
	);
}

export default function SettingsModalBody(props: SettingsModalBodyProps): JSX.Element {
	const query = useSignal("");
	const attention = useAttention(null, props.context.locale);
	/** Which pane the narrow (drill-down) layout shows. */
	const pane = useSignal<"nav" | "section">("section");
	const contentRef = useRef<HTMLDivElement>(null);

	// The Dialog places focus when it opens, which on a cold deep link is before this body has loaded —
	// so focus lands on the panel itself. Hand it to the search field once the body exists, unless the
	// person has already moved it somewhere meaningful (B.10.6 item 1).
	useEffect(() => {
		const active = document.activeElement as HTMLElement | null;
		const stranded = !active || active === document.body ||
			active.classList.contains("ui-dialog__panel");
		if (stranded) props.searchRef.current?.querySelector<HTMLInputElement>("input")?.focus();
	}, []);

	// `/` focuses the search unless the person is typing; Cmd/Ctrl+K stays the command palette's.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!isFocusSearchShortcut(event) || isEditableTarget(event.target as Element | null)) return;
			const input = props.searchRef.current?.querySelector<HTMLInputElement>("input");
			if (!input) return;
			event.preventDefault();
			pane.value = "nav";
			input.focus();
			input.select();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	function navigate(location: SettingsLocation, focus: boolean): void {
		pane.value = "section";
		contentRef.current?.scrollTo?.({ top: 0 });
		props.onNavigate(location, focus);
	}

	return (
		<div class="stg-modal__body" data-pane={pane.value}>
			<Splitter layout="horizontal" stateKey="settings-modal-split" class="stg-modal__split">
				<SplitterPanel size={28} minSize={20} maxSize={40} class="stg-modal__navpane">
					<nav class="stg-modal__nav" aria-label="Settings">
						<SettingsNavigator
							context={props.context}
							selected={props.location}
							query={query}
							marks={attention.marks}
							searchRef={props.searchRef}
							onSelect={navigate}
						/>
					</nav>
				</SplitterPanel>
				<SplitterPanel size={72} minSize={60} maxSize={80} class="stg-modal__contentpane">
					<div ref={contentRef} class="stg-modal__content">
						<Button
							class="stg-modal__back"
							variant="text"
							size="sm"
							severity="secondary"
							label="All settings"
							icon={<Icon name="chevron-left" size="sm" />}
							onClick={() => {
								pane.value = "nav";
								props.searchRef.current?.querySelector<HTMLInputElement>("input")?.focus();
							}}
						/>
						<SettingsSectionView
							section={props.location.section}
							anchor={props.location.anchor}
							focusRequest={props.focusRequest}
							mode="modal"
							context={props.context}
							onEscalate={() => props.onExpand()}
							onOpenSection={(section, anchor) =>
								navigate({ section, anchor: anchor ?? null }, false)}
						/>
					</div>
				</SplitterPanel>
			</Splitter>
		</div>
	);
}
