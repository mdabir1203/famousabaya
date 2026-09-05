-- Migration 0020: support ticket system (Phase 1 — data model + wa.me send)
--
-- The factory launcher gains a "Support" tab where operators create tickets
-- for things they can't fix themselves (login problems, app bugs, network
-- issues, hardware faults, catalog/roster data). Tickets are sent to the
-- office via a wa.me deep link (no Meta approval needed) and replies are
-- captured by an office-side whatsapp-web.js bot that POSTs back to the
-- Worker webhook (Phase 2). This migration is the data model only — the
-- Worker handlers, local server proxy, and Electron UI ship in v1.2.24.
--
-- Three tables:
--   tickets            — the canonical ticket (id, status, who/when/what)
--   ticket_events      — append-only audit log (created, sent, replied, etc.)
--   ticket_messages    — bidirectional message thread (operator ↔ office)
--
-- Status lifecycle (enforced in ticket.js handlers, not in SQL):
--   open  → pending (office replied) → resolved (operator or office)
--   open/pending → closed (auto after N days resolved; admin action)
--
-- emp_id is required to be e_bc_<digits> (AGENTS.md rule #1) so the ticket
-- audit log is consistent with the rest of the system. Tickets without a
-- roster id (e.g. "support" tickets from anonymous web visitors) would
-- need a different shape and are out of scope for v1.2.24.

CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT    PRIMARY KEY NOT NULL,               -- 'T-2026-09-04-abc123' (human-readable, sortable)
  created_at      INTEGER NOT NULL,                            -- unix sec
  created_by      TEXT    NOT NULL,                            -- e_bc_<digits>
  created_by_name TEXT,                                         -- denormalised name for display
  category        TEXT    NOT NULL,                            -- 'login'|'app'|'network'|'hardware'|'catalog'|'other'
  priority        TEXT    NOT NULL DEFAULT 'normal',           -- 'normal'|'urgent' (v1.2.24)
  subject         TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'open',             -- 'open'|'pending'|'resolved'|'closed'
  resolved_at     INTEGER,
  resolved_by     TEXT,                                          -- e_bc_<digits> or 'office' or 'system'
  whatsapp_to     TEXT,                                          -- the wa.me number it was sent to (E.164); null = not sent yet
  escalated_at    INTEGER,                                       -- when primary→fallback happened
  last_message_at INTEGER,                                       -- for sorting on the dashboard
  station         TEXT,                                          -- S-01..S-08 if known (from active_sessions at create time)
  updated_at      INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  ticket_id   TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event       TEXT    NOT NULL,                                  -- 'created'|'sent'|'replied'|'resolved'|'closed'|'reopened'|'escalated'|'note'
  actor       TEXT    NOT NULL,                                  -- e_bc_<digits> or 'office' or 'system' or 'bot'
  at          INTEGER NOT NULL,                                  -- unix sec
  note        TEXT
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  ticket_id     TEXT    NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  direction     TEXT    NOT NULL,                                -- 'out' (operator→office) | 'in' (office→operator)
  sender        TEXT    NOT NULL,                                -- e_bc_<digits> | 'office' | 'system'
  text          TEXT    NOT NULL,
  via           TEXT    NOT NULL DEFAULT 'wa.me',                -- 'wa.me' | 'whatsapp-web-bot' | 'launcher'
  wa_message_id TEXT,                                            -- Meta's wamid OR whatsapp-web.js message id (for dedup)
  sent_at       INTEGER NOT NULL                                 -- unix sec
);

-- Indexes (the local SQLite mirror mirrors these — see shared/sqlite-snapshot.cjs)
CREATE INDEX IF NOT EXISTS idx_tickets_status        ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at    ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by    ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_category      ON tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_priority      ON tickets(priority, status);  -- for "urgent open tickets" view
CREATE INDEX IF NOT EXISTS idx_tickets_last_message  ON tickets(last_message_at);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket  ON ticket_events(ticket_id, at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_dedup  ON ticket_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

-- Roster guard: same rule as the rest of the system. Tickets without an
-- e_bc_<digits> created_by are rejected at the API boundary. The trigger
-- is a last-line defense; the Worker handler is the primary check.
CREATE TRIGGER IF NOT EXISTS tickets_reject_synthetic_emp
BEFORE INSERT ON tickets
WHEN NEW.created_by NOT LIKE 'e_bc_%'
BEGIN
  SELECT RAISE(IGNORE);
END;
