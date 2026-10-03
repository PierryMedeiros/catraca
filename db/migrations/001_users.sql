-- F01: contas (participantes criados em /signup; organizadores só pela seed).
CREATE TABLE users (
  id            text PRIMARY KEY CHECK (id ~ '^usr_[a-z0-9]{10}$'),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('participant', 'organizer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
