import { MoneyView } from "../components/MoneyView.tsx";

/**
 * MoneyView, as a **default export** — the shape a Fresh island file must have.
 *
 * There is no second implementation here, and that is the point. `MoneyView` already resolves its
 * currency through props → request context → the shared signal store, so it is reactive wherever it
 * is hydrated and static wherever it is not. An island variant that re-implemented any of that would
 * be a second renderer to keep in step with the first, and the two would eventually disagree about a
 * price.
 *
 * Import this only where a default export is structurally required. Everywhere else, import
 * `{ MoneyView }` from `@projective/ui/display/money` — it is the same component.
 */
export default MoneyView;
