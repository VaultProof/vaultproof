import type { Env } from '../types.js';
import { checkSiteTranslationRateLimit, rateLimitResponse } from '../lib/rate-limit.js';

const MAX_TEXTS = 80;
const MAX_TEXT_LENGTH = 2_000;
const MAX_TOTAL_CHARS = 16_000;

const TARGET_LANGS: Record<string, string> = {
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  'pt-BR': 'PT-BR',
  ru: 'RU',
  he: 'HE',
  ja: 'JA',
  'zh-CN': 'ZH',
};

interface TranslationRequestBody {
  targetLang?: unknown;
  texts?: unknown;
}

interface DeepLTranslateResponse {
  translations?: Array<{ text?: string }>;
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return Boolean(origin) && (allowedOrigins.includes('*') || allowedOrigins.includes(origin));
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function deepLBaseUrl(apiKey: string): string {
  return apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
}

export async function handleSiteTranslate(
  request: Request,
  env: Env,
  origin: string,
  allowedOrigins: string[],
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }
  if (!isAllowedOrigin(origin, allowedOrigins)) {
    return jsonError('Origin not allowed', 403);
  }
  if (!env.DEEPL_API_KEY) {
    return jsonError('Translation is not configured', 503);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  const rl = await checkSiteTranslationRateLimit(env, ip);
  if (!rl.ok) return rateLimitResponse(rl.retryAfter!);

  let body: TranslationRequestBody;
  try {
    body = (await request.json()) as TranslationRequestBody;
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const targetLang = typeof body.targetLang === 'string' ? body.targetLang : '';
  const deepLTargetLang = TARGET_LANGS[targetLang];
  if (!deepLTargetLang) {
    return jsonError('Unsupported target language', 400);
  }
  if (!Array.isArray(body.texts) || body.texts.length === 0 || body.texts.length > MAX_TEXTS) {
    return jsonError(`texts must contain 1-${MAX_TEXTS} strings`, 400);
  }

  const texts: string[] = [];
  let totalChars = 0;
  for (const item of body.texts) {
    if (typeof item !== 'string') return jsonError('texts must contain strings only', 400);
    const text = item.trim();
    if (!text || text.length > MAX_TEXT_LENGTH) {
      return jsonError(`each text must be 1-${MAX_TEXT_LENGTH} characters`, 400);
    }
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      return jsonError(`request exceeds ${MAX_TOTAL_CHARS} translated characters`, 400);
    }
    texts.push(text);
  }

  const res = await fetch(`${deepLBaseUrl(env.DEEPL_API_KEY)}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: texts,
      target_lang: deepLTargetLang,
      preserve_formatting: true,
    }),
  });

  if (!res.ok) {
    const status = res.status >= 500 ? 502 : 400;
    return jsonError('Translation provider rejected the request', status);
  }

  const data = (await res.json()) as DeepLTranslateResponse;
  const translations = (data.translations || []).map((item) => item.text || '');
  if (translations.length !== texts.length) {
    return jsonError('Translation provider returned an unexpected response', 502);
  }

  return Response.json({ translations });
}
