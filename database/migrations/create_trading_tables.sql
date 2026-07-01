-- Trading module tables — owner-gated private capability inside the public app.
-- Convention: mirrors user_sources_config (user_id TEXT + RLS on app.current_user_id).
-- Guardrail (mission 08): no numerology anywhere — ids/keys via CSPRNG or serial, never ψ₀/φ.
-- trading_gate_results is CONCRETE (mirrors gate/run_gate.py output, PROVEN 2026-07-01).
-- positions / signatures / calibration are PROVISIONAL (schema per BLUEPRINT; no writers yet).

CREATE TABLE IF NOT EXISTS trading_gate_results (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    run_id TEXT NOT NULL,
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    dataset TEXT NOT NULL,                 -- e.g. synthetic_positive_ar1 | synthetic_negative_gbm | <real market slice>
    strategy TEXT NOT NULL,                -- e.g. momentum_1param | overfit_10param
    verdict TEXT NOT NULL CHECK (verdict IN ('PASS','KILL','WARN')),
    wfe NUMERIC,                           -- walk-forward efficiency (threshold > 0.70)
    dsr NUMERIC,                           -- deflated Sharpe ratio prob (threshold > 0.95)
    pbo NUMERIC,                           -- probability of backtest overfitting (threshold < 0.50)
    sr_hat NUMERIC,                        -- observed per-period Sharpe
    sr0 NUMERIC,                           -- deflation benchmark E[max SR | N trials]
    n_trials INTEGER,                      -- variants mined / selection-bias N
    seed INTEGER,
    details JSONB                          -- stage-by-stage extras, cost bps, thresholds used
);
CREATE INDEX IF NOT EXISTS idx_trading_gate_results_user ON trading_gate_results(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_gate_results_ts ON trading_gate_results(ts DESC);

CREATE TABLE IF NOT EXISTS trading_positions (
    id TEXT PRIMARY KEY DEFAULT 'pos_' || gen_random_uuid(),
    user_id TEXT NOT NULL DEFAULT 'local',
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    market TEXT NOT NULL,                  -- e.g. hyperliquid:BTC-PERP | kalshi:<ticker>
    side TEXT NOT NULL CHECK (side IN ('long','short')),
    size NUMERIC NOT NULL,
    entry_price NUMERIC,
    exit_price NUMERIC,
    pnl NUMERIC,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','killed')),
    strategy_id TEXT,
    details JSONB
);
CREATE INDEX IF NOT EXISTS idx_trading_positions_user ON trading_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_positions_status ON trading_positions(status);

CREATE TABLE IF NOT EXISTS trading_signatures (
    id TEXT PRIMARY KEY DEFAULT 'sig_' || gen_random_uuid(),
    user_id TEXT NOT NULL DEFAULT 'local',
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    definition JSONB NOT NULL,             -- detector/pattern spec (enrollment outcome-gated)
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','enrolled','decayed','killed')),
    outcome_stats JSONB                    -- realized hit-rate, decay curve
);
CREATE INDEX IF NOT EXISTS idx_trading_signatures_user ON trading_signatures(user_id);

CREATE TABLE IF NOT EXISTS trading_calibration (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    claim TEXT NOT NULL,                   -- the probabilistic claim being audited ("95% is 95% only if measured OOS")
    predicted NUMERIC NOT NULL,
    realized NUMERIC,
    n INTEGER,
    drift NUMERIC,
    details JSONB
);
CREATE INDEX IF NOT EXISTS idx_trading_calibration_user ON trading_calibration(user_id);

ALTER TABLE trading_gate_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_calibration ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY trading_gate_results_policy ON trading_gate_results
        FOR ALL USING (user_id = current_setting('app.current_user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY trading_positions_policy ON trading_positions
        FOR ALL USING (user_id = current_setting('app.current_user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY trading_signatures_policy ON trading_signatures
        FOR ALL USING (user_id = current_setting('app.current_user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY trading_calibration_policy ON trading_calibration
        FOR ALL USING (user_id = current_setting('app.current_user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE trading_gate_results IS 'Validation-gate verdicts (WFE/DSR/PBO conjunction) — the organism''s falsification record';
COMMENT ON TABLE trading_positions IS 'PROVISIONAL — no writer until gate ladder green + capital authorized';
COMMENT ON TABLE trading_signatures IS 'PROVISIONAL — detector enrollment is outcome-gated';
COMMENT ON TABLE trading_calibration IS 'PROVISIONAL — self-supervised calibration audit (learning_center)';
