-- =============================================================================================
-- 00000031_tables_fk_scheduling.sql — trailing FK closure (Category 0).
--
-- The permitted `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (root CLAUDE.md §1), for the reason
-- the rule carves out: a genuine circular dependency.
--
--   scheduling.reschedule_proposals --reschedule_id--> scheduling.event_reschedules
--   scheduling.event_reschedules --resolved_proposal_id--> scheduling.reschedule_proposals
--
-- Each table references the other, so whichever is created second can carry its FK inline and the
-- first cannot. The proposals side is inline (00000022); this is the other half.
--
-- COMPOSITE, not a plain FK on resolved_proposal_id. A plain one would prove the winner is SOME
-- proposal; `(resolved_proposal_id, id) → (id, reschedule_id)` proves it is a proposal on THIS round,
-- which is the only thing "the slot that carried" can mean. It targets the
-- `uq_proposal_in_reschedule (id, reschedule_id)` key that already exists for the votes' own
-- composite FK. MATCH SIMPLE (the default), so an open round — winner NULL — is not checked at all.
--
-- No ON DELETE action: a winning proposal is part of the record of why an event is where it is, and
-- nothing in this schema hard-deletes it (root CLAUDE.md §5).
-- =============================================================================================

ALTER TABLE scheduling.event_reschedules
    ADD CONSTRAINT event_reschedules_resolved_proposal_fkey
    FOREIGN KEY (resolved_proposal_id, id)
    REFERENCES scheduling.reschedule_proposals (id, reschedule_id);
