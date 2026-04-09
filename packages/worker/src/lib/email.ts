/**
 * Email service using Resend REST API.
 * Fire-and-forget — silently skips if RESEND_API_KEY is not set.
 */

const WELCOME_TEMPLATE_ID = '3ef5b171-c502-41b0-b7cc-99d765542ea4';
const AUDIENCE_ID = 'fe5eacc4-2785-4185-9433-ae85fa5281a0';

// Cached template so we only fetch once per isolate lifetime
let welcomeTemplate: { from: string; subject: string; html: string } | null = null;

async function fetchWelcomeTemplate(apiKey: string): Promise<typeof welcomeTemplate> {
  if (welcomeTemplate) return welcomeTemplate;
  const res = await fetch(`https://api.resend.com/templates/${WELCOME_TEMPLATE_ID}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json() as { from: string; subject: string; html: string };
  welcomeTemplate = { from: data.from, subject: data.subject, html: data.html };
  return welcomeTemplate;
}

export function sendWelcomeEmail(to: string, apiKey: string | undefined): void {
  if (!apiKey) return;

  fetchWelcomeTemplate(apiKey).then((tmpl) => {
    if (!tmpl) return;
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: tmpl.from, to, subject: tmpl.subject, html: tmpl.html }),
    });
  }).catch(() => {});
}

export function addToAudience(email: string, apiKey: string | undefined): void {
  if (!apiKey) return;

  fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, unsubscribed: false }),
  }).catch(() => {});
}
