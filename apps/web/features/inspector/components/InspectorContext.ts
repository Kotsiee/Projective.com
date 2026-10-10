import { createContext } from "preact";
import { useContext } from "preact/hooks";

/** Workspace-wide actions any inspector component (a viewer's Controls included) may call. */
export interface InspectorActions {
	/** Whether the viewer is signed in; decides whether a download is recorded. */
	signedIn: boolean;
	/** Download the original (records the copy for a signed-in viewer first). */
	download(): void;
	/** Copy text to the clipboard, announce the outcome, and resolve whether it worked. */
	copy(text: string, confirmation: string): Promise<boolean>;
}

const DETACHED: InspectorActions = {
	signedIn: false,
	download: () => undefined,
	copy: () => Promise.resolve(false),
};

/** Provided by the workspace island around the stage and the panel. */
export const InspectorActionsContext = createContext<InspectorActions>(DETACHED);

/** The workspace's {@link InspectorActions}. */
export function useInspectorActions(): InspectorActions {
	return useContext(InspectorActionsContext);
}
