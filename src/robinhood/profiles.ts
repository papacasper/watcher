/**
 * profiles.ts
 * User and investment profiles - mirrors robin_stocks.profiles
 */

import { auth } from "./auth.js";
import { fetchWithRetry } from "../utils/http.js";

const BASE_URL = "https://api.robinhood.com";

export interface BasicProfile {
  url: string;
  userName: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  phoneNumber: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  citizenship: string;
  citizenDestination: string;
  maritalStatus: string;
  numberOfDependents: number;
  emailVerified: boolean;
  identityVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface InvestmentProfile {
  url: string;
  "total Earnings": string;
  annualIncome: string;
  investmentExperience: string;
  "importantTo investing": string;
  "reactionTo investing": string;
  riskCapacity: string;
  investmentObjectives: string;
  "liquid net worth": string;
  "total net worth": string;
  "source of funds": string;
  "supports Charitable giving": boolean;
  "supports day trading": boolean;
  "funds with Robinhood": string;
}

export async function loadBasicProfile(info?: string): Promise<unknown> {
  const resp = await fetchWithRetry(`${ BASE_URL }/user/basic_info/`, {
    headers: auth.getHeaders()
  }, { retries: 2, label: "Robinhood basic profile" });

  if (!resp.ok) throw new Error(`Basic profile fetch failed: ${ resp.status }`);

  const data = await resp.json();
  return info ? (data as Record<string, unknown>)[info] : data;
}

export async function loadUserProfile(info?: string): Promise<unknown> {
  const resp = await fetchWithRetry(`${ BASE_URL }/user/`, {
    headers: auth.getHeaders()
  }, { retries: 2, label: "Robinhood user profile" });

  if (!resp.ok) throw new Error(`User profile fetch failed: ${ resp.status }`);

  const data = await resp.json();
  return info ? (data as Record<string, unknown>)[info] : data;
}

export async function loadInvestmentProfile(
  info?: string
): Promise<unknown> {
  const resp = await fetchWithRetry(`${ BASE_URL }/user/investment_profile/`, {
    headers: auth.getHeaders()
  }, { retries: 2, label: "Robinhood investment profile" });

  if (!resp.ok) throw new Error(`Investment profile fetch failed: ${ resp.status }`);

  const data = await resp.json();
  return info ? (data as Record<string, unknown>)[info] : data;
}

export async function loadSecurityProfile(
  info?: string
): Promise<unknown> {
  const resp = await fetchWithRetry(`${ BASE_URL }/user/security_profile/`, {
    headers: auth.getHeaders()
  }, { retries: 2, label: "Robinhood security profile" });

  if (!resp.ok) throw new Error(`Security profile fetch failed: ${ resp.status }`);

  const data = await resp.json();
  return info ? (data as Record<string, unknown>)[info] : data;
}

export async function buildUserProfile(): Promise<{
  basic: BasicProfile;
  investment: InvestmentProfile;
} | null> {
  try {
    const [basic, investment] = await Promise.all([
      loadBasicProfile() as Promise<BasicProfile>,
      loadInvestmentProfile() as Promise<InvestmentProfile>
    ]);

    return { basic, investment };
  } catch {
    return null;
  }
}

export default {
  loadBasicProfile,
  loadUserProfile,
  loadInvestmentProfile,
  loadSecurityProfile,
  buildUserProfile
};
