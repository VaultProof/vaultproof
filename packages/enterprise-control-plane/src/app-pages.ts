import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_SITE_ORIGIN = 'https://vaultproof.dev';

function rewriteStaticAssetUrls(html: string): string {
  return html
    .replaceAll('src="/js/', `src="${PUBLIC_SITE_ORIGIN}/js/`)
    .replaceAll('href="/css/', `href="${PUBLIC_SITE_ORIGIN}/css/`)
    .replaceAll('href="/favicon.png"', `href="${PUBLIC_SITE_ORIGIN}/favicon.png"`)
    .replaceAll('href="/terms"', `href="${PUBLIC_SITE_ORIGIN}/terms"`)
    .replaceAll('href="/privacy"', `href="${PUBLIC_SITE_ORIGIN}/privacy"`);
}

function readEnterpriseAppPage(filename: string): string {
  const html = readFileSync(join(process.cwd(), 'apps/site/app', filename), 'utf8');
  return rewriteStaticAssetUrls(html);
}

export function renderEnterpriseControlPage(): string {
  return readEnterpriseAppPage('control.html');
}

export function renderEnterpriseOrgPage(): string {
  return readEnterpriseAppPage('org.html');
}
