> The PR validation checklist every change is judged against (former root CLAUDE.md §9).

## 9. PR Validation Checklist

- [ ] No source-of-truth doc contradicted (or the doc was updated in the same PR).
- [ ] Schema change edited **in place** into the consolidated `vvvvtooo_type_purpose.sql` files (no
      new ALTER-on-top migration; columns folded into `CREATE TABLE`); each statement in its correct
      category; Zod + `documentation/database/*` updated together.
- [ ] Islands dumb; routes thin; services fat; aliases only.
- [ ] Pure CSS + BEM, token-only; Material lib only in `packages/ui/system/`.
- [ ] Separation-hierarchy, a11y overlays, reduced-motion, ARIA, responsive all satisfied.
- [ ] **No card-in-card**; no box around static content; no translucent region backgrounds; one
      separation device per boundary; no translucent `--primary` wash on an active navigation-rail
      item or middle-nav row — `--surface-2` / `--on-surface` (§3.6 · DESIGN_SYSTEM
      §B.4.2/§B.9.7).
- [ ] **No tagification** — non-actionable metadata is inline middot-separated text, not chips; no
      two adjacent non-interactive fills; a permitted chip or tag is a solid tonal step, never a
      translucent `--primary` wash (§3.7 · §B.11, §B.11.6).
- [ ] **Button Interaction Matrix** (§3.13 · §B.8.1) — each filled button takes its tier's fill:
      amber `severity="accent"` only for a commit inside a financial / conversion flow or the act
      that starts one; monochrome inverted for structural commitments; teal for major navigation
      active states and core workflow commits; utility actions
      `severity="neutral" variant="outlined"`; `accent` and `neutral` on `Button` only; two fills
      in one region only when hue-ranked amber + monochrome.
- [ ] **Typographic registers** honoured — no `--fw-bold`+ headings, no weight-only level splits,
      `tabular-nums` on changing figures (§3.8 · §A.4).
- [ ] **`backdrop-filter`** only in the three sanctioned cases, on a `::before` underlay (§3.9 ·
      §B.4.3).
- [ ] **Entity-view routes**: no third sticky column; the transaction lives only in the lane on
      desktop and only in the body below `--bp-md`; lane resolved by a URL slot resolver (§3.10 ·
      §D.7/§D.8).
- [ ] **Press feedback & contrast invariant** (§3.12 · §B.12) — a pressable control compresses via
      `transform` only; no interaction moves a box-model property; both reduced-motion channels set
      `transform: none`; every filled pair measures ≥ 4.5:1 in all four mode/contrast states, a
      mode-adaptive pair ≥ 7:1 in dark, and none narrows under high contrast;
      `--primary`/`--on-primary` are byte-identical in every state (§A.1.1); `--accent`/`--on-accent`
      meet ≥ 4.5:1 in all four states and ≥ 7:1 in dark, never narrow, never flip polarity, and blend
      hover/press toward a light pole, never `--on-surface` (§A.1.2); hover/active never lower a
      filled label's contrast nor push its fill under 3:1 against a surface it sits on (the light
      `--accent` fill excepted as a logged deviation, Decision #157 flag (b)).
- [ ] Lifecycle change reflected in `PRODUCT_MANAGEMENT.md`.
- [ ] Any new/changed simulatable axis mirrored in the Dev Context Switcher (`features/devtools/`) —
      `DevOverrides` field, `DevOption` list, panel control, and `reflect()` `data-dev-*` write
      (§5).
- [ ] `XXXX-XXXX` placeholders; RLS-aware queries.
- [ ] JSDoc + regions present; no meta-comments.
- [ ] Consistent with the §8 Resolved Decisions; any **new** cross-doc conflict is flagged + logged,
      not silently resolved.
- [ ] No page/business logic added before the foundational doc + package layer is in place.
