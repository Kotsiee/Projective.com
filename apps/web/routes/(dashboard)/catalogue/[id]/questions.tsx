/**
 * `/catalogue/[id]/questions` — a service listing's buyer-questions builder. The controller lives
 * with its feature (`features/catalogue/routes/questions.tsx`); this file only places it in the
 * route tree.
 */
export { default, handler } from "@features/catalogue/routes/questions.tsx";
