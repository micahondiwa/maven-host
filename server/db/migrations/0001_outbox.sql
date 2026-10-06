-- PostgreSQL 10-compatible durable outbox; preserves source identifiers and state values.
CREATE TABLE core_events_outbox (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL UNIQUE,
 occurred_at timestamptz NOT NULL,
 event_name varchar(150) NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 dedupe_key varchar(255) UNIQUE,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 locked_at timestamptz,
 last_error text NOT NULL DEFAULT '',
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX outbox_available ON core_events_outbox(status,available_at);
CREATE INDEX outbox_event_status ON core_events_outbox(event_name,status);
