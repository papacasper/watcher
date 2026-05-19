/**
 * auth.ts
 * Robinhood authentication - mirrors robin_stocks.authentication
 */

import {
  loadAuthCache,
  removeAuthCache,
  saveAuthCache as persistAuthCache,
} from "./token-cache.js";
import { fetchWithRetry } from "../utils/http.js";

export interface RobinhoodCredentials {
  username: string;
  password: string;
  mfaCode?: string;
}

export interface AuthToken {
  accessToken: string;
  tokenType: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  detail?: string;
}

export interface AuthState {
  loggedIn: boolean;
  accessToken: string | null;
  tokenType: string | null;
  refreshToken: string | null;
  deviceToken: string | null;
  expiresAt: number | null;
}

export type RobinhoodAuthMilestone = "approval_needed";

export interface RobinhoodAuthEvent {
  milestone: RobinhoodAuthMilestone;
  message: string;
}

export interface RobinhoodLoginOptions {
  onMilestone?: (event: RobinhoodAuthEvent) => void;
}

const BASE_URL = "https://api.robinhood.com";
const CLIENT_ID = "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS";
const AUTH_TIMEOUT_MS = 20_000;
const AUTH_POLL_TIMEOUT_MS = 10_000;

let authState: AuthState = {
  loggedIn: false,
  accessToken: null,
  tokenType: null,
  refreshToken: null,
  deviceToken: null,
  expiresAt: null
};

function generateDeviceToken(): string {
  const rands = Array.from(crypto.getRandomValues(new Uint8Array(16)));
  const hexa = Array.from({ length: 256 }, (_, i) => (i + 256).toString(16).slice(1));
  let token = "";
  for (let i = 0; i < rands.length; i++) {
    token += hexa[rands[i]!];
    if ([3, 5, 7, 9].includes(i)) token += "-";
  }
  return token;
}


function loadCachedAuth(): boolean {
  const cached = loadAuthCache<AuthState & { expiresAt: number }>();
  if (cached?.expiresAt && Date.now() < cached.expiresAt) {
    authState = cached;
    return true;
  }

  return false;
}

function saveAuthCache(): void {
  persistAuthCache(authState);
}

function setAuthHeaders(): Record<string, string> {
  if (!authState.accessToken) {
    throw new Error("Not authenticated. Call login() first.");
  }
  return {
    "Authorization": `${ authState.tokenType } ${ authState.accessToken }`,
    "Content-Type": "application/json",
    "X-Client-Id": CLIENT_ID,
    "device_token": authState.deviceToken ?? ""
  };
}

export class RobinhoodAuth {
  private credentials?: RobinhoodCredentials;

  constructor() {
    // Try to load cached session on startup
    loadCachedAuth();
  }

  async login(credentials: RobinhoodCredentials, options: RobinhoodLoginOptions = {}): Promise<AuthToken> {
    this.credentials = credentials;

    // If cached token is still valid, verify it works and skip re-login
    if (authState.loggedIn && authState.accessToken && authState.expiresAt && Date.now() < authState.expiresAt) {
      const probe = await fetchWithRetry(
        `${BASE_URL}/positions/?nonzero=true`,
        { headers: setAuthHeaders() },
        { timeoutMs: AUTH_POLL_TIMEOUT_MS, retries: 1, label: "Robinhood cached-session probe" }
      );
      if (probe.ok) {
        return {
          accessToken: authState.accessToken!,
          tokenType: authState.tokenType!,
          refreshToken: authState.refreshToken!,
          expiresIn: Math.floor((authState.expiresAt! - Date.now()) / 1000),
          scope: "internal",
          detail: "logged in using cached session",
        };
      }
      // Token expired server-side — fall through to refresh attempt
    }

    // Try refresh_token grant before falling back to full login
    if (authState.refreshToken) {
      try {
        await this.refreshTokens();
        return {
          accessToken: authState.accessToken!,
          tokenType: authState.tokenType!,
          refreshToken: authState.refreshToken!,
          expiresIn: Math.floor((authState.expiresAt! - Date.now()) / 1000),
          scope: "internal",
          detail: "logged in using refreshed token",
        };
      } catch {
        // Refresh token expired — fall through to full login
      }
    }

    // Reuse saved device token so Robinhood skips verification on repeat logins
    const deviceToken = authState.deviceToken ?? generateDeviceToken();

    const loginPayload: Record<string, string | number> = {
      client_id: CLIENT_ID,
      expires_in: 86400,
      grant_type: "password",
      password: credentials.password,
      scope: "internal",
      username: credentials.username,
      device_token: deviceToken,
    };

    if (credentials.mfaCode) {
      loginPayload["mfa_code"] = credentials.mfaCode;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Id": CLIENT_ID,
    };

    let resp = await fetchWithRetry(`${BASE_URL}/oauth2/token/`, {
      method: "POST",
      headers,
      body: JSON.stringify(loginPayload),
    }, { timeoutMs: AUTH_TIMEOUT_MS, retries: 1, label: "Robinhood login" });

    // Robinhood challenge flow: new device needs verification
    if (resp.status === 403) {
      const body = await resp.json() as { verification_workflow?: { id: string } };
      const workflowId = body.verification_workflow?.id;
      if (!workflowId) throw new Error(`Robinhood login failed: 403 ${JSON.stringify(body)}`);

      // Step 1: initiate the user-machine flow to get a machine_id
      const machineResp = await fetchWithRetry(`${BASE_URL}/pathfinder/user_machine/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceToken, flow: "suv", input: { workflow_id: workflowId } }),
      }, { timeoutMs: AUTH_TIMEOUT_MS, retries: 1, label: "Robinhood verification machine" });
      const machineData = await machineResp.json() as { id?: string };
      const machineId = machineData.id;
      if (!machineId) throw new Error(`Failed to get machine_id: ${JSON.stringify(machineData)}`);

      // Step 2: poll inquiries until sheriff_challenge appears (max 2 min)
      const inquiriesUrl = `${BASE_URL}/pathfinder/inquiries/${machineId}/user_view/`;
      let challengeId: string | undefined;
      let challengeType: string = "sms";
      const deadline = Date.now() + 120_000;

      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const inq = await fetchWithRetry(inquiriesUrl, {}, {
          timeoutMs: AUTH_POLL_TIMEOUT_MS,
          retries: 1,
          label: "Robinhood verification inquiry",
        }).then(r => r.json()) as {
          context?: { sheriff_challenge?: { id: string; type: string; status: string } };
        };
        const challenge = inq.context?.sheriff_challenge;
        if (challenge) {
          challengeId = challenge.id;
          challengeType = challenge.type ?? "sms";
          console.log(`Challenge type: ${challengeType}`);
          break;
        }
      }

      if (!challengeId) throw new Error("Timed out waiting for Robinhood verification challenge");

      // Step 3: in-app push approval
      if (challengeType !== "prompt") {
        throw new Error(`Unexpected challenge type "${challengeType}" — only in-app approval is supported`);
      }
      console.log("Check the Robinhood app and tap Approve…");
      options.onMilestone?.({
        milestone: "approval_needed",
        message: "Open Robinhood and tap Approve to refresh Watcher.",
      });
      const pushUrl = `${BASE_URL}/push/${challengeId}/get_prompts_status/`;
      let approved = false;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const status = await fetchWithRetry(pushUrl, {}, {
          timeoutMs: AUTH_POLL_TIMEOUT_MS,
          retries: 1,
          label: "Robinhood push status",
        }).then(r => r.json()) as { challenge_status?: string };
        if (status.challenge_status === "validated") { approved = true; break; }
      }
      if (!approved) throw new Error("Timed out waiting for in-app approval");

      // Step 4: confirm workflow approval via pathfinder
      let workflowApproved = false;
      while (Date.now() < deadline) {
        try {
          const wf = await fetchWithRetry(inquiriesUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sequence: 0, user_input: { status: "continue" } }),
          }, { timeoutMs: AUTH_POLL_TIMEOUT_MS, retries: 1, label: "Robinhood workflow approval" }).then(r => r.json()) as {
            type_context?: { result?: string };
            verification_workflow?: { workflow_status?: string };
          };
          const result = wf.type_context?.result ?? wf.verification_workflow?.workflow_status;
          if (result === "workflow_status_approved") { workflowApproved = true; break; }
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!workflowApproved) console.warn("Workflow approval timed out — proceeding anyway");

      // Step 5: retry token request (device token is now verified server-side)
      resp = await fetchWithRetry(`${BASE_URL}/oauth2/token/`, {
        method: "POST",
        headers,
        body: JSON.stringify(loginPayload),
      }, { timeoutMs: AUTH_TIMEOUT_MS, retries: 1, label: "Robinhood login retry" });
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.debug(`Robinhood login failed (${resp.status}):`, body.slice(0, 500));
      throw new Error(`Robinhood login failed: ${resp.status}`);
    }

    const data = await resp.json() as {
      access_token: string;
      token_type: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      detail?: string;
    };

    authState = {
      loggedIn: true,
      accessToken: data.access_token,
      tokenType: data.token_type,
      refreshToken: data.refresh_token,
      deviceToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    saveAuthCache();

    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
      detail: data.detail ?? `Logged in as ${credentials.username}`,
    };
  }

  private async refreshTokens(): Promise<void> {
    const resp = await fetchWithRetry(`${BASE_URL}/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: authState.refreshToken,
        client_id: CLIENT_ID,
        device_token: authState.deviceToken ?? "",
      }),
    }, { timeoutMs: AUTH_TIMEOUT_MS, retries: 1, label: "Robinhood token refresh" });
    if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
    const data = await resp.json() as {
      access_token: string;
      token_type: string;
      refresh_token: string;
      expires_in: number;
    };
    authState = {
      ...authState,
      loggedIn: true,
      accessToken: data.access_token,
      tokenType: data.token_type,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    saveAuthCache();
  }

  logout(): void {
    authState = {
      loggedIn: false,
      accessToken: null,
      tokenType: null,
      refreshToken: null,
      deviceToken: null,
      expiresAt: null
    };
    removeAuthCache();
  }

  isLoggedIn(): boolean {
    return authState.loggedIn && !!authState.accessToken;
  }

  getHeaders(): Record<string, string> {
    return setAuthHeaders();
  }

  getAccessToken(): string | null {
    return authState.accessToken;
  }
}

export const auth = new RobinhoodAuth();

export default RobinhoodAuth;
