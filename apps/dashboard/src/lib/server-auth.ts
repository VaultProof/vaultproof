import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type DashboardAuthUser = {
  id: string;
  email: string;
};

type DashboardAuthResult =
  | { user: DashboardAuthUser; error?: never }
  | { user?: never; error: NextResponse };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

function csvList(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getAllowedEmails(): string[] {
  return [
    ...csvList(process.env.DASHBOARD_INTERNAL_ALLOWED_EMAILS),
    ...csvList(process.env.VAULTPROOF_INTERNAL_ADMIN_EMAILS),
  ];
}

function getAllowedDomains(): string[] {
  return [
    ...csvList(process.env.DASHBOARD_INTERNAL_ALLOWED_DOMAINS),
    ...csvList(process.env.VAULTPROOF_INTERNAL_ADMIN_DOMAINS),
  ].filter((domain) => !PUBLIC_EMAIL_DOMAINS.has(domain));
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function requireInternalDashboardUser(request: Request): Promise<DashboardAuthResult> {
  if (!supabase) {
    return { error: jsonError("Dashboard auth is not configured.", 503) };
  }

  const allowedEmails = getAllowedEmails();
  const allowedDomains = getAllowedDomains();
  if (!allowedEmails.length && !allowedDomains.length) {
    return { error: jsonError("Internal dashboard access allowlist is not configured.", 503) };
  }

  const token = bearerToken(request);
  if (!token) {
    return { error: jsonError("Sign in is required.", 401) };
  }

  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id || !user.email) {
    return { error: jsonError("Invalid dashboard session.", 401) };
  }

  const email = user.email.trim().toLowerCase();
  const domain = email.split("@").pop() || "";
  if (!allowedEmails.includes(email) && (!domain || !allowedDomains.includes(domain))) {
    return { error: jsonError("VaultProof employee access is required.", 403) };
  }

  return {
    user: {
      id: user.id,
      email,
    },
  };
}
