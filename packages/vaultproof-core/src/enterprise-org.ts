import { getEmailDomain, isValidDomain, normalizeDomain } from './organization.js';

export interface StartedOrganizationSsoBody {
  company_domain?: string | null;
  email?: string | null;
}

export interface ValidatedStartedOrganizationSsoInput {
  companyDomain: string;
  email: string | null;
}

export function validateStartedOrganizationSsoInput(
  body: StartedOrganizationSsoBody,
): { ok: true; value: ValidatedStartedOrganizationSsoInput } | { ok: false; error: string } {
  const companyDomain = normalizeDomain(body.company_domain || '');
  const email = (body.email || '').trim().toLowerCase() || null;
  const emailDomain = email && email.includes('@') ? getEmailDomain(email) : '';
  const effectiveDomain = companyDomain || emailDomain;

  if (!effectiveDomain || !isValidDomain(effectiveDomain)) {
    return { ok: false, error: 'company_domain must be a valid domain' };
  }

  if (email && emailDomain && emailDomain !== effectiveDomain) {
    return { ok: false, error: 'email must match company_domain when provided' };
  }

  return {
    ok: true,
    value: {
      companyDomain: effectiveDomain,
      email,
    },
  };
}
