-- =============================================================================================
-- 00000032_tables_fk_projects_finance.sql — trailing FK closure (Category 0).
--
-- The permitted `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (root CLAUDE.md §1), for the reason
-- the rule carves out: a genuine circular dependency between the two schemas' table files.
--
--   finance.order_lines --stage_id--> projects.project_stages          (inline, 00000017)
--   finance.escrows --cohort_membership_id--> projects.cohort_memberships (inline, 00000017)
--   projects.cohort_memberships --order_line_id--> finance.order_lines  (this file)
--
-- `projects` is created before `finance`, so the membership cannot name the order line that paid for
-- its seat inline. SET NULL: the receipt and the seat outlive each other — an order line is never
-- deleted in practice (orders are soft-state), and a membership must not vanish with one if it were.
-- =============================================================================================

ALTER TABLE projects.cohort_memberships
    ADD CONSTRAINT cohort_memberships_order_line_fkey
    FOREIGN KEY (order_line_id)
    REFERENCES finance.order_lines (id) ON DELETE SET NULL;
