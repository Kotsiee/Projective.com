import type { JSX } from "preact";
import { IS_DEV } from "@web/utils/dev.ts";
import MoneyFlowHost from "../islands/MoneyFlowHost.island.tsx";

/**
 * MoneyFlowMount — the single guarded entry point for the Money Flow debugger.
 *
 * Renders {@link MoneyFlowHost} **only in development**. Because {@link IS_DEV} is Vite's
 * statically-replaced `import.meta.env.DEV`, `if (!IS_DEV) return null` becomes an unconditional
 * `return null` in a production build, so the bundler tree-shakes the host, the `MoneyFlowPopover` it
 * renders and the whole `money-flow-state` module out of the shipped bundle.
 *
 * This is the same guard `features/devtools/components/DevMount.tsx` uses, deliberately copied rather
 * than improvised: the debugger reads live balances across every account the developer can switch to,
 * which is exactly the kind of thing that must not survive into production by accident.
 *
 * Mounted once in `routes/(dashboard)/_layout.tsx`, beside `ChatPopoutHost`, so the window is available
 * on every authenticated route and survives navigation between them.
 */
export function MoneyFlowMount(): JSX.Element | null {
	if (!IS_DEV) return null;
	return <MoneyFlowHost />;
}
