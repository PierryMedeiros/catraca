-- F02: eventos do organizador (rascunho -> publicado -> cancelado).
CREATE TABLE events (
  id           text        PRIMARY KEY CHECK (id ~ '^evt_[a-z0-9]{10}$'),
  organizer_id text        NOT NULL REFERENCES users(id),
  name         text        NOT NULL CHECK (btrim(name) <> ''),
  starts_at    timestamptz NOT NULL,
  venue        text        NOT NULL CHECK (btrim(venue) <> ''),
  capacity     integer     NOT NULL CHECK (capacity >= 1),
  price_cents  integer     NOT NULL CHECK (price_cents > 0),
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

CREATE INDEX events_organizer_starts_idx ON events (organizer_id, starts_at);
CREATE INDEX events_status_starts_idx    ON events (status, starts_at);
