/**
 * demo-modules — the four demos' lazy chunks and the stylesheets every demo surface needs
 * (`flows/LANDING.md` §4.4, §7; work orders L3 and L5). The demo stage's island (`DemoHost`) and
 * `/features`' "Try it" dialog (`FeatureDemoDialog`) both load demos through {@link DEMO_MODULES},
 * so a fifth demo, or a moved one, is one edit here and both surfaces ship the same chunks and the
 * same sheets.
 *
 * Imported by islands only: a stylesheet reaches a page through an island's module graph, never a
 * server component's. Each loader stays a dynamic `import()` of a module outside `islands/`, so each
 * demo is its own chunk (≤ 35 kB, `core/js-budget.ts`) that the server snapshot never evaluates.
 */
import "@ui/kanban/styles/kanban.css";
import "@ui/display/styles/money-view.css";
import "../../styles/lp-theatre.css";
import "../../styles/lp-demo.css";
import "../../styles/demos/board.css";
import "../../styles/demos/payments.css";
import "../../styles/demos/booking.css";
import "../../styles/demos/splits.css";
import type { DemoComponent, DemoId } from "../../core/demos/demo-contract.ts";
import { createModuleLoader, type ModuleLoader } from "../../core/demos/demo-loader.ts";

// #region Modules
/** A demo module: its default export is the demo (`core/demos/demo-contract.ts`). */
export interface DemoModule {
	default: DemoComponent;
}

/**
 * Every demo's chunk, imported only when a surface asks for it (the stage's open tab near the
 * viewport, or a pressed "Try it"), once per page, and tried again after a failed import.
 */
export const DEMO_MODULES: ModuleLoader<DemoId, DemoModule> = createModuleLoader<
	DemoId,
	DemoModule
>({
	board: () => import("./BoardDemo.demo.tsx"),
	payments: () => import("./PaymentsDemo.demo.tsx"),
	booking: () => import("./BookingDemo.demo.tsx"),
	splits: () => import("./TeamPayDemo.demo.tsx"),
});
// #endregion
