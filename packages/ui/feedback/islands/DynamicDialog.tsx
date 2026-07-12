import type { ComponentChildren, JSX, VNode } from "preact";
import { signal, type Signal } from "@preact/signals";
import { Dialog, type DialogProps } from "./Dialog.tsx";

// #region Types
/** Configuration for a programmatically-opened dialog. Mirrors {@link DialogProps} minus its binding. */
export interface DialogConfig extends Omit<DialogProps, "visible" | "children" | "onVisibleChange"> {
	/** Dialog body — a node or a factory (evaluated once at open). */
	content: ComponentChildren | (() => VNode);
	/** Invoked after the dialog has fully closed and been removed from the host. */
	onClose?: () => void;
}

/** Imperative handle returned by {@link useDialog}'s `open`. */
export interface DialogInstanceRef {
	/** Stable instance id. */
	id: string;
	/** Close the dialog (plays the exit transition, then unmounts). */
	close: () => void;
	/** Patch this dialog's config in place (e.g. swap header/content). */
	update: (patch: Partial<DialogConfig>) => void;
}

interface DialogRecord {
	id: string;
	visible: Signal<boolean>;
	config: Signal<DialogConfig>;
}
// #endregion

// #region Store
/** Module-level registry of live dynamic dialogs, rendered by {@link DialogHost}. */
const store = signal<DialogRecord[]>([]);
let seq = 0;
const EXIT_MS = 350;

/** Open a dialog imperatively; returns a handle to close/update it. */
function openDialog(config: DialogConfig): DialogInstanceRef {
	const id = `dyn-dialog-${++seq}`;
	const visible = signal(true);
	const cfg = signal(config);

	const remove = () => {
		store.value = store.value.filter((r) => r.id !== id);
		cfg.peek().onClose?.();
	};
	const close = () => {
		if (!visible.peek()) return;
		visible.value = false;
		setTimeout(remove, EXIT_MS);
	};
	const update = (patch: Partial<DialogConfig>) => {
		cfg.value = { ...cfg.value, ...patch };
	};

	store.value = [...store.value, { id, visible, config: cfg }];
	return { id, close, update };
}

/** Close every open dynamic dialog. */
function closeAll(): void {
	for (const r of store.value) r.visible.value = false;
	setTimeout(() => (store.value = []), EXIT_MS);
}
// #endregion

/** Service handle exposed by {@link useDialog}. */
export interface DialogService {
	/** Open a dialog; returns a {@link DialogInstanceRef}. */
	open: (config: DialogConfig) => DialogInstanceRef;
	/** Close all open dynamic dialogs. */
	closeAll: () => void;
}

/**
 * useDialog — a programmatic dialog service. Call `open(config)` to mount a {@link Dialog} imperatively
 * from anywhere in an island tree; it returns a handle whose `close()` plays the exit transition and
 * unmounts, and `update(patch)` re-configures it live. Requires a single {@link DialogHost} mounted
 * once near the app root. Signal-backed and self-contained — no context provider needed.
 */
export function useDialog(): DialogService {
	return { open: openDialog, closeAll };
}

// #region Host
/** One rendered dynamic-dialog record. */
function DynamicInstance({ rec }: { rec: DialogRecord }): JSX.Element {
	const cfg = rec.config.value;
	const { content, onClose: _onClose, ...dialogProps } = cfg;
	return (
		<Dialog
			{...dialogProps}
			visible={rec.visible}
			onVisibleChange={(v) => {
				if (!v) setTimeout(() => (store.value = store.value.filter((r) => r.id !== rec.id)), EXIT_MS);
			}}
		>
			{typeof content === "function" ? (content as () => VNode)() : content}
		</Dialog>
	);
}

/**
 * DialogHost — mounts once (near the app root) to render every dialog opened via {@link useDialog}.
 * Reads the shared signal store, so imperatively-opened dialogs appear/disappear reactively without a
 * provider. Renders nothing when no dynamic dialogs are open.
 */
export function DialogHost(): JSX.Element {
	return <>{store.value.map((rec) => <DynamicInstance key={rec.id} rec={rec} />)}</>;
}
// #endregion
