-- =============================================================================================
-- 0306_staffing_enums.sql
-- US-004 · Stage Staffing & Assignment — enum groundwork.
--
-- Applications may now target a specific open seat (`projects.stage_open_seats`), not only a whole
-- stage or a staffing role. `ALTER TYPE ... ADD VALUE` must commit before the label can be used, so
-- the new value lives in its own migration file (its own transaction); the staffing engine that uses
-- it (0307) runs in a later transaction where the label is already durable.
-- =============================================================================================

ALTER TYPE projects.application_target_type ADD VALUE IF NOT EXISTS 'seat';
