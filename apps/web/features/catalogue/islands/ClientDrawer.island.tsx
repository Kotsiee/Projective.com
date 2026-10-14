import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/client-drawer.css";
import { Drawer } from "@projective/ui/feedback";
import { useMediaQuery } from "@projective/ui/navigation";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
	contextPanelDocked,
} from "@web/features/shell/core/context-panel-state.ts";
import { ClientDrawerBody } from "../components/clients/ClientDrawerBody.tsx";
import type { ClientReadScope } from "../core/client-model.ts";
import {
	type ClientSurface,
	dismissClient,
	markClientPanelMounted,
	revealClientPanel,
} from "../core/client-store.ts";
import { consoleReady, consoleUrl, startConsoleSync } from "../core/console-store.ts";
import { startWorkspaceSync, workspaceReady, workspaceUrl } from "../core/workspace-store.ts";
import type { ClientKey } from "../types/catalogue-types.ts";

/** Props for {@link ClientDrawer}. */
export interface ClientDrawerProps {
	surface: ClientSurface;
	/** What the board reads: the workspace's listing, or the console's scope. */
	scope: ClientReadScope;
	/** The buyer the server resolved from `?client=`. */
	client?: ClientKey;
}

/** The docked drawer's root id. */
export const CLIENT_DRAWER_ID = "cat-cdrawer";

/**
 * ClientDrawer — the client drawer, the middle-nav PANEL body on the console's Clients view and the
 * workspace's Clients tab whenever `?client=@handle` names a buyer. From 1280px it docks in the
 * frame; below that the same body slides over in a right-hand `Drawer` — driven by the shell's
 * `contextPanelDocked` / `contextDrawerOpen`, exactly as the conversation context panel is.
 *
 * Choosing a buyer reveals it; Close (the body's button, the slide-over's own dismissal, or dragging
 * the docked panel shut) drops `?client=` in place and returns focus to the row that opened it.
 * With no buyer chosen (after a close, or Back) it folds the docked column away for this page.
 */
export default function ClientDrawer(props: ClientDrawerProps): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const folded = useRef<boolean | null>(null);
	const wasOpen = useRef({ docked: false, drawer: false });
	const settled = useRef(false);
	const ready = props.surface === "console" ? consoleReady.value : workspaceReady.value;
	const client = ready
		? (props.surface === "console" ? consoleUrl.value.client : workspaceUrl.value.client)
		: props.client;

	useEffect(() => {
		if (props.surface === "console") {
			markClientPanelMounted();
			startConsoleSync();
		} else {
			startWorkspaceSync();
		}
		// The frame restores the viewer's remembered docked choice in its own (parent) mount effect,
		// which runs after this one; a buyer named in the address is shown over that choice.
		const reveal = setTimeout(() => {
			if (props.client) revealClientPanel();
			settled.current = true;
		}, 0);
		return () => clearTimeout(reveal);
	}, []);

	useEffect(() => {
		if (!client && folded.current === null) {
			folded.current = contextPanelDocked.peek();
			contextPanelDocked.value = false;
			contextDrawerOpen.value = false;
		} else if (client && folded.current !== null) {
			folded.current = null;
			revealClientPanel();
		}
	}, [client]);

	useSignalEffect(() => {
		const docked = contextPanelDocked.value;
		const drawer = contextDrawerOpen.value;
		const before = wasOpen.current;
		wasOpen.current = { docked, drawer };
		if (!settled.current) return;
		// Read the address as it is now: a close this island made has already dropped the buyer.
		const live = props.surface === "console"
			? consoleUrl.peek().client
			: workspaceUrl.peek().client;
		if (!live) return;
		const closedHere = inflow ? before.docked && !docked : before.drawer && !drawer;
		if (closedHere) dismissClient(props.surface, live);
	});

	const close = () => dismissClient(props.surface, client);
	const body = (scope: string) =>
		client
			? (
				<ClientDrawerBody
					key={client}
					surface={props.surface}
					handle={client}
					scope={props.scope}
					idBase={scope}
					onClose={scope === "docked" ? close : undefined}
				/>
			)
			: null;

	return (
		<>
			<aside id={CLIENT_DRAWER_ID} class="cat-cdrawer-panel" aria-label="Client">
				{inflow ? body("docked") : null}
			</aside>
			{!inflow && client && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header="Client"
					size="min(24rem, 100vw)"
					class="cat-cdrawer-sheet"
				>
					{body("drawer")}
				</Drawer>
			)}
		</>
	);
}
