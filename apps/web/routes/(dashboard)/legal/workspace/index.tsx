/** `/legal/workspace` — the signed-in IP workspace (ruling (a), Decision #270), behind the `(dashboard)` guard. */
export {
	workspaceHandler as handler,
	WorkspacePage as default,
} from "@features/legal/workspace/routes/LegalWorkspaceScreens.tsx";
