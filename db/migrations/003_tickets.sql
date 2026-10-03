-- F03: ingressos (compra na vitrine e pela API de parceiros, gateway simulado).
-- Vagas ocupadas (R05) = status pending + confirmed. O vencimento do gateway
-- (gateway_due_at) vive no banco: o worker sobrevive a reinícios do app.
CREATE TABLE tickets (
  id              text        PRIMARY KEY CHECK (id ~ '^tkt_[a-z0-9]{10}$'),
  event_id        text        NOT NULL REFERENCES events(id),
  user_id         text        NULL REFERENCES users(id),
  buyer_email     text        NOT NULL,
  code            char(8)     NOT NULL CHECK (code ~ '^[A-Z0-9]{8}$'),
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  price_cents     integer     NOT NULL CHECK (price_cents > 0),
  channel         text        NOT NULL CHECK (channel IN ('web', 'partner')),
  card_last4      char(4)     NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  gateway_outcome text        NOT NULL CHECK (gateway_outcome IN ('approved', 'declined')),
  gateway_due_at  timestamptz NOT NULL,
  checked_in      boolean     NOT NULL DEFAULT false,
  checked_in_at   timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_code_key UNIQUE (code),
  CONSTRAINT tickets_channel_user_chk CHECK ((channel = 'web') = (user_id IS NOT NULL))
);

CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_pending_due_idx  ON tickets (gateway_due_at) WHERE status = 'pending';
CREATE INDEX tickets_user_created_idx ON tickets (user_id, created_at DESC);
