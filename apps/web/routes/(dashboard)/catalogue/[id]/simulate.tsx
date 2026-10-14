/**
 * `/catalogue/[id]/simulate` — the owner's buyer simulation, framed by the item workspace's Preview
 * tab. The controller lives with its feature (`features/catalogue/routes/simulate.tsx`); this file
 * only places it in the route tree.
 */
export { default, handler } from "@features/catalogue/routes/simulate.tsx";
