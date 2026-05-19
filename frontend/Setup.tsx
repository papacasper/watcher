import React, { useState } from "react";
import type { SetupState } from "./api.js";
import { getStatus, submitSetup } from "./api.js";

interface SetupProps {
  setup: SetupState;
  onComplete: () => void;
}

export function Setup({ setup, onComplete }: SetupProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [dashboardPassword, setDashboardPassword] = useState("");
  const [dividendTargetDaily, setDividendTargetDaily] = useState(String(setup.dividendTargetDaily));
  const [dailyCost, setDailyCost] = useState(String(setup.dailyCost));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function waitForRefresh() {
    for (let i = 0; i < 120; i++) {
      const status = await getStatus().catch(() => null);
      if (status?.refreshPhase === "approval_needed") {
        setMessage(status.refreshMessage ?? "Open Robinhood and approve the sign-in.");
      }
      if (status && !status.refreshing) {
        if (status.error) throw new Error(status.error);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Setup refresh timed out");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage("Signing in to Robinhood...");
    try {
      await submitSetup({
        username,
        password,
        ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}),
        dashboardPassword,
        dividendTargetDaily: parseFloat(dividendTargetDaily),
        dailyCost: parseFloat(dailyCost),
      });
      setMessage("Loading dashboard data...");
      await waitForRefresh();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="setup-page">
      <form className="setup-panel" onSubmit={submit}>
        <div className="setup-head">
          <div>
            <div className="setup-kicker">Watcher setup</div>
            <h1>Connect Robinhood</h1>
          </div>
          <i className="fa-solid fa-shield-halved" />
        </div>

        <label>
          <span>Robinhood username</span>
          <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required />
        </label>

        <label>
          <span>Robinhood password</span>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
        </label>

        <label>
          <span>MFA code</span>
          <input value={mfaCode} onChange={e => setMfaCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
        </label>

        <label>
          <span>Dashboard password</span>
          <input value={dashboardPassword} onChange={e => setDashboardPassword(e.target.value)} type="password" autoComplete="new-password" />
        </label>

        <div className="setup-grid">
          <label>
            <span>Daily dividend target</span>
            <input value={dividendTargetDaily} onChange={e => setDividendTargetDaily(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" />
          </label>
          <label>
            <span>Daily cost</span>
            <input value={dailyCost} onChange={e => setDailyCost(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" />
          </label>
        </div>

        {message && <div className="setup-note"><i className="fa-solid fa-circle-info" />{message}</div>}
        {error && <div className="setup-error"><i className="fa-solid fa-circle-exclamation" />{error}</div>}

        <button className="setup-submit" disabled={submitting} type="submit">
          <i className={submitting ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-arrow-right"} />
          {submitting ? "Connecting" : "Continue"}
        </button>
      </form>
    </div>
  );
}
