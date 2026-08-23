/**
 * Package-level re-export of the canonical dismissal hook.
 *
 * This module used to carry a SECOND, divergent copy of `useDismiss`: it had no `enabled` option and
 * used `stopPropagation` rather than `stopImmediatePropagation` on Escape. Because every fields
 * dropdown (Select, MultiSelect, TreeSelect, CascadeSelect, DatePicker, ColorPicker, AutoComplete,
 * SplitButton) imported it, none of them could take part in overlay-stack ownership even when a
 * caller wanted them to, and one Escape press closed a different surface depending on incidental
 * render order.
 *
 * The two are now one. The canonical hook's options are a strict superset of the old ones, so every
 * existing call site keeps working unchanged while gaining portal-aware containment
 * (`hooks/overlay-registry.ts`) and consistent Escape ownership.
 */
export { useDismiss } from "../../hooks/useDismiss.ts";
export type { DismissOptions } from "../../hooks/useDismiss.ts";
