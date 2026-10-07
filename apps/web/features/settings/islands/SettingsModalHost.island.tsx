import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import type { UserContext } from "@projective/types/auth";
import { isSettingsSectionKey, type SettingsSectionKey } from "@projective/types/settings";
import { useEffectiveContext } from "@features/shell/core/effective-context.ts";
import { onOpenSettings } from "../core/settings-bridge.ts";
import { settingsHref } from "../core/settings-registry.ts";
import {
	readSettingsParam,
	settingsModalAllowed,
	withSettingsParam,
} from "../core/settings-url.ts";
import type { SettingsLocation } from "../components/SettingsNavigator.tsx";
import type { SettingsModalBodyProps } from "../components/SettingsModalBody.tsx";

/**
 * SettingsModalHost — phase one of the two-phase Settings engine (Decision #150): the contextual
 * modal, mounted once in every signed-in shell (`UserShell`), owning `?settings=<section>`.
 *
 * ## The URL contract (`core/settings-url.ts`)
 * - Arriving with `?settings=x` opens section x. A malformed value is stripped. On the console itself
 *   (`/settings/*`) the parameter is a request for that section's PAGE, so the host navigates there.
 * - Opening from a gear (`openSettings()` → the cancelable `pj:settings-open` event, claimed here)
 *   PUSHES an entry, so browser Back dismisses the modal. Moving between sections inside it REPLACES
 *   that entry, so a tour of eleven sections is still one Back away from the page.
 * - Closing removes the parameter and nothing else. When this host pushed the entry it steps back over
 *   it (same-document — see below); a modal that arrived in the URL is closed by a replace.
 *
 * ## Why Back never reloads the page
 * Fresh's client runtime stamps history entries `fClientNav: true` and reloads the document on a
 * `popstate` into one (partials are gone, Decision #52). Every entry this host writes carries
 * `fClientNav: false`, and the page's own entry is re-stamped before anything is pushed on top — the
 * `?tkv=` ticket host's proven recipe (Decision #95).
 *
 * The modal's contents are imported on first open, so a page that only renders a gear never pays for
 * the eleven sections or their stylesheets.
 */

export interface SettingsModalHostProps {
	/** The SSR chrome context; the dev persona axes are layered on in the browser. */
	context: UserContext;
}

/** The history marker: `pjSettings` names the section; `pjSettingsPushed` that this host pushed it. */
interface SettingsHistoryState {
	pjSettings?: string;
	pjSettingsPushed?: boolean;
	fClientNav?: boolean;
	[key: string]: unknown;
}

function historyState(): SettingsHistoryState {
	const state = history.state;
	return state && typeof state === "object" ? (state as SettingsHistoryState) : {};
}

function currentHref(): string {
	return location.pathname + location.search + location.hash;
}

type Body = (props: SettingsModalBodyProps) => JSX.Element;
type Header = (
	props: {
		section: SettingsSectionKey;
		titleId: string;
		onExpand: () => void;
		onClose: () => void;
	},
) => JSX.Element;

export default function SettingsModalHost(props: SettingsModalHostProps): JSX.Element | null {
	const effective = useEffectiveContext(props.context);
	const open = useSignal(false);
	const where = useSignal<SettingsLocation>({ section: "account", anchor: null });
	const focusRequest = useSignal(0);
	const body = useSignal<{ Body: Body; Header: Header } | null>(null);
	const searchRef = useRef<HTMLDivElement | null>(null);
	/** Set once the address bar has been read — until then the URL is the input, not the output. */
	const readyRef = useRef(false);

	// #region Loading
	async function ensureBody(): Promise<void> {
		if (body.peek()) return;
		const mod = await import("../components/SettingsModalBody.tsx");
		body.value = { Body: mod.default, Header: mod.SettingsModalHeader };
	}
	// #endregion

	// #region URL writes
	/** First open from a gear: pin the page's entry, then push the modal's. */
	function pushParam(section: SettingsSectionKey): void {
		const current = historyState();
		const next = withSettingsParam(currentHref(), section);
		if (current.pjSettings) {
			history.replaceState({ ...current, fClientNav: false, pjSettings: section }, "", next);
			return;
		}
		history.replaceState({ ...current, fClientNav: false }, "", currentHref());
		history.pushState(
			{ ...current, fClientNav: false, pjSettings: section, pjSettingsPushed: true },
			"",
			next,
		);
	}

	/** Moving between sections inside the open modal — never a new entry. */
	function replaceParam(section: SettingsSectionKey): void {
		if (readSettingsParam(location.search) === section) return;
		history.replaceState(
			{ ...historyState(), fClientNav: false, pjSettings: section },
			"",
			withSettingsParam(currentHref(), section),
		);
	}

	/** Remove the parameter: step back over our own entry, or replace one we did not push. */
	function dropParam(): void {
		if (readSettingsParam(location.search) === null) return;
		const state = historyState();
		if (state.pjSettingsPushed) {
			history.back();
			return;
		}
		const { pjSettings: _section, pjSettingsPushed: _pushed, ...rest } = state;
		history.replaceState(
			{ ...rest, fClientNav: false },
			"",
			withSettingsParam(currentHref(), null),
		);
	}
	// #endregion

	// #region Open / close
	function show(location: SettingsLocation, focus: boolean): void {
		where.value = location;
		if (focus) focusRequest.value += 1;
		void ensureBody();
		open.value = true;
	}

	/**
	 * Close and clean the address bar. Not gated on `open`: when Escape or the scrim dismisses the
	 * Dialog, it has already written `false` into the bound signal by the time `onVisibleChange` calls
	 * this — the parameter still has to go. `dropParam` is itself a no-op without one.
	 */
	function close(): void {
		if (open.peek()) open.value = false;
		dropParam();
	}

	function navigate(location: SettingsLocation, focus: boolean): void {
		where.value = location;
		if (focus) focusRequest.value += 1;
		replaceParam(location.section);
	}

	/**
	 * Expand to the console page. A `location.replace`, so the modal's own entry becomes the page —
	 * Back from the console lands on the page underneath, not on a modal reopening. Unsaved form
	 * drafts are already in session storage (`useSectionDraft`) and the page adopts them.
	 */
	function expand(): void {
		const { section, anchor } = where.peek();
		globalThis.location.replace(settingsHref(section, anchor));
	}
	// #endregion

	// #region URL → modal
	function syncFromUrl(): void {
		const raw = readSettingsParam(location.search);
		if (raw === null) {
			if (open.peek()) open.value = false;
			return;
		}
		if (!isSettingsSectionKey(raw)) {
			const { pjSettings: _s, pjSettingsPushed: _p, ...rest } = historyState();
			history.replaceState(
				{ ...rest, fClientNav: false },
				"",
				withSettingsParam(currentHref(), null),
			);
			return;
		}
		if (!settingsModalAllowed(location.pathname)) {
			if (location.pathname.startsWith("/settings")) globalThis.location.replace(settingsHref(raw));
			return;
		}
		// Pin the arrival entry so a later Back over a pushed section never reloads it.
		if (!historyState().pjSettings) {
			history.replaceState(
				{ ...historyState(), fClientNav: false, pjSettings: raw },
				"",
				currentHref(),
			);
		}
		show(
			{ section: raw, anchor: where.peek().section === raw ? where.peek().anchor : null },
			false,
		);
	}

	useEffect(() => {
		readyRef.current = true;
		syncFromUrl();
		const onPop = () => syncFromUrl();
		globalThis.addEventListener("popstate", onPop);
		const unsubscribe = onOpenSettings(({ section, anchor }) => {
			if (!settingsModalAllowed(location.pathname)) return false;
			if (open.peek()) navigate({ section, anchor: anchor ?? null }, false);
			else {
				pushParam(section);
				show({ section, anchor: anchor ?? null }, false);
			}
			return true;
		});
		return () => {
			globalThis.removeEventListener("popstate", onPop);
			unsubscribe();
		};
	}, []);
	// #endregion

	const loaded = body.value;
	const titleId = "stg-modal-title";
	return (
		<Dialog
			visible={open}
			onVisibleChange={(visible) => {
				if (!visible) close();
			}}
			width="var(--overlay-w-xl)"
			height="var(--overlay-h-lg)"
			class="stg-modal"
			initialFocusRef={searchRef}
			labelledBy={titleId}
			headerTemplate={() =>
				loaded
					? (
						<loaded.Header
							section={where.value.section}
							titleId={titleId}
							onExpand={expand}
							onClose={close}
						/>
					)
					: <h2 id={titleId} class="stg-modal__title">Settings</h2>}
		>
			{loaded
				? (
					<loaded.Body
						context={effective.value.context}
						location={where.value}
						focusRequest={focusRequest.value}
						onNavigate={navigate}
						onExpand={expand}
						onClose={close}
						searchRef={searchRef}
					/>
				)
				: <p class="stg-modal__loading" role="status">Loading settings…</p>}
		</Dialog>
	);
}
