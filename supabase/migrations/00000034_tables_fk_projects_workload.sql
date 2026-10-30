-- =============================================================================================
-- 00000034_tables_fk_projects_workload.sql — trailing FK closure (Category 0).
--
-- The permitted `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (root CLAUDE.md §1), for the reason
-- the rule carves out: a genuine circular dependency inside `00000015_tables_projects.sql`.
--
--   projects.ticket_workload_reports --ticket_id--> projects.tickets        (inline, 00000015)
--   projects.tickets --workload_report_id--> projects.ticket_workload_reports (this file)
--
-- `tickets` is created before the report table, so it cannot name the report suspending it inline.
-- SET NULL: a report cascades away with its ticket, never the other way round, and a ticket must not
-- point at a report that no longer exists (audit §5.1).
-- =============================================================================================

ALTER TABLE projects.tickets
    ADD CONSTRAINT tickets_workload_report_id_fkey
    FOREIGN KEY (workload_report_id)
    REFERENCES projects.ticket_workload_reports (id) ON DELETE SET NULL;
