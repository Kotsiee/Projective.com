import { useSignalEffect } from "@preact/signals";
import { useMemo } from "preact/hooks";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	createHandleChecker,
	type HandleChecker,
	type HandleFetcher,
} from "../core/handle-check.ts";

/**
 * useHandleCheck — the live `@handle` availability check for a form field.
 *
 * One {@link HandleChecker} per mounted form: feed it the field's (already lower-cased) value with
 * `input`, read `state` in render, `recheck` after a refused create, `reset` when the form closes.
 * Keystrokes are debounced inside the checker (`@web/utils/debounce.ts`), every probe is sequenced
 * so a slow answer cannot overwrite a newer one, and the claim rule (length, charset, reserved words)
 * is settled locally without a request — see `core/handle-check.ts` for the state machine.
 *
 * Any form that takes a handle binds this one (the create dialog today, the invite dialog next), so a
 * handle is judged the same way wherever it is typed. The checker is disposed when the component
 * unmounts, so a probe can never land in a form that is gone.
 *
 * @param fetcher The probe transport (default `WorkspaceService.checkHandle`); a test passes a stub.
 * @param delayMs The quiet period after the last keystroke, ms.
 */
export function useHandleCheck(
	fetcher: HandleFetcher = WorkspaceService.checkHandle,
	delayMs?: number,
): HandleChecker {
	const checker = useMemo(() => createHandleChecker({ fetcher, delayMs }), []);
	// Reads no signal, so it runs once on mount; its cleanup is the unmount.
	useSignalEffect(() => () => checker.dispose());
	return checker;
}
