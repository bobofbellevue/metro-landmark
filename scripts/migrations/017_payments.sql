-- Operator payment ledger (roadmap E4).
-- Records rent, deposits, and fees against a lease. Stripe session id is
-- optional so Checkout can be added when STRIPE_SECRET_KEY is set.
CREATE TABLE IF NOT EXISTS payments (
  payment_id SERIAL PRIMARY KEY,
  pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
  lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
  kind VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE,
  paid_at TIMESTAMP,
  method VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'due',
  memo TEXT,
  period_label VARCHAR(32),
  stripe_checkout_session_id VARCHAR(255),
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payments_kind_check CHECK (
    kind IN ('rent', 'deposit', 'fee', 'other')
  ),
  CONSTRAINT payments_status_check CHECK (
    status IN ('due', 'paid', 'void')
  ),
  CONSTRAINT payments_method_check CHECK (
    method IS NULL OR method IN ('cash', 'check', 'ach', 'card', 'other')
  ),
  CONSTRAINT payments_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payments_pmc ON payments (pmc_id);
CREATE INDEX IF NOT EXISTS idx_payments_lease ON payments (lease_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_due ON payments (status, due_date);
