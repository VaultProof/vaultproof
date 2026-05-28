import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';
import {
  ENTERPRISE_APP_SHELL_THEME,
  renderEnterpriseAppSidebar,
  type EnterpriseAppNavPage,
} from './enterprise-app-shell.js';

const PUBLIC_SITE_ORIGIN = 'https://vaultproof.dev';
const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing. Sign in again to continue.';
const DEMO_SUPABASE_CALLBACK_URL = 'https://gwzkjiomemjlhtrdrlan.supabase.co/auth/v1/callback';

type EnterpriseProviderPreset = {
  readonly id: string;
  readonly upstream: string;
  readonly header: string;
  readonly template: string;
  readonly demoPath?: string;
  readonly emailPath?: string;
  readonly extraHeaders?: Record<string, string>;
};

const ENTERPRISE_PROVIDER_SLOT_PRESETS: readonly EnterpriseProviderPreset[] = [
  { id: 'generic-bearer', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'generic-header', upstream: '', header: 'x-api-key', template: '{key}', demoPath: '/' },
  { id: 'generic-basic', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/' },
  { id: 'openai', upstream: 'https://api.openai.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'anthropic', upstream: 'https://api.anthropic.com', header: 'x-api-key', template: '{key}', demoPath: '/v1/messages', extraHeaders: { 'anthropic-version': '2023-06-01' } },
  { id: 'minimax', upstream: 'https://api.minimax.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1' },
  { id: 'groq', upstream: 'https://api.groq.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/openai/v1/models' },
  { id: 'xai', upstream: 'https://api.x.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'openrouter', upstream: 'https://openrouter.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v1/models' },
  { id: 'deepseek', upstream: 'https://api.deepseek.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'deepl', upstream: 'https://api-free.deepl.com', header: 'authorization', template: 'DeepL-Auth-Key {key}', demoPath: '/v2/usage' },
  { id: 'deepl-pro', upstream: 'https://api.deepl.com', header: 'authorization', template: 'DeepL-Auth-Key {key}', demoPath: '/v2/usage' },
  { id: 'mistral', upstream: 'https://api.mistral.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'together', upstream: 'https://api.together.xyz', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'fireworks', upstream: 'https://api.fireworks.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/inference/v1/models' },
  { id: 'cohere', upstream: 'https://api.cohere.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/models' },
  { id: 'replicate', upstream: 'https://api.replicate.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'huggingface', upstream: 'https://api-inference.huggingface.co', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'perplexity', upstream: 'https://api.perplexity.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/models' },
  { id: 'cerebras', upstream: 'https://api.cerebras.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'stability', upstream: 'https://api.stability.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/user/account' },
  { id: 'voyage', upstream: 'https://api.voyageai.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'jina', upstream: 'https://api.jina.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'ai21', upstream: 'https://api.ai21.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/studio/v1/models' },
  { id: 'assemblyai', upstream: 'https://api.assemblyai.com', header: 'authorization', template: '{key}', demoPath: '/v2' },
  { id: 'azure-openai', upstream: '', header: 'api-key', template: '{key}', demoPath: '/openai/models?api-version=2024-06-01' },
  { id: 'nvidia', upstream: 'https://integrate.api.nvidia.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'sambanova', upstream: 'https://api.sambanova.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
  { id: 'fal', upstream: 'https://queue.fal.run', header: 'authorization', template: 'Key {key}', demoPath: '/' },
  { id: 'luma', upstream: 'https://api.lumalabs.ai', header: 'authorization', template: 'Bearer {key}', demoPath: '/dream-machine/v1/generations' },
  { id: 'brave-search', upstream: 'https://api.search.brave.com', header: 'x-subscription-token', template: '{key}', demoPath: '/res/v1/web/search' },
  { id: 'serper', upstream: 'https://google.serper.dev', header: 'x-api-key', template: '{key}', demoPath: '/search' },
  { id: 'unstructured', upstream: 'https://api.unstructuredapp.io', header: 'unstructured-api-key', template: '{key}', demoPath: '/general/v0/general' },
  { id: 'elevenlabs', upstream: 'https://api.elevenlabs.io', header: 'xi-api-key', template: '{key}', demoPath: '/v1/user' },
  { id: 'pinecone', upstream: 'https://api.pinecone.io', header: 'api-key', template: '{key}', demoPath: '/indexes' },
  { id: 'clerk', upstream: 'https://api.clerk.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/users' },
  { id: 'resend', upstream: 'https://api.resend.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/emails' },
  { id: 'sendgrid', upstream: 'https://api.sendgrid.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/v3/mail/send' },
  { id: 'brevo', upstream: 'https://api.brevo.com', header: 'api-key', template: '{key}', emailPath: '/v3/smtp/email' },
  { id: 'sendinblue', upstream: 'https://api.brevo.com', header: 'api-key', template: '{key}', emailPath: '/v3/smtp/email' },
  { id: 'sparkpost', upstream: 'https://api.sparkpost.com', header: 'authorization', template: '{key}', emailPath: '/api/v1/transmissions' },
  { id: 'mailersend', upstream: 'https://api.mailersend.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/v1/email' },
  { id: 'elasticemail', upstream: 'https://api.elasticemail.com', header: 'x-elasticemail-apikey', template: '{key}', emailPath: '/v4/emails' },
  { id: 'mailjet', upstream: 'https://api.mailjet.com', header: 'authorization', template: 'Basic {key}', emailPath: '/v3.1/send' },
  { id: 'zeptomail', upstream: 'https://api.zeptomail.com', header: 'authorization', template: 'Zoho-enczapikey {key}', emailPath: '/v1.1/email' },
  { id: 'smtp2go', upstream: 'https://api.smtp2go.com', header: 'x-smtp2go-api-key', template: '{key}', emailPath: '/v3/email/send' },
  { id: 'mailtrap', upstream: 'https://send.api.mailtrap.io', header: 'api-token', template: '{key}', emailPath: '/api/send' },
  { id: 'mailerlite', upstream: 'https://connect.mailerlite.com/api', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'loops', upstream: 'https://app.loops.so/api/v1', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'courier', upstream: 'https://api.courier.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'customerio', upstream: 'https://api.customer.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'postageapp', upstream: 'https://api.postageapp.com', header: 'x-postage-server-token', template: '{key}', demoPath: '/' },
  { id: 'sender', upstream: 'https://api.sender.net', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'sendlayer', upstream: 'https://console.sendlayer.com/api', header: 'x-api-key', template: '{key}', demoPath: '/' },
  { id: 'ahasend', upstream: 'https://api.ahasend.com', header: 'x-api-key', template: '{key}', demoPath: '/' },
  { id: 'mailgun', upstream: 'https://api.mailgun.net', header: 'authorization', template: 'Basic {key}', emailPath: '/v3/example.com/messages' },
  { id: 'postmark', upstream: 'https://api.postmarkapp.com', header: 'x-postmark-server-token', template: '{key}', emailPath: '/email' },
  { id: 'aws-ses', upstream: 'https://email.us-east-1.amazonaws.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/' },
  { id: 'stripe', upstream: 'https://api.stripe.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/customers' },
  { id: 'twilio', upstream: 'https://api.twilio.com', header: 'authorization', template: 'Basic {key}', demoPath: '/2010-04-01/Accounts.json' },
  { id: 'linear', upstream: 'https://api.linear.app', header: 'authorization', template: '{key}', demoPath: '/graphql' },
  { id: 'notion', upstream: 'https://api.notion.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/users/me', extraHeaders: { 'notion-version': '2022-06-28' } },
  { id: 'github', upstream: 'https://api.github.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/user' },
  { id: 'gitlab', upstream: 'https://gitlab.com', header: 'private-token', template: '{key}', demoPath: '/api/v4/user' },
  { id: 'bitbucket', upstream: 'https://api.bitbucket.org', header: 'authorization', template: 'Bearer {key}', demoPath: '/2.0/user' },
  { id: 'circleci', upstream: 'https://circleci.com', header: 'circle-token', template: '{key}', demoPath: '/api/v2/me' },
  { id: 'buildkite', upstream: 'https://api.buildkite.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/user' },
  { id: 'dockerhub', upstream: 'https://hub.docker.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/user/' },
  { id: 'quay', upstream: 'https://quay.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v1/user/' },
  { id: 'npm-registry', upstream: 'https://registry.npmjs.org', header: 'authorization', template: 'Bearer {key}', demoPath: '/-/whoami' },
  { id: 'supabase', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/rest/v1/', extraHeaders: { apikey: '{key}' } },
  { id: 'newrelic', upstream: 'https://api.newrelic.com', header: 'api-key', template: '{key}', demoPath: '/' },
  { id: 'sentry', upstream: 'https://sentry.io/api', header: 'authorization', template: 'Bearer {key}', demoPath: '/0/' },
  { id: 'betterstack', upstream: 'https://uptime.betterstack.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v2/monitors' },
  { id: 'logsnag', upstream: 'https://api.logsnag.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/projects' },
  { id: 'raygun', upstream: 'https://api.raygun.com', header: 'x-api-key', template: '{key}', demoPath: '/v3/applications' },
  { id: 'semgrep', upstream: 'https://semgrep.dev', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/agent/deployments/current' },
  { id: 'sonarcloud', upstream: 'https://sonarcloud.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/authentication/validate' },
  { id: 'planetscale', upstream: 'https://api.planetscale.com', header: 'authorization', template: '{key}', demoPath: '/' },
  { id: 'neon', upstream: 'https://console.neon.tech/api', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/projects' },
  { id: 'upstash', upstream: 'https://api.upstash.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'qdrant', upstream: '', header: 'api-key', template: '{key}', demoPath: '/collections' },
  { id: 'zilliz', upstream: 'https://api.cloud.zilliz.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'fauna', upstream: 'https://db.fauna.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'turso', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/pipeline' },
  { id: 'elasticsearch', upstream: '', header: 'authorization', template: 'ApiKey {key}', demoPath: '/' },
  { id: 'elastic-cloud', upstream: 'https://api.elastic-cloud.com', header: 'authorization', template: 'ApiKey {key}', demoPath: '/api/v1/users/auth/_me' },
  { id: 'meilisearch', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/keys' },
  { id: 'typesense', upstream: '', header: 'x-typesense-api-key', template: '{key}', demoPath: '/keys' },
  { id: 'kubernetes', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/api' },
  { id: 'hashicorp-vault', upstream: '', header: 'x-vault-token', template: '{key}', demoPath: '/v1/sys/health' },
  { id: 'onepassword-connect', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/vaults' },
  { id: 'doppler', upstream: 'https://api.doppler.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v3/workplace' },
  { id: 'infisical', upstream: 'https://app.infisical.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v1/auth/checkAuth' },
  { id: 'vercel', upstream: 'https://api.vercel.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/user' },
  { id: 'cloudflare', upstream: 'https://api.cloudflare.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/client/v4/user/tokens/verify' },
  { id: 'netlify', upstream: 'https://api.netlify.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v1/user' },
  { id: 'digitalocean', upstream: 'https://api.digitalocean.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/account' },
  { id: 'render', upstream: 'https://api.render.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/services' },
  { id: 'heroku', upstream: 'https://api.heroku.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/account', extraHeaders: { accept: 'application/vnd.heroku+json; version=3' } },
  { id: 'fly', upstream: 'https://api.machines.dev', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/apps' },
  { id: 'railway', upstream: 'https://api.railway.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/graphql' },
  { id: 'terraform-cloud', upstream: 'https://app.terraform.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v2/account/details' },
  { id: 'pulumi', upstream: 'https://api.pulumi.com', header: 'authorization', template: 'token {key}', demoPath: '/api/user' },
  { id: 'fastly', upstream: 'https://api.fastly.com', header: 'fastly-key', template: '{key}', demoPath: '/user' },
  { id: 'tailscale', upstream: 'https://api.tailscale.com', header: 'authorization', template: 'Basic {key}', demoPath: '/api/v2/tailnet/-/devices' },
  { id: 'azure-management', upstream: 'https://management.azure.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/subscriptions?api-version=2020-01-01' },
  { id: 'gcp-resource-manager', upstream: 'https://cloudresourcemanager.googleapis.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/projects' },
  { id: 'microsoft-graph', upstream: 'https://graph.microsoft.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1.0/me' },
  { id: 'google-workspace', upstream: 'https://www.googleapis.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/oauth2/v3/userinfo' },
  { id: 'mapbox', upstream: 'https://api.mapbox.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'paddle', upstream: 'https://api.paddle.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'square', upstream: 'https://connect.squareup.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/locations' },
  { id: 'adyen', upstream: '', header: 'x-api-key', template: '{key}', demoPath: '/v71/paymentMethods' },
  { id: 'mollie', upstream: 'https://api.mollie.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/methods' },
  { id: 'lemonsqueezy', upstream: 'https://api.lemonsqueezy.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/users/me' },
  { id: 'chargebee', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/api/v2/customers' },
  { id: 'discord', upstream: 'https://discord.com/api', header: 'authorization', template: 'Bot {key}', demoPath: '/users/@me' },
  { id: 'slack', upstream: 'https://slack.com/api', header: 'authorization', template: 'Bearer {key}', demoPath: '/auth.test' },
  { id: 'google', upstream: 'https://generativelanguage.googleapis.com', header: 'x-goog-api-key', template: '{key}', demoPath: '/v1beta/models' },
  { id: 'algolia', upstream: '', header: 'x-algolia-api-key', template: '{key}', demoPath: '/1/indexes', extraHeaders: { 'x-algolia-application-id': 'YOUR_APP_ID' } },
  { id: 'langsmith', upstream: 'https://api.smith.langchain.com', header: 'x-api-key', template: '{key}', demoPath: '/' },
  { id: 'langfuse', upstream: 'https://cloud.langfuse.com', header: 'authorization', template: 'Basic {key}', demoPath: '/' },
  { id: 'posthog', upstream: 'https://us.posthog.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/projects/' },
  { id: 'segment', upstream: 'https://api.segmentapis.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/users' },
  { id: 'plausible', upstream: 'https://plausible.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v1/stats/aggregate' },
  { id: 'sanity', upstream: 'https://api.sanity.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2021-06-07/projects' },
  { id: 'contentful', upstream: 'https://api.contentful.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/spaces' },
  { id: 'workos', upstream: 'https://api.workos.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/organizations' },
  { id: 'hubspot', upstream: 'https://api.hubapi.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/account-info/v3/details' },
  { id: 'firecrawl', upstream: 'https://api.firecrawl.dev', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'e2b', upstream: 'https://api.e2b.dev', header: 'x-e2b-api-key', template: '{key}', demoPath: '/' },
  { id: 'shopify', upstream: '', header: 'x-shopify-access-token', template: '{key}', demoPath: '/admin/api/2024-10/shop.json' },
  { id: 'deepgram', upstream: 'https://api.deepgram.com', header: 'authorization', template: 'Token {key}', demoPath: '/v1/projects' },
  { id: 'hume', upstream: 'https://api.hume.ai', header: 'x-hume-api-key', template: '{key}', demoPath: '/v0/batch/jobs' },
  { id: 'runpod', upstream: 'https://api.runpod.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/graphql' },
  { id: 'exa', upstream: 'https://api.exa.ai', header: 'x-api-key', template: '{key}', demoPath: '/' },
  { id: 'tavily', upstream: 'https://api.tavily.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'airtable', upstream: 'https://api.airtable.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v0/meta/whoami' },
  { id: 'asana', upstream: 'https://app.asana.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/1.0/users/me' },
  { id: 'monday', upstream: 'https://api.monday.com', header: 'authorization', template: '{key}', demoPath: '/v2' },
  { id: 'clickup', upstream: 'https://api.clickup.com', header: 'authorization', template: '{key}', demoPath: '/api/v2/user' },
  { id: 'calendly', upstream: 'https://api.calendly.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/users/me' },
  { id: 'typeform', upstream: 'https://api.typeform.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/me' },
  { id: 'figma', upstream: 'https://api.figma.com', header: 'x-figma-token', template: '{key}', demoPath: '/v1/me' },
  { id: 'dropbox', upstream: 'https://api.dropboxapi.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/2/users/get_current_account' },
  { id: 'webflow', upstream: 'https://api.webflow.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/token/authorized_by' },
  { id: 'salesforce', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/services/data/v60.0/limits' },
  { id: 'zoho-crm', upstream: 'https://www.zohoapis.com', header: 'authorization', template: 'Zoho-oauthtoken {key}', demoPath: '/crm/v2/users' },
  { id: 'zoom', upstream: 'https://api.zoom.us', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/users/me' },
  { id: 'facebook-graph', upstream: 'https://graph.facebook.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v19.0/me' },
  { id: 'linkedin', upstream: 'https://api.linkedin.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v2/userinfo' },
  { id: 'wordpress', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/wp-json/wp/v2/users/me' },
  { id: 'zendesk', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/api/v2/users/me.json' },
  { id: 'jira', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/rest/api/3/myself' },
  { id: 'confluence', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/wiki/rest/api/user/current' },
  { id: 'freshdesk', upstream: '', header: 'authorization', template: 'Basic {key}', demoPath: '/api/v2/agents/me' },
  { id: 'trigger', upstream: 'https://api.trigger.dev', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'intercom', upstream: 'https://api.intercom.io', header: 'authorization', template: 'Bearer {key}', demoPath: '/me' },
  { id: 'launchdarkly', upstream: 'https://app.launchdarkly.com', header: 'authorization', template: '{key}', demoPath: '/api/v2/projects' },
  { id: 'snyk', upstream: 'https://api.snyk.io', header: 'authorization', template: 'token {key}', demoPath: '/rest/orgs' },
  { id: 'pagerduty', upstream: 'https://api.pagerduty.com', header: 'authorization', template: 'Token token={key}', demoPath: '/users' },
  { id: 'honeycomb', upstream: 'https://api.honeycomb.io', header: 'x-honeycomb-team', template: '{key}', demoPath: '/1/auth' },
  { id: 'okta', upstream: '', header: 'authorization', template: 'SSWS {key}', demoPath: '/api/v1/users/me' },
  { id: 'opsgenie', upstream: 'https://api.opsgenie.com', header: 'authorization', template: 'GenieKey {key}', demoPath: '/v2/users' },
  { id: 'axiom', upstream: 'https://api.axiom.co', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/user' },
  { id: 'rollbar', upstream: 'https://api.rollbar.com', header: 'x-rollbar-access-token', template: '{key}', demoPath: '/api/1/users' },
  { id: 'weaviate', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/' },
  { id: 'grafana', upstream: '', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/health' },
  { id: 'browserbase', upstream: 'https://api.browserbase.com', header: 'x-bb-api-key', template: '{key}', demoPath: '/v1/projects' },
];

const ENTERPRISE_EMAIL_PROVIDER_SLUGS: readonly string[] = [
  'resend',
  'sendgrid',
  'brevo',
  'sendinblue',
  'sparkpost',
  'mailersend',
  'elasticemail',
  'mailjet',
  'zeptomail',
  'smtp2go',
  'mailtrap',
  'mailgun',
  'postmark',
  'aws-ses',
  'aws_ses',
];

const ENTERPRISE_MANUAL_API_KEY_PROVIDER_OPTIONS: readonly string[] = Array.from(new Set([
  ...ENTERPRISE_PROVIDER_SLOT_PRESETS.map((preset) => preset.id),
  'datadog',
  'okta',
  'database-url',
  'oauth-client-secret',
  'webhook-secret',
  'jwt-secret',
  'encryption-key',
]));

function renderDatalistOptions(values: readonly string[]): string {
  return values.map((value) => `            <option value="${escapeHtml(value)}"></option>`).join('\n');
}

function renderEnterpriseProviderDefaultsJson(): string {
  const defaults: Record<string, Record<string, unknown>> = {};
  for (const preset of ENTERPRISE_PROVIDER_SLOT_PRESETS) {
    defaults[preset.id] = {
      upstream: preset.upstream,
      header: preset.header,
      template: preset.template,
    };
    if (preset.demoPath) defaults[preset.id].demoPath = preset.demoPath;
    if (preset.emailPath) defaults[preset.id].emailPath = preset.emailPath;
    if (preset.extraHeaders) defaults[preset.id].extraHeaders = preset.extraHeaders;
  }
  return JSON.stringify(defaults).replace(/</g, '\\u003c');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteStaticAssetUrls(html: string): string {
  return html
    .replaceAll('src="/js/', `src="${PUBLIC_SITE_ORIGIN}/js/`)
    .replaceAll('href="/css/', `href="${PUBLIC_SITE_ORIGIN}/css/`)
    .replaceAll('href="/favicon.png"', `href="${PUBLIC_SITE_ORIGIN}/favicon.png"`)
    .replaceAll('href="/terms"', `href="${PUBLIC_SITE_ORIGIN}/terms"`)
    .replaceAll('href="/privacy"', `href="${PUBLIC_SITE_ORIGIN}/privacy"`);
}

function removePublicSiteTheme(html: string): string {
  const publicSiteThemePattern = new RegExp(
    `\\s*<link\\s+rel="stylesheet"\\s+href="${escapeRegExp(PUBLIC_SITE_ORIGIN)}/css/site-theme\\.css"\\s*>`,
    'g',
  );
  return html.replace(publicSiteThemePattern, '');
}

const LEGACY_STATIC_SIDEBAR_ARTIFACTS = [
  'id="sidebar"',
  'id="sidebarOverlay"',
  '.sidebar-group',
  '.sidebar-head',
  '.sidebar-item',
  '.sidebar-nav-item',
  '.sidebar-label',
  '.sidebar-dot',
  '.sidebar-overlay',
  '.sidebar-bottom',
  'sidebar-nav-item',
  'sidebar-label',
  'sidebar-overlay',
  'sidebar-bottom',
  '.usage-box',
  '.usage-label',
  '.usage-row',
  '.usage-bar-track',
  '.usage-bar-fill',
  '.usage-reset',
];

function removeLegacyStaticSidebarArtifacts(html: string): string {
  return html
    .split('\n')
    .filter((line) => !LEGACY_STATIC_SIDEBAR_ARTIFACTS.some((artifact) => line.includes(artifact)))
    .join('\n');
}

function replaceOrInjectEnterpriseSidebar(html: string, activePage: EnterpriseAppNavPage, subtitle: string): string {
  const sidebar = renderEnterpriseAppSidebar(activePage, subtitle);
  const replaced = html.replace(/<aside\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>[\s\S]*?<\/aside>/, sidebar);
  if (replaced !== html) return replaced;
  return html.replace('<div class="layout">', `<div class="layout">\n      ${sidebar}`);
}

function readWorkspaceFile(relativePath: string): string {
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), '..', '..', relativePath),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function readEnterpriseAppPage(filename: string): string {
  const relativePath = filename === 'control.html' || filename === 'org.html'
    ? join('packages/enterprise-control-plane/static', filename)
    : join('apps/site/app', filename);
  const html = readWorkspaceFile(relativePath);
  return rewriteStaticAssetUrls(html);
}

const ENTERPRISE_RENDERED_APP_BASE_THEME = `
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: rgba(255, 255, 255, 0.86);
      --line: rgba(26, 40, 52, 0.14);
      --line-soft: rgba(26, 40, 52, 0.08);
      --text: #17202a;
      --muted: #526170;
      --soft: #7a8794;
      --gold: #315f95;
      --green: #15803d;
      --red: #dc2626;
      --blue: #2563eb;
      --ink: #ffffff;
      --primary-bg: #315f95;
      --primary-text:#ffffff;
      --primary-border: #315f95;
      --warn: #b45309;
      --page-bg: #f5f7fb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--page-bg);
    }
    a { color: inherit; text-decoration: none; }
    .toolbar a,
    a.primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      font: inherit;
      line-height: 1;
      white-space: nowrap;
    }
`;

const ENTERPRISE_STATIC_APP_THEME = `
    :root {
      color-scheme: light;
      --accent: #315f95;
      --accent-soft: rgba(49, 95, 149, 0.12);
      --bg: #f5f7fb;
      --bg-mid: #e9eff5;
      --bg-card: rgba(255, 255, 255, 0.92);
      --paper: #ffffff;
      --surface: #eef3f7;
      --rule: 1px solid rgba(26, 40, 52, 0.14);
      --hair: 1px solid rgba(26, 40, 52, 0.08);
      --line: rgba(26, 40, 52, 0.14);
      --text: #17202a;
      --text-muted: #526170;
      --text-faint: #7a8794;
      --muted: #526170;
      --soft: #7a8794;
      --gold: #315f95;
      --green: #15803d;
      --red: #dc2626;
      --blue: #2563eb;
      --ok: #15803d;
      --warn: #b45309;
      --danger: #dc2626;
      --ink: #ffffff;
      --primary-bg: #315f95;
      --primary-text:#ffffff;
      --primary-border: #315f95;
      --page-bg: #f5f7fb;
      --row-bg: #f8fafc;
      --display: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --body: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    html, body {
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--body);
    }
    .page {
      max-width: none;
      margin: 0;
      background: transparent;
      border: 0;
      min-height: 100vh;
    }
    .page > .topbar { display: none !important; }
    .page .layout { min-height: 100vh; }
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .page-title { color: var(--text); font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; font-weight: 850; }
    .page-desc, .page-meta, .list-sub, .resource-copy, .banner-copy, .banner-note, .form-copy, .callout { color: var(--muted); }
    .panel, .kpi-grid, .banner, .invite-panel, .action-strip, .member-card, .policy-card, .policy-provider-card, .exec-card, .resource-card, .checklist-box, .callout {
      border: 1px solid var(--line);
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 18px 54px rgba(26,40,52,.10);
      color: var(--text);
    }
    .panel-head, .list-row, .invite-row { border-color: rgba(26, 40, 52, 0.12); }
    .resource-title, .list-title, .member-email, .policy-title, .exec-title, .banner-title { color: var(--text); }
    .org-select, .form-input, .form-select, .policy-input, .policy-textarea, select, input, textarea {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
      border-radius: 8px;
    }
    option { color: #111827; }
    .btn-primary { background: var(--primary-bg); color: var(--primary-text); border: 1px solid var(--primary-border); font-weight: 850; border-radius: 8px; }
    .btn-outline, .btn-danger { background: rgba(255, 255, 255, 0.78); color: var(--text); border: 1px solid var(--line); border-radius: 8px; }
    .btn-danger { color: var(--red); border-color: rgba(251, 113, 133, 0.34); }
    .subnav-link { background: rgba(255, 255, 255, 0.78); color: var(--muted); border: 1px solid var(--line); }
    .subnav-link.active { color: var(--primary-text); background: var(--primary-bg); border-color: var(--primary-border); }
    .pill.neutral { background: rgba(255, 255, 255, 0.78); color: var(--muted); }
    .pill.ok { background: rgba(21, 128, 61, 0.1); color: var(--green); border-color: rgba(21, 128, 61, 0.24); }
    .pill.warn { background: rgba(180, 83, 9, 0.1); color: var(--gold); border-color: rgba(180, 83, 9, 0.28); }
    .pill.danger { background: rgba(251, 113, 133, 0.12); color: var(--red); border-color: rgba(251, 113, 133, 0.28); }
    .kpi-cell + .kpi-cell { border-left-color: rgba(26, 40, 52, 0.12); }
    .empty { color: var(--muted); }
    .resource-link { color: var(--gold); }
    @media (max-width: 980px) {
      .main { padding: 24px 18px; }
    }
`;

const ENTERPRISE_STATIC_APP_POLISH_THEME = `
    /* enterprise-static-theme-polish */
    .main {
      color: var(--text) !important;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 16px !important;
      font-weight: 400 !important;
    }
    .main,
    .main * {
      letter-spacing: 0 !important;
    }
    main.main > .topbar,
    .page-header {
      border: 1px solid var(--line) !important;
      background: #ffffff !important;
      border-radius: 8px !important;
      padding: 20px !important;
      box-shadow: none !important;
    }
    h1,
    .page-title {
      color: var(--text) !important;
      font-size: 1.875rem !important;
      font-weight: 600 !important;
      line-height: 2.25rem !important;
    }
    @media (min-width: 640px) {
      h1,
      .page-title {
        font-size: 2.6rem !important;
      }
    }
    h2,
    h3,
    .control-title,
    .section-title h2,
    .doc-section h2,
    .doc-section h3 {
      color: var(--text) !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
    }
    .kicker,
    .doc-kicker,
    .banner-kicker,
    .page-heading::before,
    .org-switcher-label,
    .action-strip-label,
    .kpi-label,
    .panel-head,
    .checklist-title,
    .slot-form label {
      color: var(--soft) !important;
      font-weight: 400 !important;
    }
    .lead,
    .page-desc,
    .page-meta,
    .list-sub,
    .resource-copy,
    .banner-copy,
    .banner-note,
    .form-copy,
    .callout,
    .row-sub,
    .event-sub,
    .event-time,
    .kpi-sub,
    .summary {
      color: var(--muted) !important;
      font-size: 14px !important;
      line-height: 1.6 !important;
      font-weight: 400 !important;
    }
    @media (min-width: 640px) {
      .lead,
      .page-desc,
      .page-meta,
      .summary {
        font-size: 16px !important;
      }
    }
    .row-sub,
    .event-sub,
    .event-time,
    .kpi-sub,
    .mini,
    .resource-copy,
    .list-sub,
    .banner-note,
    .form-copy {
      color: var(--muted) !important;
      font-size: 13px !important;
      line-height: 1.45 !important;
    }
    .primary,
    .btn-primary,
    .btn.primary,
    .subnav-link.active,
    button.primary,
    a.primary {
      background: var(--primary-bg) !important;
      color: var(--primary-text) !important;
      border-color: var(--primary-border) !important;
      font-weight: 600 !important;
      border-radius: 8px !important;
      box-shadow: none !important;
    }
    .btn-outline,
    .btn-danger,
    .action,
    .subnav-link,
    button,
    select,
    input,
    textarea {
      border-radius: 8px !important;
      font-weight: 500 !important;
    }
    .card,
    .panel,
    .kpi-cell,
    .kpi-grid,
    .banner,
    .invite-panel,
    .action-strip,
    .member-card,
    .policy-card,
    .policy-provider-card,
    .exec-card,
    .resource-card,
    .checklist-box,
    .doc-section {
      background: #ffffff !important;
      border-color: var(--line) !important;
      border-radius: 8px !important;
      box-shadow: 0 18px 54px rgba(26, 40, 52, 0.10) !important;
    }
    .action-strip,
    .list-row,
    .invite-row,
    .row,
    .event,
    .role-card,
    .feature,
    .member-project,
    .pill,
    .org-switcher,
    .control-kpi,
    .control-panel,
    .chart-shell,
    .chart-empty,
    .inventory-row,
    .launch-check-row,
    .go-evidence-row,
    .evidence-callout,
    .entitlement-meter,
    .scanner-row,
    .release-row,
    .tester-row {
      background: var(--row-bg, #f8fafc) !important;
      border-color: var(--line-soft) !important;
      border-radius: 8px !important;
    }
    .subnav {
      background: rgba(255, 255, 255, 0.78) !important;
      border-color: var(--line) !important;
      border-radius: 8px !important;
      box-shadow: none !important;
    }
    .banner,
    .action-strip,
    .kpi-cell,
    .panel,
    .doc-section {
      background-image: none !important;
    }
    .kpi-value {
      font-weight: 600 !important;
    }
    .row-title,
    .event-title,
    .list-title,
    .resource-title,
    .member-email,
    .policy-title,
    .exec-title,
    .banner-title {
      font-weight: 600 !important;
    }
    .tag,
    .pill,
    .feature-tag {
      font-weight: 400 !important;
    }
    .tag.warn,
    .pill.warn,
    .feature-tag.pending {
      color: var(--warn) !important;
      border-color: rgba(138, 90, 19, 0.30) !important;
      background: rgba(138, 90, 19, 0.08) !important;
    }
    .resource-link,
    .doc-section code,
    .doc-note strong {
      color: var(--green) !important;
    }
    .doc-note {
      border-left-color: var(--primary-bg) !important;
      background: rgba(49, 95, 149, 0.10) !important;
    }
`;

const ENTERPRISE_CONTROL_PAGE_THEME = `
    /* control-dashboard-theme */
    .page-header {
      margin-bottom: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(26, 40, 52, 0.10);
    }
    .page-heading::before {
      content: "Enterprise operations";
      width: max-content;
      padding: 6px 10px;
      border: 1px solid rgba(180, 83, 9, 0.26);
      border-radius: 999px;
      background: rgba(180, 83, 9, 0.1);
      color: var(--gold);
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .page-actions {
      align-items: flex-end;
      gap: 12px;
      flex: 1 1 420px;
    }
    .org-switcher {
      min-width: 280px;
      padding: 12px;
      border: 1px solid rgba(26, 40, 52, 0.14);
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.82);
    }
    .org-switcher-label,
    .action-strip-label,
    .kpi-label,
    .panel-head,
    .banner-kicker,
    .checklist-title {
      color: rgba(82, 97, 112, 0.58);
      font-weight: 850;
      letter-spacing: .12em;
    }
    .org-switcher-status { color: var(--muted); }
    .page-desc {
      max-width: 780px;
      margin: 0 0 18px;
      color: rgba(82, 97, 112, 0.72);
      font-size: 15px;
      line-height: 1.65;
    }
    .subnav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: max-content;
      max-width: 100%;
      margin: 0 0 16px;
      padding: 7px;
      border: 1px solid rgba(26, 40, 52, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.66);
      box-shadow: inset 0 1px 0 rgba(82, 97, 112, 0.05);
    }
    .subnav-link {
      padding: 9px 12px;
      border-radius: 8px;
      background: transparent;
      border-color: transparent;
      color: rgba(82, 97, 112, 0.68);
      font-weight: 800;
    }
    .subnav-link:hover {
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
    }
    .subnav-link.active {
      color: var(--ink);
      box-shadow: 0 12px 34px rgba(180, 83, 9, 0.18);
    }
    .action-strip {
      margin-bottom: 18px;
      padding: 14px;
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(180, 83, 9, 0.12), transparent 48%),
        rgba(255, 255, 255, 0.72);
    }
    .action-strip .btn-outline {
      min-height: 38px;
      background: rgba(255, 255, 255, 0.68);
    }
    .action-msg {
      color: var(--muted);
      min-height: 18px;
    }
    .banner {
      grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr);
      gap: 20px;
      margin-bottom: 18px;
      padding: 22px;
      border-radius: 8px;
      background:
        radial-gradient(circle at 18% 0%, rgba(180, 83, 9, 0.22), transparent 28rem),
        linear-gradient(180deg, rgba(26, 40, 52, 0.14), rgba(248, 250, 252, 0.86));
    }
    .banner-title {
      font-size: clamp(28px, 4vw, 44px);
      letter-spacing: -.06em;
      line-height: 1;
    }
    .banner-copy {
      max-width: 680px;
      font-size: 14px;
      line-height: 1.65;
    }
    .banner-note {
      border-left: 1px solid rgba(26, 40, 52, 0.14);
      padding-left: 18px;
      color: rgba(82, 97, 112, 0.70);
    }
    .kpi-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
      border: 0;
      border-radius: 0;
      overflow: visible;
      background: transparent;
      box-shadow: none;
    }
    .kpi-cell {
      min-height: 150px;
      padding: 18px;
      border: 1px solid rgba(26, 40, 52, 0.14);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(26, 40, 52, 0.12), rgba(248, 250, 252, 0.78)),
        rgba(248, 250, 252, 0.78);
      box-shadow: 0 18px 70px rgba(0, 0, 0, 0.16);
    }
    .kpi-cell + .kpi-cell { border-left: 1px solid rgba(26, 40, 52, 0.14); }
    .kpi-value {
      margin-top: 10px;
      color: var(--text);
      font-size: clamp(30px, 4vw, 44px);
      letter-spacing: -.055em;
      line-height: .95;
    }
    .kpi-sub {
      margin-top: 12px;
      color: rgba(82, 97, 112, 0.62);
      line-height: 1.45;
      white-space: normal;
    }
    .grid {
      grid-template-columns: minmax(0, 1.08fr) minmax(360px, .92fr);
      gap: 18px;
    }
    .stack { gap: 18px; }
    .panel {
      border-radius: 8px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.76)),
        rgba(248, 250, 252, 0.72);
    }
    .panel-head {
      min-height: 54px;
      padding: 16px 18px;
      border-bottom: 1px solid rgba(26, 40, 52, 0.10);
      background: rgba(248, 250, 252, 0.72);
    }
    .panel-head-right {
      color: var(--muted);
      font-weight: 700;
    }
    .list,
    .policy-list,
    .exec-list,
    .resource-grid,
    .member-grid,
    .invite-list {
      padding: 14px;
    }
    .list-row {
      padding: 13px 4px;
      border-bottom: 1px dashed rgba(26, 40, 52, 0.12);
    }
    .member-card,
    .policy-card,
    .policy-provider-card,
    .exec-card,
    .resource-card,
    .checklist-box {
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.82);
      border-color: rgba(26, 40, 52, 0.12);
    }
    .member-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .member-project,
    .pill {
      border-color: rgba(26, 40, 52, 0.16);
      background: rgba(255, 255, 255, 0.68);
    }
    .policy-grid {
      grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
    }
    .policy-label,
    .policy-hint,
    .member-meta,
    .exec-meta,
    .list-rank,
    .list-meta,
    .invite-sub {
      color: rgba(82, 97, 112, 0.55);
    }
    .policy-message,
    .exec-message {
      color: var(--muted);
    }
    .checklist-box {
      margin: 0 14px 14px;
    }
    .checklist-item {
      color: rgba(82, 97, 112, 0.68);
    }
    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .page-header { gap: 14px; }
      .page-actions { align-items: stretch; flex-basis: 100%; }
      .org-switcher { min-width: 100%; }
      .banner { grid-template-columns: 1fr; }
      .banner-note {
        border-left: 0;
        border-top: 1px solid rgba(26, 40, 52, 0.14);
        padding-left: 0;
        padding-top: 16px;
      }
      .kpi-grid,
      .member-grid,
      .policy-provider-grid,
      .policy-grid {
        grid-template-columns: 1fr;
      }
      .subnav { width: 100%; }
      .subnav-link { flex: 1 1 130px; text-align: center; }
    }
`;

const ENTERPRISE_ORG_PAGE_THEME = `
    /* org-dashboard-theme */
    .page-header {
      margin-bottom: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(26, 40, 52, 0.10);
    }
    .page-heading::before {
      content: "Organization setup";
      width: max-content;
      padding: 6px 10px;
      border: 1px solid rgba(180, 83, 9, 0.26);
      border-radius: 999px;
      background: rgba(180, 83, 9, 0.1);
      color: var(--gold);
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .page-actions {
      align-items: flex-end;
      gap: 12px;
      flex: 1 1 460px;
    }
    .org-switcher {
      min-width: 280px;
      padding: 12px;
      border: 1px solid rgba(26, 40, 52, 0.14);
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.82);
    }
    .org-switcher-label,
    .action-strip-label,
    .kpi-label,
    .panel-head,
    .banner-kicker,
    .form-label,
    .checklist-title {
      color: rgba(82, 97, 112, 0.58);
      font-weight: 850;
      letter-spacing: .12em;
    }
    .page-desc {
      max-width: 820px;
      margin: 0 0 18px;
      color: rgba(82, 97, 112, 0.72);
      font-size: 15px;
      line-height: 1.65;
    }
    .subnav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: max-content;
      max-width: 100%;
      margin: 0 0 16px;
      padding: 7px;
      border: 1px solid rgba(26, 40, 52, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.66);
      box-shadow: inset 0 1px 0 rgba(82, 97, 112, 0.05);
    }
    .subnav-link {
      padding: 9px 12px;
      border-radius: 8px;
      background: transparent;
      border-color: transparent;
      color: rgba(82, 97, 112, 0.68);
      font-weight: 800;
    }
    .subnav-link:hover {
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
    }
    .subnav-link.active {
      color: var(--ink);
      box-shadow: 0 12px 34px rgba(180, 83, 9, 0.18);
    }
    .action-strip {
      margin-bottom: 18px;
      padding: 14px;
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(21, 128, 61, 0.1), transparent 46%),
        rgba(255, 255, 255, 0.72);
    }
    .action-strip .btn-outline {
      min-height: 38px;
      background: rgba(255, 255, 255, 0.68);
    }
    .action-msg,
    .form-msg,
    .form-hint,
    .org-switcher-status {
      color: var(--muted);
    }
    .banner {
      grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr);
      gap: 20px;
      margin-bottom: 18px;
      padding: 22px;
      border-radius: 8px;
      background:
        radial-gradient(circle at 18% 0%, rgba(21, 128, 61, 0.18), transparent 28rem),
        radial-gradient(circle at 78% 0%, rgba(180, 83, 9, 0.18), transparent 24rem),
        linear-gradient(180deg, rgba(26, 40, 52, 0.14), rgba(248, 250, 252, 0.86));
    }
    .banner-title {
      font-size: clamp(28px, 4vw, 44px);
      letter-spacing: -.06em;
      line-height: 1;
    }
    .banner-copy {
      max-width: 680px;
      font-size: 14px;
      line-height: 1.65;
    }
    .banner-note {
      border-left: 1px solid rgba(26, 40, 52, 0.14);
      padding-left: 18px;
      color: rgba(82, 97, 112, 0.70);
    }
    .kpi-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
      border: 0;
      border-radius: 0;
      overflow: visible;
      background: transparent;
      box-shadow: none;
    }
    .kpi-cell {
      min-height: 150px;
      padding: 18px;
      border: 1px solid rgba(26, 40, 52, 0.14);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(26, 40, 52, 0.12), rgba(248, 250, 252, 0.78)),
        rgba(248, 250, 252, 0.78);
      box-shadow: 0 18px 70px rgba(0, 0, 0, 0.16);
    }
    .kpi-cell + .kpi-cell { border-left: 1px solid rgba(26, 40, 52, 0.14); }
    .kpi-value {
      margin-top: 10px;
      color: var(--text);
      font-size: clamp(30px, 4vw, 42px);
      letter-spacing: -.055em;
      line-height: .95;
      overflow-wrap: anywhere;
    }
    .kpi-sub {
      margin-top: 12px;
      color: rgba(82, 97, 112, 0.62);
      line-height: 1.45;
      white-space: normal;
    }
    .grid {
      grid-template-columns: minmax(0, 1.02fr) minmax(390px, .98fr);
      gap: 18px;
    }
    .stack { gap: 18px; }
    .panel {
      border-radius: 8px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.76)),
        rgba(248, 250, 252, 0.72);
    }
    .panel-head {
      min-height: 54px;
      padding: 16px 18px;
      border-bottom: 1px solid rgba(26, 40, 52, 0.10);
      background: rgba(248, 250, 252, 0.72);
    }
    .panel-head-right {
      color: var(--muted);
      font-weight: 700;
    }
    .form-card,
    .resource-grid,
    .list {
      padding: 14px;
    }
    .form-card {
      gap: 14px;
    }
    .form-grid {
      gap: 12px;
    }
    .form-field {
      gap: 7px;
    }
    .form-input,
    .form-select,
    .org-select {
      min-height: 42px;
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.84);
      border-color: rgba(26, 40, 52, 0.16);
      color: var(--text);
    }
    .form-input::placeholder {
      color: rgba(82, 97, 112, 0.34);
    }
    .form-input:disabled,
    .form-select:disabled,
    .org-select:disabled {
      background: rgba(248, 250, 252, 0.78);
      color: rgba(82, 97, 112, 0.42);
    }
    .form-inline {
      gap: 10px;
    }
    .form-copy,
    .callout,
    .resource-copy {
      color: rgba(82, 97, 112, 0.68);
      line-height: 1.55;
    }
    .callout,
    .resource-card,
    .checklist-box {
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.82);
      border-color: rgba(26, 40, 52, 0.12);
    }
    .callout strong {
      color: var(--text);
    }
    .resource-card {
      padding: 14px;
    }
    .resource-title,
    .list-title {
      color: var(--text);
    }
    .resource-link {
      color: var(--gold);
      font-weight: 800;
    }
    .checklist-box {
      margin: 0 14px 14px;
    }
    .checklist-item {
      color: rgba(82, 97, 112, 0.68);
    }
    .list-row {
      padding: 13px 4px;
      border-bottom: 1px dashed rgba(26, 40, 52, 0.12);
    }
    .list-rank,
    .list-meta,
    .list-sub {
      color: rgba(82, 97, 112, 0.55);
    }
    .pill {
      border-color: rgba(26, 40, 52, 0.16);
      background: rgba(255, 255, 255, 0.68);
    }
    .btn-danger {
      background: rgba(251, 113, 133, 0.1);
      color: var(--red);
      border-color: rgba(251, 113, 133, 0.32);
      border-radius: 8px;
    }
    .btn-danger:hover {
      background: rgba(251, 113, 133, 0.16);
    }
    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .page-header { gap: 14px; }
      .page-actions { align-items: stretch; flex-basis: 100%; }
      .org-switcher { min-width: 100%; }
      .banner { grid-template-columns: 1fr; }
      .banner-note {
        border-left: 0;
        border-top: 1px solid rgba(26, 40, 52, 0.14);
        padding-left: 0;
        padding-top: 16px;
      }
      .kpi-grid,
      .form-grid {
        grid-template-columns: 1fr;
      }
      .subnav { width: 100%; }
      .subnav-link { flex: 1 1 130px; text-align: center; }
      .page-actions > * { flex: 1 1 150px; }
    }
`;

const ENTERPRISE_STATIC_PAGE_THEMES: Partial<Record<EnterpriseAppNavPage, string>> = {
  control: ENTERPRISE_CONTROL_PAGE_THEME,
  org: ENTERPRISE_ORG_PAGE_THEME,
};

const ENTERPRISE_STATIC_CANONICAL_ORG_URL_SCRIPT = `<script>
    /* enterprise-static-canonical-org-url */
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var nativeReplaceState = window.history.replaceState;
      var nativePushState = window.history.pushState;

      function canonicalizeAppUrl(value) {
        if (value === undefined || value === null || value === '') return value;
        try {
          var url = new URL(String(value), window.location.href);
          if (url.origin !== window.location.origin) return value;
          if (url.pathname !== '/app/control' && url.pathname !== '/app/org') return value;
          var orgId = url.searchParams.get('org');
          if (orgId) window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
          url.searchParams.delete('org');
          return url.pathname + url.search + url.hash;
        } catch (error) {
          return value;
        }
      }

      window.history.replaceState = function(state, title, url) {
        if (arguments.length < 3) return nativeReplaceState.call(window.history, state, title);
        return nativeReplaceState.call(window.history, state, title, canonicalizeAppUrl(url));
      };
      window.history.pushState = function(state, title, url) {
        if (arguments.length < 3) return nativePushState.call(window.history, state, title);
        return nativePushState.call(window.history, state, title, canonicalizeAppUrl(url));
      };

      var canonical = canonicalizeAppUrl(window.location.href);
      var current = window.location.pathname + window.location.search + window.location.hash;
      if (canonical && canonical !== current) {
        nativeReplaceState.call(window.history, window.history.state || {}, '', canonical);
      }
    })();
  </script>`;

function applyEnterpriseStaticAppTheme(html: string, activePage: EnterpriseAppNavPage, subtitle: string): string {
  const pageSpecificTheme = ENTERPRISE_STATIC_PAGE_THEMES[activePage] ?? '';

  return removeLegacyStaticSidebarArtifacts(replaceOrInjectEnterpriseSidebar(removePublicSiteTheme(html), activePage, subtitle))
    .replace('</style>', `${ENTERPRISE_APP_SHELL_THEME}${ENTERPRISE_STATIC_APP_THEME}${pageSpecificTheme}${ENTERPRISE_STATIC_APP_POLISH_THEME}\n  </style>`)
    .replace('</head>', `${ENTERPRISE_STATIC_CANONICAL_ORG_URL_SCRIPT}\n</head>`);
}

const plannedEnterprisePages: Record<string, {
  title: string;
  kicker: string;
  summary: string;
  features: string[];
  primaryHref: string;
  primaryLabel: string;
}> = {
  members: {
    title: 'Members',
    kicker: 'access review',
    summary: 'Enterprise member management will bring org members, pending invites, project assignments, and SOC 2 access-review evidence into one GCP-hosted page.',
    features: ['Active members and roles', 'Pending invites and invite acceptance', 'Project assignment coverage', 'CSV/JSON access-review evidence'],
    primaryHref: '/api/v1/enterprise/members/access-review?format=csv',
    primaryLabel: 'export access review',
  },
  audit: {
    title: 'Audit',
    kicker: 'governance timeline',
    summary: 'Enterprise audit will show governance events and runtime proxy activity with exportable filters for customer security reviews.',
    features: ['Governance and runtime timeline', 'CSV export', 'Search and event-type filters', 'Attestation and executor metadata details'],
    primaryHref: '/api/v1/enterprise/audit?format=csv&days=30',
    primaryLabel: 'export audit CSV',
  },
  alerts: {
    title: 'Alerts',
    kicker: 'ops notifications',
    summary: 'Enterprise alerts will manage destinations, dispatch policy, delivery logs, and readiness drift notifications.',
    features: ['Email and webhook destinations', 'Dispatch policy status', 'Delivery logs', 'Policy run history'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
  activity: {
    title: 'Activity',
    kicker: 'runtime feed',
    summary: 'Enterprise activity will focus on recent executor/proxy events, status codes, latency, provider request IDs, and attestation evidence summaries.',
    features: ['Runtime request feed', 'Latency and status-code view', 'Provider request IDs', 'Attestation summary links'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
  projects: {
    title: 'Projects',
    kicker: 'inventory',
    summary: 'Enterprise projects will show project health, provider slots, origin policy, caller-lock coverage, and quick links into Control.',
    features: ['Project inventory', 'Provider slot status', 'Policy coverage', 'Control page shortcuts'],
    primaryHref: '/app/control',
    primaryLabel: 'open control',
  },
  keys: {
    title: 'Provider slots',
    kicker: 'secrets posture',
    summary: 'Enterprise provider slots will show active/revoked upstream providers, emergency revoke status, and rotation checklists without exposing raw provider secrets.',
    features: ['Active and revoked slots', 'Emergency revoke workflow', 'Rotation checklist', 'Cloud KMS posture notes'],
    primaryHref: '/app/control',
    primaryLabel: 'manage provider policy',
  },
  settings: {
    title: 'Settings',
    kicker: 'tenant defaults',
    summary: 'Enterprise settings will collect tenant-level preferences and security notices that do not belong in SSO setup.',
    features: ['Session/security notices', 'Dashboard preferences', 'Tenant defaults', 'Operational contact hints'],
    primaryHref: '/app/org',
    primaryLabel: 'open org settings',
  },
  plans: {
    title: 'Plans',
    kicker: 'enterprise packaging',
    summary: 'Enterprise plans will track rollout status, GCP edge and monitoring packaging, limits, and contract-facing governance notes.',
    features: ['GCP edge rollout status', 'Monitoring package status', 'Enterprise limits', 'Contract-facing plan notes'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
  scanner: {
    title: 'Scanner',
    kicker: 'secret exposure intake',
    summary: 'Enterprise scanner records metadata-only repository exposure findings, owners, rotation status, and evidence while scanner APIs remain disabled.',
    features: ['Redacted exposure intake', 'Secret remediation workflow', 'Provider rotation follow-up', 'Customer-safe scanner evidence export'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
};

function renderEnterpriseMembersPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Members - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 720px; }
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 8px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(82,97,112,.48); }
    .primary { background: linear-gradient(135deg, var(--gold), #23466f); color: var(--ink); border: 0; font-weight: 850; }
    .danger { color: var(--red); border-color: rgba(220,38,38,.34); }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .form-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(240px, .42fr) auto; gap: 10px; align-items: center; }
    .inline-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
    .inline-actions select, .inline-actions button { padding: 8px 9px; font-size: 13px; border-radius: 11px; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(340px, .72fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.86)); border-radius: 8px; padding: 20px; box-shadow: 0 22px 90px rgba(26,40,52,.16); }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 13px; background: rgba(248,250,252,.84); }
    .row-title { font-weight: 760; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(37,99,235,.24); border-radius: 999px; padding: 5px 8px; }
    .tag.good { color: var(--green); border-color: rgba(21,128,61,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(180,83,9,.28); }
    .role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .role-card { border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 13px; background: rgba(248,250,252,.80); }
    .role-card strong { display: block; margin-bottom: 5px; }
    .role-card p { color: var(--muted); font-size: 13px; line-height: 1.45; margin: 0 0 9px; }
    .role-card .tag { display: inline-block; margin: 0 5px 5px 0; }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(26,40,52,.22); border-radius: 8px; padding: 18px; background: rgba(248,250,252,.78); }
    .notice.error { color: var(--red); border-color: rgba(220,38,38,.3); }
    @media (max-width: 980px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .kpis, .two, .role-grid, .form-row { grid-template-columns: 1fr; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('members', 'members + access')}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">access review</div>
          <h1>Members</h1>
          <p class="lead">Review who has enterprise access, which projects they can touch, and whether any pending invites block rollout.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" id="accessReviewCsv" href="/api/v1/enterprise/members/access-review?format=csv">export CSV</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="card" id="adminPanel" style="display:none; margin-bottom:16px">
        <div class="section-title"><h2>IAM actions</h2><span class="mini">invite, role, project access</span></div>
        <form id="inviteForm" class="form-row">
          <input id="inviteEmail" type="email" autocomplete="email" placeholder="teammate@company.com" required />
          <select id="inviteRole" aria-label="Invite role">
            <option value="viewer">Viewer - read-only</option>
            <option value="auditor">Auditor - evidence review</option>
            <option value="developer">Developer - assigned project work</option>
            <option value="iam_admin">IAM Admin - users and SSO</option>
            <option value="security_admin">Security Admin - policy and evidence</option>
            <option value="platform_admin">Platform Admin - runtime and gateway</option>
          </select>
          <button class="primary" type="submit">send invite</button>
        </form>
      </section>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">members</div><div class="kpi-value" id="kpiMembers">...</div><div class="kpi-sub" id="kpiMembersSub">loading</div></div>
        <div class="card"><div class="kpi-label">privileged roles</div><div class="kpi-value" id="kpiAdmins">...</div><div class="kpi-sub">owner, admin, IAM, security, platform</div></div>
        <div class="card"><div class="kpi-label">pending invites</div><div class="kpi-value" id="kpiInvites">...</div><div class="kpi-sub">waiting for acceptance</div></div>
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">access scopes</div></div>
      </section>

      <section class="card" style="margin-bottom:16px">
        <div class="section-title"><h2>Role guide</h2><span class="mini">least-privilege IAM model</span></div>
        <div id="roleGuideList" class="role-grid"><div class="empty">Loading role guide...</div></div>
      </section>

      <section class="grid two">
        <div class="card">
          <div class="section-title"><h2>Active members</h2><span id="membersMeta" class="mini"></span></div>
          <div id="membersList" class="list"><div class="empty">Loading members...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Pending invites</h2><span id="invitesMeta" class="mini"></span></div>
          <div id="invitesList" class="list"><div class="empty">Loading invites...</div></div>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="section-title"><h2>Project coverage</h2><span id="coverageMeta" class="mini"></span></div>
        <div id="coverageList" class="list"><div class="empty">Loading project coverage...</div></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var roleDefinitions = {
        organization_roles: [
          { value: 'owner', label: 'Owner', summary: 'Full workspace control and final break-glass authority.', permissions: ['all controls'], privileged: true },
          { value: 'admin', label: 'Admin', summary: 'Legacy broad admin role.', permissions: ['members', 'projects', 'policy', 'evidence'], legacy: true, privileged: true },
          { value: 'iam_admin', label: 'IAM Admin', summary: 'Manages users, roles, project access, and SSO setup.', permissions: ['invite users', 'change roles', 'assign projects'], privileged: true },
          { value: 'security_admin', label: 'Security Admin', summary: 'Owns policy, provider slot controls, alerts, and evidence.', permissions: ['security policy', 'provider revoke', 'evidence'], privileged: true },
          { value: 'platform_admin', label: 'Platform Admin', summary: 'Runs gateway, runtime, DNS/edge, and production readiness.', permissions: ['runtime', 'gateway', 'project controls'], privileged: true },
          { value: 'developer', label: 'Developer', summary: 'Builds and tests assigned project integrations.', permissions: ['assigned projects'] },
          { value: 'auditor', label: 'Auditor', summary: 'Read-only compliance reviewer for audit and evidence.', permissions: ['audit', 'evidence'] },
          { value: 'member', label: 'Member', summary: 'Legacy contributor role.', permissions: ['assigned project work'], legacy: true },
          { value: 'viewer', label: 'Viewer', summary: 'Read-only business visibility.', permissions: ['read only'] }
        ],
        project_roles: [
          { value: 'owner', label: 'Project Owner', summary: 'Full control for one project.', permissions: ['policy', 'provider slots', 'execution'], privileged: true },
          { value: 'admin', label: 'Project Admin', summary: 'Legacy broad project admin role.', permissions: ['policy', 'provider slots', 'execution'], legacy: true, privileged: true },
          { value: 'project_admin', label: 'Project Admin', summary: 'Configures one project without org-wide IAM.', permissions: ['policy', 'provider slots'], privileged: true },
          { value: 'operator', label: 'Operator', summary: 'Runs approved traffic and reviews activity.', permissions: ['execution', 'activity'] },
          { value: 'developer', label: 'Developer', summary: 'Builds and tests without changing security policy.', permissions: ['execution', 'activity'] },
          { value: 'auditor', label: 'Auditor', summary: 'Read-only reviewer for one project.', permissions: ['evidence', 'activity'] },
          { value: 'member', label: 'Member', summary: 'Legacy project contributor role.', permissions: ['execution'], legacy: true },
          { value: 'viewer', label: 'Viewer', summary: 'Read-only project visibility.', permissions: ['read only'] }
        ]
      };
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function roleList(scope) {
        return scope === 'project' ? roleDefinitions.project_roles : roleDefinitions.organization_roles;
      }
      function roleDefinition(scope, value) {
        return (roleList(scope) || []).find(function(role) { return role.value === value; }) || { value: value, label: value, summary: '', permissions: [] };
      }
      function roleLabel(scope, value) {
        return roleDefinition(scope, value).label || value;
      }
      function isPrivilegedOrgRole(value) {
        return !!roleDefinition('organization', value).privileged;
      }
      function renderRoleOptions(scope, selected, includeOwner) {
        return (roleList(scope) || []).filter(function(role) {
          return includeOwner || role.value !== 'owner';
        }).map(function(role) {
          var label = role.label || role.value;
          var suffix = role.summary ? ' - ' + role.summary : '';
          return '<option value="' + escapeHtml(role.value) + '"' + (selected === role.value ? ' selected' : '') + '>' + escapeHtml(label + suffix) + '</option>';
        }).join('');
      }
      function renderRoleGuide() {
        var el = byId('roleGuideList');
        if (!el) return;
        var roles = (roleDefinitions.organization_roles || []).filter(function(role) {
          return role.value !== 'admin' && role.value !== 'member';
        });
        el.innerHTML = roles.map(function(role) {
          var permissions = Array.isArray(role.permissions) ? role.permissions : [];
          return '<div class="role-card"><strong>' + escapeHtml(role.label || role.value) + '</strong><p>' + escapeHtml(role.summary || '') + '</p><div>' + permissions.slice(0, 4).map(function(permission) {
            return '<span class="tag ' + (role.privileged ? 'warn' : '') + '">' + escapeHtml(permission) + '</span>';
          }).join('') + '</div></div>';
        }).join('');
      }
      function refreshInviteRoleOptions() {
        var inviteRole = byId('inviteRole');
        if (inviteRole) inviteRole.innerHTML = renderRoleOptions('organization', inviteRole.value || 'viewer', false);
      }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path, options) {
        var res = await fetch(path, Object.assign({}, options || {}, { headers: Object.assign(headers(), (options && options.headers) || {}) }));
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      async function apiJson(path, options) {
        var opts = options || {};
        opts.headers = Object.assign(headers(), opts.headers || {});
        var res = await fetch(path, opts);
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!select) return;
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderMembers(payload) {
        if (payload.role_definitions) {
          roleDefinitions = {
            organization_roles: Array.isArray(payload.role_definitions.organization_roles) ? payload.role_definitions.organization_roles : roleDefinitions.organization_roles,
            project_roles: Array.isArray(payload.role_definitions.project_roles) ? payload.role_definitions.project_roles : roleDefinitions.project_roles
          };
        }
        refreshInviteRoleOptions();
        renderRoleGuide();
        var members = Array.isArray(payload.members) ? payload.members : [];
        var invites = Array.isArray(payload.invitations) ? payload.invitations.filter(function(invite) { return invite.status === 'pending'; }) : [];
        var incomingInvites = Array.isArray(payload.pending_invitations_for_me) ? payload.pending_invitations_for_me : [];
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        var admins = members.filter(function(member) { return isPrivilegedOrgRole(member.role); });
        var canManage = !!(payload.organization && payload.organization.can_manage_members);
        var adminPanel = byId('adminPanel');
        if (adminPanel) adminPanel.style.display = canManage ? 'block' : 'none';
        text('kpiMembers', number(members.length));
        text('kpiMembersSub', payload.organization ? payload.organization.name : 'active org');
        text('kpiAdmins', number(admins.length));
        text('kpiInvites', number(invites.length + incomingInvites.length));
        text('kpiProjects', number(projects.length));
        text('membersMeta', payload.organization && payload.organization.can_manage_members ? 'admin view' : 'read-only view');
        text('invitesMeta', (invites.length + incomingInvites.length) ? 'follow up' : 'clear');
        text('coverageMeta', projects.length + ' project scopes');
        var membersList = byId('membersList');
        if (membersList) {
          membersList.innerHTML = members.length ? members.map(function(member) {
            var access = Array.isArray(member.project_access) ? member.project_access : [];
            var roleControl = canManage ? '<div class="inline-actions"><select data-action="member-role" data-user-id="' + escapeHtml(member.user_id) + '">' + renderRoleOptions('organization', member.role, true)
              + '</select><select data-action="project-pick" data-user-id="' + escapeHtml(member.user_id) + '"><option value="">assign project...</option>' + projects.map(function(project) {
              return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
            }).join('') + '</select><select data-action="project-role" data-user-id="' + escapeHtml(member.user_id) + '">' + renderRoleOptions('project', 'viewer', true) + '</select><button type="button" data-action="assign-project" data-user-id="' + escapeHtml(member.user_id) + '">assign</button></div>' : '<span class="tag good">' + escapeHtml(roleLabel('organization', member.role)) + '</span>';
            var projectBadges = access.length ? '<div class="row-sub">' + access.map(function(item) {
              var remove = canManage ? ' <button type="button" class="danger" data-action="remove-project" data-user-id="' + escapeHtml(member.user_id) + '" data-project-id="' + escapeHtml(item.project_id) + '">remove</button>' : '';
              return '<span class="tag">' + escapeHtml(item.project_name || item.vp_proj_id) + ' / ' + escapeHtml(roleLabel('project', item.role)) + '</span>' + remove;
            }).join(' ') + '</div>' : '';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(member.email || member.user_id) + '</div><div class="row-sub">' + escapeHtml(roleLabel('organization', member.role)) + ' - ' + access.length + ' project scopes - joined ' + escapeHtml(rel(member.created_at)) + '</div>' + projectBadges + '</div>' + roleControl + '</div>';
          }).join('') : '<div class="empty">No members found.</div>';
        }
        var invitesList = byId('invitesList');
        if (invitesList) {
          var outgoingInviteRows = invites.map(function(invite) {
            var action = canManage ? '<button type="button" class="danger" data-action="revoke-invite" data-invite-id="' + escapeHtml(invite.id) + '">revoke</button>' : '<span class="tag warn">pending</span>';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(invite.email) + '</div><div class="row-sub">' + escapeHtml(roleLabel('organization', invite.role)) + ' - invited ' + escapeHtml(rel(invite.created_at)) + '</div></div>' + action + '</div>';
          });
          var incomingInviteRows = incomingInvites.map(function(invite) {
            var org = invite.organization || {};
            return '<div class="row"><div><div class="row-title">' + escapeHtml(org.name || 'Organization invite') + '</div><div class="row-sub">for ' + escapeHtml(invite.email) + ' as ' + escapeHtml(roleLabel('organization', invite.role)) + ' - invited ' + escapeHtml(rel(invite.created_at)) + '</div></div><button type="button" class="primary" data-action="accept-invite" data-invite-id="' + escapeHtml(invite.id) + '">accept</button></div>';
          });
          invitesList.innerHTML = outgoingInviteRows.concat(incomingInviteRows).length ? outgoingInviteRows.concat(incomingInviteRows).join('') : '<div class="empty">No pending invites.</div>';
        }
        var coverage = projects.map(function(project) {
          var assigned = members.filter(function(member) {
            return (member.project_access || []).some(function(access) { return access.project_id === project.id; });
          }).length;
          return { project: project, assigned: assigned };
        });
        var coverageList = byId('coverageList');
        if (coverageList) {
          coverageList.innerHTML = coverage.length ? coverage.map(function(item) {
            return '<div class="row"><div><div class="row-title">' + escapeHtml(item.project.name || item.project.vp_proj_id) + '</div><div class="row-sub">' + escapeHtml(item.project.vp_proj_id) + ' - created ' + escapeHtml(rel(item.project.created_at)) + '</div></div><span class="tag">' + number(item.assigned) + ' assigned</span></div>';
          }).join('') : '<div class="empty">No projects in this organization yet.</div>';
        }
      }
      async function load() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          var orgs = await fetchJson('/api/v1/enterprise/orgs');
          renderOrgSelector(orgs);
          var exportHref = '/api/v1/enterprise/members/access-review?format=csv';
          if (currentOrgId) exportHref += '&org=' + encodeURIComponent(currentOrgId);
          var exportLink = byId('accessReviewCsv');
          if (exportLink) exportLink.href = exportHref;
          renderMembers(await fetchJson('/api/v1/enterprise/members'));
        } catch (error) {
          notice(error && error.message ? error.message : 'Members failed to load.');
        }
      }
      var select = byId('orgSelect');
      if (select) select.addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        load();
      });
      var refresh = byId('refreshBtn');
      if (refresh) refresh.addEventListener('click', load);
      var inviteForm = byId('inviteForm');
      if (inviteForm) inviteForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        try {
          await apiJson('/api/v1/enterprise/members/invitations', {
            method: 'POST',
            body: JSON.stringify({
              email: byId('inviteEmail').value,
              role: byId('inviteRole').value
            })
          });
          byId('inviteEmail').value = '';
          await load();
        } catch (error) {
          notice(error && error.message ? error.message : 'Invite failed.');
        }
      });
      document.addEventListener('change', async function(event) {
        var target = event.target;
        if (!target || target.getAttribute('data-action') !== 'member-role') return;
        try {
          await apiJson('/api/v1/enterprise/members/' + encodeURIComponent(target.getAttribute('data-user-id')) + '/role', {
            method: 'POST',
            body: JSON.stringify({ role: target.value })
          });
          await load();
        } catch (error) {
          notice(error && error.message ? error.message : 'Role update failed.');
          await load();
        }
      });
      document.addEventListener('click', async function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var action = target.getAttribute('data-action');
        try {
          if (action === 'revoke-invite') {
            await apiJson('/api/v1/enterprise/members/invitations/' + encodeURIComponent(target.getAttribute('data-invite-id')) + '/revoke', { method: 'POST' });
            await load();
          }
          if (action === 'accept-invite') {
            await apiJson('/api/v1/enterprise/members/invitations/' + encodeURIComponent(target.getAttribute('data-invite-id')) + '/accept', { method: 'POST' });
            await load();
          }
          if (action === 'assign-project') {
            var userId = target.getAttribute('data-user-id');
            var projectSelect = document.querySelector('select[data-action="project-pick"][data-user-id="' + CSS.escape(userId) + '"]');
            var roleSelect = document.querySelector('select[data-action="project-role"][data-user-id="' + CSS.escape(userId) + '"]');
            if (!projectSelect || !projectSelect.value) throw new Error('Choose a project first.');
            await apiJson('/api/v1/enterprise/members/' + encodeURIComponent(userId) + '/projects/' + encodeURIComponent(projectSelect.value) + '/access', {
              method: 'POST',
              body: JSON.stringify({ role: roleSelect ? roleSelect.value : 'viewer' })
            });
            await load();
          }
          if (action === 'remove-project') {
            await apiJson('/api/v1/enterprise/members/' + encodeURIComponent(target.getAttribute('data-user-id')) + '/projects/' + encodeURIComponent(target.getAttribute('data-project-id')) + '/access', { method: 'DELETE' });
            await load();
          }
        } catch (error) {
          notice(error && error.message ? error.message : 'Member action failed.');
        }
      });
      load();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseAuditPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Audit - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 8px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder, textarea::placeholder { color: rgba(82,97,112,.48); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 760px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #23466f); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.86)); border-radius: 8px; padding: 20px; box-shadow: 0 22px 90px rgba(26,40,52,.16); }
    .filters { display: grid; grid-template-columns: 1.1fr .85fr .9fr .9fr 1.3fr auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .event { display: grid; grid-template-columns: 160px 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .event-time { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .event-title { font-weight: 780; letter-spacing: -.02em; }
    .event-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(37,99,235,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(21,128,61,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(180,83,9,.28); }
    .tag.bad { color: var(--red); border-color: rgba(220,38,38,.28); }
    details { margin-top: 8px; color: var(--muted); font-size: 13px; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid rgba(26,40,52,.12); border-radius: 8px; padding: 12px; background: rgba(26,40,52,.18); color: #526170; overflow: auto; }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(26,40,52,.22); border-radius: 8px; padding: 18px; background: rgba(248,250,252,.78); }
    .notice.error { color: var(--red); border-color: rgba(220,38,38,.3); }
    @media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .event { grid-template-columns: 1fr; } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis { grid-template-columns: 1fr; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('audit', 'audit evidence')}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">governance timeline</div>
          <h1>Audit</h1>
          <p class="lead">Search governance changes and secure runtime proxy events from the enterprise control plane, then export the exact filtered view for evidence reviews.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" id="csvLink" href="/api/v1/enterprise/audit?format=csv&days=30">export CSV</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="card">
        <form id="filterForm" class="filters">
          <select id="projectFilter" aria-label="Project"><option value="">All projects</option></select>
          <select id="sourceFilter" aria-label="Source">
            <option value="all">all sources</option>
            <option value="governance">governance</option>
            <option value="proxy">proxy/runtime</option>
          </select>
          <select id="eventTypeFilter" aria-label="Event type">
            <option value="">all event types</option>
            <option value="proxy_request">proxy_request</option>
            <option value="proxy_error">proxy_error</option>
            <option value="enterprise_provider_key_revoked">provider revoked</option>
            <option value="organization_invitation_created">invite created</option>
            <option value="organization_member_role_updated">role updated</option>
            <option value="project_policy_updated">project policy updated</option>
          </select>
          <select id="daysFilter" aria-label="Days">
            <option value="7">last 7 days</option>
            <option value="30" selected>last 30 days</option>
            <option value="90">last 90 days</option>
          </select>
          <input id="searchFilter" type="search" placeholder="Search actor, path, provider..." />
          <button class="primary" type="submit">apply</button>
        </form>
      </section>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">total events</div><div class="kpi-value" id="kpiTotal">...</div><div class="kpi-sub" id="kpiWindow">loading</div></div>
        <div class="card"><div class="kpi-label">governance</div><div class="kpi-value" id="kpiGovernance">...</div><div class="kpi-sub">org + policy changes</div></div>
        <div class="card"><div class="kpi-label">proxy/runtime</div><div class="kpi-value" id="kpiProxy">...</div><div class="kpi-sub">secure execution requests</div></div>
        <div class="card"><div class="kpi-label">next page</div><div class="kpi-value" id="kpiMore">...</div><div class="kpi-sub">cursor availability</div></div>
      </section>

      <section class="card">
        <div class="section-title"><h2>Timeline</h2><span id="timelineMeta" class="mini"></span></div>
        <div id="eventList" class="list"><div class="empty">Loading audit events...</div></div>
        <div style="margin-top:14px"><button id="loadMoreBtn" type="button" style="display:none">load older events</button></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var nextBefore = '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function buildAuditPath(before) {
        var params = new URLSearchParams();
        params.set('days', byId('daysFilter').value || '30');
        params.set('limit', '100');
        var source = byId('sourceFilter').value || 'all';
        if (source !== 'all') params.set('source', source);
        if (byId('projectFilter').value) params.set('project_id', byId('projectFilter').value);
        if (byId('eventTypeFilter').value) params.set('event_type', byId('eventTypeFilter').value);
        if (byId('searchFilter').value.trim()) params.set('q', byId('searchFilter').value.trim());
        if (before) params.set('before', before);
        return '/api/v1/enterprise/audit?' + params.toString();
      }
      function updateCsvLink() {
        var href = buildAuditPath('').replace('/api/v1/enterprise/audit?', '/api/v1/enterprise/audit?format=csv&');
        byId('csvLink').href = href;
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderProjects(payload) {
        var select = byId('projectFilter');
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        select.innerHTML = '<option value="">All projects</option>' + projects.map(function(project) {
          return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
        }).join('');
      }
      function renderEvents(payload, append) {
        var summary = payload.summary || {};
        var events = Array.isArray(payload.events) ? payload.events : [];
        text('kpiTotal', number(summary.totalEvents));
        text('kpiGovernance', number(summary.governanceEvents));
        text('kpiProxy', number(summary.proxyEvents));
        text('kpiWindow', 'last ' + (payload.filters && payload.filters.days ? payload.filters.days : byId('daysFilter').value) + ' days');
        text('kpiMore', payload.has_more ? 'yes' : 'no');
        text('timelineMeta', payload.organization ? payload.organization.name : 'active organization');
        nextBefore = payload.next_before || '';
        byId('loadMoreBtn').style.display = nextBefore ? 'inline-block' : 'none';
        var list = byId('eventList');
        var html = events.map(function(event) {
          var project = event.project || {};
          var statusClass = event.status && Number(event.status) >= 400 ? 'bad' : event.source === 'governance' ? 'good' : 'warn';
          var metadata = event.metadata && Object.keys(event.metadata).length ? JSON.stringify(event.metadata, null, 2) : '';
          return '<article class="event"><div class="event-time">' + escapeHtml(rel(event.timestamp)) + '<br>' + escapeHtml(event.timestamp || '') + '</div><div><div class="event-title">' + escapeHtml(event.event_type) + '</div><div class="event-sub">' + escapeHtml(event.description || '') + '</div><div><span class="tag ' + statusClass + '">' + escapeHtml(event.source) + '</span>' + (event.actor ? '<span class="tag">' + escapeHtml(event.actor) + '</span>' : '') + (project.id ? '<span class="tag">' + escapeHtml(project.name || project.vp_proj_id || project.id) + '</span>' : '') + (event.status != null ? '<span class="tag">status ' + escapeHtml(event.status) + '</span>' : '') + '</div>' + (metadata ? '<details><summary>event metadata</summary><pre>' + escapeHtml(metadata) + '</pre></details>' : '') + '</div><a class="tag" href="' + escapeHtml(byId('csvLink').href) + '">CSV</a></article>';
        }).join('');
        if (append && list.querySelector('.event')) {
          list.insertAdjacentHTML('beforeend', html || '');
        } else {
          list.innerHTML = html || '<div class="empty">No audit events match these filters.</div>';
        }
      }
      async function loadBase() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        var orgs = await fetchJson('/api/v1/enterprise/orgs');
        renderOrgSelector(orgs);
        var projects = await fetchJson('/api/v1/enterprise/projects');
        renderProjects(projects);
      }
      async function loadAudit(append) {
        updateCsvLink();
        var payload = await fetchJson(buildAuditPath(append ? nextBefore : ''));
        renderEvents(payload, append);
      }
      async function reload() {
        try {
          await loadBase();
          await loadAudit(false);
        } catch (error) {
          notice(error && error.message ? error.message : 'Audit failed to load.');
        }
      }
      byId('filterForm').addEventListener('submit', function(event) {
        event.preventDefault();
        loadAudit(false).catch(function(error) { notice(error && error.message ? error.message : 'Audit failed to load.'); });
      });
      byId('loadMoreBtn').addEventListener('click', function() {
        loadAudit(true).catch(function(error) { notice(error && error.message ? error.message : 'Older audit events failed to load.'); });
      });
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseAlertsPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Alerts - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 8px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    button[disabled] { cursor: not-allowed; opacity: .58; }
    input::placeholder, textarea::placeholder { color: rgba(82,97,112,.48); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 760px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #23466f); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.86)); border-radius: 8px; padding: 20px; box-shadow: 0 22px 90px rgba(26,40,52,.16); }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .row-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(37,99,235,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(21,128,61,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(180,83,9,.28); }
    .tag.bad { color: var(--red); border-color: rgba(220,38,38,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(26,40,52,.22); border-radius: 8px; padding: 18px; background: rgba(248,250,252,.78); }
    .notice.error { color: var(--red); border-color: rgba(220,38,38,.3); }
    .slot-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .slot-form label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .slot-form input, .slot-form select, .slot-form textarea { width: 100%; }
    .slot-form textarea { min-height: 78px; resize: vertical; }
    .slot-form .wide { grid-column: span 2; }
    .slot-form-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
    .slot-form-note { color: var(--muted); font-size: 13px; line-height: 1.45; margin: 0; }
    @media (max-width: 1100px) { .filters, .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two, .slot-form { grid-template-columns: 1fr; } .slot-form .wide { grid-column: auto; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('alerts', 'alert operations')}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">ops notifications</div>
          <h1>Alerts</h1>
          <p class="lead">Review alert destinations, dispatch policy, delivery logs, and policy dispatch runs from the enterprise control plane.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <button id="testSendBtn" type="button" disabled title="Load destinations before sending a test alert">test send</button>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">destinations</div><div class="kpi-value" id="kpiDestinations">...</div><div class="kpi-sub" id="kpiEnabled">loading</div></div>
        <div class="card"><div class="kpi-label">policy</div><div class="kpi-value" id="kpiPolicy">...</div><div class="kpi-sub" id="kpiSeverity">minimum severity</div></div>
        <div class="card"><div class="kpi-label">deliveries</div><div class="kpi-value" id="kpiDeliveries">...</div><div class="kpi-sub">filtered delivery logs</div></div>
        <div class="card"><div class="kpi-label">dispatch runs</div><div class="kpi-value" id="kpiRuns">...</div><div class="kpi-sub" id="kpiCooldown">policy cadence</div></div>
      </section>

      <section class="grid two">
        <div class="card">
          <div class="section-title"><h2>Dispatch policy</h2><span id="policyMeta" class="mini"></span></div>
          <div id="policyDetails" class="list"><div class="empty">Loading policy...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Destinations</h2><span id="destinationMeta" class="mini"></span></div>
          <div id="destinationList" class="list"><div class="empty">Loading destinations...</div></div>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="section-title"><h2>Delivery logs</h2><span id="deliveryMeta" class="mini"></span></div>
        <form id="deliveryFilterForm" class="filters">
          <select id="activityWindow" aria-label="Activity window">
            <option value="24h">last 24h</option>
            <option value="7d" selected>last 7d</option>
            <option value="30d">last 30d</option>
            <option value="all">all time</option>
          </select>
          <select id="deliveryStatus" aria-label="Delivery status">
            <option value="all">all statuses</option>
            <option value="delivered">delivered</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
          </select>
          <select id="deliveryChannel" aria-label="Delivery channel">
            <option value="all">all channels</option>
            <option value="email">email</option>
            <option value="webhook">webhook</option>
          </select>
          <select id="deliveryKind" aria-label="Delivery kind">
            <option value="all">all kinds</option>
            <option value="test_send">test send</option>
            <option value="policy_dispatch">policy dispatch</option>
          </select>
          <input id="deliverySearch" type="search" placeholder="Search delivery detail..." />
          <button class="primary" type="submit">apply</button>
        </form>
        <div id="deliveryList" class="list"><div class="empty">Loading delivery logs...</div></div>
        <div style="margin-top:14px"><button id="loadMoreDeliveriesBtn" type="button" style="display:none">load older deliveries</button></div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="section-title"><h2>Dispatch runs</h2><span id="runMeta" class="mini"></span></div>
        <div id="runList" class="list"><div class="empty">Loading dispatch runs...</div></div>
        <div style="margin-top:14px"><button id="loadMoreRunsBtn" type="button" style="display:none">load older runs</button></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var nextDeliveryBefore = '';
      var nextRunBefore = '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      async function postJson(path, body) {
        var res = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function buildAlertsPath(extra) {
        var params = new URLSearchParams();
        params.set('activity_window', byId('activityWindow').value || '7d');
        params.set('delivery_limit', '20');
        params.set('run_limit', '20');
        if (byId('deliveryStatus').value !== 'all') params.set('delivery_status', byId('deliveryStatus').value);
        if (byId('deliveryChannel').value !== 'all') params.set('delivery_channel', byId('deliveryChannel').value);
        if (byId('deliveryKind').value !== 'all') params.set('delivery_kind', byId('deliveryKind').value);
        if (byId('deliverySearch').value.trim()) params.set('delivery_q', byId('deliverySearch').value.trim());
        if (extra && extra.deliveryBefore) params.set('delivery_before', extra.deliveryBefore);
        if (extra && extra.runBefore) params.set('run_before', extra.runBefore);
        return '/api/v1/enterprise/alerts?' + params.toString();
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function statusTag(status) {
        var cls = status === 'delivered' || status === 'dispatched' ? 'good' : status === 'failed' ? 'bad' : 'warn';
        return '<span class="tag ' + cls + '">' + escapeHtml(status || 'unknown') + '</span>';
      }
      function renderPayload(payload, appendMode) {
        var destinations = Array.isArray(payload.destinations) ? payload.destinations : [];
        var deliveries = Array.isArray(payload.delivery_logs) ? payload.delivery_logs : [];
        var runs = Array.isArray(payload.dispatch_runs) ? payload.dispatch_runs : [];
        var policy = payload.policy || {};
        var deliveryMeta = payload.delivery_logs_meta || {};
        var runMeta = payload.dispatch_runs_meta || {};
        var enabledCount = destinations.filter(function(destination) { return destination.enabled; }).length;
        text('kpiDestinations', number(destinations.length));
        text('kpiEnabled', enabledCount + ' enabled');
        text('kpiPolicy', policy.dispatch_enabled ? 'on' : 'off');
        text('kpiSeverity', 'minimum ' + (policy.minimum_severity || 'warning'));
        text('kpiDeliveries', number(deliveryMeta.total || deliveries.length));
        text('kpiRuns', number(runMeta.total || runs.length));
        text('kpiCooldown', payload.dispatch_status && payload.dispatch_status.cooldown_active ? 'cooldown active' : 'eligible');
        text('policyMeta', payload.can_manage ? 'admin view' : 'read-only view');
        text('destinationMeta', enabledCount + ' enabled of ' + destinations.length);
        text('deliveryMeta', (deliveryMeta.filters && deliveryMeta.filters.activity_window ? deliveryMeta.filters.activity_window : '7d') + ' window');
        text('runMeta', (runMeta.filters && runMeta.filters.activity_window ? runMeta.filters.activity_window : '7d') + ' window');
        var firstEnabledDestination = destinations.find(function(destination) { return destination.enabled; });
        var testSendBtn = byId('testSendBtn');
        testSendBtn.disabled = !payload.can_manage || !firstEnabledDestination;
        testSendBtn.dataset.destinationId = firstEnabledDestination ? firstEnabledDestination.id : '';
        testSendBtn.title = !payload.can_manage
          ? 'Only admins can test alert delivery'
          : firstEnabledDestination
            ? 'Send a test alert to ' + (firstEnabledDestination.label || firstEnabledDestination.channel_type)
            : 'No enabled alert destinations are configured';
        byId('policyDetails').innerHTML = '<div class="row"><div><div class="row-title">Policy dispatch is ' + escapeHtml(policy.dispatch_enabled ? 'enabled' : 'disabled') + '</div><div class="row-sub">Minimum severity ' + escapeHtml(policy.minimum_severity || 'warning') + ' - minimum interval ' + number(policy.min_interval_minutes || 0) + ' minutes - next eligible ' + escapeHtml(payload.dispatch_status && payload.dispatch_status.next_eligible_at ? rel(payload.dispatch_status.next_eligible_at) : 'now') + '</div></div>' + statusTag(policy.dispatch_enabled ? 'dispatched' : 'skipped') + '</div>';
        byId('destinationList').innerHTML = destinations.length ? destinations.map(function(destination) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(destination.label || destination.channel_type) + '</div><div class="row-sub">' + escapeHtml(destination.channel_type) + ' - ' + escapeHtml(destination.target_masked || '') + ' - updated ' + escapeHtml(rel(destination.updated_at || destination.created_at)) + '</div></div>' + statusTag(destination.enabled ? 'delivered' : 'skipped') + '</div>';
        }).join('') : '<div class="empty">No alert destinations configured yet.</div>';
        var deliveryHtml = deliveries.map(function(delivery) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(delivery.delivery_kind) + ' / ' + escapeHtml(delivery.channel_type) + '</div><div class="row-sub">' + escapeHtml(delivery.detail || '') + ' - ' + escapeHtml(rel(delivery.delivered_at)) + (delivery.response_status ? ' - HTTP ' + escapeHtml(delivery.response_status) : '') + '</div></div>' + statusTag(delivery.status) + '</div>';
        }).join('');
        if (appendMode === 'deliveries' && byId('deliveryList').querySelector('.row')) {
          byId('deliveryList').insertAdjacentHTML('beforeend', deliveryHtml);
        } else if (appendMode !== 'runs') {
          byId('deliveryList').innerHTML = deliveryHtml || '<div class="empty">No delivery logs match these filters.</div>';
        }
        var runHtml = runs.map(function(run) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(run.trigger_source) + ' dispatch - ' + escapeHtml(run.reason || 'policy check') + '</div><div class="row-sub">' + escapeHtml(rel(run.checked_at)) + ' - alerts ' + number(run.dispatched_alert_count) + ' - destinations ' + number(run.destination_count) + ' - delivered ' + number(run.delivered_count) + ' - failed ' + number(run.failed_count) + ' - skipped ' + number(run.skipped_count) + '</div></div>' + statusTag(run.status) + '</div>';
        }).join('');
        if (appendMode === 'runs' && byId('runList').querySelector('.row')) {
          byId('runList').insertAdjacentHTML('beforeend', runHtml);
        } else if (appendMode !== 'deliveries') {
          byId('runList').innerHTML = runHtml || '<div class="empty">No dispatch runs match these filters.</div>';
        }
        nextDeliveryBefore = deliveryMeta.next_before || '';
        nextRunBefore = runMeta.next_before || '';
        byId('loadMoreDeliveriesBtn').style.display = nextDeliveryBefore ? 'inline-block' : 'none';
        byId('loadMoreRunsBtn').style.display = nextRunBefore ? 'inline-block' : 'none';
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          renderOrgSelector(await fetchJson('/api/v1/enterprise/orgs'));
          renderPayload(await fetchJson(buildAlertsPath()), '');
        } catch (error) {
          notice(error && error.message ? error.message : 'Alerts failed to load.');
        }
      }
      byId('deliveryFilterForm').addEventListener('submit', function(event) {
        event.preventDefault();
        fetchJson(buildAlertsPath()).then(function(payload) { renderPayload(payload, ''); }).catch(function(error) { notice(error && error.message ? error.message : 'Alerts failed to load.'); });
      });
      byId('loadMoreDeliveriesBtn').addEventListener('click', function() {
        fetchJson(buildAlertsPath({ deliveryBefore: nextDeliveryBefore })).then(function(payload) { renderPayload(payload, 'deliveries'); }).catch(function(error) { notice(error && error.message ? error.message : 'Older deliveries failed to load.'); });
      });
      byId('loadMoreRunsBtn').addEventListener('click', function() {
        fetchJson(buildAlertsPath({ runBefore: nextRunBefore })).then(function(payload) { renderPayload(payload, 'runs'); }).catch(function(error) { notice(error && error.message ? error.message : 'Older dispatch runs failed to load.'); });
      });
      byId('testSendBtn').addEventListener('click', function() {
        var destinationId = byId('testSendBtn').dataset.destinationId || '';
        byId('testSendBtn').disabled = true;
        postJson('/api/v1/enterprise/alerts/test-send', { destination_id: destinationId })
          .then(function(payload) {
            notice('Test alert ' + (payload.status || 'sent') + ': ' + (payload.detail || 'delivery recorded'));
            return reload();
          })
          .catch(function(error) {
            notice(error && error.message ? error.message : 'Test alert failed.');
          })
          .finally(function() {
            byId('testSendBtn').disabled = !byId('testSendBtn').dataset.destinationId;
          });
      });
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseOperationsPage(pageName: 'activity' | 'projects' | 'inventory' | 'policy' | 'rollout' | 'keys'): string {
  const pageTitle = pageName === 'activity' ? 'Activity' : pageName === 'projects' ? 'Projects' : pageName === 'inventory' ? 'API Inventory' : pageName === 'policy' ? 'Policy Drift' : pageName === 'rollout' ? 'Rollout Manager' : 'Provider Slots';
  const pageKicker = pageName === 'activity' ? 'runtime feed' : pageName === 'projects' ? 'project inventory' : pageName === 'inventory' ? 'api inventory' : pageName === 'policy' ? 'accepted risk' : pageName === 'rollout' ? 'workload cutover' : 'secrets posture';
  const pageLead = pageName === 'activity'
    ? 'Review secure proxy/runtime events, status codes, latency, provider request IDs, and attestation evidence hints.'
    : pageName === 'projects'
      ? 'Track enterprise projects, provider coverage, caller-lock policy, traffic health, and quick links into Control.'
      : pageName === 'inventory'
        ? 'Map every API surface, owner, protection state, policy control, traffic signal, and review decision without storing secrets.'
        : pageName === 'policy'
          ? 'Review caller-lock drift, missing controls, placeholder-material risk, accepted exceptions, owners, expiry dates, and remaining blockers before paid traffic.'
          : pageName === 'rollout'
            ? 'Move one customer workload into VaultProof with app and gateway owners, test status, canary percentage, rollback path, blockers, and customer-safe evidence.'
            : 'Review active provider slots, trigger emergency revoke, and keep rotation posture visible without exposing upstream secrets.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(pageTitle)} - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 8px; padding: 11px 12px; font: inherit; max-width: 100%; min-width: 0; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder, textarea::placeholder { color: rgba(82,97,112,.48); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 780px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #23466f); color: var(--ink); border: 0; font-weight: 850; }
    .danger { color: var(--red); border-color: rgba(220,38,38,.34); }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.86)); border-radius: 8px; padding: 20px; box-shadow: 0 22px 90px rgba(26,40,52,.16); }
    .filters { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(150px, .7fr) minmax(180px, 1fr) auto; gap: 10px; margin-bottom: 16px; }
    .inventory-filters { grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(130px, .72fr)) auto auto; }
    .inventory-bulk-review { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(170px, .7fr) auto; gap: 10px; align-items: center; margin: 0; }
    .policy-filters { grid-template-columns: minmax(220px, 1.4fr) repeat(3, minmax(150px, .72fr)) auto auto; }
    .rollout-filters { grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(130px, .72fr)) auto auto; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .inventory-row { display: grid; gap: 14px; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .inventory-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: start; }
    .inventory-fields { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .inventory-field { display: grid; gap: 5px; min-width: 0; }
    .inventory-field.wide { grid-column: span 2; }
    .inventory-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .inventory-field input, .inventory-field select { width: 100%; min-width: 0; }
    .inventory-field textarea { width: 100%; min-height: 74px; resize: vertical; border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 8px; padding: 11px 12px; font: inherit; }
    .inventory-page { display: grid; gap: 16px; }
    .inventory-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .inventory-main, .inventory-side-rail { display: grid; gap: 16px; min-width: 0; }
    .inventory-side-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .inventory-panel { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.88)); border-radius: 8px; padding: 18px; box-shadow: 0 18px 70px rgba(26,40,52,.12); min-width: 0; }
    .inventory-command-head, .inventory-board-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
    .inventory-command-head h2, .inventory-board-head h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .inventory-command-head p, .inventory-board-head p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .inventory-filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0; align-items: stretch; }
    .inventory-filter-grid #inventorySearch { grid-column: span 2; }
    .inventory-filter-grid > * { width: 100%; }
    .inventory-command-actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; margin-top: 12px; }
    .inventory-bulk-review { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); align-items: stretch; }
    .inventory-bulk-review > * { width: 100%; }
    .inventory-export-row { display: flex; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
    .inventory-export-row button, .inventory-command-actions button, .inventory-filter-grid button { min-height: 42px; white-space: normal; text-align: center; }
    .inventory-table-head { display: grid; grid-template-columns: minmax(220px, 1.45fr) minmax(140px, .74fr) minmax(110px, .58fr) minmax(110px, .58fr) minmax(120px, .58fr) minmax(150px, .7fr); gap: 12px; padding: 0 12px 8px; color: rgba(82,97,112,.64); font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid rgba(26,40,52,.10); }
    .inventory-list { gap: 0; }
    .inventory-record { border-bottom: 1px solid rgba(26,40,52,.12); padding: 16px 12px; background: rgba(255,255,255,.5); }
    .inventory-record:last-child { border-bottom: 0; }
    .inventory-record-main { display: grid; grid-template-columns: minmax(220px, 1.45fr) minmax(140px, .74fr) minmax(110px, .58fr) minmax(110px, .58fr) minmax(120px, .58fr) minmax(150px, .7fr); gap: 12px; align-items: start; min-width: 0; }
    .inventory-record-title { font-weight: 850; letter-spacing: -.02em; overflow-wrap: anywhere; }
    .inventory-record-sub { color: var(--muted); font-size: 12px; line-height: 1.42; margin-top: 5px; overflow-wrap: anywhere; }
    .inventory-cell-label { color: rgba(82,97,112,.58); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; font-weight: 850; margin-bottom: 5px; display: none; }
    .inventory-cell-value { font-size: 13px; line-height: 1.42; overflow-wrap: anywhere; }
    .inventory-cell-value strong { display: block; color: var(--text); font-size: 14px; letter-spacing: -.01em; }
    .inventory-status-list { margin-top: 8px; }
    .inventory-record-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
    .inventory-record-actions > * { max-width: 100%; white-space: normal; }
    .inventory-detail-grid { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(26,40,52,.10); grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .inventory-policy-note { border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 10px 12px; background: rgba(248,250,252,.74); }
    .inventory-summary-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .inventory-metric-card { border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 12px; background: rgba(248,250,252,.74); }
    .inventory-metric-card strong { display: block; font-size: 24px; letter-spacing: -.04em; }
    .inventory-metric-card span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
    .row-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: start; }
    .slot-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .slot-form label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .slot-form input, .slot-form select, .slot-form textarea { width: 100%; }
    .slot-form textarea { min-height: 78px; resize: vertical; }
    .slot-form .wide { grid-column: span 2; }
    .slot-form-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
    .slot-form-note { color: var(--muted); font-size: 13px; line-height: 1.45; margin: 0; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(37,99,235,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(21,128,61,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(180,83,9,.28); }
    .tag.bad { color: var(--red); border-color: rgba(220,38,38,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(26,40,52,.22); border-radius: 8px; padding: 18px; background: rgba(248,250,252,.78); }
    .notice.error { color: var(--red); border-color: rgba(220,38,38,.3); }
    @media (max-width: 1360px) { .inventory-record-main, .inventory-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .inventory-table-head { display: none; } .inventory-cell-label { display: block; } .inventory-record-actions { justify-content: flex-start; } }
    @media (max-width: 1100px) { .filters, .kpis, .two, .inventory-fields, .slot-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } .inventory-filter-grid #inventorySearch { grid-column: auto; } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two, .inventory-head, .inventory-fields, .slot-form, .inventory-filter-grid, .inventory-bulk-review, .inventory-command-actions, .inventory-record-main, .inventory-detail-grid, .inventory-side-rail { grid-template-columns: 1fr; } .inventory-field.wide, .slot-form .wide, .inventory-filter-grid #inventorySearch { grid-column: auto; } .inventory-command-head, .inventory-board-head { flex-direction: column; } .inventory-export-row { justify-content: flex-start; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar(pageName, pageKicker)}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">${escapeHtml(pageKicker)}</div>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p class="lead">${escapeHtml(pageLead)}</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          ${pageName === 'keys' ? '<button id="openProviderSlotForm" class="primary" type="button">add slot</button><button id="copyExposureResponseReportBtn" type="button">copy incident report</button>' : ''}
          ${pageName === 'inventory' ? '<button id="openManualApiKeyForm" class="primary" type="button">add API key</button><button id="openInventoryImportForm" type="button">import CSV/OpenAPI</button>' : ''}
          ${pageName === 'policy' ? '<button id="copyPolicyBriefBtn" type="button">copy drift brief</button><button id="copyPolicyJsonBtn" class="primary" type="button">copy policy JSON</button>' : ''}
          ${pageName === 'rollout' ? '<button id="copyRolloutBriefBtn" type="button">copy rollout brief</button><button id="copyRolloutJsonBtn" class="primary" type="button">copy rollout JSON</button>' : ''}
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" href="/app/control">open control</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      ${pageName === 'keys' ? `
      <section id="providerSlotFormPanel" class="card" style="display:none;margin-bottom:16px">
        <div class="section-title"><h2>Add provider slot</h2><span class="mini">placeholder material</span></div>
        <form id="providerSlotForm">
          <div class="slot-form">
            <label>Project
              <select id="slotProject" required></select>
            </label>
            <label>Provider
              <input id="slotProvider" list="providerSlotOptions" value="openai" required maxlength="64" />
            </label>
            <label>Slug
              <input id="slotSlug" value="openai" required maxlength="64" />
            </label>
            <label class="wide">Upstream base URL
              <input id="slotUpstream" value="https://api.openai.com" required />
            </label>
            <label>Auth header
              <input id="slotHeaderName" value="authorization" required />
            </label>
            <label class="wide">Auth template
              <input id="slotHeaderTemplate" value="Bearer {key}" required />
            </label>
            <label class="wide">Extra headers JSON
              <textarea id="slotExtraHeaders" placeholder='{"anthropic-version":"2023-06-01"}'></textarea>
            </label>
          </div>
          <datalist id="providerSlotOptions">
${renderDatalistOptions(ENTERPRISE_PROVIDER_SLOT_PRESETS.map((preset) => preset.id))}
          </datalist>
          <div class="slot-form-actions">
            <button class="primary" type="submit">create slot</button>
            <button id="cancelProviderSlotForm" type="button">cancel</button>
            <p class="slot-form-note">Real provider keys stay out of this browser flow until sealed ingest is enabled.</p>
          </div>
        </form>
      </section>` : ''}

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">active scopes</div></div>
        <div class="card"><div class="kpi-label">provider slots</div><div class="kpi-value" id="kpiKeys">...</div><div class="kpi-sub" id="kpiProviders">active providers</div></div>
        <div class="card"><div class="kpi-label">calls</div><div class="kpi-value" id="kpiCalls">...</div><div class="kpi-sub">all-time proxy logs</div></div>
        <div class="card"><div class="kpi-label">denied</div><div class="kpi-value" id="kpiDenied">...</div><div class="kpi-sub">401 / 403 / 429</div></div>
      </section>

      <section id="activityPanel" class="card" style="display:none">
        <div class="section-title"><h2>Runtime activity</h2><span id="activityMeta" class="mini"></span></div>
        <form id="activityFilterForm" class="filters">
          <select id="activityProjectFilter" aria-label="Project"><option value="">All projects</option></select>
          <select id="activityStatusFilter" aria-label="Status">
            <option value="">all statuses</option>
            <option value="proxy_request">successful</option>
            <option value="proxy_error">errors</option>
          </select>
          <input id="activitySearch" type="search" placeholder="Search provider, path, method..." />
          <button class="primary" type="submit">apply</button>
        </form>
        <div id="activityList" class="list"><div class="empty">Loading activity...</div></div>
      </section>

      <section id="projectsPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Project inventory</h2><span id="projectMeta" class="mini"></span></div>
          <div id="projectList" class="list"><div class="empty">Loading projects...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Project health</h2><span id="healthMeta" class="mini"></span></div>
          <div id="healthList" class="list"><div class="empty">Loading health...</div></div>
        </div>
      </section>

      <section id="inventoryPanel" class="inventory-page" style="display:none">
        <div id="inventoryImportFormPanel" class="card" style="display:none;grid-column:1/-1">
          <div class="section-title"><h2>Import CSV/OpenAPI</h2><span class="mini">metadata only</span></div>
          <form id="inventoryImportForm">
            <div class="slot-form">
              <label>Project
                <select id="inventoryImportProject"></select>
              </label>
              <label>Format
                <select id="inventoryImportFormat">
                  <option value="auto">auto detect</option>
                  <option value="csv">CSV</option>
                  <option value="openapi">OpenAPI JSON</option>
                </select>
              </label>
              <label>Default owner
                <input id="inventoryImportOwner" placeholder="Platform owner" maxlength="96" />
              </label>
              <label>Default environment
                <select id="inventoryImportEnvironment">
                  <option value="demo">sandbox</option>
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="production">production</option>
                </select>
              </label>
              <label class="wide">Import data
                <textarea id="inventoryImportText" placeholder="CSV columns: provider,key_label,upstream_scope,business_owner,technical_owner,environment,business_service,data_sensitivity,risk,review_status,next_review_date. Or paste OpenAPI JSON with info, servers, paths, and securitySchemes." required></textarea>
              </label>
            </div>
            <div class="slot-form-actions">
              <button class="primary" type="submit">import inventory metadata</button>
              <button id="cancelInventoryImportForm" type="button">cancel</button>
              <p class="slot-form-note">Imports create metadata-only API inventory hints. Do not paste raw API keys, bearer tokens, request bodies, response bodies, or customer payloads.</p>
            </div>
          </form>
        </div>
        <div id="manualApiKeyFormPanel" class="card" style="display:none;grid-column:1/-1">
          <div class="section-title"><h2>Add manual API key</h2><span class="mini">metadata only</span></div>
          <form id="manualApiKeyForm">
            <div class="slot-form">
              <label>Project
                <select id="manualKeyProject"></select>
              </label>
              <label>Provider
                <input id="manualKeyProvider" list="manualApiKeyProviderOptions" placeholder="openai, stripe, resend" required maxlength="64" />
              </label>
              <label>API key label
                <input id="manualKeyLabel" placeholder="Production billing key" required maxlength="96" />
              </label>
              <label>Key fingerprint
                <input id="manualKeyReference" placeholder="last 4 or fingerprint only" maxlength="96" />
              </label>
              <label class="wide">Key location
                <input id="manualKeyLocation" placeholder="GCP Secret Manager, customer vault, owner-held" maxlength="140" />
              </label>
              <label class="wide">Upstream scope
                <input id="manualKeyScope" placeholder="api.provider.com/v1/messages, billing API, email send API" maxlength="180" />
              </label>
              <label>Business owner
                <input id="manualKeyBusinessOwner" placeholder="Security owner" maxlength="96" />
              </label>
              <label>Technical owner
                <input id="manualKeyTechnicalOwner" placeholder="Platform owner" maxlength="96" />
              </label>
              <label>Environment
                <select id="manualKeyEnvironment">
                  <option value="demo">sandbox</option>
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="production">production</option>
                </select>
              </label>
              <label>Rotation status
                <select id="manualKeyRotationStatus">
                  <option value="unknown">unknown</option>
                  <option value="current">current</option>
                  <option value="rotation_due">rotation due</option>
                  <option value="rotated_for_demo">rotated for pilot</option>
                  <option value="accepted_demo_only">accepted for pilot</option>
                </select>
              </label>
              <label>Review status
                <select id="manualKeyReviewStatus">
                  <option value="needs_review">needs review</option>
                  <option value="approved">approved</option>
                  <option value="exception">exception</option>
                  <option value="blocked">blocked</option>
                </select>
              </label>
              <label>Next review
                <input id="manualKeyNextReview" type="date" />
              </label>
            </div>
            <datalist id="manualApiKeyProviderOptions">
${renderDatalistOptions(ENTERPRISE_MANUAL_API_KEY_PROVIDER_OPTIONS)}
            </datalist>
            <div class="slot-form-actions">
              <button class="primary" type="submit">save API key metadata</button>
              <button id="cancelManualApiKeyForm" type="button">cancel</button>
              <p class="slot-form-note">Do not paste raw API keys here. Store only provider, label, fingerprint/last four, owner, location, and review metadata.</p>
            </div>
          </form>
        </div>
        <div class="inventory-layout">
          <div class="inventory-main">
            <section class="inventory-panel inventory-command-panel">
              <div class="inventory-command-head">
                <div>
                  <h2>Review queue</h2>
                  <p>Filter the API surface list, apply review decisions in bulk, and export customer-safe evidence.</p>
                </div>
                <span id="inventoryMeta" class="tag good">metadata-only</span>
              </div>
              <form id="inventoryFilterForm" class="inventory-filter-grid">
                <input id="inventorySearch" type="search" placeholder="Search project, provider, owner, scope..." />
                <select id="inventoryStatusFilter" aria-label="Inventory status">
                  <option value="">all statuses</option>
                  <option value="protected">protected</option>
                  <option value="manual">manual API keys</option>
                  <option value="imported">CSV/OpenAPI imports</option>
                  <option value="missing_provider_slot">missing provider slot</option>
                  <option value="needs_sealed_ingest">needs sealed ingest</option>
                  <option value="policy_incomplete">policy incomplete</option>
                  <option value="no_recent_traffic">no recent traffic</option>
                  <option value="review_due">review due</option>
                  <option value="blocked">blocked</option>
                </select>
                <select id="inventoryReviewFilter" aria-label="Review status">
                  <option value="">all reviews</option>
                  <option value="needs_review">needs review</option>
                  <option value="approved">approved</option>
                  <option value="exception">exception</option>
                  <option value="blocked">blocked</option>
                </select>
                <select id="inventoryRiskFilter" aria-label="Risk">
                  <option value="">all risk</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
                <select id="inventorySourceFilter" aria-label="Source">
                  <option value="">all sources</option>
                  <option value="project_slot">project/provider rows</option>
                  <option value="manual">manual key metadata</option>
                  <option value="imported">imported API hints</option>
                </select>
                <button class="primary" type="submit">apply filters</button>
                <button id="clearInventoryFilters" type="button">clear</button>
              </form>
              <div class="inventory-command-actions">
                <form id="inventoryBulkReviewForm" class="inventory-bulk-review">
                  <select id="bulkInventoryReviewStatus" aria-label="Bulk review status">
                    <option value="">mark visible rows...</option>
                    <option value="approved">approved</option>
                    <option value="exception">exception</option>
                    <option value="blocked">blocked</option>
                    <option value="needs_review">needs review</option>
                  </select>
                  <input id="bulkInventoryNextReview" type="date" aria-label="Optional next review date" />
                  <button class="primary" type="submit">apply filtered review</button>
                </form>
                <div class="inventory-export-row">
                  <button id="copyInventoryCsvBtn" type="button">copy inventory CSV</button>
                  <button id="copyFilteredInventoryCsvBtn" type="button">copy filtered CSV</button>
                  <button id="copyInventoryReviewBriefBtn" type="button">copy review brief</button>
                  <button id="copyInventoryJsonBtn" class="primary" type="button">copy inventory JSON</button>
                </div>
              </div>
            </section>

            <section class="inventory-panel inventory-board-panel">
              <div class="inventory-board-head">
                <div>
                  <h2>API inventory board</h2>
                  <p>Each row is metadata-only. Use Provider Slots when a raw key needs protected execution.</p>
                </div>
              </div>
              <div class="inventory-table-head" aria-hidden="true">
                <div>API surface</div>
                <div>Owner</div>
                <div>Policy</div>
                <div>Traffic</div>
                <div>Review</div>
                <div>Actions</div>
              </div>
              <div id="inventoryList" class="list inventory-list"><div class="empty">Loading API inventory...</div></div>
            </section>
          </div>

          <aside class="inventory-side-rail">
            <section class="inventory-panel">
              <div class="section-title"><h2>Inventory evidence</h2><span class="mini">no secrets</span></div>
              <div id="inventorySummaryList" class="list"></div>
            </section>
            <section class="inventory-panel">
              <div class="section-title"><h2>Review workflow</h2><span class="mini">customer handoff</span></div>
              <div id="inventoryWorkflowList" class="list"></div>
            </section>
          </aside>
        </div>
      </section>

      <section id="policyPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Policy drift board</h2><span id="policyMeta" class="mini">accepted-risk records</span></div>
          <form id="policyFilterForm" class="filters policy-filters">
            <input id="policySearch" type="search" placeholder="Search control, project, provider, owner..." />
            <select id="policySeverityFilter" aria-label="Policy severity">
              <option value="">all severity</option>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
            </select>
            <select id="policyStatusFilter" aria-label="Policy status">
              <option value="">all status</option>
              <option value="open_drift">open drift</option>
              <option value="accepted_demo">pilot accepted</option>
              <option value="approved_exception">approved exception</option>
              <option value="expired_exception">expired exception</option>
              <option value="blocked">blocked</option>
            </select>
            <select id="policyControlFilter" aria-label="Policy control">
              <option value="">all controls</option>
              <option value="missing-provider-slot">missing provider slot</option>
              <option value="demo-placeholder-material">placeholder material</option>
              <option value="strict-origin-missing">strict origin</option>
              <option value="gateway-lock-missing">gateway lock</option>
              <option value="method-lock-missing">method lock</option>
              <option value="upstream-scope-missing">upstream scope</option>
              <option value="inventory-owner-missing">owner metadata</option>
              <option value="traffic-evidence-missing">traffic evidence</option>
              <option value="traffic-evidence-stale">stale traffic</option>
              <option value="inventory-review-due">review due</option>
              <option value="inventory-blocked">inventory blocked</option>
            </select>
            <button class="primary" type="submit">apply filters</button>
            <button id="clearPolicyFilters" type="button">clear</button>
          </form>
          <div id="policyList" class="list"><div class="empty">Loading policy drift...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Exception evidence</h2><span class="mini">no secrets</span></div>
          <div id="policySummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Review workflow</h2><span class="mini">paid-user ready</span></div>
          <div id="policyWorkflowList" class="list"></div>
        </div>
      </section>

      <section id="rolloutPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Integration rollout board</h2><span id="rolloutMeta" class="mini">workload cutover</span></div>
          <form id="rolloutFilterForm" class="filters rollout-filters">
            <input id="rolloutSearch" type="search" placeholder="Search workload, project, provider, owner..." />
            <select id="rolloutStatusFilter" aria-label="Rollout status">
              <option value="">all status</option>
              <option value="hold">hold</option>
              <option value="draft">draft</option>
              <option value="planned">planned</option>
              <option value="ready_for_canary">ready for canary</option>
              <option value="canary">canary</option>
              <option value="live">live</option>
              <option value="rollback">rollback</option>
            </select>
            <select id="rolloutModeFilter" aria-label="Integration mode">
              <option value="">all modes</option>
              <option value="vaultproof_proxy">VaultProof proxy</option>
              <option value="customer_gateway">customer gateway</option>
              <option value="sdk">SDK</option>
              <option value="sidecar">sidecar</option>
              <option value="manual_test">manual test</option>
              <option value="unset">mode unset</option>
            </select>
            <select id="rolloutTestFilter" aria-label="Test status">
              <option value="">all tests</option>
              <option value="not_started">not started</option>
              <option value="dry_run_passed">dry-run passed</option>
              <option value="denial_passed">denial passed</option>
              <option value="canary_passed">canary passed</option>
              <option value="live_verified">live verified</option>
              <option value="failed">failed</option>
            </select>
            <select id="rolloutBlockerFilter" aria-label="Blockers">
              <option value="">all blocker states</option>
              <option value="has_blockers">has blockers</option>
              <option value="no_blockers">no blockers</option>
              <option value="owner_gaps">owner gaps</option>
              <option value="rollback_gaps">rollback gaps</option>
              <option value="test_gaps">test evidence gaps</option>
            </select>
            <button class="primary" type="submit">apply filters</button>
            <button id="clearRolloutFilters" type="button">clear</button>
          </form>
          <div id="rolloutList" class="list"><div class="empty">Loading integration rollout...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Rollout evidence</h2><span class="mini">no secrets</span></div>
          <div id="rolloutSummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Cutover workflow</h2><span class="mini">customer-safe</span></div>
          <div id="rolloutWorkflowList" class="list"></div>
        </div>
      </section>

      ${pageName === 'keys' ? `
      <section id="apiProxyTestPanel" class="card" style="display:none;margin-bottom:16px">
        <div class="section-title"><h2>Customer API proxy test kit</h2><span id="apiProxyTestMeta" class="mini">copy-safe</span></div>
        <div id="apiProxyTestList" class="list"><div class="empty">Loading self-test kit...</div></div>
      </section>

      <section id="exposureResponsePanel" class="grid two" style="display:none;margin-bottom:16px">
        <div class="card">
          <div class="section-title"><h2>Key exposure response</h2><span id="exposureResponseMeta" class="mini">incident mode</span></div>
          <form id="exposureResponseForm" class="slot-form">
            <label>Incident label
              <input id="exposureIncidentName" value="External platform credential review" maxlength="120" />
            </label>
            <label>Source
              <input id="exposureIncidentSource" value="Vercel-style env exposure" maxlength="120" />
            </label>
            <label>Mode
              <select id="exposureIncidentMode">
                <option value="triage">triage</option>
                <option value="containment">containment</option>
                <option value="rotation">rotation</option>
                <option value="postmortem">postmortem</option>
              </select>
            </label>
            <label>Owner
              <input id="exposureIncidentOwner" placeholder="security owner" maxlength="96" />
            </label>
            <label class="wide">Customer-safe note
              <textarea id="exposureIncidentNote" placeholder="Metadata-only note. Do not paste API keys, bearer tokens, OAuth secrets, request bodies, response bodies, or customer payloads."></textarea>
            </label>
          </form>
          <div class="slot-form-actions">
            <button class="primary" type="button" data-action="copy-exposure-response-json">copy incident JSON</button>
            <button type="button" data-action="copy-exposure-response-brief">copy brief</button>
            <a class="tag" href="/app/audit">audit</a>
          </div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Response checklist</h2><span class="mini">no raw keys</span></div>
          <div id="exposureResponseChecklist" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Affected provider slots</h2><span class="mini">kill switch + rotation</span></div>
          <div id="exposureResponseList" class="list"><div class="empty">Loading exposure response posture...</div></div>
        </div>
      </section>

      <section id="emailKeyDemoPanel" class="grid two" style="display:none;margin-bottom:16px">
        <div class="card">
          <div class="section-title"><h2>Email API key walkthrough</h2><span class="mini">required for pilot</span></div>
          <div id="emailKeyDemoList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Protected email policy</h2><span class="mini">no raw keys</span></div>
          <div class="list">
            <div class="row"><div><div class="row-title">What this proves</div><div class="row-sub">The customer app sends through VaultProof without storing, viewing, copying, logging, or emailing the raw email-provider key.</div></div><span class="tag good">use-only</span></div>
            <div class="row"><div><div class="row-title">Policy boundary</div><div class="row-sub">Lock sender domains, recipient allowlists, template IDs, gateway markers, and per-minute limits before live sends.</div></div><span class="tag warn">policy</span></div>
            <div class="row"><div><div class="row-title">Policy denial evidence</div><div class="row-sub">Blocked email attempts record sender domain, recipient domains, recipient count, template IDs, caller-lock facts, and protected-secret classification without writing the raw email payload.</div></div><span class="tag bad">deny + audit</span></div>
            <div class="row"><div><div class="row-title">First run</div><div class="row-sub">Use protected email dry-run first. Live sandbox send should wait until a sealed provider key is loaded with the local ingest helper.</div></div><span class="tag">dry-run first</span></div>
          </div>
        </div>
      </section>` : ''}

      <section id="keysPanel" class="card" style="display:none">
        <div class="section-title"><h2>Provider slots</h2><span id="keyMeta" class="mini"></span></div>
        <div id="keyList" class="list"><div class="empty">Loading provider slots...</div></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var PAGE_MODE = '${pageName}';
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var cachedProjects = [];
      var cachedOverview = {};
      var cachedInventoryRows = [];
      var cachedPolicyRows = [];
      var cachedRolloutRows = [];
      var providerDefaults = ${renderEnterpriseProviderDefaultsJson()};
      var emailProviderSlugs = ${JSON.stringify(ENTERPRISE_EMAIL_PROVIDER_SLUGS)};
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function displayRuntimeTier(value) {
        var tier = String(value || '');
        if (tier === 'shared-demo') return 'shared pilot runtime';
        if (tier === 'dedicated-production') return 'dedicated production runtime';
        return tier || 'not reported';
      }
      function displayPilotStatus(value) {
        var status = String(value || '');
        if (status === 'accepted_for_pilot' || status === 'accepted_for_demo') return 'accepted for pilot';
        if (status === 'ready_for_guided_testing') return 'ready for guided testing';
        if (status === 'ready_for_paid_pilot') return 'ready for paid pilot';
        if (status === 'ready_for_customer_testing') return 'ready for customer testing';
        return status.replace(/_/g, ' ');
      }
      function displayMaterialMode(value) {
        var mode = String(value || '');
        if (mode === 'sealed-live') return 'live sealed material';
        if (mode === 'demo-placeholder') return 'placeholder material';
        if (mode === 'mixed') return 'mixed material state';
        return mode ? mode.replace(/_/g, ' ') : 'material missing';
      }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path, options) {
        var opts = options || {};
        opts.headers = Object.assign(headers(), opts.headers || {});
        var res = await fetch(path, opts);
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function statusTag(value) {
        var n = Number(value || 0);
        var cls = n >= 400 ? 'bad' : n >= 300 ? 'warn' : 'good';
        return '<span class="tag ' + cls + '">' + escapeHtml(value == null ? 'unknown' : value) + '</span>';
      }
      function isEmailProvider(value) {
        return emailProviderSlugs.indexOf(String(value || '').trim().toLowerCase()) !== -1;
      }
      function slotIsEmailProvider(slot) {
        return isEmailProvider(slot.provider) || isEmailProvider(slot.slug);
      }
      function emailProviderLabel(value) {
        var provider = String(value || '').trim().toLowerCase();
        return provider === 'aws-ses' || provider === 'aws_ses' ? 'AWS SES' : provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Email provider';
      }
      function emailDemoPath(slot) {
        var provider = String(slot.provider || slot.slug || '').trim().toLowerCase();
        var defaults = providerDefaults[provider] || providerDefaults[String(slot.slug || '').trim().toLowerCase()] || {};
        return defaults.emailPath || '/emails';
      }
      function providerDemoPath(slot) {
        if (slotIsEmailProvider(slot)) return emailDemoPath(slot);
        var provider = String(slot.provider || slot.slug || '').trim().toLowerCase();
        var defaults = providerDefaults[provider] || providerDefaults[String(slot.slug || '').trim().toLowerCase()] || {};
        return defaults.demoPath || '/';
      }
      function toBase64Utf8(value) {
        return btoa(unescape(encodeURIComponent(value)));
      }
      function demoEmailPayload(slot, options) {
        var provider = String(slot.provider || slot.slug || '').trim().toLowerCase();
        var recipient = options && options.blocked ? 'blocked@untrusted.example' : 'security-review@example.com';
        if (provider === 'sendgrid') {
          return {
            personalizations: [{ to: [{ email: recipient }] }],
            from: { email: 'pilot@vaultproof.dev' },
            template_id: 'vaultproof-pilot',
            subject: 'VaultProof protected email dry-run',
            content: [{ type: 'text/plain', value: 'VaultProof policy validated this email-provider call without exposing the raw key.' }]
          };
        }
        if (provider === 'mailgun') {
          return {
            from: 'VaultProof Pilot <pilot@vaultproof.dev>',
            to: recipient,
            subject: 'VaultProof protected email dry-run',
            text: 'VaultProof policy validated this email-provider call without exposing the raw key.'
          };
        }
        if (provider === 'postmark') {
          return {
            From: 'pilot@vaultproof.dev',
            To: recipient,
            TemplateId: 'vaultproof-pilot',
            Subject: 'VaultProof protected email dry-run',
            TextBody: 'VaultProof policy validated this email-provider call without exposing the raw key.'
          };
        }
        if (provider === 'aws-ses' || provider === 'aws_ses') {
          return {
            Source: 'pilot@vaultproof.dev',
            Destination: { ToAddresses: [recipient] },
            Template: 'vaultproof-pilot',
            Message: {
              Subject: { Data: 'VaultProof protected email dry-run' },
              Body: { Text: { Data: 'VaultProof policy validated this email-provider call without exposing the raw key.' } }
            }
          };
        }
        return {
          from: 'VaultProof Pilot <pilot@vaultproof.dev>',
          to: [recipient],
          subject: 'VaultProof protected email dry-run',
          text: 'VaultProof policy validated this email-provider call without exposing the raw key.'
        };
      }
      function proxySelfTestBody(slot, options) {
        if (slotIsEmailProvider(slot)) {
          return {
            method: 'POST',
            upstream_path: emailDemoPath(slot),
            headers: { 'content-type': 'application/json' },
            body_base64: toBase64Utf8(JSON.stringify(demoEmailPayload(slot, options || {}))),
            dry_run: true
          };
        }
        return {
          method: 'GET',
          upstream_path: providerDemoPath(slot),
          dry_run: true
        };
      }
      function proxySelfTestSnippet(project, slot, options) {
        var slug = slot.slug || slot.provider;
        var path = '/api/v1/enterprise/projects/' + encodeURIComponent(project.id) + '/providers/' + encodeURIComponent(slug) + '/execute';
        var headers = {
          authorization: 'Bearer YOUR_VAULTPROOF_SESSION_JWT',
          'content-type': 'application/json',
          'x-vaultproof-organization': currentOrgId || project.organization_id || 'YOUR_ORGANIZATION_ID',
          'x-vaultproof-customer-gateway': 'vaultproof-managed',
          'x-vaultproof-client-class': 'browser'
        };
        return [
          'fetch(' + JSON.stringify(location.origin + path) + ', {',
          '  method: "POST",',
          '  headers: ' + JSON.stringify(headers, null, 2).replace(/\\n/g, '\\n  ') + ',',
          '  body: JSON.stringify(' + JSON.stringify(proxySelfTestBody(slot, options || {}), null, 2).replace(/\\n/g, '\\n  ') + ')',
          '}).then(async (response) => ({',
          '  status: response.status,',
          '  body: await response.json().catch(() => null)',
          '}));'
        ].join('\\n');
      }
      function copyToClipboard(value, label) {
        function done() { notice((label || 'Value') + ' copied. No raw provider keys, manually entered API keys, encrypted shares, bearer tokens, OAuth secrets, request bodies, response bodies, or customer payloads are included.'); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function() { fallbackCopy(value); done(); });
          return;
        }
        fallbackCopy(value);
        done();
      }
      function fallbackCopy(value) {
        var textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function updateKpis() {
        var slotCount = cachedProjects.reduce(function(total, project) { return total + ((project.provider_slots || []).length); }, 0);
        var liveSlotCount = cachedProjects.reduce(function(total, project) {
          return total + (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'sealed-live'; }).length;
        }, 0);
        var demoSlotCount = cachedProjects.reduce(function(total, project) {
          return total + (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'demo-placeholder'; }).length;
        }, 0);
        text('kpiProjects', number(cachedProjects.length));
        text('kpiKeys', number(slotCount));
        text('kpiProviders', slotCount ? (liveSlotCount + ' live sealed / ' + demoSlotCount + ' placeholder') : 'no active slots');
        text('kpiCalls', number(cachedOverview.totalCalls));
        text('kpiDenied', number(cachedOverview.deniedCalls));
      }
      function renderProjectOptions() {
        var select = byId('activityProjectFilter');
        if (select) {
          select.innerHTML = '<option value="">All projects</option>' + cachedProjects.map(function(project) {
            return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
          }).join('');
        }
        var slotProject = byId('slotProject');
        if (slotProject) {
          slotProject.innerHTML = cachedProjects.length ? cachedProjects.map(function(project) {
            return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + ' - ' + escapeHtml(project.project_role || 'member') + '</option>';
          }).join('') : '<option value="">No projects</option>';
          slotProject.disabled = !cachedProjects.length;
        }
        var manualKeyProject = byId('manualKeyProject');
        if (manualKeyProject) {
          manualKeyProject.innerHTML = '<option value="">Unassigned inventory record</option>' + cachedProjects.map(function(project) {
            return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + ' - ' + escapeHtml(project.project_role || 'member') + '</option>';
          }).join('');
        }
        var inventoryImportProject = byId('inventoryImportProject');
        if (inventoryImportProject) {
          inventoryImportProject.innerHTML = '<option value="">Unassigned import records</option>' + cachedProjects.map(function(project) {
            return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + ' - ' + escapeHtml(project.project_role || 'member') + '</option>';
          }).join('');
        }
      }
      function inventoryStorageKey() {
        return 'vaultproof_api_inventory::' + (currentOrgId || 'default');
      }
      function manualApiKeyStorageKey() {
        return 'vaultproof_manual_api_keys::' + (currentOrgId || 'default');
      }
      function redactInventoryNote(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key)/i.test(textValue)) {
          return '[redacted: note contained secret-like material]';
        }
        return textValue;
      }
      function readInventoryAnnotations() {
        try {
          var parsed = JSON.parse(localStorage.getItem(inventoryStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writeInventoryAnnotations(value) {
        localStorage.setItem(inventoryStorageKey(), JSON.stringify(value || {}));
      }
      function readManualApiKeys() {
        try {
          var parsed = JSON.parse(localStorage.getItem(manualApiKeyStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writeManualApiKeys(value) {
        localStorage.setItem(manualApiKeyStorageKey(), JSON.stringify(value || {}));
      }
      function redactManualApiKeyText(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return '';
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+\\S+|service[_ -]?role|client[_ -]?secret\\s*[:=]?\\s*\\S+|api[_ -]?key\\s*[:=]\\s*\\S+|password\\s*[:=]\\s*\\S+|private[_ -]?key)/i.test(textValue)) {
          return '[redacted: secret-like material was not stored]';
        }
        return textValue.slice(0, 220);
      }
      function manualApiKeyRecord(id, value) {
        var record = value && typeof value === 'object' ? value : {};
        return {
          id: id,
          project_id: redactManualApiKeyText(record.project_id),
          provider: redactManualApiKeyText(record.provider),
          key_label: redactManualApiKeyText(record.key_label),
          key_reference: redactManualApiKeyText(record.key_reference),
          key_location: redactManualApiKeyText(record.key_location),
          upstream_scope: redactManualApiKeyText(record.upstream_scope),
          business_owner: redactManualApiKeyText(record.business_owner),
          technical_owner: redactManualApiKeyText(record.technical_owner),
          business_service: redactManualApiKeyText(record.business_service),
          data_sensitivity: redactManualApiKeyText(record.data_sensitivity),
          risk: redactManualApiKeyText(record.risk),
          environment: redactManualApiKeyText(record.environment),
          rotation_status: redactManualApiKeyText(record.rotation_status || 'unknown'),
          review_status: redactManualApiKeyText(record.review_status || 'needs_review'),
          next_review_date: redactManualApiKeyText(record.next_review_date),
          source: redactManualApiKeyText(record.source),
          source_format: redactManualApiKeyText(record.source_format),
          source_detail: redactManualApiKeyText(record.source_detail),
          imported_at: redactManualApiKeyText(record.imported_at),
          created_at: redactManualApiKeyText(record.created_at),
          updated_at: redactManualApiKeyText(record.updated_at)
        };
      }
      function manualApiKeyRecords() {
        var records = readManualApiKeys();
        return Object.keys(records).map(function(id) {
          return manualApiKeyRecord(id, records[id]);
        }).filter(function(record) {
          return record.provider || record.key_label || record.key_reference;
        });
      }
      function findProject(projectId) {
        return cachedProjects.find(function(project) { return project.id === projectId; }) || null;
      }
      function newManualApiKeyId() {
        return 'manual-key::' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      }
      function setManualApiKeyFormVisible(visible) {
        var panel = byId('manualApiKeyFormPanel');
        if (!panel) return;
        panel.style.display = visible ? 'block' : 'none';
        if (visible) {
          renderProjectOptions();
          var provider = byId('manualKeyProvider');
          if (provider) provider.focus();
        }
      }
      function setInventoryImportFormVisible(visible) {
        var panel = byId('inventoryImportFormPanel');
        if (!panel) return;
        panel.style.display = visible ? 'block' : 'none';
        if (visible) {
          renderProjectOptions();
          var input = byId('inventoryImportText');
          if (input) input.focus();
        }
      }
      function normalizeImportHeader(value) {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      }
      function parseCsvRows(textValue) {
        var rows = [];
        var row = [];
        var value = '';
        var inQuotes = false;
        var text = String(textValue || '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
        for (var index = 0; index < text.length; index += 1) {
          var character = text[index];
          if (character === '"') {
            if (inQuotes && text[index + 1] === '"') {
              value += '"';
              index += 1;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (character === ',' && !inQuotes) {
            row.push(value);
            value = '';
          } else if (character === '\\n' && !inQuotes) {
            row.push(value);
            if (row.some(function(cell) { return String(cell || '').trim(); })) rows.push(row);
            row = [];
            value = '';
          } else {
            value += character;
          }
        }
        row.push(value);
        if (row.some(function(cell) { return String(cell || '').trim(); })) rows.push(row);
        return rows;
      }
      function csvHeaderAlias(header) {
        var normalized = normalizeImportHeader(header);
        var aliases = {
          label: 'key_label',
          name: 'key_label',
          api: 'key_label',
          api_name: 'key_label',
          key_name: 'key_label',
          api_key_label: 'key_label',
          service: 'business_service',
          business_unit: 'business_service',
          app: 'business_service',
          application: 'business_service',
          owner: 'business_owner',
          business_owner_email: 'business_owner',
          technical_owner_email: 'technical_owner',
          fingerprint: 'key_reference',
          last4: 'key_reference',
          last_four: 'key_reference',
          reference: 'key_reference',
          location: 'key_location',
          secret_location: 'key_location',
          scope: 'upstream_scope',
          host: 'upstream_scope',
          url: 'upstream_scope',
          path: 'upstream_scope',
          endpoint: 'upstream_scope',
          data: 'data_sensitivity',
          sensitivity: 'data_sensitivity',
          status: 'review_status',
          review: 'review_status',
          next_review: 'next_review_date',
          rotation: 'rotation_status',
          source: 'source_detail'
        };
        return aliases[normalized] || normalized;
      }
      function importField(value, field) {
        var redacted = redactManualApiKeyText(value);
        if (field !== 'project_id' && /[A-Za-z0-9_-]{36,}/.test(redacted) && !/^https?:\\/\\//i.test(redacted)) {
          return '[redacted: secret-like import value was not stored]';
        }
        return redacted;
      }
      function normalizeImportedRecord(rawRecord, defaults) {
        var raw = rawRecord && typeof rawRecord === 'object' ? rawRecord : {};
        var provider = importField(raw.provider || raw.provider_slug || raw.security_scheme || '', 'provider');
        var keyLabel = importField(raw.key_label || raw.operation_id || raw.summary || raw.name || provider || 'Imported API surface', 'key_label');
        return {
          project_id: importField(raw.project_id || defaults.project_id || '', 'project_id'),
          provider: provider || 'unknown-provider',
          key_label: keyLabel || 'Imported API surface',
          key_reference: importField(raw.key_reference || raw.fingerprint || raw.last_four || '', 'key_reference'),
          key_location: importField(raw.key_location || raw.secret_location || raw.location || 'customer inventory import', 'key_location'),
          upstream_scope: importField(raw.upstream_scope || raw.endpoint || raw.path || raw.url || '', 'upstream_scope'),
          business_owner: importField(raw.business_owner || defaults.owner || '', 'business_owner'),
          technical_owner: importField(raw.technical_owner || defaults.owner || '', 'technical_owner'),
          business_service: importField(raw.business_service || raw.service || raw.tag || raw.group || '', 'business_service'),
          data_sensitivity: importField(raw.data_sensitivity || raw.sensitivity || '', 'data_sensitivity'),
          risk: importField(raw.risk || '', 'risk'),
          environment: importField(raw.environment || defaults.environment || 'demo', 'environment'),
          rotation_status: importField(raw.rotation_status || 'unknown', 'rotation_status'),
          review_status: importField(raw.review_status || 'needs_review', 'review_status'),
          next_review_date: importField(raw.next_review_date || '', 'next_review_date'),
          source: 'vaultproof_inventory_import',
          source_format: importField(defaults.format || raw.source_format || 'csv', 'source_format'),
          source_detail: importField(raw.source_detail || '', 'source_detail')
        };
      }
      function parseInventoryCsv(textValue, defaults) {
        var rows = parseCsvRows(textValue);
        if (!rows.length) return [];
        var headers = rows.shift().map(csvHeaderAlias);
        var hasRecognizedHeader = headers.some(function(header) {
          return ['provider', 'key_label', 'upstream_scope', 'business_owner', 'technical_owner', 'environment', 'business_service', 'data_sensitivity', 'risk', 'review_status'].indexOf(header) !== -1;
        });
        if (!hasRecognizedHeader) {
          rows.unshift(headers);
          headers = ['provider', 'key_label', 'upstream_scope', 'business_owner', 'technical_owner', 'environment', 'business_service', 'data_sensitivity', 'risk', 'review_status', 'next_review_date'];
        }
        return rows.map(function(row) {
          var raw = {};
          headers.forEach(function(header, index) {
            if (!header) return;
            raw[header] = row[index] || '';
          });
          return normalizeImportedRecord(raw, Object.assign({}, defaults, { format: 'csv' }));
        }).filter(function(record) {
          return record.provider || record.key_label || record.upstream_scope;
        });
      }
      function inferProviderFromOpenApi(serverUrl, schemeName) {
        var source = String(schemeName || serverUrl || '').toLowerCase();
        var matched = Object.keys(providerDefaults || {}).map(function(id) {
          return Object.assign({ id: id }, providerDefaults[id] || {});
        }).find(function(preset) {
          return source.indexOf(preset.id.replace(/-/g, '')) !== -1 || source.indexOf(preset.id) !== -1 || (preset.upstream && source.indexOf(new URL(preset.upstream).hostname.replace(/^api\\./, '')) !== -1);
        });
        return matched ? matched.id : (schemeName ? String(schemeName).toLowerCase().replace(/[^a-z0-9-]+/g, '-') : 'openapi');
      }
      function parseOpenApiInventoryHints(textValue, defaults) {
        var spec = JSON.parse(String(textValue || ''));
        if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object') {
          throw new Error('OpenAPI import needs JSON with a paths object.');
        }
        var title = spec.info && spec.info.title ? String(spec.info.title) : 'OpenAPI service';
        var servers = Array.isArray(spec.servers) && spec.servers.length ? spec.servers : [{ url: '' }];
        var serverUrl = servers[0] && servers[0].url ? String(servers[0].url) : '';
        var securitySchemes = spec.components && spec.components.securitySchemes && typeof spec.components.securitySchemes === 'object' ? spec.components.securitySchemes : {};
        var schemeNames = Object.keys(securitySchemes);
        var provider = inferProviderFromOpenApi(serverUrl, schemeNames[0] || title);
        var methods = ['get', 'post', 'put', 'patch', 'delete', 'head'];
        var records = [];
        Object.keys(spec.paths).forEach(function(pathname) {
          var pathItem = spec.paths[pathname];
          if (!pathItem || typeof pathItem !== 'object') return;
          methods.forEach(function(method) {
            var operation = pathItem[method];
            if (!operation || typeof operation !== 'object') return;
            var operationSecurity = Array.isArray(operation.security) && operation.security[0] ? Object.keys(operation.security[0])[0] : '';
            var operationProvider = inferProviderFromOpenApi(serverUrl, operationSecurity || schemeNames[0] || title);
            var label = operation.operationId || operation.summary || (method.toUpperCase() + ' ' + pathname);
            var tags = Array.isArray(operation.tags) ? operation.tags.filter(Boolean) : [];
            records.push(normalizeImportedRecord({
              provider: operationProvider || provider,
              key_label: label,
              upstream_scope: (serverUrl ? serverUrl.replace(/\\/$/, '') : '') + pathname,
              business_service: tags[0] || title,
              source_detail: 'OpenAPI ' + method.toUpperCase() + ' ' + pathname
            }, Object.assign({}, defaults, { format: 'openapi' })));
          });
        });
        return records;
      }
      function submitInventoryImportForm(event) {
        event.preventDefault();
        var textInput = byId('inventoryImportText');
        var importText = textInput ? String(textInput.value || '').trim() : '';
        if (!importText) {
          notice('Paste CSV or OpenAPI JSON metadata before importing.');
          return;
        }
        var format = byId('inventoryImportFormat') && byId('inventoryImportFormat').value || 'auto';
        var defaults = {
          project_id: byId('inventoryImportProject') && byId('inventoryImportProject').value || '',
          owner: byId('inventoryImportOwner') && byId('inventoryImportOwner').value || '',
          environment: byId('inventoryImportEnvironment') && byId('inventoryImportEnvironment').value || 'demo'
        };
        var recordsToImport = [];
        if (format === 'csv' || (format === 'auto' && importText[0] !== '{')) {
          recordsToImport = parseInventoryCsv(importText, defaults);
        } else {
          recordsToImport = parseOpenApiInventoryHints(importText, defaults);
        }
        if (!recordsToImport.length) {
          notice('No importable API inventory metadata was found.');
          return;
        }
        var limited = recordsToImport.slice(0, 50);
        var now = new Date().toISOString();
        var records = readManualApiKeys();
        limited.forEach(function(record) {
          var id = newManualApiKeyId();
          records[id] = Object.assign({}, record, {
            created_at: now,
            updated_at: now,
            imported_at: now
          });
        });
        writeManualApiKeys(records);
        if (event.target && event.target.reset) event.target.reset();
        setInventoryImportFormVisible(false);
        cachedInventoryRows = buildInventoryRows();
        renderInventory();
        notice('Imported ' + number(limited.length) + ' metadata-only API inventory hint' + (limited.length === 1 ? '' : 's') + '. Raw keys and request payloads were not stored.');
      }
      function submitManualApiKeyForm(event) {
        event.preventDefault();
        var provider = redactManualApiKeyText(byId('manualKeyProvider') && byId('manualKeyProvider').value);
        var keyLabel = redactManualApiKeyText(byId('manualKeyLabel') && byId('manualKeyLabel').value);
        if (!provider || !keyLabel) {
          notice('Provider and API key label are required.');
          return;
        }
        var id = newManualApiKeyId();
        var now = new Date().toISOString();
        var records = readManualApiKeys();
        records[id] = {
          project_id: redactManualApiKeyText(byId('manualKeyProject') && byId('manualKeyProject').value),
          provider: provider,
          key_label: keyLabel,
          key_reference: redactManualApiKeyText(byId('manualKeyReference') && byId('manualKeyReference').value),
          key_location: redactManualApiKeyText(byId('manualKeyLocation') && byId('manualKeyLocation').value),
          upstream_scope: redactManualApiKeyText(byId('manualKeyScope') && byId('manualKeyScope').value),
          business_owner: redactManualApiKeyText(byId('manualKeyBusinessOwner') && byId('manualKeyBusinessOwner').value),
          technical_owner: redactManualApiKeyText(byId('manualKeyTechnicalOwner') && byId('manualKeyTechnicalOwner').value),
          environment: redactManualApiKeyText(byId('manualKeyEnvironment') && byId('manualKeyEnvironment').value),
          rotation_status: redactManualApiKeyText(byId('manualKeyRotationStatus') && byId('manualKeyRotationStatus').value),
          review_status: redactManualApiKeyText(byId('manualKeyReviewStatus') && byId('manualKeyReviewStatus').value),
          next_review_date: redactManualApiKeyText(byId('manualKeyNextReview') && byId('manualKeyNextReview').value),
          created_at: now,
          updated_at: now
        };
        writeManualApiKeys(records);
        if (event.target && event.target.reset) event.target.reset();
        setManualApiKeyFormVisible(false);
        cachedInventoryRows = buildInventoryRows();
        renderInventory();
        notice('Manual API key metadata saved. Raw keys are not stored in the inventory.');
      }
      function saveManualApiKeyField(target) {
        var id = target.getAttribute('data-manual-key-id');
        var field = target.getAttribute('data-manual-key-field');
        if (!id || !field) return;
        var records = readManualApiKeys();
        var current = records[id] && typeof records[id] === 'object' ? records[id] : {};
        current[field] = redactManualApiKeyText(target.value || '');
        current.updated_at = new Date().toISOString();
        records[id] = current;
        writeManualApiKeys(records);
        cachedInventoryRows = buildInventoryRows();
        if (['provider', 'key_label', 'rotation_status'].indexOf(field) !== -1) {
          renderInventory();
        } else {
          renderInventorySummary();
        }
      }
      function deleteManualApiKey(id) {
        if (!id) return;
        if (!confirm('Remove this manual API key inventory record from this browser?')) return;
        var records = readManualApiKeys();
        delete records[id];
        writeManualApiKeys(records);
        var annotations = readInventoryAnnotations();
        delete annotations[id];
        writeInventoryAnnotations(annotations);
        cachedInventoryRows = buildInventoryRows();
        renderInventory();
        notice('Manual API key inventory record removed from this browser.');
      }
      function saveInventoryField(target) {
        var rowId = target.getAttribute('data-inventory-row-id');
        var field = target.getAttribute('data-inventory-field');
        if (!rowId || !field) return;
        var annotations = readInventoryAnnotations();
        var current = annotations[rowId] && typeof annotations[rowId] === 'object' ? annotations[rowId] : {};
        current[field] = target.value || '';
        current.updated_at = new Date().toISOString();
        annotations[rowId] = current;
        writeInventoryAnnotations(annotations);
        cachedInventoryRows = buildInventoryRows();
        if (['review_status', 'next_review_date', 'risk', 'environment', 'data_sensitivity'].indexOf(field) !== -1) {
          renderInventory();
        } else {
          renderInventorySummary();
        }
      }
      function projectHealthMap() {
        var map = {};
        (Array.isArray(cachedOverview.projectHealth) ? cachedOverview.projectHealth : []).forEach(function(item) {
          if (item && item.project_id) map[item.project_id] = item;
        });
        return map;
      }
      function arrayLength(value) {
        return Array.isArray(value) ? value.filter(Boolean).length : 0;
      }
      function mergePolicy(project, slot) {
        var base = project.caller_lock_policy || {};
        var slug = slot && (slot.slug || slot.provider);
        var override = slug && base.provider_overrides && base.provider_overrides[slug] && typeof base.provider_overrides[slug] === 'object'
          ? base.provider_overrides[slug]
          : {};
        return Object.assign({}, base, override || {});
      }
      function callerLockPolicySummary(policy, project, slot) {
        var checks = [
          project.strict_origin === true,
          arrayLength(policy.allowed_customer_gateways) > 0,
          arrayLength(policy.allowed_methods) > 0,
          arrayLength(policy.allowed_upstream_hosts) > 0 || arrayLength(policy.allowed_upstream_path_prefixes) > 0,
          Boolean(slot && (policy.allowed_providers || []).indexOf(slot.provider) !== -1) || Boolean(slot)
        ];
        var passed = checks.filter(Boolean).length;
        return {
          passed: passed,
          total: checks.length,
          complete: passed >= 4,
          label: passed + '/' + checks.length + ' caller-lock controls'
        };
      }
      function isReviewDue(annotation) {
        if (!annotation || !annotation.next_review_date) return false;
        var reviewTime = new Date(annotation.next_review_date + 'T23:59:59Z').getTime();
        return Number.isFinite(reviewTime) && reviewTime < Date.now();
      }
      function inventoryRowId(project, slot) {
        return project.id + '::' + (slot ? (slot.key_id || slot.slug || slot.provider) : 'missing-provider');
      }
      function inventoryDefaultPath(slot) {
        if (!slot) return 'not mapped';
        return slotIsEmailProvider(slot) ? emailDemoPath(slot) : providerDemoPath(slot);
      }
      function buildManualApiKeyInventoryRows(annotations) {
        var health = projectHealthMap();
        return manualApiKeyRecords().map(function(record) {
          var project = findProject(record.project_id) || {
            id: record.project_id || record.id,
            name: record.project_id ? 'Manual API key project' : 'Unassigned manual API key',
            vp_proj_id: record.project_id || 'manual-api-key',
            project_role: 'inventory',
            strict_origin: false,
            allowed_origins: null,
            caller_lock_policy: {}
          };
          var storedAnnotation = annotations[record.id] && typeof annotations[record.id] === 'object' ? annotations[record.id] : {};
          var annotation = Object.assign({
            business_owner: record.business_owner || '',
            technical_owner: record.technical_owner || '',
            environment: record.environment || '',
            business_service: record.business_service || record.key_label || '',
            data_sensitivity: record.data_sensitivity || '',
            risk: record.risk || '',
            review_status: record.review_status || 'needs_review',
            next_review_date: record.next_review_date || '',
            note: ''
          }, storedAnnotation || {});
          var projectHealth = health[project.id] || {};
          var policy = mergePolicy(project, null);
          var coverage = callerLockPolicySummary(policy, project, null);
          var calls = Number(projectHealth.calls || 0);
          var errors = Number(projectHealth.errors || 0);
          var denied = Number(projectHealth.denied || 0);
          var lastActivity = projectHealth.lastActivity || null;
          var statuses = [
            { label: 'manual API key', tone: 'warn' },
            { label: 'missing provider slot', tone: 'bad' },
            { label: 'needs sealed ingest', tone: 'warn' }
          ];
          if (record.source === 'vaultproof_inventory_import') statuses.push({ label: (record.source_format === 'openapi' ? 'OpenAPI import' : 'CSV import'), tone: 'good' });
          if (!coverage.complete) statuses.push({ label: 'policy incomplete', tone: 'warn' });
          if (!calls) statuses.push({ label: 'no recent traffic', tone: 'warn' });
          if (isReviewDue(annotation) || !annotation.review_status || annotation.review_status === 'needs_review') statuses.push({ label: 'review due', tone: 'warn' });
          if (annotation.review_status === 'approved') statuses.push({ label: 'review approved', tone: 'good' });
          if (annotation.review_status === 'blocked') statuses.push({ label: 'blocked', tone: 'bad' });
          if (annotation.review_status === 'exception') statuses.push({ label: 'exception noted', tone: 'warn' });
          return {
            id: record.id,
            project: {
              id: project.id,
              name: project.name || project.vp_proj_id || 'Manual API key',
              vp_proj_id: project.vp_proj_id || null,
              role: project.project_role,
              strict_origin: project.strict_origin === true,
              allowed_origins: project.allowed_origins || null
            },
            provider: null,
            manual_key: {
              id: record.id,
              provider: record.provider || null,
              key_label: record.key_label || null,
              key_reference: record.key_reference || null,
              key_location: record.key_location || null,
              upstream_scope: record.upstream_scope || null,
              rotation_status: record.rotation_status || 'unknown',
              source: record.source || null,
              source_format: record.source_format || null,
              source_detail: record.source_detail || null,
              imported_at: record.imported_at || null,
              created_at: record.created_at || null,
              updated_at: record.updated_at || null
            },
            policy: {
              caller_lock_controls: coverage.label,
              complete: false,
              rate_limit_per_minute: policy.rate_limit_per_minute || null,
              allowed_methods: Array.isArray(policy.allowed_methods) ? policy.allowed_methods : [],
              allowed_upstream_hosts: Array.isArray(policy.allowed_upstream_hosts) ? policy.allowed_upstream_hosts : [],
              allowed_upstream_path_prefixes: Array.isArray(policy.allowed_upstream_path_prefixes) ? policy.allowed_upstream_path_prefixes : [],
              allowed_customer_gateways: Array.isArray(policy.allowed_customer_gateways) ? policy.allowed_customer_gateways : []
            },
            traffic: {
              calls: calls,
              errors: errors,
              denied: denied,
              last_seen_at: lastActivity,
              stale: false
            },
            annotation: annotation,
            statuses: statuses
          };
        });
      }
      function buildInventoryRows() {
        var annotations = readInventoryAnnotations();
        var health = projectHealthMap();
        var rows = [];
        cachedProjects.forEach(function(project) {
          var slots = Array.isArray(project.provider_slots) && project.provider_slots.length ? project.provider_slots : [null];
          slots.forEach(function(slot) {
            var rowId = inventoryRowId(project, slot);
            var annotation = annotations[rowId] && typeof annotations[rowId] === 'object' ? annotations[rowId] : {};
            var projectHealth = health[project.id] || {};
            var policy = mergePolicy(project, slot);
            var coverage = callerLockPolicySummary(policy, project, slot);
            var calls = Number(projectHealth.calls || 0);
            var errors = Number(projectHealth.errors || 0);
            var denied = Number(projectHealth.denied || 0);
            var lastActivity = projectHealth.lastActivity || null;
            var lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : NaN;
            var stale = calls > 0 && Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs > 30 * 24 * 60 * 60 * 1000;
            var statuses = [];
            if (!slot) statuses.push({ label: 'missing provider slot', tone: 'bad' });
            if (slot && slot.material_ready === true && project.strict_origin === true && coverage.complete) statuses.push({ label: 'protected', tone: 'good' });
            if (slot && slot.material_mode === 'demo-placeholder') statuses.push({ label: 'placeholder material', tone: 'warn' });
            if (!coverage.complete) statuses.push({ label: 'policy incomplete', tone: 'warn' });
            if (!calls) statuses.push({ label: 'no recent traffic', tone: 'warn' });
            if (stale) statuses.push({ label: 'stale', tone: 'warn' });
            if (isReviewDue(annotation) || !annotation.review_status || annotation.review_status === 'needs_review') statuses.push({ label: 'review due', tone: 'warn' });
            if (annotation.review_status === 'approved') statuses.push({ label: 'review approved', tone: 'good' });
            if (annotation.review_status === 'blocked') statuses.push({ label: 'blocked', tone: 'bad' });
            if (annotation.review_status === 'exception') statuses.push({ label: 'exception noted', tone: 'warn' });
            rows.push({
              id: rowId,
              project: {
                id: project.id,
                name: project.name || project.vp_proj_id,
                vp_proj_id: project.vp_proj_id,
                role: project.project_role,
                strict_origin: project.strict_origin === true,
                allowed_origins: project.allowed_origins || null
              },
              provider: slot ? {
                key_id: slot.key_id,
                provider: slot.provider,
                slug: slot.slug || slot.provider,
                material_mode: slot.material_mode || 'missing',
                material_ready: slot.material_ready === true,
                default_path: inventoryDefaultPath(slot)
              } : null,
              policy: {
                caller_lock_controls: coverage.label,
                complete: coverage.complete,
                rate_limit_per_minute: policy.rate_limit_per_minute || null,
                allowed_methods: Array.isArray(policy.allowed_methods) ? policy.allowed_methods : [],
                allowed_upstream_hosts: Array.isArray(policy.allowed_upstream_hosts) ? policy.allowed_upstream_hosts : [],
                allowed_upstream_path_prefixes: Array.isArray(policy.allowed_upstream_path_prefixes) ? policy.allowed_upstream_path_prefixes : [],
                allowed_customer_gateways: Array.isArray(policy.allowed_customer_gateways) ? policy.allowed_customer_gateways : []
              },
              traffic: {
                calls: calls,
                errors: errors,
                denied: denied,
                last_seen_at: lastActivity,
                stale: stale
              },
              annotation: annotation,
              statuses: statuses
            });
          });
        });
        buildManualApiKeyInventoryRows(annotations).forEach(function(row) {
          rows.push(row);
        });
        return rows;
      }
      function selectedOption(value, expected) {
        return String(value || '') === expected ? ' selected' : '';
      }
      function inventoryInput(row, field, label, placeholder) {
        var annotation = row.annotation || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="' + escapeHtml(field) + '" value="' + escapeHtml(annotation[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function inventorySelect(row, field, label, options) {
        var annotation = row.annotation || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(annotation[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function manualApiKeyInput(row, field, label, placeholder) {
        var record = row.manual_key || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-manual-key-id="' + escapeHtml(row.id) + '" data-manual-key-field="' + escapeHtml(field) + '" value="' + escapeHtml(record[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function manualApiKeySelect(row, field, label, options) {
        var record = row.manual_key || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-manual-key-id="' + escapeHtml(row.id) + '" data-manual-key-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(record[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderManualApiKeyFields(row) {
        if (!row.manual_key) return '';
        return manualApiKeyInput(row, 'key_label', 'API key label', 'Production billing key') +
          manualApiKeyInput(row, 'provider', 'provider', 'openai, stripe, resend') +
          manualApiKeyInput(row, 'key_reference', 'key fingerprint', 'last 4 or fingerprint only') +
          manualApiKeyInput(row, 'key_location', 'key location', 'GCP Secret Manager or customer vault') +
          '<div class="inventory-field wide"><label>upstream scope</label><input data-manual-key-id="' + escapeHtml(row.id) + '" data-manual-key-field="upstream_scope" value="' + escapeHtml(row.manual_key.upstream_scope || '') + '" placeholder="Provider API, endpoint family, or service scope" /></div>' +
          manualApiKeySelect(row, 'rotation_status', 'rotation status', [
            { value: 'unknown', label: 'unknown' },
            { value: 'current', label: 'current' },
            { value: 'rotation_due', label: 'rotation due' },
            { value: 'rotated_for_demo', label: 'rotated for pilot' },
            { value: 'accepted_demo_only', label: 'accepted for pilot' }
          ]);
      }
      function renderInventoryStatusTags(row) {
        var statuses = Array.isArray(row.statuses) ? row.statuses : [];
        var visible = statuses.slice(0, 4).map(function(status) {
          return '<span class="tag ' + escapeHtml(status.tone) + '">' + escapeHtml(status.label) + '</span>';
        });
        if (statuses.length > visible.length) {
          visible.push('<span class="tag">+' + number(statuses.length - visible.length) + '</span>');
        }
        return visible.join('');
      }
      function inventoryReviewTone(value) {
        if (value === 'approved') return 'good';
        if (value === 'blocked') return 'bad';
        return 'warn';
      }
      function inventoryRiskTone(value) {
        if (value === 'critical' || value === 'high') return value === 'critical' ? 'bad' : 'warn';
        if (value === 'low' || value === 'medium') return 'good';
        return '';
      }
      function renderInventoryRow(row) {
        var annotation = row.annotation || {};
        var provider = row.provider || {};
        var manualKey = row.manual_key || null;
        var providerLabel = row.provider ? provider.slug + ' / ' + provider.provider : manualKey ? (manualKey.key_label || 'manual key') + ' / ' + (manualKey.provider || 'provider unset') : 'no provider slot';
        var traffic = row.traffic || {};
        var policy = row.policy || {};
        var defaultPath = row.provider ? provider.default_path : manualKey ? (manualKey.upstream_scope || 'manual scope not set') : 'not mapped';
        var reviewStatus = annotation.review_status || 'needs_review';
        var risk = annotation.risk || '';
        var ownerPrimary = annotation.business_owner || annotation.technical_owner || 'owner unset';
        var ownerSecondary = annotation.business_owner && annotation.technical_owner ? annotation.technical_owner : (annotation.business_owner || annotation.technical_owner ? 'second owner unset' : 'assign business and technical owner');
        var trafficTone = Number(traffic.errors || 0) || Number(traffic.denied || 0) ? 'warn' : Number(traffic.calls || 0) ? 'good' : 'warn';
        var actionHtml = row.manual_key
          ? '<button class="danger" type="button" data-action="delete-manual-api-key" data-manual-key-id="' + escapeHtml(row.id) + '">remove</button><a class="tag good" href="/app/keys">seal key</a><a class="tag" href="/app/control">control</a>'
          : '<a class="tag good" href="/app/control">control</a><a class="tag" href="/app/keys">provider slots</a><a class="tag" href="/app/activity">activity</a>';
        return '<article class="inventory-record" data-inventory-card="' + escapeHtml(row.id) + '">' +
          '<div class="inventory-record-main">' +
            '<div class="inventory-identity"><div class="inventory-cell-label">API surface</div><div class="inventory-record-title">' + escapeHtml(row.project.name) + '</div>' +
              '<div class="inventory-record-sub">' + escapeHtml(providerLabel) + ' - ' + escapeHtml(row.project.vp_proj_id || row.project.id || 'project') + '</div>' +
              '<div class="inventory-record-sub">Scope: ' + escapeHtml(defaultPath) + '</div>' +
              '<div class="inventory-status-list">' + renderInventoryStatusTags(row) + '</div></div>' +
            '<div><div class="inventory-cell-label">Owner</div><div class="inventory-cell-value"><strong>' + escapeHtml(ownerPrimary) + '</strong>' + escapeHtml(ownerSecondary) + '</div></div>' +
            '<div><div class="inventory-cell-label">Policy</div><div class="inventory-cell-value"><span class="tag ' + (policy.complete ? 'good' : 'warn') + '">' + escapeHtml(policy.complete ? 'ready' : 'incomplete') + '</span><div class="inventory-record-sub">' + escapeHtml(policy.caller_lock_controls || 'policy not reported') + '</div></div></div>' +
            '<div><div class="inventory-cell-label">Traffic</div><div class="inventory-cell-value"><span class="tag ' + trafficTone + '">' + number(traffic.calls) + ' calls</span><div class="inventory-record-sub">' + number(traffic.errors) + ' errors - ' + number(traffic.denied) + ' denied - last ' + escapeHtml(rel(traffic.last_seen_at)) + '</div></div></div>' +
            '<div><div class="inventory-cell-label">Review</div><div class="inventory-cell-value"><span class="tag ' + inventoryReviewTone(reviewStatus) + '">' + escapeHtml(reviewStatus.replace(/_/g, ' ')) + '</span>' + (risk ? '<span class="tag ' + inventoryRiskTone(risk) + '">' + escapeHtml(risk) + ' risk</span>' : '<span class="tag">risk unset</span>') + '<div class="inventory-record-sub">next ' + escapeHtml(annotation.next_review_date || 'not scheduled') + '</div></div></div>' +
            '<div class="inventory-record-actions">' + actionHtml + '</div>' +
          '</div>' +
          '<div class="inventory-fields inventory-detail-grid">' +
          renderManualApiKeyFields(row) +
          inventoryInput(row, 'business_owner', 'business owner', 'Security owner') +
          inventoryInput(row, 'technical_owner', 'technical owner', 'Platform owner') +
          inventorySelect(row, 'environment', 'environment', [
            { value: '', label: 'unset' },
            { value: 'demo', label: 'sandbox' },
            { value: 'dev', label: 'dev' },
            { value: 'staging', label: 'staging' },
            { value: 'production', label: 'production' }
          ]) +
          inventoryInput(row, 'business_service', 'business service', 'Billing, support, AI assistant') +
          inventorySelect(row, 'data_sensitivity', 'data sensitivity', [
            { value: '', label: 'unset' },
            { value: 'public', label: 'public' },
            { value: 'internal', label: 'internal' },
            { value: 'confidential', label: 'confidential' },
            { value: 'restricted', label: 'restricted' }
          ]) +
          inventorySelect(row, 'risk', 'risk', [
            { value: '', label: 'unset' },
            { value: 'low', label: 'low' },
            { value: 'medium', label: 'medium' },
            { value: 'high', label: 'high' },
            { value: 'critical', label: 'critical' }
          ]) +
          inventorySelect(row, 'review_status', 'review status', [
            { value: 'needs_review', label: 'needs review' },
            { value: 'approved', label: 'approved' },
            { value: 'exception', label: 'exception' },
            { value: 'blocked', label: 'blocked' }
          ]) +
          '<div class="inventory-field"><label>next review</label><input type="date" data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="next_review_date" value="' + escapeHtml(annotation.next_review_date || '') + '" /></div>' +
          '<div class="inventory-field wide"><label>review notes</label><textarea data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="note" placeholder="Metadata-only note. Do not paste secrets, request bodies, response bodies, or customer payloads.">' + escapeHtml(annotation.note || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>policy evidence</label><div class="inventory-policy-note row-sub">Origins: ' + escapeHtml(row.project.strict_origin ? 'strict' : 'relaxed') + '. Methods: ' + escapeHtml((policy.allowed_methods || []).join(', ') || 'not set') + '. Hosts: ' + escapeHtml((policy.allowed_upstream_hosts || []).join(', ') || 'not set') + '. Paths: ' + escapeHtml((policy.allowed_upstream_path_prefixes || []).join(', ') || 'not set') + '. Gateways: ' + escapeHtml((policy.allowed_customer_gateways || []).join(', ') || 'not set') + '. Material: ' + escapeHtml(displayMaterialMode(provider.material_mode || 'missing')) + '.</div></div>' +
          '</div></article>';
      }
      function inventorySummaryForRows(rows) {
        var inventoryRows = Array.isArray(rows) ? rows : [];
        return {
          total: inventoryRows.length,
          protected: inventoryRows.filter(function(row) { return row.statuses.some(function(status) { return status.label === 'protected'; }); }).length,
          missing_provider_slot: inventoryRows.filter(function(row) { return !row.provider; }).length,
          manual_api_keys: inventoryRows.filter(function(row) { return Boolean(row.manual_key); }).length,
          imported_api_hints: inventoryRows.filter(function(row) { return Boolean(row.manual_key) && row.manual_key.source === 'vaultproof_inventory_import'; }).length,
          needs_sealed_ingest: inventoryRows.filter(function(row) { return Boolean(row.manual_key) && !row.provider; }).length,
          policy_incomplete: inventoryRows.filter(function(row) { return !row.policy.complete; }).length,
          no_recent_traffic: inventoryRows.filter(function(row) { return Number(row.traffic.calls || 0) === 0; }).length,
          review_due: inventoryRows.filter(function(row) { return row.statuses.some(function(status) { return status.label === 'review due'; }); }).length,
          approved: inventoryRows.filter(function(row) { return row.annotation && row.annotation.review_status === 'approved'; }).length,
          exceptions: inventoryRows.filter(function(row) { return row.annotation && row.annotation.review_status === 'exception'; }).length,
          needs_review: inventoryRows.filter(function(row) { return !row.annotation || !row.annotation.review_status || row.annotation.review_status === 'needs_review'; }).length,
          high_risk: inventoryRows.filter(function(row) { return row.annotation && row.annotation.risk === 'high'; }).length,
          critical_risk: inventoryRows.filter(function(row) { return row.annotation && row.annotation.risk === 'critical'; }).length,
          blocked: inventoryRows.filter(function(row) { return row.annotation && row.annotation.review_status === 'blocked'; }).length
        };
      }
      function inventorySummary() {
        return inventorySummaryForRows(cachedInventoryRows);
      }
      function inventoryFilterState() {
        return {
          search: ((byId('inventorySearch') && byId('inventorySearch').value) || '').trim().toLowerCase(),
          status: (byId('inventoryStatusFilter') && byId('inventoryStatusFilter').value) || '',
          review: (byId('inventoryReviewFilter') && byId('inventoryReviewFilter').value) || '',
          risk: (byId('inventoryRiskFilter') && byId('inventoryRiskFilter').value) || '',
          source: (byId('inventorySourceFilter') && byId('inventorySourceFilter').value) || ''
        };
      }
      function inventoryRowHasStatus(row, status) {
        return (row.statuses || []).some(function(item) {
          return item && item.label === status;
        });
      }
      function inventoryRowSearchText(row) {
        var annotation = row.annotation || {};
        var provider = row.provider || {};
        var manualKey = row.manual_key || {};
        var project = row.project || {};
        return [
          row.id,
          project.name,
          project.vp_proj_id,
          project.id,
          provider.provider,
          provider.slug,
          provider.material_mode,
          provider.default_path,
          manualKey.provider,
          manualKey.key_label,
          manualKey.key_reference,
          manualKey.key_location,
          manualKey.upstream_scope,
          manualKey.source_format,
          annotation.business_owner,
          annotation.technical_owner,
          annotation.environment,
          annotation.business_service,
          annotation.data_sensitivity,
          annotation.risk,
          annotation.review_status,
          annotation.note,
          (row.statuses || []).map(function(status) { return status.label || status; }).join(' ')
        ].filter(Boolean).join(' ').toLowerCase();
      }
      function inventoryRowMatchesFilters(row, filters) {
        var annotation = row.annotation || {};
        var manualKey = row.manual_key || {};
        if (filters.search && inventoryRowSearchText(row).indexOf(filters.search) === -1) return false;
        if (filters.review && (annotation.review_status || 'needs_review') !== filters.review) return false;
        if (filters.risk && (annotation.risk || '') !== filters.risk) return false;
        if (filters.source === 'project_slot' && !row.provider) return false;
        if (filters.source === 'manual' && !row.manual_key) return false;
        if (filters.source === 'imported' && manualKey.source !== 'vaultproof_inventory_import') return false;
        if (filters.status === 'protected' && !inventoryRowHasStatus(row, 'protected')) return false;
        if (filters.status === 'manual' && !row.manual_key) return false;
        if (filters.status === 'imported' && manualKey.source !== 'vaultproof_inventory_import') return false;
        if (filters.status === 'missing_provider_slot' && row.provider) return false;
        if (filters.status === 'needs_sealed_ingest' && !inventoryRowHasStatus(row, 'needs sealed ingest')) return false;
        if (filters.status === 'policy_incomplete' && !inventoryRowHasStatus(row, 'policy incomplete')) return false;
        if (filters.status === 'no_recent_traffic' && !inventoryRowHasStatus(row, 'no recent traffic')) return false;
        if (filters.status === 'review_due' && !inventoryRowHasStatus(row, 'review due')) return false;
        if (filters.status === 'blocked' && (annotation.review_status || '') !== 'blocked') return false;
        return true;
      }
      function inventoryFiltersActive(filters) {
        return Boolean(filters && (filters.search || filters.status || filters.review || filters.risk || filters.source));
      }
      function filteredInventoryRows(filters) {
        var currentFilters = filters || inventoryFilterState();
        return cachedInventoryRows.filter(function(row) {
          return inventoryRowMatchesFilters(row, currentFilters);
        });
      }
      function renderInventoryList() {
        var filters = inventoryFilterState();
        var visibleRows = filteredInventoryRows(filters);
        var filtered = visibleRows.length !== cachedInventoryRows.length || inventoryFiltersActive(filters);
        text('inventoryMeta', (filtered ? number(visibleRows.length) + ' of ' : '') + number(cachedInventoryRows.length) + ' API surfaces');
        if (!cachedInventoryRows.length) {
          byId('inventoryList').innerHTML = '<div class="empty">No projects or provider slots are visible yet. Create one project and provider slot before the customer API inventory review.</div>';
          return;
        }
        byId('inventoryList').innerHTML = visibleRows.length ? visibleRows.map(renderInventoryRow).join('') : '<div class="empty">No API inventory rows match these filters. Clear filters or import more metadata before customer review.</div>';
      }
      function inventoryEvidencePacket() {
        var summary = inventorySummary();
        return {
          packet_type: 'vaultproof_enterprise_api_inventory',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/inventory',
          organization_id: currentOrgId || null,
          summary: summary,
          export_formats: ['json', 'csv'],
          rows: cachedInventoryRows.map(function(row) {
            return {
              id: row.id,
              project: row.project,
              provider: Object.assign({}, row.provider, { material_mode: displayMaterialMode(row.provider && row.provider.material_mode) }),
              manual_key: row.manual_key ? {
                provider: row.manual_key.provider || null,
                key_label: row.manual_key.key_label || null,
                key_reference: row.manual_key.key_reference || null,
                key_location: row.manual_key.key_location || null,
                upstream_scope: row.manual_key.upstream_scope || null,
                rotation_status: row.manual_key.rotation_status || null,
                source: row.manual_key.source || null,
                source_format: row.manual_key.source_format || null,
                source_detail: row.manual_key.source_detail || null,
                imported_at: row.manual_key.imported_at || null,
                created_at: row.manual_key.created_at || null,
                updated_at: row.manual_key.updated_at || null
              } : null,
              policy: row.policy,
              traffic: row.traffic,
              annotation: {
                business_owner: row.annotation.business_owner || null,
                technical_owner: row.annotation.technical_owner || null,
                environment: row.annotation.environment || null,
                business_service: row.annotation.business_service || null,
                data_sensitivity: row.annotation.data_sensitivity || null,
                risk: row.annotation.risk || null,
                review_status: row.annotation.review_status || 'needs_review',
                next_review_date: row.annotation.next_review_date || null,
                updated_at: row.annotation.updated_at || null,
                bulk_reviewed_at: row.annotation.bulk_reviewed_at || null,
                note: redactInventoryNote(row.annotation.note)
              },
              statuses: row.statuses.map(function(status) { return status.label; })
            };
          }),
          workflow_links: {
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            security_review: '/app/security-review',
            evidence: '/app/evidence',
            audit_csv_30_days: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'),
            access_review_csv: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv')
          },
          secrets_excluded: [
            'raw provider keys',
            'raw manually entered API keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function csvCell(value) {
        var textValue = value == null ? '' : String(value);
        return '"' + textValue.replace(/"/g, '""') + '"';
      }
      function inventoryEvidenceCsv(rows) {
        var exportRows = Array.isArray(rows) ? rows : cachedInventoryRows;
        var headers = [
          'inventory_id',
          'project_name',
          'project_id',
          'vp_project_id',
          'provider',
          'provider_slug',
          'material_mode',
          'manual_key_label',
          'manual_key_reference',
          'key_location',
          'upstream_scope',
          'business_owner',
          'technical_owner',
          'environment',
          'business_service',
          'data_sensitivity',
          'risk',
          'review_status',
          'next_review_date',
          'bulk_reviewed_at',
          'policy_complete',
          'caller_lock_controls',
          'traffic_calls',
          'traffic_errors',
          'traffic_denied',
          'last_seen_at',
          'statuses',
          'source_format'
        ];
        var lines = [headers.map(csvCell).join(',')];
        exportRows.forEach(function(row) {
          var manualKey = row.manual_key || {};
          var provider = row.provider || {};
          var annotation = row.annotation || {};
          var traffic = row.traffic || {};
          var policy = row.policy || {};
          lines.push([
            row.id,
            row.project && row.project.name,
            row.project && row.project.id,
            row.project && row.project.vp_proj_id,
            provider.provider || manualKey.provider || '',
            provider.slug || '',
            provider.material_mode || '',
            manualKey.key_label || '',
            manualKey.key_reference || '',
            manualKey.key_location || '',
            manualKey.upstream_scope || provider.default_path || '',
            annotation.business_owner || '',
            annotation.technical_owner || '',
            annotation.environment || '',
            annotation.business_service || '',
            annotation.data_sensitivity || '',
            annotation.risk || '',
            annotation.review_status || 'needs_review',
            annotation.next_review_date || '',
            annotation.bulk_reviewed_at || '',
            policy.complete === true ? 'true' : 'false',
            policy.caller_lock_controls || '',
            Number(traffic.calls || 0),
            Number(traffic.errors || 0),
            Number(traffic.denied || 0),
            traffic.last_seen_at || '',
            (row.statuses || []).map(function(status) { return status.label || status; }).join('; '),
            manualKey.source_format || ''
          ].map(csvCell).join(','));
        });
        return lines.join('\\n');
      }
      function inventoryBriefRowLabel(row) {
        var project = row.project || {};
        var provider = row.provider || {};
        var manualKey = row.manual_key || {};
        var providerLabel = row.provider ? (provider.slug || provider.provider || 'provider') : (manualKey.key_label || manualKey.provider || 'manual API key');
        return (project.name || project.vp_proj_id || 'Unassigned project') + ' / ' + providerLabel;
      }
      function inventoryBriefActions(row) {
        var actions = [];
        var annotation = row.annotation || {};
        if (!row.provider) actions.push(row.manual_key ? 'seal provider slot for protected execution' : 'create provider slot');
        if (!row.policy || !row.policy.complete) actions.push('complete caller-lock policy');
        if (Number((row.traffic || {}).calls || 0) === 0) actions.push('collect traffic or dry-run evidence');
        if (!annotation.business_owner || !annotation.technical_owner) actions.push('assign business and technical owners');
        if (!annotation.review_status || annotation.review_status === 'needs_review') actions.push('finish inventory review');
        if (annotation.review_status === 'blocked') actions.push('resolve blocker before pilot traffic');
        if (annotation.review_status === 'exception') actions.push('confirm exception owner and expiry in Policy Drift');
        if (annotation.risk === 'critical' || annotation.risk === 'high') actions.push('review high-risk data/API posture');
        return actions.length ? actions : ['ready for customer review'];
      }
      function inventoryBriefPriority(row) {
        var annotation = row.annotation || {};
        var score = 0;
        if (annotation.review_status === 'blocked') score += 100;
        if (!row.provider) score += 40;
        if (!row.policy || !row.policy.complete) score += 25;
        if ((row.statuses || []).some(function(status) { return status.label === 'review due'; })) score += 20;
        if (annotation.risk === 'critical') score += 18;
        if (annotation.risk === 'high') score += 12;
        if (Number((row.traffic || {}).calls || 0) === 0) score += 8;
        return score;
      }
      function inventoryReviewBrief() {
        var filters = inventoryFilterState();
        var rows = filteredInventoryRows(filters);
        var summary = inventorySummaryForRows(rows);
        var scope = inventoryFiltersActive(filters) ? 'filtered rows' : 'all visible inventory rows';
        var priorityRows = rows.slice().sort(function(left, right) {
          return inventoryBriefPriority(right) - inventoryBriefPriority(left);
        }).filter(function(row) {
          return inventoryBriefPriority(row) > 0;
        }).slice(0, 12);
        var lines = [
          'VaultProof API inventory review brief',
          'Generated: ' + new Date().toISOString(),
          'Organization: ' + (currentOrgId || 'not selected'),
          'Scope: ' + scope + ' (' + number(rows.length) + ' row(s))',
          '',
          'Summary:',
          '- Total rows: ' + number(summary.total),
          '- Protected: ' + number(summary.protected),
          '- Approved: ' + number(summary.approved),
          '- Needs review: ' + number(summary.needs_review),
          '- Exceptions: ' + number(summary.exceptions),
          '- Blocked: ' + number(summary.blocked),
          '- Missing provider slot: ' + number(summary.missing_provider_slot),
          '- Needs sealed ingest: ' + number(summary.needs_sealed_ingest),
          '- Policy incomplete: ' + number(summary.policy_incomplete),
          '- No recent traffic: ' + number(summary.no_recent_traffic),
          '- Review due: ' + number(summary.review_due),
          '- High/critical risk: ' + number(summary.high_risk + summary.critical_risk),
          '',
          'Priority actions:'
        ];
        if (priorityRows.length) {
          priorityRows.forEach(function(row) {
            lines.push('- ' + inventoryBriefRowLabel(row) + ': ' + inventoryBriefActions(row).join('; '));
          });
        } else {
          lines.push('- No priority blockers in the current inventory scope.');
        }
        lines.push(
          '',
          'Secret boundary:',
          '- This brief is metadata-only. It excludes raw provider keys, manually entered API keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.'
        );
        return lines.join('\\n');
      }
      function evidenceExportHref(path) {
        if (!currentOrgId) return path;
        var joiner = path.indexOf('?') === -1 ? '?' : '&';
        return path + joiner + 'org=' + encodeURIComponent(currentOrgId);
      }
      function renderInventorySummary() {
        if (PAGE_MODE !== 'inventory') return;
        var summary = inventorySummary();
        byId('inventorySummaryList').innerHTML =
          '<div class="inventory-summary-metrics">' +
            '<div class="inventory-metric-card"><strong>' + number(summary.total) + '</strong><span>surfaces</span></div>' +
            '<div class="inventory-metric-card"><strong>' + number(summary.protected) + '</strong><span>protected</span></div>' +
            '<div class="inventory-metric-card"><strong>' + number(summary.review_due) + '</strong><span>review due</span></div>' +
            '<div class="inventory-metric-card"><strong>' + number(summary.blocked) + '</strong><span>blocked</span></div>' +
          '</div>' +
          [
            '<div class="row"><div><div class="row-title">Coverage</div><div class="row-sub">' + number(summary.missing_provider_slot) + ' missing provider slot, ' + number(summary.policy_incomplete) + ' policy incomplete, and ' + number(summary.no_recent_traffic) + ' without traffic evidence.</div></div><span class="tag ' + (summary.missing_provider_slot || summary.policy_incomplete ? 'warn' : 'good') + '">' + (summary.missing_provider_slot || summary.policy_incomplete ? 'review' : 'ready') + '</span></div>',
            '<div class="row"><div><div class="row-title">Manual records</div><div class="row-sub">' + number(summary.manual_api_keys) + ' metadata-only manual key records; ' + number(summary.needs_sealed_ingest) + ' need sealed ingest before protected execution.</div></div><span class="tag warn">metadata</span></div>',
            '<div class="row"><div><div class="row-title">Imports</div><div class="row-sub">' + number(summary.imported_api_hints) + ' CSV/OpenAPI hints are saved locally and reviewed like manual records.</div></div><span class="tag good">safe import</span></div>',
            '<div class="row"><div><div class="row-title">Secret boundary</div><div class="row-sub">Inventory records exclude raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.</div></div><span class="tag good">redacted</span></div>'
          ].join('');
        byId('inventoryWorkflowList').innerHTML = [
          '<div class="row"><div><div class="row-title">1. Import or add metadata</div><div class="row-sub">Bring in CSV/OpenAPI hints or add one manual API record. Keep raw keys out of the inventory.</div></div><button class="tag good" type="button" data-action="open-inventory-import">import</button></div>',
          '<div class="row"><div><div class="row-title">2. Seal the real key</div><div class="row-sub">Move the selected provider behind VaultProof once ownership, scope, and risk are known.</div></div><a class="tag good" href="/app/keys">provider slots</a></div>',
          '<div class="row"><div><div class="row-title">3. Tighten policy</div><div class="row-sub">Confirm origin, method, upstream, gateway, and rate controls before customer traffic.</div></div><a class="tag good" href="/app/control">control</a></div>',
          '<div class="row"><div><div class="row-title">4. Export proof</div><div class="row-sub">Use the command bar for CSV, filtered CSV, brief, or JSON exports.</div></div><span><a class="tag" href="/app/evidence">evidence</a><a class="tag" href="/app/security-review">review</a></span></div>',
          '<div class="row"><div><div class="row-title">Traffic and audit</div><div class="row-sub">Use Activity, Audit CSV, and Access Review CSV when a customer asks what changed or who can reach it.</div></div><span><a class="tag" href="/app/activity">activity</a><a class="tag" href="' + escapeHtml(evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30')) + '">audit CSV</a><a class="tag" href="' + escapeHtml(evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv')) + '">access CSV</a></span></div>'
        ].join('');
      }
      function renderInventory() {
        var panel = byId('inventoryPanel');
        if (panel) panel.style.display = PAGE_MODE === 'inventory' ? 'grid' : 'none';
        if (PAGE_MODE !== 'inventory') return;
        cachedInventoryRows = buildInventoryRows();
        renderInventoryList();
        renderInventorySummary();
      }
      function copyInventoryJson() {
        cachedInventoryRows = buildInventoryRows();
        copyToClipboard(JSON.stringify(inventoryEvidencePacket(), null, 2), 'API inventory JSON');
      }
      function copyInventoryCsv() {
        cachedInventoryRows = buildInventoryRows();
        copyToClipboard(inventoryEvidenceCsv(), 'API inventory CSV');
      }
      function copyFilteredInventoryCsv() {
        cachedInventoryRows = buildInventoryRows();
        var filters = inventoryFilterState();
        var rows = filteredInventoryRows(filters);
        var label = inventoryFiltersActive(filters) ? 'Filtered API inventory CSV' : 'API inventory CSV';
        copyToClipboard(inventoryEvidenceCsv(rows), label);
      }
      function copyInventoryReviewBrief() {
        cachedInventoryRows = buildInventoryRows();
        copyToClipboard(inventoryReviewBrief(), 'API inventory review brief');
      }
      function applyInventoryBulkReview(event) {
        if (event) event.preventDefault();
        cachedInventoryRows = buildInventoryRows();
        var status = (byId('bulkInventoryReviewStatus') && byId('bulkInventoryReviewStatus').value) || '';
        if (['approved', 'exception', 'blocked', 'needs_review'].indexOf(status) === -1) {
          notice('Choose a review status before applying a bulk inventory review.');
          return;
        }
        var rows = filteredInventoryRows(inventoryFilterState());
        if (!rows.length) {
          notice('No visible inventory rows match the current filters.');
          return;
        }
        if (!confirm('Apply review status "' + status.replace('_', ' ') + '" to ' + rows.length + ' visible API inventory row(s)?')) return;
        var annotations = readInventoryAnnotations();
        var nextReview = (byId('bulkInventoryNextReview') && byId('bulkInventoryNextReview').value) || '';
        var now = new Date().toISOString();
        rows.forEach(function(row) {
          var current = annotations[row.id] && typeof annotations[row.id] === 'object' ? annotations[row.id] : {};
          current.review_status = status;
          if (nextReview) current.next_review_date = nextReview;
          current.updated_at = now;
          current.bulk_reviewed_at = now;
          annotations[row.id] = current;
        });
        writeInventoryAnnotations(annotations);
        if (byId('bulkInventoryReviewStatus')) byId('bulkInventoryReviewStatus').value = '';
        cachedInventoryRows = buildInventoryRows();
        renderInventory();
        notice('Updated ' + rows.length + ' visible inventory row(s).');
      }
      function policyStorageKey() {
        return 'vaultproof_policy_exceptions::' + (currentOrgId || 'default');
      }
      function readPolicyExceptions() {
        try {
          var parsed = JSON.parse(localStorage.getItem(policyStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writePolicyExceptions(value) {
        localStorage.setItem(policyStorageKey(), JSON.stringify(value || {}));
      }
      function redactPolicyText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key)/i.test(textValue)) {
          return '[redacted: policy note contained secret-like material]';
        }
        return textValue;
      }
      function policyExceptionActive(exception) {
        if (!exception || ['accepted_demo', 'approved'].indexOf(exception.approval_status || '') === -1) return false;
        if (!exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires >= Date.now();
      }
      function policyExceptionExpired(exception) {
        if (!exception || !exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires < Date.now();
      }
      function policySeverityRank(value) {
        return { critical: 4, high: 3, medium: 2, low: 1 }[String(value || '').toLowerCase()] || 0;
      }
      function policyRowStatus(row) {
        var exception = row.exception || {};
        if (exception.approval_status === 'blocked') return 'blocked';
        if (policyExceptionActive(exception)) return exception.approval_status === 'approved' ? 'approved exception' : 'pilot accepted';
        if (policyExceptionExpired(exception)) return 'expired exception';
        return 'open drift';
      }
      function policyRowTone(row) {
        var status = policyRowStatus(row);
        if (status === 'approved exception' || status === 'pilot accepted') return 'good';
        if (status === 'blocked' || row.severity === 'critical') return 'bad';
        return 'warn';
      }
      function addPolicyRow(rows, inventoryRow, controlId, title, detail, severity, action) {
        var exceptions = readPolicyExceptions();
        var id = inventoryRow.id + '::' + controlId;
        var exception = exceptions[id] && typeof exceptions[id] === 'object' ? exceptions[id] : {};
        rows.push({
          id: id,
          api_surface_id: inventoryRow.id,
          control_id: controlId,
          title: title,
          detail: detail,
          severity: severity,
          action: action,
          project: inventoryRow.project,
          provider: inventoryRow.provider,
          policy: inventoryRow.policy,
          traffic: inventoryRow.traffic,
          inventory_annotation: inventoryRow.annotation || {},
          exception: exception
        });
      }
      function buildPolicyRows() {
        var rows = [];
        buildInventoryRows().forEach(function(inventoryRow) {
          var annotation = inventoryRow.annotation || {};
          var provider = inventoryRow.provider || {};
          var policy = inventoryRow.policy || {};
          var traffic = inventoryRow.traffic || {};
          var ownerMissing = !annotation.business_owner || !annotation.technical_owner;
          if (!inventoryRow.provider) {
            addPolicyRow(rows, inventoryRow, 'missing-provider-slot', 'Missing provider slot', 'This project has no mapped provider slot, so VaultProof cannot prove which upstream API is protected.', 'critical', 'Create a provider slot in /app/keys, then map the caller policy in /app/control.');
          }
          if (inventoryRow.provider && provider.material_mode === 'demo-placeholder') {
            addPolicyRow(rows, inventoryRow, 'demo-placeholder-material', 'Placeholder provider material', 'The provider slot uses placeholder material. That is acceptable for a controlled pilot only when explicitly accepted and dated.', 'high', 'Rotate to sealed live material before paid customer data, or record a temporary exception with an expiry.');
          }
          if (inventoryRow.project && inventoryRow.project.strict_origin !== true) {
            addPolicyRow(rows, inventoryRow, 'strict-origin-missing', 'Strict origin not enabled', 'Strict origin enforcement is not active for this project, which weakens browser-origin binding.', 'critical', 'Enable strict origin and confirm allowed origins in /app/control.');
          }
          if (!Array.isArray(policy.allowed_customer_gateways) || policy.allowed_customer_gateways.length === 0) {
            addPolicyRow(rows, inventoryRow, 'gateway-lock-missing', 'Customer gateway lock missing', 'No approved customer gateway marker is visible for this API surface.', 'high', 'Add allowed_customer_gateways in /app/control or document the accepted pilot gateway path.');
          }
          if (!Array.isArray(policy.allowed_methods) || policy.allowed_methods.length === 0) {
            addPolicyRow(rows, inventoryRow, 'method-lock-missing', 'Allowed methods not set', 'The caller-lock policy does not report an allowed HTTP method list for this surface.', 'medium', 'Set the smallest allowed method list in /app/control.');
          }
          if ((!Array.isArray(policy.allowed_upstream_hosts) || policy.allowed_upstream_hosts.length === 0) && (!Array.isArray(policy.allowed_upstream_path_prefixes) || policy.allowed_upstream_path_prefixes.length === 0)) {
            addPolicyRow(rows, inventoryRow, 'upstream-scope-missing', 'Upstream scope not set', 'No upstream host or path-prefix restriction is visible for this protected provider path.', 'high', 'Set allowed upstream hosts or path prefixes in /app/control.');
          }
          if (ownerMissing) {
            addPolicyRow(rows, inventoryRow, 'inventory-owner-missing', 'Owner metadata missing', 'Business owner and technical owner are required before a buyer can treat this API as operationally owned.', 'medium', 'Open /app/inventory and set both owners for this API surface.');
          }
          if (Number(traffic.calls || 0) === 0) {
            addPolicyRow(rows, inventoryRow, 'traffic-evidence-missing', 'No recent traffic evidence', 'No proxy traffic is visible for this API surface, so the walkthrough cannot prove live runtime behavior yet.', 'medium', 'Run a dry-run request from /app/keys and review /app/activity.');
          }
          if (traffic.stale) {
            addPolicyRow(rows, inventoryRow, 'traffic-evidence-stale', 'Traffic evidence is stale', 'The last observed proxy activity is older than 30 days.', 'medium', 'Run a fresh dry-run or low-volume test and review /app/activity.');
          }
          if (isReviewDue(annotation) || !annotation.review_status || annotation.review_status === 'needs_review') {
            addPolicyRow(rows, inventoryRow, 'inventory-review-due', 'Inventory review due', 'The API inventory row is not approved or the next review date has passed.', 'medium', 'Approve, block, or record an exception from /app/inventory.');
          }
          if (annotation.review_status === 'blocked') {
            addPolicyRow(rows, inventoryRow, 'inventory-blocked', 'Inventory row blocked', 'The API inventory record is explicitly blocked and should hold launch until resolved.', 'critical', 'Resolve the blocker or record a signed accepted-risk decision with owner and expiry.');
          }
        });
        return rows.sort(function(a, b) {
          return policySeverityRank(b.severity) - policySeverityRank(a.severity) || a.title.localeCompare(b.title);
        });
      }
      function policySelect(row, field, label, options) {
        var exception = row.exception || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(exception[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function policyInput(row, field, label, placeholder) {
        var exception = row.exception || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="' + escapeHtml(field) + '" value="' + escapeHtml(exception[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function renderPolicyRow(row) {
        var exception = row.exception || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? provider.slug + ' / ' + provider.provider : 'no provider slot';
        var status = policyRowStatus(row);
        var tone = policyRowTone(row);
        var expired = policyExceptionExpired(exception);
        return '<div class="inventory-row" data-policy-card="' + escapeHtml(row.id) + '">' +
          '<div class="inventory-head"><div><div class="row-title">' + escapeHtml(row.title) + '</div>' +
          '<div class="row-sub">' + escapeHtml(row.project.name) + ' - ' + escapeHtml(providerLabel) + ' - ' + escapeHtml(row.detail) + '</div>' +
          '<div><span class="tag ' + tone + '">' + escapeHtml(status) + '</span><span class="tag ' + (row.severity === 'critical' ? 'bad' : row.severity === 'high' ? 'warn' : '') + '">' + escapeHtml(row.severity) + '</span><span class="tag">' + escapeHtml(row.control_id) + '</span>' + (expired ? '<span class="tag bad">expired</span>' : '') + '</div></div>' +
          '<div class="row-actions"><a class="tag" href="/app/control">control</a><a class="tag" href="/app/inventory">inventory</a><a class="tag" href="/app/keys">provider slots</a><a class="tag" href="/app/activity">activity</a></div></div>' +
          '<div class="inventory-fields">' +
          policySelect(row, 'approval_status', 'exception status', [
            { value: '', label: 'open' },
            { value: 'accepted_demo', label: 'accepted for pilot' },
            { value: 'approved', label: 'approved exception' },
            { value: 'blocked', label: 'blocked' }
          ]) +
          policyInput(row, 'owner', 'exception owner', row.inventory_annotation.technical_owner || row.inventory_annotation.business_owner || 'Security owner') +
          policySelect(row, 'risk_level', 'risk level', [
            { value: '', label: 'unset' },
            { value: 'low', label: 'low' },
            { value: 'medium', label: 'medium' },
            { value: 'high', label: 'high' },
            { value: 'critical', label: 'critical' }
          ]) +
          '<div class="inventory-field"><label>expiration date</label><input type="date" data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="expires_at" value="' + escapeHtml(exception.expires_at || '') + '" /></div>' +
          '<div class="inventory-field wide"><label>accepted-risk reason</label><textarea data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="reason" placeholder="Metadata only. Do not paste secrets, request bodies, response bodies, or customer payloads.">' + escapeHtml(exception.reason || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>compensating control</label><textarea data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="compensating_control" placeholder="Temporary control, monitoring owner, or rollout guardrail.">' + escapeHtml(exception.compensating_control || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>next action</label><textarea data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="next_action" placeholder="' + escapeHtml(row.action) + '">' + escapeHtml(exception.next_action || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>recommended action</label><div class="row-sub">' + escapeHtml(row.action) + '</div></div>' +
          '</div></div>';
      }
      function savePolicyField(target, rerender) {
        var rowId = target.getAttribute('data-policy-row-id');
        var field = target.getAttribute('data-policy-field');
        if (!rowId || !field) return;
        var exceptions = readPolicyExceptions();
        var current = exceptions[rowId] && typeof exceptions[rowId] === 'object' ? exceptions[rowId] : {};
        current[field] = target.value || '';
        current.updated_at = new Date().toISOString();
        exceptions[rowId] = current;
        writePolicyExceptions(exceptions);
        cachedPolicyRows = buildPolicyRows();
        if (rerender || field === 'approval_status' || field === 'expires_at') {
          renderPolicy();
        } else {
          renderPolicySummary();
        }
      }
      function policyFilterState() {
        return {
          search: ((byId('policySearch') && byId('policySearch').value) || '').trim().toLowerCase(),
          severity: (byId('policySeverityFilter') && byId('policySeverityFilter').value) || '',
          status: (byId('policyStatusFilter') && byId('policyStatusFilter').value) || '',
          control: (byId('policyControlFilter') && byId('policyControlFilter').value) || ''
        };
      }
      function policyStatusFilterValue(row) {
        var status = policyRowStatus(row);
        if (status === 'pilot accepted') return 'accepted_demo';
        if (status === 'approved exception') return 'approved_exception';
        if (status === 'expired exception') return 'expired_exception';
        if (status === 'blocked') return 'blocked';
        return 'open_drift';
      }
      function policyRowSearchText(row) {
        var exception = row.exception || {};
        var project = row.project || {};
        var provider = row.provider || {};
        return [
          row.id,
          row.title,
          row.detail,
          row.severity,
          row.control_id,
          row.action,
          policyRowStatus(row),
          project.name,
          project.vp_proj_id,
          provider.provider,
          provider.slug,
          exception.owner,
          exception.risk_level,
          exception.approval_status,
          exception.reason,
          exception.compensating_control,
          exception.next_action
        ].filter(Boolean).join(' ').toLowerCase();
      }
      function policyRowMatchesFilters(row, filters) {
        if (filters.search && policyRowSearchText(row).indexOf(filters.search) === -1) return false;
        if (filters.severity && row.severity !== filters.severity) return false;
        if (filters.status && policyStatusFilterValue(row) !== filters.status) return false;
        if (filters.control && row.control_id !== filters.control) return false;
        return true;
      }
      function policyFiltersActive(filters) {
        return Boolean(filters && (filters.search || filters.severity || filters.status || filters.control));
      }
      function filteredPolicyRows(filters) {
        var currentFilters = filters || policyFilterState();
        return cachedPolicyRows.filter(function(row) {
          return policyRowMatchesFilters(row, currentFilters);
        });
      }
      function renderPolicyList() {
        var filters = policyFilterState();
        var visibleRows = filteredPolicyRows(filters);
        var filtered = visibleRows.length !== cachedPolicyRows.length || policyFiltersActive(filters);
        text('policyMeta', (filtered ? number(visibleRows.length) + ' of ' : '') + number(cachedPolicyRows.length) + ' drift rows');
        if (!cachedPolicyRows.length) {
          byId('policyList').innerHTML = '<div class="empty">No active policy drift is visible from the current projects, provider slots, inventory metadata, policy settings, and traffic evidence.</div>';
          return;
        }
        byId('policyList').innerHTML = visibleRows.length ? visibleRows.map(renderPolicyRow).join('') : '<div class="empty">No policy drift rows match these filters. Clear filters or review API inventory, Control, and Provider Slots.</div>';
      }
      function policyDriftSummaryForRows(rows) {
        var policyRows = Array.isArray(rows) ? rows : [];
        var activeExceptions = policyRows.filter(function(row) { return policyExceptionActive(row.exception); });
        var criticalOpen = policyRows.filter(function(row) {
          return (row.severity === 'critical' || row.severity === 'high') && !policyExceptionActive(row.exception) && policyRowStatus(row) !== 'blocked';
        });
        return {
          total: policyRows.length,
          critical: policyRows.filter(function(row) { return row.severity === 'critical'; }).length,
          high: policyRows.filter(function(row) { return row.severity === 'high'; }).length,
          medium: policyRows.filter(function(row) { return row.severity === 'medium'; }).length,
          open_drift: policyRows.filter(function(row) { return policyStatusFilterValue(row) === 'open_drift'; }).length,
          active_exceptions: activeExceptions.length,
          expired_exceptions: policyRows.filter(function(row) { return policyExceptionExpired(row.exception); }).length,
          blocked: policyRows.filter(function(row) { return policyRowStatus(row) === 'blocked'; }).length,
          launch_status: criticalOpen.length || policyRows.some(function(row) { return policyRowStatus(row) === 'blocked'; }) ? 'hold' : 'ready'
        };
      }
      function policyDriftSummary() {
        return policyDriftSummaryForRows(cachedPolicyRows);
      }
      function policyEvidencePacket() {
        var summary = policyDriftSummary();
        return {
          packet_type: 'vaultproof_enterprise_policy_drift',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/policy',
          organization_id: currentOrgId || null,
          status: summary.launch_status,
          summary: summary,
          rows: cachedPolicyRows.map(function(row) {
            return {
              id: row.id,
              api_surface_id: row.api_surface_id,
              control_id: row.control_id,
              title: row.title,
              severity: row.severity,
              status: policyRowStatus(row),
              project: row.project,
              provider: row.provider,
              action: row.action,
              exception: {
                approval_status: row.exception.approval_status || null,
                owner: row.exception.owner || null,
                risk_level: row.exception.risk_level || null,
                expires_at: row.exception.expires_at || null,
                updated_at: row.exception.updated_at || null,
                reason: redactPolicyText(row.exception.reason),
                compensating_control: redactPolicyText(row.exception.compensating_control),
                next_action: redactPolicyText(row.exception.next_action)
              }
            };
          }),
          workflow_links: {
            policy_drift: '/app/policy',
            api_inventory: '/app/inventory',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            security_review: '/app/security-review',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function policyBriefRowLabel(row) {
        var project = row.project || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? (provider.slug || provider.provider || 'provider') : 'no provider slot';
        return (project.name || project.vp_proj_id || 'Unassigned project') + ' / ' + providerLabel + ' / ' + row.control_id;
      }
      function policyBriefActions(row) {
        var exception = row.exception || {};
        var status = policyRowStatus(row);
        var actions = [];
        if (status === 'blocked') actions.push('resolve blocker before pilot traffic');
        if (status === 'expired exception') actions.push('renew or close expired accepted-risk record');
        if (status === 'open drift') actions.push(row.action);
        if (!policyExceptionActive(exception) && (row.severity === 'critical' || row.severity === 'high')) actions.push('close or record owner-approved exception before paid traffic');
        if (!exception.owner) actions.push('assign exception owner');
        if (!exception.reason) actions.push('capture accepted-risk reason');
        if (!exception.compensating_control) actions.push('capture compensating control');
        if (!exception.expires_at) actions.push('set expiration date');
        return actions.length ? actions : ['exception is recorded; verify it is still acceptable for the customer walkthrough'];
      }
      function policyBriefPriority(row) {
        var score = policySeverityRank(row.severity) * 10;
        var status = policyRowStatus(row);
        if (status === 'blocked') score += 100;
        if (status === 'expired exception') score += 60;
        if (status === 'open drift') score += 35;
        if (!policyExceptionActive(row.exception) && (row.severity === 'critical' || row.severity === 'high')) score += 20;
        return score;
      }
      function policyDriftBrief() {
        var filters = policyFilterState();
        var rows = filteredPolicyRows(filters);
        var summary = policyDriftSummaryForRows(rows);
        var scope = policyFiltersActive(filters) ? 'filtered drift rows' : 'all drift rows';
        var priorityRows = rows.slice().sort(function(left, right) {
          return policyBriefPriority(right) - policyBriefPriority(left);
        }).filter(function(row) {
          return policyBriefPriority(row) > 0;
        }).slice(0, 12);
        var lines = [
          'VaultProof policy drift review brief',
          'Generated: ' + new Date().toISOString(),
          'Organization: ' + (currentOrgId || 'not selected'),
          'Scope: ' + scope + ' (' + number(rows.length) + ' row(s))',
          '',
          'Summary:',
          '- Total drift rows: ' + number(summary.total),
          '- Critical: ' + number(summary.critical),
          '- High: ' + number(summary.high),
          '- Medium: ' + number(summary.medium),
          '- Open drift: ' + number(summary.open_drift),
          '- Active exceptions: ' + number(summary.active_exceptions),
          '- Expired exceptions: ' + number(summary.expired_exceptions),
          '- Blocked: ' + number(summary.blocked),
          '- Launch status: ' + summary.launch_status,
          '',
          'Priority actions:'
        ];
        if (priorityRows.length) {
          priorityRows.forEach(function(row) {
            lines.push('- ' + policyBriefRowLabel(row) + ': ' + policyBriefActions(row).join('; '));
          });
        } else {
          lines.push('- No priority policy drift rows in the current scope.');
        }
        lines.push(
          '',
          'Secret boundary:',
          '- This brief is metadata-only. It excludes raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.'
        );
        return lines.join('\\n');
      }
      function renderPolicySummary() {
        if (PAGE_MODE !== 'policy') return;
        var summary = policyDriftSummary();
        byId('policySummaryList').innerHTML = [
          '<div class="row"><div><div class="row-title">Policy drift status</div><div class="row-sub">' + number(summary.total) + ' drift rows, ' + number(summary.critical) + ' critical, ' + number(summary.high) + ' high, ' + number(summary.active_exceptions) + ' active accepted-risk records.</div></div><span class="tag ' + (summary.launch_status === 'ready' ? 'good' : 'bad') + '">' + escapeHtml(summary.launch_status) + '</span></div>',
          '<div class="row"><div><div class="row-title">Exception hygiene</div><div class="row-sub">' + number(summary.expired_exceptions) + ' expired exceptions and ' + number(summary.blocked) + ' blocked rows. Every paid-user exception needs owner, reason, compensating control, expiration date, and next action.</div></div><span class="tag warn">review</span></div>',
          '<div class="row"><div><div class="row-title">Secret boundary</div><div class="row-sub">Policy drift evidence excludes raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.</div></div><span class="tag good">redacted</span></div>'
        ].join('');
        byId('policyWorkflowList').innerHTML = [
          '<div class="row"><div><div class="row-title">Close policy gaps</div><div class="row-sub">Fix strict origin, gateway lock, method lock, upstream scope, and provider-slot posture in Control and Provider Slots.</div></div><span><a class="tag good" href="/app/control">control</a><a class="tag good" href="/app/keys">provider slots</a></span></div>',
          '<div class="row"><div><div class="row-title">Own every API surface</div><div class="row-sub">Use API Inventory to set business owner, technical owner, data sensitivity, risk, review status, and next review date.</div></div><a class="tag good" href="/app/inventory">inventory</a></div>',
          '<div class="row"><div><div class="row-title">Prove runtime behavior</div><div class="row-sub">Run dry-run or low-volume traffic and review Activity before the customer walkthrough.</div></div><a class="tag" href="/app/activity">activity</a></div>',
          '<div class="row"><div><div class="row-title">Launch packet</div><div class="row-sub">Export vaultproof_enterprise_policy_drift or copy the drift brief into Evidence and Security Review before paid traffic.</div></div><span><button class="tag good" type="button" data-action="copy-policy-brief">brief</button><a class="tag" href="/app/evidence">evidence</a><a class="tag" href="/app/security-review">security review</a></span></div>'
        ].join('');
      }
      function renderPolicy() {
        var panel = byId('policyPanel');
        if (panel) panel.style.display = PAGE_MODE === 'policy' ? 'grid' : 'none';
        if (PAGE_MODE !== 'policy') return;
        cachedPolicyRows = buildPolicyRows();
        renderPolicyList();
        renderPolicySummary();
      }
      function copyPolicyJson() {
        cachedPolicyRows = buildPolicyRows();
        copyToClipboard(JSON.stringify(policyEvidencePacket(), null, 2), 'Policy drift JSON');
      }
      function copyPolicyBrief() {
        cachedPolicyRows = buildPolicyRows();
        copyToClipboard(policyDriftBrief(), 'Policy drift review brief');
      }
      function rolloutStorageKey() {
        return 'vaultproof_integration_rollouts::' + (currentOrgId || 'default');
      }
      function readRolloutState() {
        try {
          var parsed = JSON.parse(localStorage.getItem(rolloutStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writeRolloutState(value) {
        localStorage.setItem(rolloutStorageKey(), JSON.stringify(value || {}));
      }
      function redactRolloutText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:)/i.test(textValue)) {
          return '[redacted: rollout note contained secret-like material]';
        }
        return textValue;
      }
      function rolloutPercent(value) {
        var parsed = Number(value || 0);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
      function rolloutSnippet(row) {
        if (!row.provider) return 'Create a provider slot before generating the protected-call snippet.';
        var slug = row.provider.slug || row.provider.provider || 'provider';
        var path = '/api/v1/enterprise/projects/' + encodeURIComponent(row.project.id) + '/providers/' + encodeURIComponent(slug) + '/execute';
        var headers = {
          authorization: 'Bearer YOUR_VAULTPROOF_SESSION_JWT',
          'content-type': 'application/json',
          'x-vaultproof-organization': currentOrgId || 'YOUR_ORGANIZATION_ID',
          'x-vaultproof-customer-gateway': 'vaultproof-managed',
          'x-vaultproof-client-class': 'server'
        };
        var body = {
          method: 'GET',
          upstream_path: row.provider.default_path || '/',
          dry_run: true
        };
        return [
          'fetch(' + JSON.stringify(location.origin + path) + ', {',
          '  method: "POST",',
          '  headers: ' + JSON.stringify(headers, null, 2).replace(/\\n/g, '\\n  ') + ',',
          '  body: JSON.stringify(' + JSON.stringify(body, null, 2).replace(/\\n/g, '\\n  ') + ')',
          '}).then(async (response) => ({',
          '  status: response.status,',
          '  body: await response.json().catch(() => null)',
          '}));'
        ].join('\\n');
      }
      function rolloutBlockers(row, state, policyRows) {
        var blockers = [];
        var annotation = row.annotation || {};
        var canary = rolloutPercent(state.canary_percent);
        var testStatus = state.test_status || 'not_started';
        var openCriticalPolicy = policyRows.filter(function(policyRow) {
          return (policyRow.severity === 'critical' || policyRow.severity === 'high') && policyRowStatus(policyRow) !== 'approved exception' && policyRowStatus(policyRow) !== 'pilot accepted';
        });
        if (!row.provider) blockers.push('missing provider slot');
        if (row.provider && row.provider.material_mode === 'demo-placeholder') blockers.push('placeholder provider material');
        if (!row.policy || row.policy.complete !== true) blockers.push('caller-lock policy incomplete');
        if (annotation.review_status === 'blocked') blockers.push('API inventory row blocked');
        if (!annotation.business_owner || !annotation.technical_owner) blockers.push('API inventory owners missing');
        if (!state.application) blockers.push('application/workload name missing');
        if (!state.integration_mode) blockers.push('integration mode missing');
        if (!state.app_owner) blockers.push('app owner missing');
        if (!state.gateway_owner) blockers.push('gateway owner missing');
        if (!state.target_date) blockers.push('target date missing');
        if (!state.rollback_owner || !state.rollback_path) blockers.push('rollback owner/path missing');
        if (Number(row.traffic && row.traffic.calls || 0) === 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('dry-run or traffic evidence missing');
        if (canary > 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('canary needs test evidence');
        if (openCriticalPolicy.length) blockers.push(openCriticalPolicy.length + ' critical/high policy drift rows');
        if (state.rollout_status === 'blocked') blockers.push('rollout manually blocked');
        return blockers;
      }
      function rolloutStatus(row) {
        var blockers = row.blockers || [];
        var state = row.rollout || {};
        var canary = rolloutPercent(state.canary_percent);
        if (state.rollout_status === 'rollback') return 'rollback';
        if (blockers.length) return 'hold';
        if (state.rollout_status === 'live' || state.test_status === 'live_verified') return 'live';
        if (state.test_status === 'canary_passed' || canary > 0) return 'canary';
        if (state.test_status === 'dry_run_passed' || state.test_status === 'denial_passed') return 'ready_for_canary';
        if (state.application || state.integration_mode || state.app_owner || state.gateway_owner) return 'planned';
        return 'draft';
      }
      function rolloutTone(status) {
        if (status === 'live' || status === 'ready_for_canary') return 'good';
        if (status === 'hold' || status === 'rollback') return 'bad';
        return 'warn';
      }
      function buildRolloutRows() {
        var rolloutState = readRolloutState();
        var inventoryRows = buildInventoryRows();
        var policyRows = buildPolicyRows();
        return inventoryRows.map(function(row) {
          var state = rolloutState[row.id] && typeof rolloutState[row.id] === 'object' ? rolloutState[row.id] : {};
          var relatedPolicyRows = policyRows.filter(function(policyRow) { return policyRow.api_surface_id === row.id; });
          var blockers = rolloutBlockers(row, state, relatedPolicyRows);
          return {
            id: row.id,
            project: row.project,
            provider: row.provider,
            policy: row.policy,
            traffic: row.traffic,
            inventory_annotation: row.annotation || {},
            policy_drift: relatedPolicyRows.map(function(policyRow) {
              return { id: policyRow.id, title: policyRow.title, severity: policyRow.severity, status: policyRowStatus(policyRow) };
            }),
            rollout: state,
            blockers: blockers
          };
        });
      }
      function rolloutInput(row, field, label, placeholder) {
        var state = row.rollout || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="' + escapeHtml(field) + '" value="' + escapeHtml(state[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function rolloutSelect(row, field, label, options) {
        var state = row.rollout || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(state[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderRolloutRow(row) {
        var state = row.rollout || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? provider.slug + ' / ' + provider.provider : 'no provider slot';
        var status = rolloutStatus(row);
        var blockers = row.blockers || [];
        return '<div class="inventory-row" data-rollout-card="' + escapeHtml(row.id) + '">' +
          '<div class="inventory-head"><div><div class="row-title">' + escapeHtml(state.application || row.inventory_annotation.business_service || row.project.name) + '</div>' +
          '<div class="row-sub">' + escapeHtml(row.project.name) + ' - ' + escapeHtml(providerLabel) + ' - canary ' + rolloutPercent(state.canary_percent) + '% - last seen ' + escapeHtml(rel(row.traffic && row.traffic.last_seen_at)) + '</div>' +
          '<div><span class="tag ' + rolloutTone(status) + '">' + escapeHtml(status) + '</span><span class="tag">' + escapeHtml(state.integration_mode || 'integration mode unset') + '</span><span class="tag">' + escapeHtml(state.test_status || 'test not started') + '</span><span class="tag ' + (blockers.length ? 'bad' : 'good') + '">' + blockers.length + ' blockers</span></div></div>' +
          '<div class="row-actions"><button type="button" data-action="copy-rollout-snippet" data-rollout-row-id="' + escapeHtml(row.id) + '">copy snippet</button><a class="tag" href="/app/control">control</a><a class="tag" href="/app/policy">policy</a><a class="tag" href="/app/activity">activity</a></div></div>' +
          '<div class="inventory-fields">' +
          rolloutInput(row, 'application', 'application/workload', row.inventory_annotation.business_service || 'Customer billing API') +
          rolloutSelect(row, 'environment', 'environment', [
            { value: '', label: 'unset' },
            { value: 'demo', label: 'sandbox' },
            { value: 'dev', label: 'dev' },
            { value: 'staging', label: 'staging' },
            { value: 'production', label: 'production' }
          ]) +
          rolloutSelect(row, 'integration_mode', 'integration mode', [
            { value: '', label: 'unset' },
            { value: 'vaultproof_proxy', label: 'VaultProof proxy' },
            { value: 'customer_gateway', label: 'customer gateway' },
            { value: 'sdk', label: 'SDK' },
            { value: 'sidecar', label: 'sidecar' },
            { value: 'manual_test', label: 'manual test' }
          ]) +
          rolloutSelect(row, 'rollout_status', 'rollout status', [
            { value: '', label: 'draft' },
            { value: 'planned', label: 'planned' },
            { value: 'in_progress', label: 'in progress' },
            { value: 'canary', label: 'canary' },
            { value: 'live', label: 'live' },
            { value: 'blocked', label: 'blocked' },
            { value: 'rollback', label: 'rollback' }
          ]) +
          rolloutInput(row, 'app_owner', 'app owner', row.inventory_annotation.technical_owner || 'Application owner') +
          rolloutInput(row, 'gateway_owner', 'gateway owner', 'Platform owner') +
          '<div class="inventory-field"><label>target date</label><input type="date" data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="target_date" value="' + escapeHtml(state.target_date || '') + '" /></div>' +
          rolloutInput(row, 'support_window', 'support window', 'Launch week / business hours') +
          '<div class="inventory-field"><label>canary percent</label><input type="number" min="0" max="100" step="1" data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="canary_percent" value="' + escapeHtml(state.canary_percent || '') + '" placeholder="0" /></div>' +
          rolloutSelect(row, 'test_status', 'test status', [
            { value: 'not_started', label: 'not started' },
            { value: 'dry_run_passed', label: 'dry-run passed' },
            { value: 'denial_passed', label: 'denial passed' },
            { value: 'canary_passed', label: 'canary passed' },
            { value: 'live_verified', label: 'live verified' },
            { value: 'failed', label: 'failed' }
          ]) +
          rolloutInput(row, 'rollback_owner', 'rollback owner', 'Ops owner') +
          '<div class="inventory-field wide"><label>rollback path</label><textarea data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="rollback_path" placeholder="How to return traffic to the previous direct provider path or pause the workload.">' + escapeHtml(state.rollback_path || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>blockers</label><div class="row-sub">' + escapeHtml(blockers.length ? blockers.join('; ') : 'No derived blockers. Review customer change window and support plan before live traffic.') + '</div></div>' +
          '<div class="inventory-field wide"><label>rollout note</label><textarea data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="note" placeholder="Metadata-only note. Do not paste tokens, request bodies, response bodies, keys, or customer payloads.">' + escapeHtml(state.note || '') + '</textarea></div>' +
          '</div></div>';
      }
      function saveRolloutField(target, rerender) {
        var rowId = target.getAttribute('data-rollout-row-id');
        var field = target.getAttribute('data-rollout-field');
        if (!rowId || !field) return;
        var state = readRolloutState();
        var current = state[rowId] && typeof state[rowId] === 'object' ? state[rowId] : {};
        current[field] = target.value || '';
        current.updated_at = new Date().toISOString();
        state[rowId] = current;
        writeRolloutState(state);
        cachedRolloutRows = buildRolloutRows();
        if (rerender || ['rollout_status', 'test_status', 'canary_percent', 'target_date'].indexOf(field) !== -1) {
          renderRollout();
        } else {
          renderRolloutSummary();
        }
      }
      function rolloutFilterState() {
        return {
          search: ((byId('rolloutSearch') && byId('rolloutSearch').value) || '').trim().toLowerCase(),
          status: (byId('rolloutStatusFilter') && byId('rolloutStatusFilter').value) || '',
          mode: (byId('rolloutModeFilter') && byId('rolloutModeFilter').value) || '',
          test: (byId('rolloutTestFilter') && byId('rolloutTestFilter').value) || '',
          blockers: (byId('rolloutBlockerFilter') && byId('rolloutBlockerFilter').value) || ''
        };
      }
      function rolloutRowSearchText(row) {
        var state = row.rollout || {};
        var project = row.project || {};
        var provider = row.provider || {};
        var annotation = row.inventory_annotation || {};
        return [
          row.id,
          rolloutStatus(row),
          project.name,
          project.vp_proj_id,
          provider.provider,
          provider.slug,
          annotation.business_service,
          annotation.business_owner,
          annotation.technical_owner,
          state.application,
          state.environment,
          state.integration_mode,
          state.rollout_status,
          state.app_owner,
          state.gateway_owner,
          state.support_window,
          state.test_status,
          state.rollback_owner,
          state.rollback_path,
          state.note,
          (row.blockers || []).join(' '),
          (row.policy_drift || []).map(function(item) { return [item.title, item.severity, item.status].join(' '); }).join(' ')
        ].filter(Boolean).join(' ').toLowerCase();
      }
      function rolloutRowMatchesFilters(row, filters) {
        var state = row.rollout || {};
        var mode = state.integration_mode || 'unset';
        var testStatus = state.test_status || 'not_started';
        var blockers = row.blockers || [];
        if (filters.search && rolloutRowSearchText(row).indexOf(filters.search) === -1) return false;
        if (filters.status && rolloutStatus(row) !== filters.status) return false;
        if (filters.mode && mode !== filters.mode) return false;
        if (filters.test && testStatus !== filters.test) return false;
        if (filters.blockers === 'has_blockers' && !blockers.length) return false;
        if (filters.blockers === 'no_blockers' && blockers.length) return false;
        if (filters.blockers === 'owner_gaps' && !blockers.some(function(blocker) { return /owner/i.test(blocker); })) return false;
        if (filters.blockers === 'rollback_gaps' && !blockers.some(function(blocker) { return /rollback/i.test(blocker); })) return false;
        if (filters.blockers === 'test_gaps' && !blockers.some(function(blocker) { return /dry-run|traffic|test evidence|canary/i.test(blocker); })) return false;
        return true;
      }
      function rolloutFiltersActive(filters) {
        return Boolean(filters && (filters.search || filters.status || filters.mode || filters.test || filters.blockers));
      }
      function filteredRolloutRows(filters) {
        var currentFilters = filters || rolloutFilterState();
        return cachedRolloutRows.filter(function(row) {
          return rolloutRowMatchesFilters(row, currentFilters);
        });
      }
      function renderRolloutList() {
        var filters = rolloutFilterState();
        var visibleRows = filteredRolloutRows(filters);
        var filtered = visibleRows.length !== cachedRolloutRows.length || rolloutFiltersActive(filters);
        text('rolloutMeta', (filtered ? number(visibleRows.length) + ' of ' : '') + number(cachedRolloutRows.length) + ' candidate workloads');
        if (!cachedRolloutRows.length) {
          byId('rolloutList').innerHTML = '<div class="empty">No API inventory rows are visible yet. Create one project and provider slot before building the customer rollout plan.</div>';
          return;
        }
        byId('rolloutList').innerHTML = visibleRows.length ? visibleRows.map(renderRolloutRow).join('') : '<div class="empty">No rollout rows match these filters. Clear filters or review API Inventory, Policy Drift, and Provider Slots.</div>';
      }
      function rolloutSummaryForRows(rows) {
        var rolloutRows = Array.isArray(rows) ? rows : [];
        return {
          total: rolloutRows.length,
          live: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'live'; }).length,
          canary: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'canary'; }).length,
          ready_for_canary: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'ready_for_canary'; }).length,
          planned: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'planned'; }).length,
          hold: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'hold'; }).length,
          rollback: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'rollback'; }).length,
          draft: rolloutRows.filter(function(row) { return rolloutStatus(row) === 'draft'; }).length,
          owner_gaps: rolloutRows.filter(function(row) { return (row.blockers || []).some(function(blocker) { return /owner/i.test(blocker); }); }).length,
          rollback_gaps: rolloutRows.filter(function(row) { return (row.blockers || []).some(function(blocker) { return /rollback/i.test(blocker); }); }).length,
          test_gaps: rolloutRows.filter(function(row) { return (row.blockers || []).some(function(blocker) { return /dry-run|traffic|test evidence|canary/i.test(blocker); }); }).length,
          blocker_count: rolloutRows.reduce(function(total, row) { return total + (row.blockers || []).length; }, 0)
        };
      }
      function rolloutSummary() {
        return rolloutSummaryForRows(cachedRolloutRows);
      }
      function rolloutEvidencePacket() {
        var summary = rolloutSummary();
        return {
          packet_type: 'vaultproof_enterprise_integration_rollout',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/rollout',
          organization_id: currentOrgId || null,
          status: summary.hold ? 'hold' : summary.live || summary.ready_for_canary || summary.canary ? 'ready' : 'draft',
          summary: summary,
          rows: cachedRolloutRows.map(function(row) {
            var state = row.rollout || {};
            return {
              id: row.id,
              status: rolloutStatus(row),
              project: row.project,
              provider: row.provider,
              traffic: row.traffic,
              blockers: row.blockers,
              policy_drift: row.policy_drift,
              rollout: {
                application: state.application || null,
                environment: state.environment || null,
                integration_mode: state.integration_mode || null,
                rollout_status: state.rollout_status || null,
                app_owner: state.app_owner || null,
                gateway_owner: state.gateway_owner || null,
                target_date: state.target_date || null,
                support_window: state.support_window || null,
                canary_percent: rolloutPercent(state.canary_percent),
                test_status: state.test_status || 'not_started',
                rollback_owner: state.rollback_owner || null,
                rollback_path: redactRolloutText(state.rollback_path),
                note: redactRolloutText(state.note),
                updated_at: state.updated_at || null
              },
              snippet_preview: row.provider ? 'Copy-safe dry-run snippet available from /app/rollout. Uses YOUR_VAULTPROOF_SESSION_JWT placeholder only.' : 'Provider slot required before snippet is available.'
            };
          }),
          workflow_links: {
            rollout_manager: '/app/rollout',
            api_inventory: '/app/inventory',
            policy_drift: '/app/policy',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            security_review: '/app/security-review',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function rolloutBriefRowLabel(row) {
        var state = row.rollout || {};
        var project = row.project || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? (provider.slug || provider.provider || 'provider') : 'no provider slot';
        return (state.application || (row.inventory_annotation || {}).business_service || project.name || project.vp_proj_id || 'Unnamed workload') + ' / ' + providerLabel;
      }
      function rolloutBriefActions(row) {
        var state = row.rollout || {};
        var blockers = row.blockers || [];
        var actions = [];
        if (!state.application) actions.push('name the application/workload');
        if (!state.integration_mode) actions.push('choose integration mode');
        if (!state.app_owner || !state.gateway_owner) actions.push('assign app and gateway owners');
        if (!state.target_date) actions.push('set target date');
        if (!state.rollback_owner || !state.rollback_path) actions.push('confirm rollback owner/path');
        if (blockers.length) actions.push('close blockers: ' + blockers.slice(0, 4).join('; '));
        if (rolloutStatus(row) === 'ready_for_canary') actions.push('schedule canary and support window');
        if (rolloutStatus(row) === 'canary') actions.push('review canary evidence before live traffic');
        if (rolloutStatus(row) === 'live') actions.push('keep monitoring and release evidence current');
        return actions.length ? actions : ['ready for customer cutover review'];
      }
      function rolloutBriefPriority(row) {
        var status = rolloutStatus(row);
        var score = (row.blockers || []).length * 10;
        if (status === 'hold') score += 80;
        if (status === 'rollback') score += 70;
        if (status === 'draft') score += 35;
        if (status === 'planned') score += 20;
        if (status === 'ready_for_canary') score += 12;
        if ((row.policy_drift || []).some(function(item) { return item.severity === 'critical' || item.severity === 'high'; })) score += 20;
        return score;
      }
      function rolloutBrief() {
        var filters = rolloutFilterState();
        var rows = filteredRolloutRows(filters);
        var summary = rolloutSummaryForRows(rows);
        var scope = rolloutFiltersActive(filters) ? 'filtered rollout rows' : 'all rollout rows';
        var priorityRows = rows.slice().sort(function(left, right) {
          return rolloutBriefPriority(right) - rolloutBriefPriority(left);
        }).filter(function(row) {
          return rolloutBriefPriority(row) > 0;
        }).slice(0, 12);
        var lines = [
          'VaultProof integration rollout brief',
          'Generated: ' + new Date().toISOString(),
          'Organization: ' + (currentOrgId || 'not selected'),
          'Scope: ' + scope + ' (' + number(rows.length) + ' row(s))',
          '',
          'Summary:',
          '- Candidate workloads: ' + number(summary.total),
          '- Live: ' + number(summary.live),
          '- Canary: ' + number(summary.canary),
          '- Ready for canary: ' + number(summary.ready_for_canary),
          '- Planned: ' + number(summary.planned),
          '- Draft: ' + number(summary.draft),
          '- Hold: ' + number(summary.hold),
          '- Rollback: ' + number(summary.rollback),
          '- Total blockers: ' + number(summary.blocker_count),
          '- Owner gaps: ' + number(summary.owner_gaps),
          '- Rollback gaps: ' + number(summary.rollback_gaps),
          '- Test evidence gaps: ' + number(summary.test_gaps),
          '',
          'Priority actions:'
        ];
        if (priorityRows.length) {
          priorityRows.forEach(function(row) {
            lines.push('- ' + rolloutBriefRowLabel(row) + ' [' + rolloutStatus(row) + ']: ' + rolloutBriefActions(row).join('; '));
          });
        } else {
          lines.push('- No priority rollout blockers in the current scope.');
        }
        lines.push(
          '',
          'Secret boundary:',
          '- This brief is metadata-only. It excludes raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.'
        );
        return lines.join('\\n');
      }
      function renderRolloutSummary() {
        if (PAGE_MODE !== 'rollout') return;
        var summary = rolloutSummary();
        byId('rolloutSummaryList').innerHTML = [
          '<div class="row"><div><div class="row-title">Rollout status</div><div class="row-sub">' + number(summary.total) + ' candidate workloads, ' + number(summary.ready_for_canary) + ' ready for canary, ' + number(summary.canary) + ' in canary, ' + number(summary.live) + ' live, ' + number(summary.hold) + ' on hold.</div></div><span class="tag ' + (summary.hold ? 'bad' : 'good') + '">' + (summary.hold ? 'hold' : 'ready') + '</span></div>',
          '<div class="row"><div><div class="row-title">Blockers</div><div class="row-sub">' + number(summary.blocker_count) + ' derived blockers across rollout rows. Close policy drift, owners, rollback, target date, and dry-run evidence before production traffic.</div></div><span class="tag warn">review</span></div>',
          '<div class="row"><div><div class="row-title">Secret boundary</div><div class="row-sub">Rollout records and snippets use placeholders and exclude raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.</div></div><span class="tag good">redacted</span></div>'
        ].join('');
        byId('rolloutWorkflowList').innerHTML = [
          '<div class="row"><div><div class="row-title">Choose first workload</div><div class="row-sub">Pick one API inventory row, set app/gateway owners, select the integration mode, and define the target date.</div></div><a class="tag good" href="/app/inventory">inventory</a></div>',
          '<div class="row"><div><div class="row-title">Close rollout blockers</div><div class="row-sub">Resolve policy drift, provider material, caller lock, dry-run evidence, and rollback gaps before canary.</div></div><span><a class="tag" href="/app/policy">policy</a><a class="tag" href="/app/control">control</a></span></div>',
          '<div class="row"><div><div class="row-title">Run copy-safe test</div><div class="row-sub">Use the snippet button for a dry-run request with VaultProof auth placeholders, gateway marker, and no raw provider key.</div></div><a class="tag" href="/app/keys">provider slots</a></div>',
          '<div class="row"><div><div class="row-title">Launch evidence</div><div class="row-sub">Export vaultproof_enterprise_integration_rollout or copy the rollout brief into Evidence and Security Review before live traffic.</div></div><span><button class="tag good" type="button" data-action="copy-rollout-brief">brief</button><a class="tag" href="/app/evidence">evidence</a><a class="tag" href="/app/security-review">security review</a></span></div>'
        ].join('');
      }
      function renderRollout() {
        var panel = byId('rolloutPanel');
        if (panel) panel.style.display = PAGE_MODE === 'rollout' ? 'grid' : 'none';
        if (PAGE_MODE !== 'rollout') return;
        cachedRolloutRows = buildRolloutRows();
        renderRolloutList();
        renderRolloutSummary();
      }
      function copyRolloutJson() {
        cachedRolloutRows = buildRolloutRows();
        copyToClipboard(JSON.stringify(rolloutEvidencePacket(), null, 2), 'Integration rollout JSON');
      }
      function copyRolloutBrief() {
        cachedRolloutRows = buildRolloutRows();
        copyToClipboard(rolloutBrief(), 'Integration rollout brief');
      }
      function copyRolloutSnippet(target) {
        var rowId = target.getAttribute('data-rollout-row-id');
        var row = cachedRolloutRows.find(function(item) { return item.id === rowId; });
        if (!row) {
          notice('Rollout row is not visible. Refresh and try again.');
          return;
        }
        copyToClipboard(rolloutSnippet(row), 'Integration rollout dry-run snippet');
      }
      function renderProjects() {
        byId('projectsPanel').style.display = PAGE_MODE === 'projects' ? 'grid' : 'none';
        if (PAGE_MODE !== 'projects') return;
        text('projectMeta', cachedProjects.length + ' active projects');
        var projectList = byId('projectList');
        projectList.innerHTML = cachedProjects.length ? cachedProjects.map(function(project) {
          var policy = project.caller_lock_policy || {};
          var providers = (project.provider_slots || []).map(function(slot) { return slot.slug || slot.provider; });
          var liveSlots = (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'sealed-live'; }).length;
          var demoSlots = (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'demo-placeholder'; }).length;
          return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id) + '</div><div class="row-sub">' + escapeHtml(project.vp_proj_id) + ' - ' + escapeHtml(project.project_role) + ' via ' + escapeHtml(project.access_via) + ' - created ' + escapeHtml(rel(project.created_at)) + '</div><div><span class="tag ' + (project.strict_origin ? 'good' : 'warn') + '">' + (project.strict_origin ? 'strict origin' : 'origin relaxed') + '</span><span class="tag">' + providers.length + ' provider slots</span><span class="tag ' + (liveSlots ? 'good' : 'warn') + '">' + liveSlots + ' live sealed</span><span class="tag ' + (demoSlots ? 'warn' : '') + '">' + demoSlots + ' placeholder</span><span class="tag">' + (policy.rate_limit_per_minute ? policy.rate_limit_per_minute + '/min' : 'no project rate cap') + '</span></div></div><a class="tag" href="/app/control">control</a></div>';
        }).join('') : '<div class="empty">No active enterprise projects yet.</div>';
        var health = Array.isArray(cachedOverview.projectHealth) ? cachedOverview.projectHealth : [];
        text('healthMeta', (cachedOverview.healthWindowDays || 7) + 'd window');
        byId('healthList').innerHTML = health.length ? health.map(function(project) {
          var cls = project.denied || project.errors ? 'bad' : project.calls ? 'good' : 'warn';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id) + '</div><div class="row-sub">calls ' + number(project.calls) + ' - errors ' + number(project.errors) + ' - denied ' + number(project.denied) + ' - last ' + escapeHtml(rel(project.lastActivity)) + '</div></div><span class="tag ' + cls + '">' + (project.calls ? 'traffic' : 'idle') + '</span></div>';
        }).join('') : '<div class="empty">No project health data yet.</div>';
      }
      async function renderActivity() {
        byId('activityPanel').style.display = PAGE_MODE === 'activity' ? 'block' : 'none';
        if (PAGE_MODE !== 'activity') return;
        var params = new URLSearchParams({ source: 'proxy', limit: '100', days: '30' });
        if (byId('activityProjectFilter').value) params.set('project_id', byId('activityProjectFilter').value);
        if (byId('activityStatusFilter').value) params.set('event_type', byId('activityStatusFilter').value);
        if (byId('activitySearch').value.trim()) params.set('q', byId('activitySearch').value.trim());
        var payload = await fetchJson('/api/v1/enterprise/audit?' + params.toString());
        var events = Array.isArray(payload.events) ? payload.events : [];
        text('activityMeta', events.length + ' proxy events');
        byId('activityList').innerHTML = events.length ? events.map(function(event) {
          var meta = event.metadata || {};
          var project = event.project || {};
          return '<div class="row"><div><div class="row-title">' + escapeHtml(event.description || event.event_type) + '</div><div class="row-sub">' + escapeHtml(rel(event.timestamp)) + ' - ' + escapeHtml(project.name || project.vp_proj_id || 'unknown project') + ' - ' + escapeHtml(meta.provider || meta.slug || 'unknown provider') + ' - ' + escapeHtml(meta.latency_ms == null ? 'latency n/a' : meta.latency_ms + 'ms') + (meta.provider_request_id ? ' - request ' + escapeHtml(meta.provider_request_id) : '') + '</div></div>' + statusTag(event.status) + '</div>';
        }).join('') : '<div class="empty">No runtime activity matches these filters.</div>';
      }
      function renderApiProxyTestKit(rows) {
        var panel = byId('apiProxyTestPanel');
        if (panel) panel.style.display = PAGE_MODE === 'keys' ? 'block' : 'none';
        var list = byId('apiProxyTestList');
        if (!list || PAGE_MODE !== 'keys') return;
        text('apiProxyTestMeta', rows.length ? rows.length + ' slot self-tests' : 'copy-safe');
        list.innerHTML = rows.length ? rows.slice(0, 8).map(function(item) {
          var slug = item.slot.slug || item.slot.provider;
          var materialMode = item.slot.material_mode || 'missing';
          var materialClass = materialMode === 'sealed-live' ? 'good' : materialMode === 'demo-placeholder' ? 'warn' : 'bad';
          var materialLabel = displayMaterialMode(materialMode);
          var denyButton = slotIsEmailProvider(item.slot) ? '<button type="button" data-action="copy-proxy-deny-test" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(slug) + '">copy blocked-recipient request</button>' : '';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(slug) + ' API proxy self-test</div><div class="row-sub">POST /api/v1/enterprise/projects/' + escapeHtml(item.project.id) + '/providers/' + escapeHtml(slug) + '/execute - dry-run request with VaultProof auth, gateway marker, client class, and organization header. No raw provider key is copied into the customer app.</div><div><span class="tag ' + materialClass + '">' + escapeHtml(materialLabel) + '</span><span class="tag good">YOUR_VAULTPROOF_SESSION_JWT</span><span class="tag">x-vaultproof-customer-gateway</span><span class="tag">audit evidence</span></div></div><div class="row-actions"><button type="button" class="primary" data-action="copy-proxy-dry-run" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(slug) + '">copy dry-run request</button>' + denyButton + '</div></div>';
        }).join('') : '<div class="empty">No provider slots are visible yet. Add a provider slot before sharing the customer API proxy self-test kit.</div>';
      }
      function renderKeys() {
        byId('keysPanel').style.display = PAGE_MODE === 'keys' ? 'block' : 'none';
        if (byId('emailKeyDemoPanel')) byId('emailKeyDemoPanel').style.display = PAGE_MODE === 'keys' ? 'grid' : 'none';
        if (PAGE_MODE !== 'keys') return;
        var rows = [];
        cachedProjects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) {
            rows.push({ project: project, slot: slot });
          });
        });
        renderApiProxyTestKit(rows);
        text('keyMeta', rows.length + ' active provider slots');
        var emailRows = rows.filter(function(item) { return slotIsEmailProvider(item.slot); });
        if (byId('emailKeyDemoList')) {
          byId('emailKeyDemoList').innerHTML = emailRows.length ? emailRows.map(function(item) {
            var materialMode = item.slot.material_mode || 'missing';
            var materialClass = materialMode === 'sealed-live' ? 'good' : materialMode === 'demo-placeholder' ? 'warn' : 'bad';
            var materialLabel = displayMaterialMode(materialMode);
            var action = '<button type="button" class="primary" data-action="email-dry-run" data-project-id="' + escapeHtml(item.project.id) + '" data-provider="' + escapeHtml(item.slot.provider) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">protected email dry-run</button><button type="button" data-action="email-deny-test" data-project-id="' + escapeHtml(item.project.id) + '" data-provider="' + escapeHtml(item.slot.provider) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">blocked recipient test</button>';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(emailProviderLabel(item.slot.provider)) + ' protected send</div><div class="row-sub">' + escapeHtml(item.project.name || item.project.vp_proj_id) + ' - path ' + escapeHtml(emailDemoPath(item.slot)) + ' - material ' + escapeHtml(materialLabel) + '</div><div><span class="tag ' + materialClass + '">' + escapeHtml(materialLabel) + '</span><span class="tag good">no raw key in browser</span><span class="tag">audit evidence</span><span class="tag warn">recipient allowlist</span></div></div>' + action + '</div>';
          }).join('') : '<div class="row"><div><div class="row-title">No email provider key protected yet</div><div class="row-sub">Create a Resend, SendGrid, Mailgun, Postmark, or AWS SES provider slot, then run protected email dry-run before the customer walkthrough.</div><div><span class="tag warn">required for pilot</span><span class="tag">raw keys stay out</span></div></div><button type="button" class="primary" data-action="prefill-email-slot">create resend slot</button></div>';
        }
        byId('keyList').innerHTML = rows.length ? rows.map(function(item) {
          var policy = item.project.caller_lock_policy || {};
          var override = policy.provider_overrides && policy.provider_overrides[item.slot.slug || item.slot.provider];
          var canAdmin = item.project.project_role === 'owner' || item.project.project_role === 'admin';
          var emailAction = slotIsEmailProvider(item.slot) ? '<button type="button" data-action="email-dry-run" data-project-id="' + escapeHtml(item.project.id) + '" data-provider="' + escapeHtml(item.slot.provider) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">protected email dry-run</button>' : '';
          var revokeAction = canAdmin ? '<button type="button" class="danger" data-action="revoke-slot" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">emergency revoke</button>' : '<span class="tag warn">read-only</span>';
          var action = emailAction + revokeAction;
          var materialMode = item.slot.material_mode || 'missing';
          var materialClass = materialMode === 'sealed-live' ? 'good' : materialMode === 'demo-placeholder' ? 'warn' : 'bad';
          var materialLabel = displayMaterialMode(materialMode);
          var secretKind = slotIsEmailProvider(item.slot) ? 'email API key' : 'provider API key';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(item.slot.slug || item.slot.provider) + '</div><div class="row-sub">' + escapeHtml(item.project.name || item.project.vp_proj_id) + ' - provider ' + escapeHtml(item.slot.provider) + ' - key id ' + escapeHtml(item.slot.key_id) + '</div><div><span class="tag good">active</span><span class="tag">' + escapeHtml(secretKind) + '</span><span class="tag ' + materialClass + '">' + materialLabel + '</span><span class="tag">' + (override ? 'provider override' : 'project policy') + '</span><span class="tag">rotation: manual checklist</span><span class="tag">SKR: executor-bound</span></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' + action + '</div></div>';
        }).join('') : '<div class="empty">No active provider slots found.</div>';
      }
      function syncProviderDefaults(force) {
        var providerInput = byId('slotProvider');
        if (!providerInput) return;
        var provider = String(providerInput.value || '').trim().toLowerCase();
        var defaults = providerDefaults[provider];
        if (!defaults) return;
        var slug = byId('slotSlug');
        var upstream = byId('slotUpstream');
        var header = byId('slotHeaderName');
        var template = byId('slotHeaderTemplate');
        var extraHeaders = byId('slotExtraHeaders');
        if (slug && (force || !slug.value || providerDefaults[slug.value])) slug.value = provider;
        if (upstream && (force || !upstream.value)) upstream.value = defaults.upstream || '';
        if (header && (force || !header.value)) header.value = defaults.header;
        if (template && (force || !template.value)) template.value = defaults.template;
        if (extraHeaders && (force || !extraHeaders.value)) {
          extraHeaders.value = defaults.extraHeaders ? JSON.stringify(defaults.extraHeaders, null, 2) : '';
        }
      }
      function setProviderSlotFormVisible(visible) {
        var panel = byId('providerSlotFormPanel');
        if (!panel) return;
        panel.style.display = visible ? 'block' : 'none';
        if (visible) {
          renderProjectOptions();
          syncProviderDefaults(false);
          var provider = byId('slotProvider');
          if (provider) provider.focus();
        }
      }
      async function submitProviderSlotForm(event) {
        event.preventDefault();
        var projectId = byId('slotProject') && byId('slotProject').value;
        if (!projectId) {
          notice('Choose a project first.');
          return;
        }
        var payload = {
          provider: byId('slotProvider').value,
          slug: byId('slotSlug').value,
          upstream_base_url: byId('slotUpstream').value,
          auth_header_name: byId('slotHeaderName').value,
          auth_header_template: byId('slotHeaderTemplate').value
        };
        var extraHeadersText = byId('slotExtraHeaders') && byId('slotExtraHeaders').value.trim();
        if (extraHeadersText) {
          try {
            payload.extra_headers = JSON.parse(extraHeadersText);
          } catch (error) {
            notice('Extra headers must be valid JSON.');
            return;
          }
        }
        try {
          await fetchJson('/api/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/providers', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          setProviderSlotFormVisible(false);
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Provider slot could not be created.');
        }
      }
      function emailExecuteRequest(target, options) {
        var projectId = target.getAttribute('data-project-id');
        var slug = target.getAttribute('data-slug');
        var provider = target.getAttribute('data-provider') || slug;
        var payload = demoEmailPayload({ provider: provider, slug: slug }, options || {});
        return {
          path: '/api/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/providers/' + encodeURIComponent(slug) + '/execute',
          body: {
            method: 'POST',
            upstream_path: emailDemoPath({ provider: provider, slug: slug }),
            headers: { 'content-type': 'application/json' },
            body_base64: toBase64Utf8(JSON.stringify(payload)),
            dry_run: true
          }
        };
      }
      async function runProtectedEmailDryRun(target) {
        var request = emailExecuteRequest(target);
        try {
          var result = await fetchJson(request.path, {
            method: 'POST',
            headers: {
              'x-vaultproof-customer-gateway': 'vaultproof-managed',
              'x-vaultproof-client-class': 'browser'
            },
            body: JSON.stringify(request.body)
          });
          notice('Protected email dry-run validated: ' + (result.execution && result.execution.requestId ? result.execution.requestId : 'accepted') + '. Raw email provider key was not exposed.');
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Protected email dry-run failed.');
        }
      }
      async function runProtectedEmailDenialTest(target) {
        var request = emailExecuteRequest(target, { blocked: true });
        try {
          var res = await fetch(request.path, {
            method: 'POST',
            headers: Object.assign(headers(), {
              'x-vaultproof-customer-gateway': 'vaultproof-managed',
              'x-vaultproof-client-class': 'browser'
            }),
            body: JSON.stringify(request.body)
          });
          var payload = await res.json().catch(function() { return null; });
          if (res.status === 403) {
            notice('Policy denial evidence recorded: ' + friendlyErrorMessage((payload && payload.error) || 'blocked recipient rejected') + '.');
          } else if (res.ok) {
            notice('Blocked recipient test was accepted. Add an email recipient-domain or recipient allowlist before using this as denial evidence.');
          } else {
            notice(friendlyErrorMessage((payload && payload.error) || ('Blocked recipient test failed: ' + res.status)));
          }
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Blocked recipient test failed.');
        }
      }
      function prefillEmailSlot() {
        setProviderSlotFormVisible(true);
        if (byId('slotProvider')) byId('slotProvider').value = 'resend';
        syncProviderDefaults(true);
      }
      function findProviderItem(projectId, slug) {
        var found = null;
        cachedProjects.forEach(function(project) {
          if (found || project.id !== projectId) return;
          (project.provider_slots || []).forEach(function(slot) {
            var slotSlug = slot.slug || slot.provider;
            if (!found && slotSlug === slug) found = { project: project, slot: slot };
          });
        });
        return found;
      }
      function copyProxySelfTest(target, options) {
        var item = findProviderItem(target.getAttribute('data-project-id'), target.getAttribute('data-slug'));
        if (!item) {
          notice('Provider slot is not visible. Refresh the page and try again.');
          return;
        }
        copyToClipboard(proxySelfTestSnippet(item.project, item.slot, options || {}), options && options.blocked ? 'Blocked-recipient self-test request' : 'Dry-run self-test request');
      }
      function exposureIncidentState() {
        return {
          label: redactManualApiKeyText(byId('exposureIncidentName') && byId('exposureIncidentName').value) || 'External platform credential review',
          source: redactManualApiKeyText(byId('exposureIncidentSource') && byId('exposureIncidentSource').value) || 'credential exposure',
          mode: redactManualApiKeyText(byId('exposureIncidentMode') && byId('exposureIncidentMode').value) || 'triage',
          owner: redactManualApiKeyText(byId('exposureIncidentOwner') && byId('exposureIncidentOwner').value),
          note: redactInventoryNote(byId('exposureIncidentNote') && byId('exposureIncidentNote').value)
        };
      }
      function scannerStorageKey() {
        return 'vaultproof_scanner_findings::' + (currentOrgId || 'default');
      }
      function scannerSecretPattern(value) {
        return /(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:|x-api-key|secret_access_key)/i.test(String(value || ''));
      }
      function redactScannerText(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return '';
        if (scannerSecretPattern(textValue)) return '[redacted: scanner field contained secret-like material]';
        return textValue.slice(0, 500);
      }
      function readExposureScannerFindings() {
        try {
          var parsed = JSON.parse(localStorage.getItem(scannerStorageKey()) || '[]');
          var rows = Array.isArray(parsed) ? parsed : Object.keys(parsed || {}).map(function(key) { return parsed[key]; });
          return rows.filter(function(row) { return row && typeof row === 'object'; }).map(function(row) {
            return {
              id: row.id || ('scanner-' + Math.random().toString(36).slice(2)),
              repository: redactScannerText(row.repository),
              branch: redactScannerText(row.branch),
              finding_type: redactScannerText(row.finding_type || 'hardcoded_secret'),
              secret_family: redactScannerText(row.secret_family),
              severity: ['critical', 'high', 'medium', 'low'].indexOf(row.severity) !== -1 ? row.severity : 'high',
              status: ['new', 'confirmed', 'rotating', 'rotated', 'accepted_demo', 'false_positive', 'blocked'].indexOf(row.status) !== -1 ? row.status : 'new',
              owner: redactScannerText(row.owner),
              provider_slot: redactScannerText(row.provider_slot),
              evidence_ref: redactScannerText(row.evidence_ref),
              note: redactScannerText(row.note),
              created_at: row.created_at || null,
              updated_at: row.updated_at || null
            };
          }).slice(0, 50);
        } catch (_error) {
          return [];
        }
      }
      function scannerFindingOpen(finding) {
        return ['new', 'confirmed', 'rotating', 'blocked'].indexOf(finding.status) !== -1;
      }
      function scannerFindingMatchesSlot(finding, slot) {
        if (!finding || !slot) return false;
        var haystack = [
          finding.provider_slot,
          finding.secret_family,
          finding.note,
          finding.evidence_ref
        ].filter(Boolean).join(' ').toLowerCase();
        var provider = String(slot.provider || '').toLowerCase();
        var slug = String(slot.slug || slot.provider || '').toLowerCase();
        return Boolean(haystack && ((provider && haystack.indexOf(provider) !== -1) || (slug && haystack.indexOf(slug) !== -1)));
      }
      function exposureScannerSummary(findings) {
        var rows = Array.isArray(findings) ? findings : readExposureScannerFindings();
        var open = rows.filter(scannerFindingOpen);
        return {
          total_findings: rows.length,
          open_findings: open.length,
          open_critical_or_high: open.filter(function(row) { return row.severity === 'critical' || row.severity === 'high'; }).length,
          rotating: rows.filter(function(row) { return row.status === 'rotating'; }).length,
          rotated: rows.filter(function(row) { return row.status === 'rotated'; }).length,
          accepted_for_pilot: rows.filter(function(row) { return row.status === 'accepted_demo'; }).length
        };
      }
      function exposureResponseRows() {
        var health = projectHealthMap();
        var scannerFindings = readExposureScannerFindings();
        var rows = [];
        cachedProjects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) {
            var slug = slot.slug || slot.provider;
            var projectHealth = health[project.id] || {};
            var materialMode = slot.material_mode || 'missing';
            var row = {
              id: project.id + '::' + slug,
              project: {
                id: project.id,
                name: project.name || project.vp_proj_id,
                vp_proj_id: project.vp_proj_id,
                role: project.project_role,
                strict_origin: project.strict_origin === true
              },
              provider: {
                key_id: slot.key_id || null,
                provider: slot.provider || null,
                slug: slug,
                material_mode: materialMode,
                material_ready: slot.material_ready === true
              },
              can_emergency_revoke: project.project_role === 'owner' || project.project_role === 'admin',
              traffic: {
                calls: Number(projectHealth.calls || 0),
                errors: Number(projectHealth.errors || 0),
                denied: Number(projectHealth.denied || 0),
                last_seen_at: projectHealth.lastActivity || null
              },
              scanner_findings: scannerFindings.filter(function(finding) { return scannerFindingMatchesSlot(finding, slot); })
            };
            row.risk = exposureResponseRisk(row);
            row.actions = exposureResponseActions(row);
            rows.push(row);
          });
        });
        return rows;
      }
      function exposureResponseRisk(row) {
        var openScannerFindings = (row.scanner_findings || []).filter(scannerFindingOpen);
        if (openScannerFindings.some(function(finding) { return finding.severity === 'critical' || finding.severity === 'high'; })) return 'scanner_open_exposure';
        if (!row.provider.material_ready || row.provider.material_mode !== 'sealed-live') return 'needs_rotation';
        if (Number(row.traffic.denied || 0) > 0 || Number(row.traffic.errors || 0) > 0) return 'review_activity';
        if (!Number(row.traffic.calls || 0)) return 'needs_usage_evidence';
        return 'ready_to_contain';
      }
      function exposureRiskTone(risk) {
        if (risk === 'scanner_open_exposure' || risk === 'needs_rotation') return 'bad';
        if (risk === 'review_activity' || risk === 'needs_usage_evidence') return 'warn';
        return 'good';
      }
      function exposureResponseActions(row) {
        var actions = [];
        var openScannerFindings = (row.scanner_findings || []).filter(scannerFindingOpen);
        if (openScannerFindings.length) actions.push('close ' + openScannerFindings.length + ' linked scanner finding' + (openScannerFindings.length === 1 ? '' : 's'));
        if (row.can_emergency_revoke) actions.push('emergency revoke available from Provider Slots');
        else actions.push('assign an owner/admin to revoke this slot');
        if (!row.provider.material_ready || row.provider.material_mode !== 'sealed-live') actions.push('rotate upstream credential and seal a live provider slot');
        else actions.push('disable VaultProof slot first, then rotate upstream if exposed');
        if (!Number(row.traffic.calls || 0)) actions.push('run a dry-run request after rotation to create usage evidence');
        if (Number(row.traffic.denied || 0) > 0 || Number(row.traffic.errors || 0) > 0) actions.push('review denied/error activity in Audit');
        if (!row.project.strict_origin) actions.push('tighten origin/caller policy before restoring traffic');
        return actions;
      }
      function exposureResponseSummary(rows) {
        var list = Array.isArray(rows) ? rows : exposureResponseRows();
        var scanner = exposureScannerSummary();
        return {
          total_provider_slots: list.length,
          sealed_live: list.filter(function(row) { return row.provider.material_mode === 'sealed-live'; }).length,
          placeholder_or_unready: list.filter(function(row) { return row.provider.material_mode !== 'sealed-live' || !row.provider.material_ready; }).length,
          emergency_revoke_available: list.filter(function(row) { return row.can_emergency_revoke; }).length,
          linked_scanner_findings: list.reduce(function(total, row) { return total + (row.scanner_findings || []).length; }, 0),
          open_scanner_findings: scanner.open_findings,
          open_critical_or_high_scanner_findings: scanner.open_critical_or_high,
          scanner_findings_recorded: scanner.total_findings,
          needs_rotation: list.filter(function(row) { return row.risk === 'needs_rotation'; }).length,
          scanner_open_exposure: list.filter(function(row) { return row.risk === 'scanner_open_exposure'; }).length,
          needs_activity_review: list.filter(function(row) { return row.risk === 'review_activity'; }).length,
          needs_usage_evidence: list.filter(function(row) { return row.risk === 'needs_usage_evidence'; }).length
        };
      }
      function exposureResponsePacket() {
        var rows = exposureResponseRows();
        var scannerFindings = readExposureScannerFindings();
        return {
          packet_type: 'vaultproof_enterprise_key_exposure_response',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/keys',
          organization_id: currentOrgId || null,
          incident: exposureIncidentState(),
          summary: exposureResponseSummary(rows),
          provider_slots: rows.map(function(row) {
            return {
              id: row.id,
              project: row.project,
              provider: row.provider,
              risk: row.risk,
              can_emergency_revoke: row.can_emergency_revoke,
              traffic: row.traffic,
              linked_scanner_findings: (row.scanner_findings || []).map(function(finding) {
                return {
                  id: finding.id,
                  repository: finding.repository || null,
                  branch: finding.branch || null,
                  finding_type: finding.finding_type || null,
                  secret_family: finding.secret_family || null,
                  severity: finding.severity,
                  status: finding.status,
                  owner: finding.owner || null,
                  provider_slot: finding.provider_slot || null,
                  evidence_ref: finding.evidence_ref || null,
                  note: finding.note || null
                };
              }),
              recommended_actions: row.actions
            };
          }),
          scanner_findings: scannerFindings.map(function(finding) {
            return {
              id: finding.id,
              repository: finding.repository || null,
              branch: finding.branch || null,
              finding_type: finding.finding_type || null,
              secret_family: finding.secret_family || null,
              severity: finding.severity,
              status: finding.status,
              owner: finding.owner || null,
              provider_slot: finding.provider_slot || null,
              evidence_ref: finding.evidence_ref || null,
              note: finding.note || null
            };
          }),
          workflow_links: {
            provider_slots: '/app/keys',
            control: '/app/control',
            activity: '/app/activity',
            audit: '/app/audit',
            audit_csv_30_days: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'),
            scanner: '/app/scanner',
            security_review: '/app/security-review',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'service-role keys',
            'origin-lock values',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function exposureResponseBrief() {
        var packet = exposureResponsePacket();
        var summary = packet.summary;
        var priority = packet.provider_slots.filter(function(row) {
          return row.risk === 'scanner_open_exposure' || row.risk === 'needs_rotation' || row.risk === 'review_activity';
        }).slice(0, 12);
        var lines = [
          'VaultProof key exposure response brief',
          'Generated: ' + packet.generated_at,
          'Organization: ' + (packet.organization_id || 'not selected'),
          'Incident: ' + packet.incident.label + ' / ' + packet.incident.source + ' / ' + packet.incident.mode,
          '',
          'Summary:',
          '- Provider slots in scope: ' + number(summary.total_provider_slots),
          '- Live sealed slots: ' + number(summary.sealed_live),
          '- Placeholder or unready slots: ' + number(summary.placeholder_or_unready),
          '- Emergency revoke available: ' + number(summary.emergency_revoke_available),
          '- Scanner findings recorded: ' + number(summary.scanner_findings_recorded),
          '- Open scanner findings: ' + number(summary.open_scanner_findings),
          '- Open critical/high scanner findings: ' + number(summary.open_critical_or_high_scanner_findings),
          '- Needs rotation: ' + number(summary.needs_rotation),
          '- Scanner-linked open exposure: ' + number(summary.scanner_open_exposure),
          '- Needs activity review: ' + number(summary.needs_activity_review),
          '- Needs usage evidence: ' + number(summary.needs_usage_evidence),
          '',
          'Priority actions:'
        ];
        if (priority.length) {
          priority.forEach(function(row) {
            lines.push('- ' + (row.project.name || row.project.vp_proj_id || 'Project') + ' / ' + (row.provider.slug || row.provider.provider || 'provider') + ' [' + row.risk + ']: ' + row.recommended_actions.join('; '));
          });
        } else {
          lines.push('- No provider-slot blockers in the current response scope.');
        }
        lines.push(
          '',
          'Operating boundary:',
          '- VaultProof can immediately disable or audit traffic routed through VaultProof. Raw keys still living directly in external env vars must be rotated upstream and moved behind a provider slot.',
          '- This brief excludes raw provider keys, encrypted shares, bearer tokens, OAuth secrets, request bodies, response bodies, and customer payloads.'
        );
        return lines.join('\\n');
      }
      function renderExposureResponseRow(row) {
        var tone = exposureRiskTone(row.risk);
        var slug = row.provider.slug || row.provider.provider || 'provider';
        var linkedScanner = (row.scanner_findings || []).filter(scannerFindingOpen);
        var scannerTag = linkedScanner.length ? '<span class="tag bad">' + linkedScanner.length + ' open scanner finding' + (linkedScanner.length === 1 ? '' : 's') + '</span>' : '';
        var revokeButton = row.can_emergency_revoke
          ? '<button type="button" class="danger" data-action="revoke-slot" data-project-id="' + escapeHtml(row.project.id) + '" data-slug="' + escapeHtml(slug) + '">emergency revoke</button>'
          : '<span class="tag warn">admin required</span>';
        return '<div class="row"><div><div class="row-title">' + escapeHtml(row.project.name || row.project.vp_proj_id || 'Project') + ' - ' + escapeHtml(slug) + '</div><div class="row-sub">Material ' + escapeHtml(displayMaterialMode(row.provider.material_mode || 'missing')) + ' - calls ' + number(row.traffic.calls) + ' - denied ' + number(row.traffic.denied) + ' - last seen ' + escapeHtml(rel(row.traffic.last_seen_at)) + '</div><div><span class="tag ' + tone + '">' + escapeHtml(row.risk) + '</span><span class="tag">' + escapeHtml(row.provider.provider || 'provider') + '</span><span class="tag ' + (row.project.strict_origin ? 'good' : 'warn') + '">' + (row.project.strict_origin ? 'strict origin' : 'origin relaxed') + '</span>' + scannerTag + '</div><div class="row-sub">' + row.actions.map(escapeHtml).join(' - ') + '</div></div><div class="row-actions">' + revokeButton + '<button type="button" data-action="copy-proxy-dry-run" data-project-id="' + escapeHtml(row.project.id) + '" data-slug="' + escapeHtml(slug) + '">copy dry-run</button><a class="tag" href="/app/scanner">scanner</a><a class="tag" href="/app/activity">activity</a></div></div>';
      }
      function renderExposureResponse() {
        var panel = byId('exposureResponsePanel');
        if (panel) panel.style.display = PAGE_MODE === 'keys' ? 'grid' : 'none';
        if (PAGE_MODE !== 'keys') return;
        var rows = exposureResponseRows();
        var summary = exposureResponseSummary(rows);
        text('exposureResponseMeta', number(summary.total_provider_slots) + ' slots / ' + number(summary.needs_rotation) + ' rotate');
        byId('exposureResponseChecklist').innerHTML = [
          '<div class="row"><div><div class="row-title">Contain through VaultProof first</div><div class="row-sub">Emergency revoke pauses provider-slot usage without exposing or copying raw upstream keys.</div></div><span class="tag good">kill switch</span></div>',
          '<div class="row"><div><div class="row-title">Rotate upstream second</div><div class="row-sub">Create new upstream provider credentials, seal them into VaultProof, run dry-run evidence, then retire exposed raw env vars.</div></div><span class="tag warn">rotation</span></div>',
          '<div class="row"><div><div class="row-title">Scanner findings linked</div><div class="row-sub">' + number(summary.linked_scanner_findings) + ' provider-slot matches from ' + number(summary.scanner_findings_recorded) + ' redacted scanner findings. Open critical/high findings stay visible until marked rotating, rotated, false positive, or pilot accepted in Scanner.</div></div><a class="tag ' + (summary.open_critical_or_high_scanner_findings ? 'bad' : 'good') + '" href="/app/scanner">' + number(summary.open_critical_or_high_scanner_findings) + ' critical/high open</a></div>',
          '<div class="row"><div><div class="row-title">Prove what VaultProof saw</div><div class="row-sub">Export audit CSV, activity, and this incident JSON for security review. Past direct-provider usage outside VaultProof remains outside this proof boundary.</div></div><span><button class="tag good" type="button" data-action="copy-exposure-response-json">JSON</button><a class="tag" href="' + escapeHtml(evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30')) + '">audit CSV</a></span></div>'
        ].join('');
        byId('exposureResponseList').innerHTML = rows.length ? rows.map(renderExposureResponseRow).join('') : '<div class="empty">No provider slots are visible yet. Add provider slots before using VaultProof as the incident response control layer.</div>';
      }
      function copyExposureResponseJson() {
        copyToClipboard(JSON.stringify(exposureResponsePacket(), null, 2), 'Key exposure response JSON');
      }
      function copyExposureResponseBrief() {
        copyToClipboard(exposureResponseBrief(), 'Key exposure response brief');
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          var bootstrap = await fetchJson('/api/v1/enterprise/projects/bootstrap');
          renderOrgSelector(bootstrap);
          cachedProjects = Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
          cachedOverview = bootstrap.overview || {};
          updateKpis();
          renderProjectOptions();
          renderProjects();
          renderInventory();
          renderPolicy();
          renderRollout();
          renderExposureResponse();
          renderKeys();
          await renderActivity();
        } catch (error) {
          notice(error && error.message ? error.message : 'Enterprise operations failed to load.');
        }
      }
      if (byId('activityFilterForm')) {
        byId('activityFilterForm').addEventListener('submit', function(event) {
          event.preventDefault();
          renderActivity().catch(function(error) { notice(error && error.message ? error.message : 'Activity failed to load.'); });
        });
      }
      if (byId('openProviderSlotForm')) {
        byId('openProviderSlotForm').addEventListener('click', function() { setProviderSlotFormVisible(true); });
      }
      if (byId('cancelProviderSlotForm')) {
        byId('cancelProviderSlotForm').addEventListener('click', function() { setProviderSlotFormVisible(false); });
      }
      if (byId('providerSlotForm')) {
        byId('providerSlotForm').addEventListener('submit', submitProviderSlotForm);
      }
      if (byId('openManualApiKeyForm')) {
        byId('openManualApiKeyForm').addEventListener('click', function() { setManualApiKeyFormVisible(true); });
      }
      if (byId('openInventoryImportForm')) {
        byId('openInventoryImportForm').addEventListener('click', function() { setInventoryImportFormVisible(true); });
      }
      if (byId('cancelInventoryImportForm')) {
        byId('cancelInventoryImportForm').addEventListener('click', function() { setInventoryImportFormVisible(false); });
      }
      if (byId('inventoryImportForm')) {
        byId('inventoryImportForm').addEventListener('submit', submitInventoryImportForm);
      }
      if (byId('inventoryFilterForm')) {
        byId('inventoryFilterForm').addEventListener('submit', function(event) {
          event.preventDefault();
          renderInventoryList();
        });
      }
      if (byId('inventoryBulkReviewForm')) {
        byId('inventoryBulkReviewForm').addEventListener('submit', applyInventoryBulkReview);
      }
      if (byId('policyFilterForm')) {
        byId('policyFilterForm').addEventListener('submit', function(event) {
          event.preventDefault();
          renderPolicyList();
        });
      }
      if (byId('rolloutFilterForm')) {
        byId('rolloutFilterForm').addEventListener('submit', function(event) {
          event.preventDefault();
          renderRolloutList();
        });
      }
      if (byId('clearPolicyFilters')) {
        byId('clearPolicyFilters').addEventListener('click', function() {
          ['policySearch', 'policySeverityFilter', 'policyStatusFilter', 'policyControlFilter'].forEach(function(id) {
            if (byId(id)) byId(id).value = '';
          });
          renderPolicyList();
        });
      }
      if (byId('clearRolloutFilters')) {
        byId('clearRolloutFilters').addEventListener('click', function() {
          ['rolloutSearch', 'rolloutStatusFilter', 'rolloutModeFilter', 'rolloutTestFilter', 'rolloutBlockerFilter'].forEach(function(id) {
            if (byId(id)) byId(id).value = '';
          });
          renderRolloutList();
        });
      }
      if (byId('clearInventoryFilters')) {
        byId('clearInventoryFilters').addEventListener('click', function() {
          ['inventorySearch', 'inventoryStatusFilter', 'inventoryReviewFilter', 'inventoryRiskFilter', 'inventorySourceFilter'].forEach(function(id) {
            if (byId(id)) byId(id).value = '';
          });
          renderInventoryList();
        });
      }
      if (byId('copyFilteredInventoryCsvBtn')) {
        byId('copyFilteredInventoryCsvBtn').addEventListener('click', copyFilteredInventoryCsv);
      }
      if (byId('cancelManualApiKeyForm')) {
        byId('cancelManualApiKeyForm').addEventListener('click', function() { setManualApiKeyFormVisible(false); });
      }
      if (byId('manualApiKeyForm')) {
        byId('manualApiKeyForm').addEventListener('submit', submitManualApiKeyForm);
      }
      if (byId('slotProvider')) {
        byId('slotProvider').addEventListener('change', function() { syncProviderDefaults(true); });
      }
      if (byId('copyInventoryJsonBtn')) {
        byId('copyInventoryJsonBtn').addEventListener('click', copyInventoryJson);
      }
      if (byId('copyInventoryCsvBtn')) {
        byId('copyInventoryCsvBtn').addEventListener('click', copyInventoryCsv);
      }
      if (byId('copyInventoryReviewBriefBtn')) {
        byId('copyInventoryReviewBriefBtn').addEventListener('click', copyInventoryReviewBrief);
      }
      if (byId('copyPolicyBriefBtn')) {
        byId('copyPolicyBriefBtn').addEventListener('click', copyPolicyBrief);
      }
      if (byId('copyPolicyJsonBtn')) {
        byId('copyPolicyJsonBtn').addEventListener('click', copyPolicyJson);
      }
      if (byId('copyRolloutJsonBtn')) {
        byId('copyRolloutJsonBtn').addEventListener('click', copyRolloutJson);
      }
      if (byId('copyRolloutBriefBtn')) {
        byId('copyRolloutBriefBtn').addEventListener('click', copyRolloutBrief);
      }
      if (byId('copyExposureResponseReportBtn')) {
        byId('copyExposureResponseReportBtn').addEventListener('click', copyExposureResponseBrief);
      }
      document.addEventListener('input', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.id === 'inventorySearch') {
          renderInventoryList();
          return;
        }
        if (target.id === 'policySearch') {
          renderPolicyList();
          return;
        }
        if (target.id === 'rolloutSearch') {
          renderRolloutList();
          return;
        }
        if (target.getAttribute('data-manual-key-field')) {
          saveManualApiKeyField(target);
          return;
        }
        if (target.getAttribute('data-inventory-field')) {
          saveInventoryField(target);
          return;
        }
        if (target.getAttribute('data-policy-field')) {
          savePolicyField(target, false);
          return;
        }
        if (target.getAttribute('data-rollout-field')) {
          saveRolloutField(target, false);
        }
      });
      document.addEventListener('change', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (['inventoryStatusFilter', 'inventoryReviewFilter', 'inventoryRiskFilter', 'inventorySourceFilter'].indexOf(target.id) !== -1) {
          renderInventoryList();
          return;
        }
        if (['policySeverityFilter', 'policyStatusFilter', 'policyControlFilter'].indexOf(target.id) !== -1) {
          renderPolicyList();
          return;
        }
        if (['rolloutStatusFilter', 'rolloutModeFilter', 'rolloutTestFilter', 'rolloutBlockerFilter'].indexOf(target.id) !== -1) {
          renderRolloutList();
          return;
        }
        if (target.getAttribute('data-manual-key-field')) {
          saveManualApiKeyField(target);
          return;
        }
        if (target.getAttribute('data-inventory-field')) {
          saveInventoryField(target);
          return;
        }
        if (target.getAttribute('data-policy-field')) {
          savePolicyField(target, true);
          return;
        }
        if (target.getAttribute('data-rollout-field')) {
          saveRolloutField(target, true);
        }
      });
      document.addEventListener('click', async function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-action') === 'copy-rollout-snippet') {
          copyRolloutSnippet(target);
          return;
        }
        if (target.getAttribute('data-action') === 'copy-rollout-brief') {
          copyRolloutBrief();
          return;
        }
        if (target.getAttribute('data-action') === 'copy-exposure-response-json') {
          copyExposureResponseJson();
          return;
        }
        if (target.getAttribute('data-action') === 'copy-exposure-response-brief') {
          copyExposureResponseBrief();
          return;
        }
        if (target.getAttribute('data-action') === 'open-inventory-import') {
          setInventoryImportFormVisible(true);
          return;
        }
        if (target.getAttribute('data-action') === 'copy-inventory-csv') {
          copyInventoryCsv();
          return;
        }
        if (target.getAttribute('data-action') === 'copy-filtered-inventory-csv') {
          copyFilteredInventoryCsv();
          return;
        }
        if (target.getAttribute('data-action') === 'copy-inventory-review-brief') {
          copyInventoryReviewBrief();
          return;
        }
        if (target.getAttribute('data-action') === 'copy-policy-brief') {
          copyPolicyBrief();
          return;
        }
        if (target.getAttribute('data-action') === 'copy-inventory-json') {
          copyInventoryJson();
          return;
        }
        if (target.getAttribute('data-action') === 'delete-manual-api-key') {
          deleteManualApiKey(target.getAttribute('data-manual-key-id'));
          return;
        }
        if (target.getAttribute('data-action') === 'prefill-email-slot') {
          prefillEmailSlot();
          return;
        }
        if (target.getAttribute('data-action') === 'email-dry-run') {
          await runProtectedEmailDryRun(target);
          return;
        }
        if (target.getAttribute('data-action') === 'email-deny-test') {
          await runProtectedEmailDenialTest(target);
          return;
        }
        if (target.getAttribute('data-action') === 'copy-proxy-dry-run') {
          copyProxySelfTest(target);
          return;
        }
        if (target.getAttribute('data-action') === 'copy-proxy-deny-test') {
          copyProxySelfTest(target, { blocked: true });
          return;
        }
        if (target.getAttribute('data-action') !== 'revoke-slot') return;
        var reason = prompt('Reason for emergency revoke?');
        if (reason === null) return;
        try {
          await fetchJson('/api/v1/enterprise/projects/' + encodeURIComponent(target.getAttribute('data-project-id')) + '/providers/' + encodeURIComponent(target.getAttribute('data-slug')) + '/revoke', {
            method: 'POST',
            body: JSON.stringify({ reason: reason || 'Emergency revoke from enterprise dashboard' })
          });
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Provider revoke failed.');
        }
      });
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

type EnterpriseSupportPageName = 'docs' | 'setup' | 'launch' | 'evidence' | 'demo' | 'technical-guide' | 'security-review' | 'verifier' | 'settings' | 'entitlements' | 'onboarding' | 'plans' | 'pilot' | 'pilot-success' | 'testers' | 'release' | 'scanner' | 'support' | 'runbooks';

function renderEnterpriseSupportPage(pageName: EnterpriseSupportPageName): string {
  const supportPageCopy: Record<EnterpriseSupportPageName, { title: string; kicker: string; lead: string }> = {
    docs: {
      title: 'Enterprise docs',
      kicker: 'enterprise documentation',
      lead: 'Enterprise-only documentation for customer teams using VaultProof after purchase. Use this page for setup, SSO, provider slots, key exposure response, evidence, runbooks, and operating boundaries without mixing in public developer docs.',
    },
    setup: {
      title: 'Enterprise setup guide',
      kicker: 'welcome to VaultProof',
      lead: 'Welcome to VaultProof Enterprise, and congratulations on starting your secure workspace. This guide is for enterprise teams with many apps, environments, owners, and provider integrations. Use it to map your environment, connect identity, choose a gateway pattern, protect provider keys, prove readiness, and operate VaultProof safely.',
    },
    launch: {
      title: 'Launch checklist',
      kicker: 'customer go-live',
      lead: 'Turn the enterprise setup plan into a working customer launch board. Track readiness, owners, policy, evidence, alerts, and rollout actions before sending real customer traffic.',
    },
    evidence: {
      title: 'Evidence packet',
      kicker: 'customer proof',
      lead: 'Assemble the proof a customer security team asks for first: runtime readiness, access review, audit exports, provider posture, policy workflow, and a downloadable JSON packet scoped to the selected organization.',
    },
    demo: {
      title: 'Buyer walkthrough',
      kicker: 'customer walkthrough',
      lead: 'Run a repeatable buyer walkthrough that shows active key protection, a safe email API key story, runtime evidence, launch blockers, pricing packaging, and the next paid-pilot step without exposing secrets.',
    },
    testers: {
      title: 'Pilot testers',
      kicker: 'paid-user readiness',
      lead: 'Prepare enterprise testers with a clear roster, login state, scenario assignments, feedback capture, blockers, and a customer-safe readiness packet.',
    },
    'technical-guide': {
      title: 'Technical guide',
      kicker: 'implementation details',
      lead: 'Deep implementation reference for identity, gateways, project modeling, caller lock, key custody, evidence, operations, rollout, and troubleshooting. Use it when technical teams need the exact wiring behind the setup guide.',
    },
    'security-review': {
      title: 'Security review packet',
      kicker: 'buyer review',
      lead: 'Give security, procurement, and technical reviewers a concise customer-safe packet: architecture summary, control coverage, evidence links, open launch items, and copyable review answers without exposing secrets.',
    },
    verifier: {
      title: 'AI Proof Verifier',
      kicker: 'verifier-first evidence',
      lead: 'Register models that run outside VaultProof, submit proof bundles from those external jobs, verify the evidence, and tie pilot results to the shared enterprise runtime attestation, project policy, RBAC, and audit.',
    },
    settings: {
      title: 'Settings',
      kicker: 'tenant defaults',
      lead: 'Review tenant defaults, organization identity, SSO state, and production readiness from the enterprise control plane.',
    },
    entitlements: {
      title: 'Entitlements',
      kicker: 'paid customer package',
      lead: 'Track the customer contract package, capacity envelope, support tier, renewal owner, incident-response boundary, and paid-user guardrails without exposing secrets or adding billing tables.',
    },
    onboarding: {
      title: 'Paid onboarding',
      kicker: 'customer activation',
      lead: 'Turn a signed or accepted enterprise package into a controlled customer activation board with owners, login handoff, first workload scope, support coverage, and copyable evidence.',
    },
    plans: {
      title: 'Plans',
      kicker: 'enterprise packaging',
      lead: 'Track enterprise rollout packaging, GCP edge readiness, usage posture, and contract-facing guardrails.',
    },
    pilot: {
      title: 'Pilot proposal',
      kicker: 'first customer',
      lead: 'Shape the first paid pilot into a clear buyer proposal: one workload, one owner group, one provider path, price, support boundary, success metric, and go-live guardrails.',
    },
    'pilot-success': {
      title: 'Pilot success tracker',
      kicker: 'customer proof',
      lead: 'Track the pilot from kickoff to expansion decision with live readiness signals, browser-local milestone evidence, proof links, blockers, and a copyable weekly customer update.',
    },
    release: {
      title: 'Release evidence',
      kicker: 'change proof',
      lead: 'Record what changed, which build/image tag is live, who approved it, how it was verified, and where rollback lives before a customer sees the release.',
    },
    scanner: {
      title: 'Scanner',
      kicker: 'secret exposure intake',
      lead: 'Record sanitized repository exposure findings, owners, rotation state, and remediation evidence for enterprise review without uploading repository contents or secret values.',
    },
    support: {
      title: 'Launch support room',
      kicker: 'customer support',
      lead: 'Package the founder-led support model for a customer pilot: who owns launch-week follow-up, what evidence support can inspect, which actions require approval, and where the internal admin console begins and ends.',
    },
    runbooks: {
      title: 'Runbooks',
      kicker: 'operator commands',
      lead: 'Review production verification, evidence, deploy, secret, DNS, edge, SSH, and cleanup runbooks before making live infrastructure changes.',
    },
  };
  const pageTitle = supportPageCopy[pageName].title;
  const pageKicker = supportPageCopy[pageName].kicker;
  const pageLead = supportPageCopy[pageName].lead;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(pageTitle)} - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 8px; padding: 11px 12px; font: inherit; }
    input::placeholder, textarea::placeholder { color: rgba(82,97,112,.48); }
    textarea { min-height: 120px; resize: vertical; line-height: 1.45; }
    option { color: #111827; }
    button { cursor: pointer; }
    button[disabled] { cursor: not-allowed; opacity: .58; }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 780px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #23466f); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.86)); border-radius: 8px; padding: 20px; box-shadow: 0 22px 90px rgba(26,40,52,.16); }
    .doc-guide { display: none; max-width: 940px; }
    .doc-section { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(26,40,52,.12), rgba(248,250,252,.76)); border-radius: 8px; padding: 24px; margin-bottom: 18px; box-shadow: 0 22px 90px rgba(26,40,52,.12); }
    .doc-section h2 { margin: 0 0 10px; font-size: 26px; letter-spacing: -.045em; }
    .doc-section h3 { margin: 18px 0 8px; font-size: 16px; letter-spacing: -.02em; color: var(--text); }
    .doc-section p { margin: 0 0 12px; color: var(--muted); line-height: 1.68; }
    .doc-section ul, .doc-section ol { margin: 10px 0 0; padding-left: 22px; color: var(--muted); line-height: 1.68; }
    .doc-section li { margin: 7px 0; }
    .doc-section code { color: var(--gold); }
    .doc-note { border-left: 3px solid var(--gold); padding: 12px 14px; margin-top: 14px; border-radius: 0 8px 8px 0; background: rgba(180,83,9,.08); color: var(--text); }
    .doc-note strong { color: var(--gold); }
    .doc-kicker { display: block; color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 850; margin-bottom: 8px; }
    .launch-progress { height: 11px; border-radius: 999px; background: rgba(26,40,52,.12); overflow: hidden; margin-top: 16px; }
    .launch-progress span { display: block; height: 100%; width: 0; background: linear-gradient(135deg, var(--green), var(--primary-bg)); border-radius: inherit; transition: width 180ms ease; }
    .launch-check-row { display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: start; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .launch-check-row input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--green); }
    .launch-check-title { font-weight: 780; letter-spacing: -.02em; }
    .launch-check-sub { color: var(--muted); font-size: 13px; line-height: 1.45; margin-top: 5px; }
    .launch-check-row[data-complete="true"] { border-color: rgba(21,128,61,.24); background: rgba(21,128,61,.10); }
    .go-decision { display: grid; gap: 8px; margin-bottom: 14px; }
    .go-decision-title { font-size: 24px; font-weight: 850; letter-spacing: -.045em; }
    .go-evidence-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 12px; align-items: start; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .go-evidence-row input[type="checkbox"] { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--green); }
    .go-evidence-row[data-complete="true"] { border-color: rgba(21,128,61,.24); background: rgba(21,128,61,.10); }
    .go-note { width: 100%; min-height: 42px; margin-top: 10px; padding: 10px 11px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.78); color: var(--text); font: inherit; }
    .go-status { width: 100%; min-width: 118px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.78); color: var(--text); font: inherit; font-size: 12px; padding: 8px 10px; }
    .go-action { display: block; color: var(--muted); font-size: 12px; margin-top: 7px; line-height: 1.45; }
    .go-action code { color: var(--gold); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere; word-break: break-word; }
    .evidence-callout { display: grid; gap: 10px; border: 1px solid rgba(21,128,61,.22); background: rgba(21,128,61,.08); border-radius: 8px; padding: 16px; }
    .evidence-callout strong { font-size: 18px; letter-spacing: -.03em; }
    .evidence-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .brief-box { width: 100%; min-height: 210px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 12px; line-height: 1.55; }
    .demo-script { min-height: 330px; }
    .review-filters { display: grid; grid-template-columns: minmax(220px, 1.3fr) minmax(150px, .7fr) auto; gap: 10px; margin-bottom: 14px; }
    .entitlement-meter-list { display: grid; gap: 12px; margin-bottom: 14px; }
    .entitlement-meter { border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .entitlement-meter-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .entitlement-meter-title { font-weight: 780; letter-spacing: -.02em; }
    .entitlement-meter-value { color: var(--muted); font-size: 12px; text-align: right; }
    .entitlement-meter-track { height: 10px; border-radius: 999px; background: rgba(26,40,52,.12); overflow: hidden; margin-top: 10px; }
    .entitlement-meter-fill { display: block; height: 100%; width: 0; border-radius: inherit; background: linear-gradient(135deg, var(--green), var(--primary-bg)); }
    .entitlement-meter-fill.warn { background: linear-gradient(135deg, var(--warn), #f3d86f); }
    .entitlement-meter-fill.bad { background: linear-gradient(135deg, var(--red), #e5a197); }
    .scanner-form, .scanner-fields, .release-form, .release-fields, .tester-form, .tester-fields, .entitlement-form, .pilot-success-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .scanner-field, .release-field, .tester-field, .entitlement-field, .pilot-success-field { display: grid; gap: 6px; }
    .scanner-field.wide, .release-field.wide, .tester-field.wide, .entitlement-field.wide, .pilot-success-field.wide { grid-column: 1 / -1; }
    .scanner-field label, .release-field label, .tester-field label, .entitlement-field label, .pilot-success-field label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
    .scanner-row, .release-row, .tester-row { border: 1px solid rgba(26,40,52,.12); background: rgba(248,250,252,.84); border-radius: 8px; padding: 15px; display: grid; gap: 12px; }
    .scanner-head, .release-head, .tester-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
    .onboarding-evidence-row { grid-template-columns: 22px minmax(0, 1fr) minmax(260px, .44fr); }
    .onboarding-controls { display: grid; gap: 8px; min-width: 240px; }
    .onboarding-controls input, .onboarding-controls textarea, .onboarding-controls select { width: 100%; }
    .row-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(26,40,52,.10); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.84); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(37,99,235,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(21,128,61,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(180,83,9,.28); }
    .tag.bad { color: var(--red); border-color: rgba(220,38,38,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(26,40,52,.22); border-radius: 8px; padding: 18px; background: rgba(248,250,252,.78); }
    .notice.error { color: var(--red); border-color: rgba(220,38,38,.3); }
    @media (max-width: 1100px) { .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .kpis, .two, .launch-check-row, .go-evidence-row, .onboarding-evidence-row, .row, .review-filters, .scanner-form, .scanner-fields, .scanner-head, .release-form, .release-fields, .release-head, .tester-form, .tester-fields, .tester-head, .entitlement-form, .pilot-success-form { grid-template-columns: 1fr; } .go-evidence-row > span:last-child:not(.onboarding-controls) { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } .go-status { width: auto; } .row-actions { justify-content: flex-start; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar(pageName, pageKicker)}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">${escapeHtml(pageKicker)}</div>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p class="lead">${escapeHtml(pageLead)}</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" href="/app/dashboard">dashboard</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section id="supportKpis" class="grid kpis">
        <div class="card"><div class="kpi-label">production</div><div class="kpi-value" id="kpiProduction">...</div><div class="kpi-sub">control plane + executor</div></div>
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">active scopes</div></div>
        <div class="card"><div class="kpi-label">members</div><div class="kpi-value" id="kpiMembers">...</div><div class="kpi-sub" id="kpiOrgRole">org role</div></div>
        <div class="card"><div class="kpi-label">calls</div><div class="kpi-value" id="kpiCalls">...</div><div class="kpi-sub">proxy traffic</div></div>
      </section>

      <section id="launchPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Launch progress</h2><span class="mini" id="launchProgressMeta">0 of 0</span></div>
          <div class="kpi-value" id="launchProgressValue">0%</div>
          <div class="launch-progress" aria-hidden="true"><span id="launchProgressBar"></span></div>
          <p class="mini" id="launchProgressCopy" style="margin-top:14px">Loading launch state...</p>
        </div>
        <div class="card">
          <div class="section-title"><h2>Launch package</h2><span class="mini">live checks</span></div>
          <div id="launchSummaryList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Go/No-Go Readiness</h2><span class="mini" id="goNoGoMeta">hold</span></div>
          <div id="goNoGoDecision" class="evidence-callout go-decision"></div>
          <div id="goNoGoList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Identity/OAuth evidence packet</h2><span class="mini" id="identityQaMeta">hold</span></div>
          <div id="identityQaList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Key rotation evidence packet</h2><span class="mini" id="keyRotationMeta">hold</span></div>
          <div id="keyRotationList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Pilot operations evidence packet</h2><span class="mini" id="pilotOpsMeta">hold</span></div>
          <div id="pilotOpsList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer tasks</h2><span class="mini">saved in this browser</span></div>
          <div id="launchChecklist" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Next actions</h2><span class="mini">customer workflow</span></div>
          <div id="launchActions" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Launch brief</h2>
            <button id="copyLaunchBriefBtn" type="button">copy brief</button>
          </div>
          <textarea id="launchBrief" class="brief-box" readonly aria-label="Launch brief"></textarea>
        </div>
      </section>

      <section id="evidencePanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Evidence readiness</h2><span class="mini" id="evidenceMeta">live packet</span></div>
          <div id="evidenceReadinessList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer exports</h2><span class="mini">review links</span></div>
          <div id="evidenceExportList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Proof inventory</h2><span class="mini">current scope</span></div>
          <div id="evidenceProofList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Review workflow</h2><span class="mini">customer handoff</span></div>
          <div id="evidenceWorkflowList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Identity/OAuth proof</h2><span class="mini" id="evidenceIdentityMeta">hold</span></div>
          <div id="evidenceIdentityList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Key rotation proof</h2><span class="mini" id="evidenceKeyRotationMeta">hold</span></div>
          <div id="evidenceKeyRotationList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Key exposure response proof</h2><span class="mini" id="evidenceExposureResponseMeta">hold</span></div>
          <div id="evidenceExposureResponseList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Pilot operations proof</h2><span class="mini" id="evidencePilotOpsMeta">hold</span></div>
          <div id="evidencePilotOpsList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>API proxy self-test proof</h2><span class="mini" id="evidenceApiProxyMeta">hold</span></div>
          <div id="evidenceApiProxyList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>API inventory proof</h2><span class="mini" id="evidenceApiInventoryMeta">hold</span></div>
          <div id="evidenceApiInventoryList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Policy drift proof</h2><span class="mini" id="evidencePolicyDriftMeta">hold</span></div>
          <div id="evidencePolicyDriftList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Integration rollout proof</h2><span class="mini" id="evidenceRolloutMeta">hold</span></div>
          <div id="evidenceRolloutList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Scanner exposure proof</h2><span class="mini" id="evidenceScannerMeta">hold</span></div>
          <div id="evidenceScannerList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Launch support proof</h2><span class="mini" id="evidenceSupportMeta">hold</span></div>
          <div id="evidenceSupportList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Monitoring evidence proof</h2><span class="mini" id="evidenceMonitoringMeta">hold</span></div>
          <div id="evidenceMonitoringList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Release evidence proof</h2><span class="mini" id="evidenceReleaseMeta">hold</span></div>
          <div id="evidenceReleaseList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Paid-pilot tester proof</h2><span class="mini" id="evidenceTesterMeta">hold</span></div>
          <div id="evidenceTesterList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Contract entitlements proof</h2><span class="mini" id="evidenceEntitlementsMeta">contract review</span></div>
          <div id="evidenceEntitlementsList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Paid onboarding proof</h2><span class="mini" id="evidenceOnboardingMeta">hold</span></div>
          <div id="evidenceOnboardingList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Evidence packet JSON</h2>
            <div class="evidence-actions">
              <button id="copyEvidencePacketBtn" type="button">copy JSON</button>
              <button id="downloadEvidencePacketBtn" type="button">download JSON</button>
            </div>
          </div>
          <div class="evidence-callout" style="margin-bottom:14px">
            <strong>Safe customer packet</strong>
            <span class="mini">This summary is generated in the browser from existing enterprise APIs and does not include provider keys, encrypted shares, Supabase service-role keys, origin-lock values, signing secrets, or raw executor internals.</span>
          </div>
          <textarea id="evidencePacket" class="brief-box" readonly aria-label="Evidence packet JSON"></textarea>
        </div>
      </section>

      <section id="demoPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Walkthrough objective</h2><span class="mini" id="demoMeta">buyer flow</span></div>
          <div id="demoObjectiveList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Live proof path</h2><span class="mini">show these in order</span></div>
          <div id="demoPathList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Buyer proof points</h2><span class="mini">why it matters</span></div>
          <div id="demoProofList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Safety guardrails</h2><span class="mini">pilot controlled</span></div>
          <div id="demoGuardrailList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Objection answers</h2><span class="mini">customer Q&A</span></div>
          <div id="demoObjectionList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Close path</h2><span class="mini">paid pilot</span></div>
          <div id="demoCloseList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable walkthrough talk track</h2>
            <button id="copyDemoScriptBtn" type="button">copy script</button>
          </div>
          <textarea id="demoScript" class="brief-box demo-script" readonly aria-label="Walkthrough talk track"></textarea>
        </div>
      </section>

      <section id="testersPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Tester intake</h2><span id="testerMeta" class="mini">browser-local</span></div>
          <form id="pilotTesterForm" class="tester-form">
            <div class="tester-field"><label for="testerName">tester name/email</label><input id="testerName" placeholder="security reviewer or tester@example.com" /></div>
            <div class="tester-field"><label for="testerTeam">team</label><input id="testerTeam" placeholder="Security, platform, app team" /></div>
            <div class="tester-field"><label for="testerRole">role</label><select id="testerRole"><option value="security_reviewer">security reviewer</option><option value="platform_admin">platform admin</option><option value="app_owner">app owner</option><option value="developer">developer</option><option value="procurement">procurement</option><option value="executive_sponsor">executive sponsor</option></select></div>
            <div class="tester-field"><label for="testerScenario">scenario</label><select id="testerScenario"><option value="login_and_sso">login and SSO</option><option value="evidence_review">evidence review</option><option value="api_proxy_self_test">API proxy self-test</option><option value="provider_slot_review">provider slot review</option><option value="security_review">security review</option><option value="rollout_review">rollout review</option><option value="support_handoff">support handoff</option></select></div>
            <div class="tester-field"><label for="testerStatus">status</label><select id="testerStatus"><option value="not_invited">not invited</option><option value="invited">invited</option><option value="login_blocked">login blocked</option><option value="login_passed">login passed</option><option value="scenario_passed">scenario passed</option><option value="feedback_received">feedback received</option><option value="complete">complete</option></select></div>
            <div class="tester-field"><label for="testerOwner">VaultProof owner</label><input id="testerOwner" placeholder="owner for follow-up" /></div>
            <div class="tester-field wide"><label for="testerBlocker">blocker</label><textarea id="testerBlocker" placeholder="What blocks this tester. Do not paste passwords, tokens, provider keys, request bodies, or customer payloads."></textarea></div>
            <div class="tester-field wide"><label for="testerFeedback">feedback note</label><textarea id="testerFeedback" placeholder="Customer-safe feedback, next step, or objection. Metadata only."></textarea></div>
            <button class="primary" type="submit">add tester</button>
          </form>
        </div>
        <div class="card">
          <div class="section-title"><h2>Tester readiness</h2><span class="mini">paid pilot</span></div>
          <div id="testerReadinessList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Guided session plan</h2>
            <div class="evidence-actions">
              <span id="testerSessionMeta" class="mini">not scheduled</span>
              <button id="copyTesterSessionBriefBtn" type="button">copy session brief</button>
            </div>
          </div>
          <form id="testerSessionForm" class="tester-form">
            <div class="tester-field"><label for="testerSessionStatus">session status</label><select id="testerSessionStatus" data-tester-session-field="status"><option value="not_scheduled">not scheduled</option><option value="scheduled">scheduled</option><option value="in_progress">in progress</option><option value="complete">complete</option><option value="blocked">blocked</option></select></div>
            <div class="tester-field"><label for="testerSessionWindow">session window</label><input id="testerSessionWindow" data-tester-session-field="session_window" placeholder="2026-06-01 10:00 PT" /></div>
            <div class="tester-field"><label for="testerSessionFacilitator">VaultProof facilitator</label><input id="testerSessionFacilitator" data-tester-session-field="facilitator" placeholder="walkthrough/session owner" /></div>
            <div class="tester-field"><label for="testerSessionCustomerOwner">customer owner</label><input id="testerSessionCustomerOwner" data-tester-session-field="customer_owner" placeholder="buyer, security, or platform owner" /></div>
            <div class="tester-field wide"><label for="testerSessionSuccess">success criteria</label><textarea id="testerSessionSuccess" data-tester-session-field="success_criteria" placeholder="What must be true at the end of the guided test. Metadata only."></textarea></div>
            <div class="tester-field wide"><label for="testerSessionAction">customer action</label><textarea id="testerSessionAction" data-tester-session-field="customer_action" placeholder="Decision, follow-up, or next test action expected from the customer."></textarea></div>
            <div class="tester-field wide"><label for="testerSessionNote">session note</label><textarea id="testerSessionNote" data-tester-session-field="session_note" placeholder="Customer-safe session note. Do not paste passwords, tokens, provider keys, request bodies, or customer payloads."></textarea></div>
          </form>
          <div id="testerSessionList" class="list" style="margin-top:14px"></div>
          <textarea id="testerSessionBrief" class="brief-box" readonly aria-label="Tester session brief"></textarea>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Tester roster</h2><span class="mini">saved in this browser</span></div>
          <div id="testerRosterList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Scenario workflow</h2><span class="mini">tomorrow's path</span></div>
          <div id="testerWorkflowList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title">
            <h2>Tester readiness JSON</h2>
            <button id="copyTesterJsonBtn" type="button">copy tester JSON</button>
          </div>
          <textarea id="testerEvidencePacket" class="brief-box" readonly aria-label="Tester readiness JSON"></textarea>
        </div>
      </section>

      <section id="supportPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Support readiness</h2><span id="supportMeta" class="mini">customer pilot</span></div>
          <div id="supportReadinessList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Guided pilot guide</h2><span class="mini">Nelson + Max</span></div>
          <div id="supportGuidedPilotList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Buyer qualification</h2><span class="mini">PMF signal</span></div>
          <div id="supportQualificationList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer setup sequence</h2><span class="mini">guided onboarding</span></div>
          <div id="supportSetupSequenceList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Internal admin boundary</h2><span class="mini">employee only</span></div>
          <div id="supportBoundaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Launch-week workflow</h2><span class="mini">founder-led</span></div>
          <div id="supportWorkflowList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Exposure response handoff</h2><span class="mini">customer-safe</span></div>
          <div id="supportExposureList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer handoff</h2><span class="mini">what to share</span></div>
          <div id="supportHandoffList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Support brief</h2>
            <button id="copySupportBriefBtn" type="button">copy brief</button>
          </div>
          <textarea id="supportBrief" class="brief-box" readonly aria-label="Support brief"></textarea>
        </div>
      </section>

      <section id="releasePanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Release intake</h2><span id="releaseMeta" class="mini">browser-local</span></div>
          <form id="releaseEvidenceForm" class="release-form">
            <div class="release-field"><label for="releaseLabel">release label</label><input id="releaseLabel" placeholder="enterprise pilot release 2026-05-13" /></div>
            <div class="release-field"><label for="releaseBuildTag">build/image tag</label><input id="releaseBuildTag" placeholder="git sha or container tag" /></div>
            <div class="release-field"><label for="releaseApprover">approver</label><input id="releaseApprover" placeholder="operator or customer owner" /></div>
            <div class="release-field"><label for="releaseVerifier">verifier</label><input id="releaseVerifier" placeholder="person who ran QA/gates" /></div>
            <div class="release-field"><label for="releaseVerificationStatus">verification status</label><select id="releaseVerificationStatus"><option value="pending">pending</option><option value="passed">passed</option><option value="failed">failed</option><option value="blocked">blocked</option><option value="accepted_demo">accepted for pilot</option></select></div>
            <div class="release-field"><label for="releaseRolloutStatus">rollout status</label><select id="releaseRolloutStatus"><option value="planned">planned</option><option value="canary">canary</option><option value="live">live</option><option value="rolled_back">rolled back</option><option value="paused">paused</option></select></div>
            <div class="release-field"><label for="releaseRollbackOwner">rollback owner</label><input id="releaseRollbackOwner" placeholder="operator name or team" /></div>
            <div class="release-field"><label for="releaseRollbackPath">rollback path</label><input id="releaseRollbackPath" placeholder="previous build tag, reset plan, or runbook ref" /></div>
            <div class="release-field wide"><label for="releaseSummary">change summary</label><textarea id="releaseSummary" placeholder="What changed for customers. Metadata only; do not paste env values, tokens, request bodies, or secrets."></textarea></div>
            <div class="release-field wide"><label for="releaseEvidenceNote">verification evidence note</label><textarea id="releaseEvidenceNote" placeholder="Smoke/gate command results, Cloud Build id, deploy ticket, or customer approval reference. Metadata only."></textarea></div>
            <button class="primary" type="submit">add release record</button>
          </form>
        </div>
        <div class="card">
          <div class="section-title"><h2>Release posture</h2><span class="mini">customer-safe</span></div>
          <div id="releaseReadinessList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Release records</h2><span class="mini">saved in this browser</span></div>
          <div id="releaseRecordList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Release workflow</h2><span class="mini">operator handoff</span></div>
          <div id="releaseWorkflowList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title">
            <h2>Release evidence JSON</h2>
            <button id="copyReleaseJsonBtn" type="button">copy release JSON</button>
          </div>
          <textarea id="releaseEvidencePacket" class="brief-box" readonly aria-label="Release evidence JSON"></textarea>
        </div>
      </section>

      <section id="enterpriseDocsPanel" class="doc-guide" style="display:none">
        <article class="doc-section">
          <span class="doc-kicker">Start here</span>
          <h2>Enterprise docs index</h2>
          <p>This page is the customer-facing index for VaultProof Enterprise documentation. The public docs at <code>vaultproof.dev/docs</code> are still available for general product and developer references, but enterprise rollout, SSO, provider-slot custody, evidence, and incident response belong here.</p>
          <p>Use these links when a customer asks where to start, how to set up identity, how key custody works, or what to do after a suspected provider-key exposure.</p>
          <div class="list">
            <div class="row"><div><div class="row-title">Setup guide</div><div class="row-sub">Rollout sequence for identity, gateways, projects, provider slots, policy, evidence, alerts, and gradual go-live.</div></div><a class="tag good" href="/app/setup">open</a></div>
            <div class="row"><div><div class="row-title">Technical guide</div><div class="row-sub">Architecture, trust boundaries, SSO, caller lock, key custody, GCP runtime posture, audit evidence, and troubleshooting.</div></div><a class="tag good" href="/app/technical-guide">open</a></div>
            <div class="row"><div><div class="row-title">Security review</div><div class="row-sub">Customer-safe security and procurement packet with control coverage, evidence links, open items, and common answers.</div></div><a class="tag good" href="/app/security-review">open</a></div>
            <div class="row"><div><div class="row-title">Runbooks</div><div class="row-sub">Operator commands for production verification, evidence capture, deploy checks, DNS, edge, and cleanup.</div></div><a class="tag good" href="/app/runbooks">open</a></div>
            <div class="row"><div><div class="row-title">Evidence packet</div><div class="row-sub">Customer proof packet for readiness, access review, audit, API inventory, scanner exposure, key exposure response, release, and monitoring.</div></div><a class="tag good" href="/app/evidence">open</a></div>
          </div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Dashboard</span>
          <h2>Dashboard functions</h2>
          <p>The dashboard is the daily control center. It brings runtime posture, organization access, evidence, provider-key risk, project health, API-key coverage, material readiness, and traffic outcome charts into one place.</p>
          <div class="list">
            <div class="row"><div><div class="row-title">Control center header</div><div class="row-sub">Shows provider families, active key slots, material readiness, traffic mix, and project coverage without duplicating sidebar navigation.</div></div><a class="tag good" href="/app/dashboard">dashboard</a></div>
            <div class="row"><div><div class="row-title">Overview tab</div><div class="row-sub">Shows production runtime status, project count, member count, 30-day calls, provider material donut, traffic outcome bar, project coverage, and provider usage.</div></div><span class="tag good">daily check</span></div>
            <div class="row"><div><div class="row-title">Key Map tab</div><div class="row-sub">Groups API key slots by provider with recent calls, denied requests, material readiness, and organization coverage.</div></div><span class="tag good">key map</span></div>
            <div class="row"><div><div class="row-title">Security tab</div><div class="row-sub">Groups runtime controls, evidence posture, caller-lock policy, provider slots, and runbook coverage for security review.</div></div><span class="tag good">security</span></div>
            <div class="row"><div><div class="row-title">Access tab</div><div class="row-sub">Summarizes membership, SSO, alerts, and the setup access checklist before inviting a broader business team.</div></div><span class="tag good">access</span></div>
            <div class="row"><div><div class="row-title">Operations tab</div><div class="row-sub">Shows project health, runtime activity, recent audit events, and attention signals from provider-key overview data.</div></div><span class="tag good">operations</span></div>
          </div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Catalog</span>
          <h2>Workspace features and functions</h2>
          <p>These are the customer-facing enterprise workspace functions exposed from the dashboard and sidebar.</p>
          <div class="list">
            <div class="row"><div><div class="row-title">Enterprise docs</div><div class="row-sub">Enterprise-only documentation for setup, SSO, provider slots, key exposure response, evidence, runbooks, and operating boundaries.</div></div><a class="tag good" href="/app/docs">open</a></div>
            <div class="row"><div><div class="row-title">Setup guide</div><div class="row-sub">Implementation sequence for mapping environments, connecting SSO, choosing gateways, configuring projects, protecting provider slots, and going live safely.</div></div><a class="tag good" href="/app/setup">open</a></div>
            <div class="row"><div><div class="row-title">Provider slots</div><div class="row-sub">Provider key slots, material mode, protected email API key slots, dry-run request snippets, emergency revoke, rotation review, and key exposure response.</div></div><a class="tag good" href="/app/keys">open</a></div>
            <div class="row"><div><div class="row-title">Projects</div><div class="row-sub">Project inventory, usage, provider slot posture, policy status, and quick links into Control.</div></div><a class="tag good" href="/app/projects">open</a></div>
            <div class="row"><div><div class="row-title">API Inventory</div><div class="row-sub">Metadata-only API catalog with owners, risk, data sensitivity, provider-slot mapping, review status, imports, filtered CSV, review brief, and JSON export.</div></div><a class="tag good" href="/app/inventory">open</a></div>
            <div class="row"><div><div class="row-title">Policy Drift</div><div class="row-sub">Control-gap board for missing provider slots, caller-lock gaps, stale/no traffic, accepted-risk records, compensating controls, expirations, and launch blockers.</div></div><a class="tag good" href="/app/policy">open</a></div>
            <div class="row"><div><div class="row-title">Rollout Manager</div><div class="row-sub">Workload cutover planning with integration mode, app/gateway owners, canary, rollback path, support window, blockers, dry-run snippets, and evidence export.</div></div><a class="tag good" href="/app/rollout">open</a></div>
            <div class="row"><div><div class="row-title">Control</div><div class="row-sub">Project policy, provider allowlists, caller-lock rules, rate limits, upstream restrictions, and secure execution settings.</div></div><a class="tag good" href="/app/control">open</a></div>
            <div class="row"><div><div class="row-title">Activity</div><div class="row-sub">Runtime and proxy events with status codes, latency, provider request IDs, denial details, and attestation summaries.</div></div><a class="tag good" href="/app/activity">open</a></div>
            <div class="row"><div><div class="row-title">Alerts</div><div class="row-sub">Alert destinations, delivery logs, dispatch runs, policy state, and admin test-send workflow.</div></div><a class="tag good" href="/app/alerts">open</a></div>
            <div class="row"><div><div class="row-title">Readiness</div><div class="row-sub">Production gate for control plane, executor, GCP confidential runtime, Cloud KMS path, attestation, replay protection, and origin lock.</div></div><a class="tag good" href="/readiness">open</a></div>
            <div class="row"><div><div class="row-title">Health</div><div class="row-sub">Lightweight control-plane health response for monitoring, edge verification, and operator checks.</div></div><a class="tag good" href="/health">open</a></div>
            <div class="row"><div><div class="row-title">AI Proof Verifier</div><div class="row-sub">Registers external models, verifies submitted proof bundles, and ties evidence to project policy, audit, and runtime posture without VaultProof running the model.</div></div><a class="tag warn" href="/app/verifier">beta</a></div>
            <div class="row"><div><div class="row-title">Org + SSO</div><div class="row-sub">Organization identity, company domain, SSO status, Entra/Supabase SAML rollout, roles, and workspace ownership.</div></div><a class="tag good" href="/app/org">open</a></div>
            <div class="row"><div><div class="row-title">Members</div><div class="row-sub">People, invitations, roles, project assignments, invite create/revoke, and access-review export.</div></div><a class="tag good" href="/app/members">open</a></div>
            <div class="row"><div><div class="row-title">Audit</div><div class="row-sub">Governance and runtime event timeline with search, filters, evidence-friendly event details, and CSV export.</div></div><a class="tag good" href="/app/audit">open</a></div>
            <div class="row"><div><div class="row-title">Evidence packet</div><div class="row-sub">Customer proof packet with readiness, access review, audit links, API inventory, policy drift, rollout, scanner, release, monitoring, and key exposure response summaries.</div></div><a class="tag good" href="/app/evidence">open</a></div>
            <div class="row"><div><div class="row-title">Release evidence</div><div class="row-sub">Customer-safe release proof for build tag, approval, verification status, rollout state, rollback owner/path, and JSON export.</div></div><a class="tag good" href="/app/release">open</a></div>
            <div class="row"><div><div class="row-title">Security review</div><div class="row-sub">Buyer/security/procurement packet with architecture, control coverage, evidence links, open review items, common answers, and copyable briefs.</div></div><a class="tag good" href="/app/security-review">open</a></div>
            <div class="row"><div><div class="row-title">Scanner</div><div class="row-sub">Redacted repository exposure findings, owners, severity, rotation/remediation status, provider-slot hints, and customer-safe scanner evidence JSON.</div></div><a class="tag good" href="/app/scanner">open</a></div>
            <div class="row"><div><div class="row-title">Tester readiness</div><div class="row-sub">Tester roster, login/scenario status, guided session plan, feedback, blockers, and readiness JSON.</div></div><a class="tag good" href="/app/testers">open</a></div>
            <div class="row"><div><div class="row-title">Plans</div><div class="row-sub">Paid-pilot package, capacity envelope, contract guardrails, security boundaries, rollout posture, and customer review links.</div></div><a class="tag good" href="/app/plans">open</a></div>
            <div class="row"><div><div class="row-title">Entitlements</div><div class="row-sub">Contract package, capacity, support tier, renewal owner, billing handoff, amendment log, usage meters, and paid-user guardrails.</div></div><a class="tag good" href="/app/entitlements">open</a></div>
            <div class="row"><div><div class="row-title">Settings</div><div class="row-sub">Tenant defaults, organization identity, SSO state, session notices, and security notices.</div></div><a class="tag good" href="/app/settings">open</a></div>
            <div class="row"><div><div class="row-title">Runbooks</div><div class="row-sub">Operator commands for production verification, evidence, deploy, secret rotation, DNS, edge, SSH hardening, cleanup, and incident response.</div></div><a class="tag good" href="/app/runbooks">open</a></div>
          </div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Exports</span>
          <h2>Dashboard exports and evidence functions</h2>
          <p>The dashboard points operators to evidence exports that are safe for customer security review. These exports must not include provider keys, service-role keys, OAuth secrets, SAML material, request bodies, response bodies, or customer payloads.</p>
          <ul>
            <li><code>/api/v1/enterprise/audit?format=csv&amp;days=30</code> exports the last 30 days of governance and runtime audit evidence.</li>
            <li><code>/api/v1/enterprise/members/access-review?format=csv</code> exports members, roles, and project access for access review.</li>
            <li><code>vaultproof_enterprise_evidence_packet</code> summarizes readiness, launch posture, identity proof, key rotation, exposure response, API inventory, policy drift, rollout, scanner, release, testers, entitlements, onboarding, and monitoring.</li>
            <li><code>vaultproof_enterprise_key_exposure_response</code> documents linked scanner findings, provider-slot containment, emergency revoke path, rotation scope, proof boundary, and incident response steps.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Incident response</span>
          <h2>Key exposure response</h2>
          <p>Key exposure response is the enterprise incident workflow for a suspected provider API key leak. It lives on <code>/app/keys</code> because Provider Slots are where VaultProof can pause, revoke, rotate, and prove protected provider access.</p>
          <p>Use it when a scanner finding, platform incident, exposed environment variable, copied credential, or customer security report says a provider key may have escaped its intended boundary.</p>
          <h3>What it does</h3>
          <ul>
            <li>Links redacted scanner findings from <code>/app/scanner</code> to matching provider slots.</li>
            <li>Shows which provider slots are affected and whether each slot is live-sealed, unready, missing rotation, or ready to contain.</li>
            <li>Flags high-risk states such as <code>scanner_open_exposure</code>, <code>needs_rotation</code>, <code>review_activity</code>, and <code>needs_usage_evidence</code>.</li>
            <li>Gives owners an emergency revoke path for VaultProof-routed provider-slot usage.</li>
            <li>Creates a customer-safe incident JSON packet and brief without raw keys, bearer tokens, OAuth secrets, encrypted shares, request bodies, responses, or customer payloads.</li>
            <li>Feeds Evidence, Security Review, Support, and Runbooks so the customer can see what was contained and what still needs work.</li>
          </ul>
          <h3>What it does not do</h3>
          <ul>
            <li>It does not automatically rotate a key at the upstream provider.</li>
            <li>It does not prove direct raw-key use that bypassed VaultProof.</li>
            <li>It does not store raw scanner output, repositories, provider API keys, tokens, or customer payloads.</li>
            <li>It does not remove old secrets from customer platforms such as CI variables, hosting environment variables, local <code>.env</code> files, or chat/ticket history.</li>
          </ul>
          <div class="doc-note"><strong>Boundary:</strong> VaultProof can immediately disable or audit traffic routed through VaultProof. Any same raw key still living outside VaultProof must be rotated upstream and removed from the customer environment.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Operator order</span>
          <h2>Exposure response sequence</h2>
          <ol>
            <li>Open <code>/app/scanner</code> and record only redacted finding metadata: repository, branch/ref, secret family, severity, owner, provider-slot hint, evidence reference, and remediation note.</li>
            <li>Open <code>/app/keys</code> and review the Key exposure response panel for linked scanner findings and affected provider slots.</li>
            <li>Emergency revoke affected provider slots first when VaultProof-routed use should pause immediately.</li>
            <li>Rotate the upstream provider credential in the provider account, then seal the replacement into a live VaultProof provider slot.</li>
            <li>Run a dry-run or low-volume test request so Activity and Audit show post-rotation evidence.</li>
            <li>Update linked scanner findings only after revoke, upstream rotation, false-positive review, or explicit pilot-limited acceptance.</li>
            <li>Export the incident JSON, audit CSV, and Evidence packet for customer security review.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">SSO and access</span>
          <h2>Enterprise SSO docs</h2>
          <p>Customer SSO setup starts in <code>admin.vaultproof.dev</code>, then customers sign in at <code>enterprise.vaultproof.dev/app/login</code>. VaultProof stores safe rollout metadata such as company domain, provider name, login mode, and status. SAML XML, certificates, IdP private material, OAuth client secrets, and Supabase service-role keys stay out of the browser forms.</p>
          <ul>
            <li>Use <code>/app/org</code> for customer-visible organization and SSO status.</li>
            <li>Use the internal admin business detail page to set company domain, provider, rollout status, and to run the Supabase SAML broker check.</li>
            <li>Use Supabase SAML configuration to register the customer IdP metadata URL or XML.</li>
            <li>Keep a documented break-glass admin path before enforcing SSO-first access.</li>
          </ul>
        </article>
      </section>

      <section id="setupPanel" class="doc-guide" style="display:none">
        <article class="doc-section">
          <span class="doc-kicker">Read first</span>
          <h2>Start here</h2>
          <p>VaultProof setup is not just a button click. In a large enterprise, the hard part is deciding which teams, apps, provider keys, environments, gateways, and security owners should be allowed to use protected provider access.</p>
          <p>Use this page like an implementation document. Work through it from top to bottom, then return to the dashboard pages when you are ready to configure the live account.</p>
          <ol>
            <li>Confirm the workspace and readiness status.</li>
            <li>Map environments, apps, owners, providers, and sensitive flows.</li>
            <li>Connect identity and assign least-privilege access.</li>
            <li>Choose the gateway and network pattern.</li>
            <li>Create projects, provider slots, caller-lock rules, and rate limits.</li>
            <li>Validate with dry-run traffic before real provider calls.</li>
            <li>Export evidence, test alerts, and launch one workload at a time.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Live status</span>
          <h2>Current workspace status</h2>
          <p>These values come from the selected organization and the live confidential runtime. If something looks wrong, select the correct organization and refresh before changing policy.</p>
          <div id="setupStatusList" class="list"></div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Before setup</span>
          <h2>What your team should prepare</h2>
          <p>Gather this before production configuration. It saves a lot of rework later, especially when security, identity, app teams, and network teams are all involved.</p>
          <ul>
            <li>Business owner, security owner, identity owner, network owner, developer owner, and incident contact.</li>
            <li>Production, staging, development, sandbox, regional, subsidiary, and regulated environment list.</li>
            <li>Provider inventory: provider name, account, API family, current key location, owner, rotation date, and leak blast radius.</li>
            <li>Compliance needs: SOC 2 evidence, access reviews, audit exports, retention requirements, and customer-specific proof.</li>
            <li>Gateway preference: VaultProof-managed edge, customer-managed gateway, mTLS gateway, device gateway, or direct trusted edge path.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 1</span>
          <h2>Map your enterprise environment</h2>
          <p>Create VaultProof projects around real business and security boundaries. Do not put unrelated production and development apps into the same project just because they use the same provider.</p>
          <h3>For each workload, write down:</h3>
          <ul>
            <li>Environment, application name, business purpose, and owning team.</li>
            <li>Calling origin, gateway marker, CIDR, device fleet, or mTLS identity.</li>
            <li>Allowed provider, upstream host, HTTP methods, and path prefixes.</li>
            <li>Expected request volume, rate-limit needs, and incident priority.</li>
            <li>Whether the flow handles regulated, financial, customer, production automation, or other sensitive data.</li>
          </ul>
          <div class="doc-note"><strong>Rule of thumb:</strong> if two workloads need different owners, approval flows, provider keys, rate limits, or audit reviews, they should usually be separate projects.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 2</span>
          <h2>Configure identity and access</h2>
          <p>Use company identity for enterprise access. VaultProof currently supports Microsoft Entra ID through the Supabase SAML session path, while VaultProof still enforces organization membership, project permissions, caller lock, and execution policy.</p>
          <ul>
            <li>Owners approve the organization, admins, SSO rollout, and go-live timing.</li>
            <li>Admins manage projects, members, provider slots, and policy.</li>
            <li>Security reviewers inspect readiness, audit, access reviews, alerts, and evidence.</li>
            <li>Developers and operators configure project rules and troubleshoot runtime activity.</li>
            <li>Viewers can inspect posture without changing policy.</li>
          </ul>
          <p>Use access-review exports before rollout, after major org changes, and on a recurring schedule. Keep a documented break-glass admin path outside normal SSO changes.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 3</span>
          <h2>Choose the gateway and network pattern</h2>
          <p>The gateway pattern decides which system is trusted to identify callers before VaultProof signs secure execution requests.</p>
          <h3>VaultProof-managed gateway</h3>
          <p>Fastest path. Customer apps call <code>enterprise.vaultproof.dev</code>, and VaultProof manages GCP edge controls, coarse rate limits, origin lock, request-size guards, and telemetry.</p>
          <h3>Customer-managed gateway</h3>
          <p>Use this when the customer requires all SaaS or API traffic through their own API gateway. The customer gateway validates identity, device, subscription, or mTLS policy first, then forwards trusted caller-lock headers to VaultProof.</p>
          <h3>mTLS or device gateway</h3>
          <p>Use this for server, device, IoT, or fleet traffic. Caller lock can use certificate thumbprints, certificate subject fragments, device identity hashes, fleet IDs, firmware versions, CIDRs, and gateway markers.</p>
          <div class="doc-note"><strong>Later hardening:</strong> plan TLS-origin cutover, gateway cutover, private-origin migration, and rollback during a controlled change window after the basic production path is stable.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 4</span>
          <h2>Configure projects, provider slots, and policy</h2>
          <p>Projects define who can use protected provider access and under what rules. Provider slots hold the protected provider connection state. Policy decides which callers and upstream requests are allowed.</p>
          <ul>
            <li>Allow only the provider families each project needs.</li>
            <li>Bind execution to approved origins, gateways, CIDRs, devices, fleets, firmware versions, mTLS identities, methods, hosts, and paths.</li>
            <li>Set expected request volume before production so rate limits reduce blast radius from bugs, leaked client tokens, or compromised apps.</li>
            <li>Give each provider slot an owner, purpose, rotation date, and emergency revoke path.</li>
          </ul>
          <p>Provider keys should not be visible in the dashboard. Enterprise execution reconstructs provider key material only inside confidential execution memory and zeroes plaintext after use.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 5</span>
          <h2>Validate with dry-run traffic</h2>
          <p>Dry-run first. Before real provider calls, use dry-run or validate-only execution to prove auth, organization access, project policy, caller lock, request signing, executor reachability, and audit metadata.</p>
          <p>Dry-run is successful when the request is accepted by policy, audit metadata is written, the secure executor is reachable, and provider dispatch is intentionally skipped.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 6</span>
          <h2>Evidence, alerts, and compliance</h2>
          <p>Enterprise security teams need proof, not promises. Before go-live, confirm production readiness, audit CSV export, access-review CSV export, alert delivery, and attestation evidence.</p>
          <ul>
            <li>Use <code>/readiness</code> to confirm GCP edge, control plane, executor, attestation, Cloud KMS posture, replay protection, and origin lock.</li>
            <li>Use Audit for governance/runtime events and evidence-friendly CSV export.</li>
            <li>Use Members for access-review export.</li>
            <li>Configure alert destinations and send a test alert.</li>
            <li>Decide who receives key leak, emergency revoke, readiness drift, denial spike, provider error, and runtime availability notifications.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 7</span>
          <h2>Go live gradually</h2>
          <p>Do not move every app at once. Start with one low-risk production workload, one provider path, and a known traffic volume.</p>
          <ol>
            <li>Confirm readiness is production-ready.</li>
            <li>Confirm SSO/admin access works.</li>
            <li>Confirm provider slot and policy are locked.</li>
            <li>Send low-volume traffic.</li>
            <li>Watch Activity, Audit, Alerts, readiness, provider denials, and provider errors.</li>
            <li>Expand by project only after the first workload is stable.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Reference</span>
          <h2>Pages used during setup</h2>
          <p>Use these pages when the document tells you to configure or verify a specific area.</p>
          <div id="setupReferenceList" class="list"></div>
        </article>
      </section>

      <section id="technicalGuidePanel" class="doc-guide" style="display:none">
        <article class="doc-section">
          <span class="doc-kicker">Audience</span>
          <h2>Who should use this guide</h2>
          <p>This guide is for the people who need to connect VaultProof to a real enterprise environment: identity admins, network teams, platform engineers, app owners, security reviewers, compliance owners, and incident responders.</p>
          <p>The setup guide explains what to do in order. This technical guide explains why each part exists, what system owns it, what data crosses the boundary, and what questions technical teams usually ask before approving production traffic.</p>
          <div class="doc-note"><strong>Keep the setup page simple:</strong> use this page when someone asks for architecture, trust boundaries, identity flow, gateway behavior, key custody, attestation, audit evidence, or troubleshooting details.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Architecture</span>
          <h2>Architecture at a glance</h2>
          <p>VaultProof Enterprise separates the customer-facing control plane from the secure execution path. The control plane handles organization access, projects, policies, members, audit, alerts, and dashboards. The executor handles protected provider calls and key release inside the GCP confidential runtime.</p>
          <ol>
            <li>A user signs in to the enterprise dashboard and receives an enterprise session.</li>
            <li>The dashboard calls only <code>/api/v1/enterprise/*</code> APIs on the enterprise control plane.</li>
            <li>The control plane checks organization membership, project access, policy state, and request signing rules.</li>
            <li>Approved execution requests are sent to the secure executor over the internal enterprise path.</li>
            <li>The executor verifies the request signature, replay protection, caller-lock metadata, attestation posture, and key-release readiness.</li>
            <li>Provider key material is protected through the configured Cloud KMS path and is used inside the confidential runtime.</li>
            <li>Governance, runtime, alerts, readiness, and evidence events are recorded for review and export.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Identity</span>
          <h2>Identity and authorization model</h2>
          <p>Enterprise users should use company identity. Today the customer-facing path is Microsoft Entra ID SSO through Supabase SAML session brokering. Supabase provides the browser session and JWT validation surface; VaultProof still controls organization membership, project roles, audit events, and policy enforcement.</p>
          <h3>What Entra ID owns</h3>
          <ul>
            <li>Corporate user identity, MFA, conditional access, device posture, and identity lifecycle.</li>
            <li>Who can use the customer enterprise app, based on the customer identity team policy.</li>
            <li>SAML assertions sent into the brokered session path.</li>
          </ul>
          <h3>What VaultProof owns</h3>
          <ul>
            <li>Organization membership, project-level access, dashboard authorization, and audit records.</li>
            <li>Role model for owners, admins, security reviewers, developers/operators, and viewers.</li>
            <li>Caller-lock policy, provider-slot policy, rate limits, evidence exports, and emergency revoke actions.</li>
          </ul>
          <p>This means a user can authenticate successfully but still be blocked if they are not a member of the VaultProof organization or do not have access to the requested project.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Network</span>
          <h2>Gateway and network patterns</h2>
          <p>The gateway identifies the caller before VaultProof allows protected provider access. A customer can start with the VaultProof-managed path and later move to a customer-managed gateway, mTLS, device gateway, or private-origin pattern.</p>
          <h3>VaultProof-managed GCP edge/gateway</h3>
          <p>Good for fast pilots and standard SaaS rollout. VaultProof manages edge routing, health checks, origin lock, coarse rate limiting, request-size controls, telemetry, and rollback steps.</p>
          <h3>Customer-managed API gateway</h3>
          <p>Good when the business requires every API to pass through its own gateway. The customer gateway validates subscriptions, Entra JWTs, private network controls, mTLS, device policy, and customer rate limits before forwarding trusted caller-lock headers to VaultProof.</p>
          <h3>mTLS, device, and fleet gateways</h3>
          <p>Good for servers, devices, IoT, or internal agents. Caller lock can bind policy to certificate thumbprints, certificate subjects, device IDs, firmware versions, fleet IDs, CIDRs, and gateway markers.</p>
          <h3>Private origin path</h3>
          <p>Use this for a hardened production phase after the basic path is stable. The target state is to remove public origin exposure, keep GCP edge/gateway as the allowed ingress, and maintain a separate break-glass operations path.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Projects</span>
          <h2>Project modeling and environment boundaries</h2>
          <p>Projects should match security and ownership boundaries, not just product names. Separate projects are usually better when workloads have different owners, environments, provider accounts, compliance needs, rate limits, or incident response owners.</p>
          <ul>
            <li>Separate production, staging, development, sandbox, regulated, regional, and subsidiary workloads when they have different risk.</li>
            <li>Use one project for one clear business purpose and one owner group.</li>
            <li>Assign project members by least privilege, then use access-review exports before and after launch.</li>
            <li>Keep provider slots scoped to the exact project that needs them.</li>
          </ul>
          <p>A strong project model makes incident response easier because VaultProof can show which caller, project, provider slot, and policy allowed or blocked the traffic.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Key custody</span>
          <h2>Provider key custody and Cloud KMS</h2>
          <p>VaultProof is designed so raw provider keys do not sit in customer app code, environment variables, browser storage, logs, or ordinary dashboard views. The enterprise executor uses GCP confidential computing and Cloud KMS so protected material is only released to the expected measured runtime.</p>
          <ul>
            <li>The GCP confidential VM reports attestation evidence through GCP attestation.</li>
            <li>The key-release policy binds release to measured runtime attributes and policy hash.</li>
            <li>The executor verifies request signatures and replay protection before using protected material.</li>
            <li>Plaintext provider material is kept inside the execution process and cleared after use.</li>
            <li>Provider slots track owner, purpose, rotation state, and emergency revoke posture.</li>
          </ul>
          <div class="doc-note"><strong>Important:</strong> key release readiness is not the same as business approval. Technical readiness proves the runtime can release securely; organization policy still decides whether a project is allowed to use a provider.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Policy</span>
          <h2>Caller lock and execution policy</h2>
          <p>Caller lock is the set of facts that prove the request came through the expected application, gateway, network, device, or certificate path. Execution policy is the rule set that decides what provider access is allowed after identity and caller lock pass.</p>
          <h3>Common caller-lock inputs</h3>
          <ul>
            <li>Allowed origins, gateway headers, gateway markers, CIDRs, mTLS certificate thumbprints, device IDs, fleet IDs, firmware versions, and service identities.</li>
            <li>Allowed upstream hosts, path prefixes, HTTP methods, provider families, and rate limits.</li>
            <li>Required dry-run mode during validation and launch windows.</li>
          </ul>
          <p>The goal is simple: a stolen app token or leaked browser session should not be enough to use a protected provider key from the wrong network, origin, device, gateway, or project.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Evidence</span>
          <h2>Evidence, logs, exports, and audit</h2>
          <p>Enterprise teams need evidence for security reviews, incident response, customer questionnaires, and compliance handoff. VaultProof records both governance events and runtime events so teams can answer who changed access, what policy applied, which provider slot was used, and whether the confidential runtime was production-ready.</p>
          <ul>
            <li><code>/readiness</code> proves current production posture for control plane and executor.</li>
            <li>Audit CSV exports governance/runtime events for compliance review.</li>
            <li>Access-review CSV exports members, roles, and project assignments.</li>
            <li>Activity shows runtime status codes, provider request IDs, denial reasons, latency, and attestation summaries.</li>
            <li>Runbooks capture evidence bundles and validate them before handoff.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Operations</span>
          <h2>Alerts and incident response</h2>
          <p>Alerts should go to teams that can act quickly. A useful launch setup usually includes security operations, platform operations, app owners, and an incident commander path.</p>
          <ul>
            <li>Send test alerts before go-live and after changing alert destinations.</li>
            <li>Alert on key leak reports, emergency revoke, readiness drift, denial spikes, provider errors, execution failures, and unusual traffic volume.</li>
            <li>Use emergency revoke when a provider key, project, or caller path is suspected to be unsafe.</li>
            <li>Use audit and activity together: audit explains governance changes; activity explains runtime behavior.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Rollout</span>
          <h2>Rollout and validation flow</h2>
          <ol>
            <li>Confirm the organization, SSO path, break-glass path, and project owner.</li>
            <li>Create the project, provider slot, caller lock, allowlisted upstreams, and rate limits.</li>
            <li>Run dry-run execution until auth, policy, signing, executor reachability, and audit metadata pass.</li>
            <li>Verify production readiness, evidence export, access review export, and alert delivery.</li>
            <li>Send low-volume production traffic for one workload and one provider path.</li>
            <li>Watch Activity, Alerts, Audit, provider errors, denials, and readiness.</li>
            <li>Expand project by project after the first workload is stable.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Troubleshooting</span>
          <h2>Troubleshooting map</h2>
          <h3>User cannot sign in</h3>
          <p>Check Entra assignment, Supabase SAML configuration, invite status, organization membership, browser session storage, and whether the user is on the expected enterprise hostname.</p>
          <h3>User can sign in but sees no data</h3>
          <p>Check organization membership, active organization selection, project assignments, role level, and API auth errors in the browser network tab.</p>
          <h3>Dry-run fails</h3>
          <p>Check bearer token, selected organization, project role, caller-lock inputs, provider allowlist, upstream method/host/path, request signature, and executor reachability.</p>
          <h3>Readiness is not production-ready</h3>
          <p>Open <code>/readiness</code>, then use Runbooks for verifier, evidence, key-release, attestation, DNS, edge, SSH, and origin-lock checks.</p>
          <h3>GCP edge returns 503 or 504</h3>
          <p>Check origin host, port, protocol, health probe path, NSG rules, UFW rules, nginx/systemd service status, and whether the origin allows GCP edge traffic.</p>
          <h3>Provider call is denied</h3>
          <p>Check caller-lock mismatch, project policy, rate limit, provider slot state, emergency revoke status, and audit/activity denial details.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Checklist</span>
          <h2>Integration questions for technical review</h2>
          <ul>
            <li>Which Entra tenant, enterprise app, groups, MFA, and conditional access rules govern VaultProof users?</li>
            <li>Which apps, environments, regions, subsidiaries, and provider accounts are in scope for the first rollout?</li>
            <li>Which gateway pattern is required: VaultProof-managed, customer gateway, mTLS, device gateway, private origin, or hybrid?</li>
            <li>Which caller-lock facts can the customer reliably provide and monitor?</li>
            <li>Which provider keys move first, who owns them, and what is the emergency revoke path?</li>
            <li>Which evidence exports are required for security, audit, legal, procurement, and customer trust teams?</li>
            <li>Who receives alerts and who has authority to pause or revoke traffic?</li>
            <li>What is the rollback plan if SSO, gateway routing, DNS, or provider execution breaks?</li>
          </ul>
        </article>
      </section>

      <section id="securityReviewPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Review readiness</h2><span id="securityReviewMeta" class="mini">customer-safe</span></div>
          <div id="securityReviewStatusList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Control coverage</h2><span class="mini">what is protected</span></div>
          <div id="securityReviewControlList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Evidence map</h2><span class="mini">where to verify</span></div>
          <div id="securityReviewEvidenceList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Open review items</h2><span id="securityReviewOpenMeta" class="mini">before paid pilot</span></div>
          <form id="securityReviewOpenFilterForm" class="review-filters">
            <input id="securityReviewOpenSearch" type="search" placeholder="Search blockers, limitations, controls..." />
            <select id="securityReviewOpenType" aria-label="Open review item type">
              <option value="">all open items</option>
              <option value="blocker">blockers</option>
              <option value="review">review items</option>
              <option value="known_limitation">known limitations</option>
            </select>
            <button id="clearSecurityReviewFilters" type="button">clear</button>
          </form>
          <div id="securityReviewOpenList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable security review packet</h2>
            <div class="evidence-actions">
              <button id="copySecurityReviewBriefBtn" type="button">copy review brief</button>
              <button id="copySecurityReviewBtn" type="button">copy packet</button>
            </div>
          </div>
          <textarea id="securityReviewBrief" class="brief-box demo-script" readonly aria-label="Security review packet"></textarea>
        </div>
      </section>

      <section id="settingsPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Organization defaults</h2><span id="settingsMeta" class="mini"></span></div><div id="settingsList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Security notices</h2><span class="mini">enterprise safe</span></div><div id="securityList" class="list"></div></div>
      </section>

      <section id="entitlementsPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Contract intake</h2><span id="entitlementsMeta" class="mini">browser-local</span></div>
          <form id="entitlementsForm" class="entitlement-form">
            <div class="entitlement-field"><label for="entitlementPackage">package</label><select id="entitlementPackage" data-entitlement-field="package_label"><option value="Enterprise paid pilot">Enterprise paid pilot</option><option value="Enterprise standard">Enterprise standard</option><option value="Regulated enterprise">Regulated enterprise</option><option value="Expansion account">Expansion account</option></select></div>
            <div class="entitlement-field"><label for="entitlementStatus">contract status</label><select id="entitlementStatus" data-entitlement-field="contract_status"><option value="draft">draft</option><option value="accepted_demo">accepted for pilot</option><option value="signed">signed</option><option value="active">active</option><option value="blocked">blocked</option></select></div>
            <div class="entitlement-field"><label for="entitlementCalls">monthly calls</label><input id="entitlementCalls" data-entitlement-field="monthly_call_allowance" inputmode="numeric" placeholder="100000" /></div>
            <div class="entitlement-field"><label for="entitlementSlots">provider slots</label><input id="entitlementSlots" data-entitlement-field="provider_slot_allowance" inputmode="numeric" placeholder="3" /></div>
            <div class="entitlement-field"><label for="entitlementSeats">seats</label><input id="entitlementSeats" data-entitlement-field="seat_allowance" inputmode="numeric" placeholder="10" /></div>
            <div class="entitlement-field"><label for="entitlementSupport">support tier</label><select id="entitlementSupport" data-entitlement-field="support_tier"><option value="founder-led launch-week support">founder-led launch-week support</option><option value="standard business-hours support">standard business-hours support</option><option value="dedicated launch support">dedicated launch support</option><option value="dedicated enterprise support">dedicated enterprise support</option></select></div>
            <div class="entitlement-field"><label for="entitlementIr">incident response</label><select id="entitlementIr" data-entitlement-field="incident_response_add_on"><option value="optional add-on">optional add-on</option><option value="included">24-hour response included</option><option value="customer-owned">customer-owned response team</option></select></div>
            <div class="entitlement-field"><label for="entitlementRuntime">runtime</label><select id="entitlementRuntime" data-entitlement-field="runtime_label"><option value="shared confidential runtime">shared confidential runtime</option><option value="dedicated confidential runtime">dedicated confidential runtime</option><option value="customer-managed gateway plus shared runtime">customer-managed gateway plus shared runtime</option></select></div>
            <div class="entitlement-field"><label for="entitlementRenewal">renewal/review date</label><input id="entitlementRenewal" data-entitlement-field="renewal_date" placeholder="2026-06-30" /></div>
            <div class="entitlement-field"><label for="entitlementBillingOwner">billing owner</label><input id="entitlementBillingOwner" data-entitlement-field="billing_owner" placeholder="finance or buyer owner" /></div>
            <div class="entitlement-field"><label for="entitlementSuccessOwner">success owner</label><input id="entitlementSuccessOwner" data-entitlement-field="success_owner" placeholder="customer success owner" /></div>
            <div class="entitlement-field"><label for="entitlementRetention">retention</label><input id="entitlementRetention" data-entitlement-field="retention_label" placeholder="30-day audit export during pilot" /></div>
            <div class="entitlement-field wide"><label for="entitlementNotes">customer-safe note</label><textarea id="entitlementNotes" data-entitlement-field="customer_note" placeholder="Contract note, expansion condition, or capacity exception. Do not paste tokens, provider keys, service-role credentials, request bodies, or customer payloads."></textarea></div>
          </form>
        </div>
        <div class="card">
          <div class="section-title"><h2>Paid-user readiness</h2><span id="entitlementsStatusMeta" class="mini">contract review</span></div>
          <div id="entitlementsSummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Capacity envelope</h2><span class="mini">observed vs contract</span></div>
          <div id="entitlementsCapacityList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Commercial handoff</h2><span id="entitlementsBillingMeta" class="mini">billing review</span></div>
          <form id="entitlementsBillingForm" class="entitlement-form">
            <div class="entitlement-field"><label for="entitlementInvoiceStatus">invoice status</label><select id="entitlementInvoiceStatus" data-entitlement-field="invoice_status"><option value="not_started">not started</option><option value="quote_sent">quote sent</option><option value="po_pending">PO pending</option><option value="invoice_ready">invoice ready</option><option value="paid">paid</option><option value="blocked">blocked</option></select></div>
            <div class="entitlement-field"><label for="entitlementPoStatus">PO status</label><select id="entitlementPoStatus" data-entitlement-field="purchase_order_status"><option value="not_required">not required</option><option value="requested">requested</option><option value="received">received</option><option value="blocked">blocked</option></select></div>
            <div class="entitlement-field"><label for="entitlementProcurementOwner">procurement owner</label><input id="entitlementProcurementOwner" data-entitlement-field="procurement_owner" placeholder="buyer, finance, or procurement owner" /></div>
            <div class="entitlement-field"><label for="entitlementPaymentTerms">payment terms</label><input id="entitlementPaymentTerms" data-entitlement-field="payment_terms" placeholder="Net 30 after pilot acceptance" /></div>
            <div class="entitlement-field"><label for="entitlementExpansionReview">expansion review</label><input id="entitlementExpansionReview" data-entitlement-field="expansion_review_date" placeholder="2026-07-15" /></div>
            <div class="entitlement-field wide"><label for="entitlementBillingNote">billing-safe note</label><textarea id="entitlementBillingNote" data-entitlement-field="billing_note" placeholder="PO, invoice, procurement, or expansion note. Do not paste card numbers, bank data, tokens, secrets, request bodies, or customer payloads."></textarea></div>
          </form>
          <div id="entitlementsBillingList" class="list" style="margin-top:14px"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Amendment and renewal log</h2><span id="entitlementsRenewalMeta" class="mini">renewal watch</span></div>
          <form id="entitlementAmendmentForm" class="entitlement-form">
            <div class="entitlement-field"><label for="entitlementAmendmentType">change type</label><select id="entitlementAmendmentType"><option value="allowance_change">allowance change</option><option value="commercial_change">commercial change</option><option value="support_change">support change</option><option value="renewal_review">renewal review</option><option value="risk_acceptance">risk acceptance</option><option value="other">other</option></select></div>
            <div class="entitlement-field"><label for="entitlementAmendmentStatus">status</label><select id="entitlementAmendmentStatus"><option value="proposed">proposed</option><option value="approved">approved</option><option value="active">active</option><option value="blocked">blocked</option></select></div>
            <div class="entitlement-field"><label for="entitlementAmendmentEffective">effective date</label><input id="entitlementAmendmentEffective" placeholder="2026-07-01" /></div>
            <div class="entitlement-field"><label for="entitlementAmendmentOwner">owner</label><input id="entitlementAmendmentOwner" placeholder="billing, success, or buyer owner" /></div>
            <div class="entitlement-field wide"><label for="entitlementAmendmentNote">customer-safe note</label><textarea id="entitlementAmendmentNote" placeholder="Allowance change, renewal decision, support term, or blocker. Do not paste card numbers, bank data, tokens, secrets, request bodies, or customer payloads."></textarea></div>
            <div class="entitlement-field wide"><button id="addEntitlementAmendmentBtn" class="primary" type="submit">add amendment</button></div>
          </form>
          <div id="entitlementsRenewalList" class="list" style="margin-top:14px"></div>
          <div id="entitlementAmendmentList" class="list" style="margin-top:14px"></div>
        </div>
        <div class="card">
          <div class="section-title">
            <h2>Usage guardrails</h2>
            <button id="copyEntitlementsCapacityBriefBtn" type="button">copy capacity brief</button>
          </div>
          <div id="entitlementsUsageMeterList" class="entitlement-meter-list"></div>
          <div id="entitlementsUsageGuardrailList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Contract guardrails</h2><span class="mini">paid customer</span></div>
          <div id="entitlementsGuardrailList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Handoff path</h2><span class="mini">customer success</span></div>
          <div id="entitlementsHandoffList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Entitlements JSON</h2>
            <button id="copyEntitlementsJsonBtn" type="button">copy entitlements JSON</button>
          </div>
          <textarea id="entitlementsPacket" class="brief-box" readonly aria-label="Entitlements JSON"></textarea>
        </div>
      </section>

      <section id="onboardingPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Customer activation</h2><span id="onboardingMeta" class="mini">hold</span></div>
          <div id="onboardingSummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Owner handoff</h2><span class="mini">paid customer</span></div>
          <div id="onboardingHandoffList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Activation milestones</h2><span class="mini">saved in this browser</span></div>
          <div id="onboardingMilestoneList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Role task checklist</h2>
            <div class="evidence-actions">
              <span id="onboardingTaskMeta" class="mini">customer owners</span>
              <button id="copyOnboardingTaskBriefBtn" type="button">copy task brief</button>
            </div>
          </div>
          <div id="onboardingTaskList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Evidence path</h2><span class="mini">customer testing</span></div>
          <div id="onboardingEvidenceList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Onboarding JSON</h2><button id="copyOnboardingJsonBtn" type="button">copy onboarding JSON</button></div>
          <textarea id="onboardingPacket" class="brief-box" readonly aria-label="Onboarding JSON"></textarea>
        </div>
      </section>

      <section id="plansPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Rollout package</h2><span id="planMeta" class="mini"></span></div><div id="planList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Commercial package</h2><span class="mini">paid pilot</span></div><div id="commercialList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Contract guardrails</h2><span class="mini">evidence pack</span></div><div id="guardrailList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Buyer review path</h2><span class="mini">proof workflow</span></div><div id="buyerReviewList" class="list"></div></div>
      </section>

      ${pageName === 'pilot' ? `
      <section id="pilotPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Pilot scope</h2><span id="pilotMeta" class="mini">browser-local</span></div>
          <form id="pilotProposalForm" class="list">
            <input id="pilotWorkload" data-pilot-field="workload" placeholder="First workload" />
            <input id="pilotProvider" data-pilot-field="provider_path" placeholder="Provider path" />
            <input id="pilotOwner" data-pilot-field="owner_group" placeholder="Owner group" />
            <input id="pilotMonthlyCalls" data-pilot-field="monthly_calls" inputmode="numeric" placeholder="Expected monthly calls" />
            <input id="pilotPrice" data-pilot-field="monthly_price_usd" inputmode="numeric" placeholder="Monthly pilot price" />
            <select id="pilotSupportTier" data-pilot-field="support_tier" aria-label="Support tier">
              <option value="founder-led launch-week support">founder-led launch-week support</option>
              <option value="standard business-hours support">standard business-hours support</option>
              <option value="dedicated launch support">dedicated launch support</option>
            </select>
            <select id="pilotIrAddon" data-pilot-field="incident_response_add_on" aria-label="Incident response add-on">
              <option value="optional add-on">24-hour incident response optional</option>
              <option value="included for pilot">24-hour incident response included</option>
              <option value="customer-owned">customer incident-response team owns 24-hour coverage</option>
            </select>
            <input id="pilotStartWindow" data-pilot-field="start_window" placeholder="Start window" />
            <textarea id="pilotSuccessMetric" data-pilot-field="success_metric" placeholder="Success metric"></textarea>
          </form>
        </div>
        <div class="card">
          <div class="section-title"><h2>Commercial summary</h2><span class="mini">sellable package</span></div>
          <div id="pilotCommercialList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Guardrails</h2><span class="mini">before traffic</span></div>
          <div id="pilotGuardrailList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Close checklist</h2><span class="mini">next buyer step</span></div>
          <div id="pilotCloseList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable customer proposal</h2>
            <button id="copyPilotProposalBtn" type="button">copy proposal</button>
          </div>
          <textarea id="pilotProposalBrief" class="brief-box demo-script" readonly aria-label="Customer proposal"></textarea>
        </div>
      </section>
      ` : '<section id="pilotPanel" class="grid two" style="display:none"></section>'}

      ${pageName === 'pilot-success' ? `
      <section id="pilotSuccessPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Success posture</h2><span id="pilotSuccessMeta" class="mini">customer pilot</span></div>
          <div id="pilotSuccessStatusList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Evidence path</h2><span class="mini">proof links</span></div>
          <div id="pilotSuccessEvidenceList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Success milestones</h2><span class="mini">saved in this browser</span></div>
          <div id="pilotSuccessMilestoneList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Expansion decision</h2>
            <div class="evidence-actions">
              <span id="pilotSuccessDecisionMeta" class="mini">not ready</span>
              <button id="copyPilotSuccessDecisionBtn" type="button">copy decision brief</button>
            </div>
          </div>
          <form id="pilotSuccessDecisionForm" class="pilot-success-form">
            <div class="pilot-success-field"><label for="pilotSuccessDecisionStatus">decision</label><select id="pilotSuccessDecisionStatus" data-pilot-success-decision-field="decision_status"><option value="not_ready">not ready</option><option value="expand">expand</option><option value="hold">hold</option><option value="no_go">no-go</option></select></div>
            <div class="pilot-success-field"><label for="pilotSuccessDecisionPackage">next package/path</label><input id="pilotSuccessDecisionPackage" data-pilot-success-decision-field="next_package" placeholder="Expansion account, standard, regulated, or hold path" /></div>
            <div class="pilot-success-field"><label for="pilotSuccessDecisionOwner">owner</label><input id="pilotSuccessDecisionOwner" data-pilot-success-decision-field="owner" placeholder="customer or VaultProof owner" /></div>
            <div class="pilot-success-field"><label for="pilotSuccessDecisionTarget">target date</label><input id="pilotSuccessDecisionTarget" data-pilot-success-decision-field="target_date" placeholder="2026-06-30" /></div>
            <div class="pilot-success-field wide"><label for="pilotSuccessDecisionNextStep">next step</label><textarea id="pilotSuccessDecisionNextStep" data-pilot-success-decision-field="next_step" placeholder="Expansion action, hold condition, or no-go reason. Metadata only."></textarea></div>
            <div class="pilot-success-field wide"><label for="pilotSuccessDecisionNote">decision note</label><textarea id="pilotSuccessDecisionNote" data-pilot-success-decision-field="note" placeholder="Customer-safe decision note. Do not paste tokens, keys, request bodies, or payloads."></textarea></div>
          </form>
          <div id="pilotSuccessDecisionList" class="list" style="margin-top:14px"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable weekly update</h2>
            <button id="copyPilotSuccessBtn" type="button">copy update</button>
          </div>
          <textarea id="pilotSuccessBrief" class="brief-box demo-script" readonly aria-label="Customer success update"></textarea>
        </div>
      </section>
      ` : '<section id="pilotSuccessPanel" class="grid two" style="display:none"></section>'}

      <section id="scannerPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Secret exposure intake</h2><span class="mini" id="scannerMeta">metadata only</span></div>
          <form id="scannerFindingForm" class="scanner-form">
            <div class="scanner-field"><label for="scannerRepository">repository</label><input id="scannerRepository" placeholder="customer/app-service" /></div>
            <div class="scanner-field"><label for="scannerBranch">branch/ref</label><input id="scannerBranch" placeholder="main, release/2026-05, or commit hash" /></div>
            <div class="scanner-field"><label for="scannerFindingType">finding type</label><select id="scannerFindingType"><option value="hardcoded_secret">hardcoded secret</option><option value="env_file">env/config file</option><option value="oauth_secret">OAuth/client secret</option><option value="webhook_secret">webhook signing secret</option><option value="provider_key">provider API key</option><option value="private_key">private key material</option><option value="other">other</option></select></div>
            <div class="scanner-field"><label for="scannerSecretFamily">secret family</label><input id="scannerSecretFamily" placeholder="OpenAI, Resend, SendGrid, OAuth, Stripe" /></div>
            <div class="scanner-field"><label for="scannerSeverity">severity</label><select id="scannerSeverity"><option value="critical">critical</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div>
            <div class="scanner-field"><label for="scannerStatus">status</label><select id="scannerStatus"><option value="new">new</option><option value="confirmed">confirmed</option><option value="rotating">rotating</option><option value="rotated">rotated</option><option value="accepted_demo">accepted for pilot</option><option value="false_positive">false positive</option><option value="blocked">blocked</option></select></div>
            <div class="scanner-field"><label for="scannerOwner">owner</label><input id="scannerOwner" placeholder="security or app owner" /></div>
            <div class="scanner-field"><label for="scannerProviderSlot">provider slot</label><input id="scannerProviderSlot" placeholder="provider slug or slot name" /></div>
            <div class="scanner-field wide"><label for="scannerEvidenceRef">redacted scanner evidence</label><textarea id="scannerEvidenceRef" placeholder="Sanitized file path, scanner finding id, PR/ticket id, or hash only. Do not paste secret values, source files, request bodies, or customer payloads."></textarea></div>
            <div class="scanner-field wide"><label for="scannerNote">remediation note</label><textarea id="scannerNote" placeholder="Rotation owner, revoke path, compensating control, or why this is pilot-limited. Metadata only."></textarea></div>
            <button class="primary" type="submit">add finding</button>
          </form>
        </div>
        <div class="card">
          <div class="section-title"><h2>Scanner posture</h2><span class="mini">enterprise-safe</span></div>
          <div id="scannerList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Exposure findings</h2><span class="mini">saved in this browser</span></div>
          <div id="scannerFindingList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Remediation workflow</h2><span class="mini">customer handoff</span></div>
          <div id="scannerChecklist" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title">
            <h2>Scanner evidence JSON</h2>
            <button id="copyScannerJsonBtn" type="button">copy scanner JSON</button>
          </div>
          <textarea id="scannerEvidencePacket" class="brief-box" readonly aria-label="Scanner evidence JSON"></textarea>
        </div>
      </section>

      <section id="verifierPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Shared pilot attestation</h2><span class="mini">one confidential runtime proof</span></div>
          <p class="mini">Pilot proof records use the shared VaultProof Enterprise confidential runtime attestation. That proves the VaultProof verifier/control path is running with the expected GCP confidential posture; it does not mean VaultProof ran the customer model.</p>
          <div id="verifierAttestationList" class="list" style="margin-top:12px"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Register external model</h2><span class="mini">VaultProof does not run it</span></div>
          <form id="verifierModelForm" class="list">
            <select id="verifierModelProjectSelect" aria-label="Verifier model project"><option value="">Loading projects...</option></select>
            <input id="verifierModelRef" placeholder="model ref, for example fraud-xgb-v1" />
            <input id="verifierModelName" placeholder="display name, for example Fraud Score XGBoost v1" />
            <select id="verifierModelFamily" aria-label="Model family">
              <option value="classification">classification</option>
              <option value="regression">regression</option>
              <option value="ranking">ranking</option>
              <option value="embedding">embedding</option>
              <option value="llm">llm</option>
              <option value="vision">vision</option>
              <option value="custom">custom</option>
            </select>
            <input id="verifierProofSystems" value="vaultproof-manifest-v1,external-verifier,tee-attestation" aria-label="Allowed proof systems" />
            <button class="primary" type="submit">save model</button>
          </form>
          <div class="section-title" style="margin-top:18px"><h2>Model registry</h2><span class="mini">allowed models</span></div>
          <div id="verifierModelList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Submit proof bundle</h2><span class="mini">verify evidence only</span></div>
          <form id="verifierProofForm" class="list">
            <select id="verifierProofProjectSelect" aria-label="Proof project"><option value="">Loading projects...</option></select>
            <select id="verifierProofModelSelect" aria-label="Proof model"><option value="">Register a model first</option></select>
            <select id="verifierProofSystem" aria-label="Proof system">
              <option value="vaultproof-manifest-v1">vaultproof-manifest-v1</option>
              <option value="external-verifier">external-verifier</option>
              <option value="tee-attestation">tee-attestation</option>
              <option value="world-zk-compute">world-zk-compute</option>
              <option value="ezkl">ezkl</option>
              <option value="risc0">risc0</option>
            </select>
            <input id="verifierOutputHash" placeholder="claimed output hash, optional sha256:..." />
            <textarea id="verifierProofBundle" placeholder='{"proof_system":"vaultproof-manifest-v1","model_ref":"fraud-xgb-v1","claimed_output_hash":"sha256:..."}'></textarea>
            <button class="primary" type="submit">verify proof bundle</button>
          </form>
          <div class="section-title" style="margin-top:18px"><h2>Proof verification evidence</h2><span class="mini">latest checks</span></div>
          <div id="verifierEvidenceList" class="list"></div>
        </div>
      </section>

      <section id="runbooksPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Safe verification commands</h2><span class="mini">read-only checks</span></div><div id="runbooksSafeList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Gated infrastructure actions</h2><span class="mini">operator approval</span></div><div id="runbooksGatedList" class="list"></div></div>
        <div class="card" style="grid-column:1/-1"><div class="section-title"><h2>Key exposure response runbook</h2><span class="mini" id="runbooksExposureMeta">incident mode</span></div><div id="runbooksExposureList" class="list"></div></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var PAGE_MODE = '${pageName}';
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var latestOrgPayload = null;
      var latestReadiness = null;
      var latestOverview = null;
      var latestBootstrap = null;
      var latestSecurityReviewPacket = null;
      var latestEntitlementsPacket = null;
      var latestPaidOnboardingPacket = null;
      var latestPilotSuccessPacket = null;
      var latestPilotTesterPacket = null;
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function displayRuntimeTier(value) {
        var tier = String(value || '');
        if (tier === 'shared-demo') return 'shared pilot runtime';
        if (tier === 'dedicated-production') return 'dedicated production runtime';
        return tier || 'not reported';
      }
      function displayPilotStatus(value) {
        var status = String(value || '');
        if (status === 'accepted_for_pilot' || status === 'accepted_for_demo') return 'accepted for pilot';
        if (status === 'ready_for_guided_testing') return 'ready for guided testing';
        if (status === 'ready_for_paid_pilot') return 'ready for paid pilot';
        if (status === 'ready_for_customer_testing') return 'ready for customer testing';
        return status.replace(/_/g, ' ');
      }
      function displayMaterialMode(value) {
        var mode = String(value || '');
        if (mode === 'sealed-live') return 'live sealed material';
        if (mode === 'demo-placeholder') return 'placeholder material';
        if (mode === 'mixed') return 'mixed material state';
        return mode ? mode.replace(/_/g, ' ') : 'material missing';
      }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function row(title, sub, tag, tone) {
        return '<div class="row"><div><div class="row-title">' + escapeHtml(title) + '</div><div class="row-sub">' + escapeHtml(sub || '') + '</div></div><span class="tag ' + (tone || '') + '">' + escapeHtml(tag || 'ready') + '</span></div>';
      }
      var STAFF_ONLY_APP_PATHS = {
        '/app/launch': true,
        '/app/demo': true,
        '/app/onboarding': true,
        '/app/support': true,
        '/app/pilot': true,
        '/app/pilot-success': true
      };
      function isInternalAdminHost() {
        return location.hostname === 'admin.vaultproof.dev'
          || location.hostname === 'internal-admin.vaultproof.test'
          || location.pathname.indexOf('/internal/') === 0;
      }
      function customerSafeHref(href) {
        var value = String(href || '');
        if (!value || value.charAt(0) === '#') return value;
        try {
          var resolved = new URL(value, location.origin);
          var path = resolved.pathname.replace(/\\.html$/, '').replace(/\\/+$/, '') || '/';
          if (resolved.origin === location.origin && STAFF_ONLY_APP_PATHS[path] && !isInternalAdminHost()) {
            return '#staff-only';
          }
        } catch (_) {
          if (STAFF_ONLY_APP_PATHS[value] && !isInternalAdminHost()) return '#staff-only';
        }
        return value;
      }
      function linkRow(title, sub, href, label, tone) {
        var safeHref = customerSafeHref(href);
        var action = safeHref === '#staff-only'
          ? '<span class="tag warn">staff only</span>'
          : '<a class="tag ' + (tone || '') + '" href="' + escapeHtml(safeHref) + '">' + escapeHtml(label || 'open') + '</a>';
        return '<div class="row"><div><div class="row-title">' + escapeHtml(title) + '</div><div class="row-sub">' + escapeHtml(sub || '') + '</div></div>' + action + '</div>';
      }
      function launchStorageKey() {
        return 'vaultproof_launch_checklist:' + (currentOrgId || 'default');
      }
      function goNoGoStorageKey() {
        return 'vaultproof_go_no_go_evidence:' + (currentOrgId || 'default');
      }
      function pilotProposalStorageKey() {
        return 'vaultproof_pilot_proposal:' + (currentOrgId || 'default');
      }
      function pilotSuccessStorageKey() {
        return 'vaultproof_pilot_success:' + (currentOrgId || 'default');
      }
      function entitlementsStorageKey() {
        return 'vaultproof_enterprise_entitlements:' + (currentOrgId || 'default');
      }
      function paidOnboardingStorageKey() {
        return 'vaultproof_paid_onboarding:' + (currentOrgId || 'default');
      }
      function defaultEntitlementsState() {
        return {
          package_label: 'Enterprise paid pilot',
          contract_status: 'draft',
          monthly_call_allowance: '100000',
          provider_slot_allowance: '3',
          seat_allowance: '10',
          support_tier: 'founder-led launch-week support',
          incident_response_add_on: 'optional add-on',
          runtime_label: 'shared confidential runtime',
          renewal_date: '',
          billing_owner: '',
          success_owner: '',
          retention_label: '30-day audit export during pilot',
          invoice_status: 'not_started',
          purchase_order_status: 'not_required',
          procurement_owner: '',
          payment_terms: '',
          expansion_review_date: '',
          billing_note: '',
          customer_note: ''
        };
      }
      function getEntitlementsState() {
        try {
          var raw = localStorage.getItem(entitlementsStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return Object.assign(defaultEntitlementsState(), parsed && typeof parsed === 'object' ? parsed : {});
        } catch (_) {
          return defaultEntitlementsState();
        }
      }
      function setEntitlementsState(field, value) {
        var state = getEntitlementsState();
        var redactedFields = ['renewal_date', 'billing_owner', 'success_owner', 'retention_label', 'customer_note', 'procurement_owner', 'payment_terms', 'expansion_review_date', 'billing_note'];
        state[field] = redactedFields.indexOf(field) !== -1 ? (redactEntitlementNote(value) || '') : String(value == null ? '' : value);
        state.updated_at = new Date().toISOString();
        localStorage.setItem(entitlementsStorageKey(), JSON.stringify(state));
      }
      var PAID_ONBOARDING_MANUAL_ITEMS = [
        { id: 'customer-kickoff-owner', title: 'Customer kickoff owner confirmed', sub: 'A named customer owner can accept the activation plan, bring the right teams, and approve the first test window.', action: 'Confirm buyer/admin owner plus security, platform, and app owner attendance before activation.', critical: true },
        { id: 'enterprise-admin-login-sent', title: 'Enterprise admin login path sent', sub: 'The first customer admin knows to sign in on enterprise.vaultproof.dev and not on the B2C/root site.', action: 'Send https://enterprise.vaultproof.dev/app/login to the customer admin after entitlement review.', critical: true },
        { id: 'first-workload-owner-accepted', title: 'First workload owner accepted', sub: 'The first protected workflow has an app owner, provider path, expected volume, and rollback owner.', action: 'Review /app/pilot, /app/inventory, and /app/rollout with the workload owner.', critical: true },
        { id: 'support-handoff-scheduled', title: 'Support handoff scheduled', sub: 'Launch-week support owner, escalation path, and optional incident-response add-on boundary are clear.', action: 'Review /app/support and schedule the customer support handoff.', critical: true },
        { id: 'capacity-renewal-reviewed', title: 'Capacity and renewal reviewed', sub: 'Monthly calls, provider slots, seats, renewal/review date, retention label, and billing owner have been reviewed.', action: 'Confirm /app/entitlements against the paid-pilot contract or pilot acceptance.', critical: true },
        { id: 'key-posture-accepted', title: 'Key posture accepted or rotation scheduled', sub: 'Shared or pilot-limited key posture is explicitly accepted for the walkthrough or rotation is scheduled before paid customer data.', action: 'Use /app/evidence key-rotation proof and /app/keys provider-slot posture before the customer test.', critical: true },
        { id: 'customer-testing-window-scheduled', title: 'Customer testing window scheduled', sub: 'The customer testing date, tester roster, first scenario, rollback owner, and feedback capture path are known.', action: 'Review /app/testers, /app/evidence, and /app/pilot-success before the guided session.', critical: true }
      ];
      var PAID_ONBOARDING_ROLE_TASKS = [
        { id: 'task-security-review', role: 'security', title: 'Security review owner', sub: 'Security owner reviews evidence, security packet, key posture, and remaining blockers.', action: 'Assign a security reviewer and walk /app/security-review plus /app/evidence before testing.' },
        { id: 'task-platform-owner', role: 'platform', title: 'Platform owner', sub: 'Platform owner confirms login path, SSO posture, gateway/origin constraints, and rollback contact.', action: 'Assign a platform owner and review /app/org, /app/control, /app/rollout, and runbooks.' },
        { id: 'task-app-owner', role: 'app owner', title: 'First workload app owner', sub: 'Application owner confirms first API workflow, expected traffic, provider path, and test success criteria.', action: 'Assign the first workload owner and review /app/pilot, /app/inventory, and /app/keys.' },
        { id: 'task-billing-owner', role: 'billing', title: 'Billing and renewal owner', sub: 'Billing owner confirms package, allowance, renewal/review date, support tier, and expansion path.', action: 'Assign billing owner and review /app/entitlements plus /app/plans.' },
        { id: 'task-support-owner', role: 'support', title: 'Support handoff owner', sub: 'Support owner confirms launch-week contact, escalation path, feedback capture, and optional incident-response boundary.', action: 'Assign support owner and review /app/support plus /app/pilot-success.' }
      ];
      var PAID_ONBOARDING_MANUAL_STALE_MS = 14 * 24 * 60 * 60 * 1000;
      function getPaidOnboardingManualState() {
        try {
          var raw = localStorage.getItem(paidOnboardingStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setPaidOnboardingManualState(id, patch) {
        var state = getPaidOnboardingManualState();
        var existing = state[id] && typeof state[id] === 'object' ? state[id] : {};
        state[id] = Object.assign({}, existing, patch || {}, { updated_at: new Date().toISOString() });
        localStorage.setItem(paidOnboardingStorageKey(), JSON.stringify(state));
      }
      var PILOT_SUCCESS_ITEMS = [
        { id: 'kickoff-completed', title: 'Pilot kickoff completed', sub: 'Business, security, identity, network, developer, support, and incident owners reviewed the first workload proposal.', action: 'Run kickoff from /app/pilot and /app/security-review.', critical: true },
        { id: 'dry-run-passed', title: 'Dry-run self-test passed', sub: 'API proxy dry-run and blocked-recipient denial evidence are captured before live customer traffic.', action: 'Use /app/keys self-test and review /app/activity.', critical: true },
        { id: 'customer-review-complete', title: 'Customer security review complete', sub: 'Security/procurement reviewers have the security packet, evidence packet, and open blockers.', action: 'Share /app/security-review and /app/evidence.', critical: true },
        { id: 'low-volume-traffic-reviewed', title: 'Low-volume traffic reviewed', sub: 'First low-volume traffic window was reviewed with latency, denials, errors, and audit evidence.', action: 'Review /app/activity, /app/audit, and /app/alerts.', critical: true },
        { id: 'success-metric-accepted', title: 'Success metric accepted', sub: 'The customer accepts the pilot success metric and expansion/no-go decision criteria.', action: 'Confirm success metric from /app/pilot.', critical: true },
        { id: 'expansion-decision-ready', title: 'Expansion decision ready', sub: 'Next project, provider path, or production volume step is agreed after the first workflow is stable.', action: 'Prepare expansion terms or hold decision.', critical: false }
      ];
      function defaultPilotProposalState() {
        return {
          workload: 'First protected email/API workflow',
          provider_path: 'Resend, SendGrid, Mailgun, Postmark, AWS SES, MiniMax, or selected provider slot',
          owner_group: 'Security owner + application owner',
          monthly_calls: '100000',
          monthly_price_usd: '5000',
          support_tier: 'founder-led launch-week support',
          incident_response_add_on: 'optional add-on',
          start_window: 'Two-week pilot window after login, key, and monitoring evidence pass',
          success_metric: 'Dry-run and low-volume production traffic pass with exported evidence, no raw key exposure, and a named rollback owner.'
        };
      }
      function getPilotProposalState() {
        try {
          var raw = localStorage.getItem(pilotProposalStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return Object.assign(defaultPilotProposalState(), parsed && typeof parsed === 'object' ? parsed : {});
        } catch (_) {
          return defaultPilotProposalState();
        }
      }
      function setPilotProposalState(field, value) {
        var state = getPilotProposalState();
        state[field] = String(value == null ? '' : value);
        state.updated_at = new Date().toISOString();
        localStorage.setItem(pilotProposalStorageKey(), JSON.stringify(state));
      }
      function getPilotSuccessState() {
        try {
          var raw = localStorage.getItem(pilotSuccessStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setPilotSuccessState(id, patch) {
        var state = getPilotSuccessState();
        var existing = state[id] && typeof state[id] === 'object' ? state[id] : {};
        state[id] = Object.assign({}, existing, patch || {}, { updated_at: new Date().toISOString() });
        localStorage.setItem(pilotSuccessStorageKey(), JSON.stringify(state));
      }
      function defaultPilotSuccessDecisionState() {
        return {
          decision_status: 'not_ready',
          next_package: 'Expansion account',
          owner: '',
          target_date: '',
          next_step: 'Confirm expansion terms, next workload, support boundary, and success metric.',
          note: ''
        };
      }
      function getPilotSuccessDecisionState() {
        var state = getPilotSuccessState();
        var record = state.expansion_decision && typeof state.expansion_decision === 'object' ? state.expansion_decision : {};
        return Object.assign(defaultPilotSuccessDecisionState(), record);
      }
      function setPilotSuccessDecisionState(field, value) {
        var state = getPilotSuccessState();
        var record = state.expansion_decision && typeof state.expansion_decision === 'object' ? state.expansion_decision : {};
        var next = Object.assign(defaultPilotSuccessDecisionState(), record);
        next[field] = field === 'decision_status' ? String(value || 'not_ready') : (safeOnboardingText(value) || '');
        next.updated_at = new Date().toISOString();
        state.expansion_decision = next;
        localStorage.setItem(pilotSuccessStorageKey(), JSON.stringify(state));
      }
      function getLaunchManualState() {
        try {
          var raw = localStorage.getItem(launchStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setLaunchManualState(id, checked) {
        var state = getLaunchManualState();
        state[id] = Boolean(checked);
        localStorage.setItem(launchStorageKey(), JSON.stringify(state));
      }
      function getGoNoGoManualState() {
        try {
          var raw = localStorage.getItem(goNoGoStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setGoNoGoManualState(id, patch) {
        var state = getGoNoGoManualState();
        var existing = state[id] && typeof state[id] === 'object' ? state[id] : {};
        state[id] = Object.assign({}, existing, patch || {}, { updated_at: new Date().toISOString() });
        localStorage.setItem(goNoGoStorageKey(), JSON.stringify(state));
      }
      function launchCheckRow(item, checked) {
        var complete = item.auto ? Boolean(item.complete) : Boolean(checked);
        var disabled = item.auto ? ' disabled' : '';
        return '<label class="launch-check-row" data-complete="' + (complete ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-launch-check="' + escapeHtml(item.id) + '"' + (complete ? ' checked' : '') + disabled + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span></span>' +
          '<span class="tag ' + (complete ? 'good' : item.auto ? 'warn' : '') + '">' + escapeHtml(complete ? 'done' : item.tag) + '</span>' +
        '</label>';
      }
      var GO_NO_GO_MANUAL_ITEMS = [
        { id: 'strict-login-qa', title: 'Strict login QA run', action: 'LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login', sub: 'Automated Supabase redirect, generated session, and authenticated enterprise API checks passed.', critical: true },
        { id: 'human-login-qa', title: 'Human login QA completed', action: 'Browser-test https://enterprise.vaultproof.dev/app/login with ken@vaultproof.dev', sub: 'A real browser sign-in has been clicked through on the enterprise hostname.', critical: true },
        { id: 'supabase-redirect-oauth', title: 'Supabase redirect/OAuth settings confirmed', action: 'Confirm https://enterprise.vaultproof.dev/app/login is allowed and the external OAuth callback is https://gwzkjiomemjlhtrdrlan.supabase.co/auth/v1/callback', sub: 'Supabase Auth settings match the enterprise hostname and external OAuth provider app.', critical: true },
        { id: 'cloud-armor-verified', title: 'Cloud Armor verification passed', action: 'npm run verify:gcp-enterprise-cloud-armor', sub: 'Scanner-path blocking, expected rules, live health, and blocked /.env probe have been verified.', critical: true },
        { id: 'key-rotation-reviewed', title: 'Key rotation status', action: 'Rotate exposed/shared pilot keys before paid onboarding, or document pilot-limited acceptance for this walkthrough', sub: 'Shared pilot keys, service-role keys, and origin-lock values have been reviewed for this launch decision.', critical: true },
        { id: 'rollback-owner-confirmed', title: 'Rollback owner/path confirmed', action: 'Name the owner who can pause traffic, revoke provider slots, reset the VM image, or roll back DNS/edge changes', sub: 'The rollback path is known before customer traffic starts.', critical: true },
        { id: 'budget-monitoring-reviewed', title: 'Budget/monitoring reviewed', action: 'Review budget alert, uptime expectations, denial/error monitoring, and launch-week owner coverage', sub: 'The customer pilot will not run blind on cost, availability, or provider errors.', critical: true }
      ];
      var GO_NO_GO_MANUAL_STALE_MS = 7 * 24 * 60 * 60 * 1000;
      function goNoGoManualById(goNoGo) {
        var lookup = {};
        ((goNoGo && goNoGo.manual) || []).forEach(function(item) { lookup[item.id] = item; });
        return lookup;
      }
      function manualEvidenceSummary(item) {
        return {
          status: item && item.status ? item.status : 'missing',
          updated_at: item && item.updated_at ? item.updated_at : null,
          note: item && item.note ? item.note : null,
          stale: item && item.stale === true
        };
      }
      function buildIdentityQaPacket(goNoGo) {
        var manual = goNoGoManualById(goNoGo);
        var strict = manual['strict-login-qa'];
        var human = manual['human-login-qa'];
        var redirect = manual['supabase-redirect-oauth'];
        var ready = strict && strict.passed && human && human.passed && redirect && redirect.passed;
        return {
          status: ready ? 'ready' : 'hold',
          login_url: location.origin + '/app/login',
          allowed_redirect_uri: location.origin + '/app/login',
          external_oauth_callback_uri: ${JSON.stringify(DEMO_SUPABASE_CALLBACK_URL)},
          strict_login_qa_command: 'LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login',
          oauth_redirect_qa_command: 'LOGIN_QA_OAUTH_PROVIDER=google npm run qa:enterprise-login',
          human_browser_qa_action: 'Browser-test ' + location.origin + '/app/login with ken@vaultproof.dev',
          manual_evidence: {
            strict_login_qa: manualEvidenceSummary(strict),
            human_login_qa: manualEvidenceSummary(human),
            supabase_redirect_oauth: manualEvidenceSummary(redirect)
          },
          secrets_excluded: [
            'Supabase service-role key',
            'Supabase browser session token',
            'OAuth client secret',
            'provider API keys',
            'origin-lock secret'
          ]
        };
      }
      function identityQaRows(packet) {
        var strictStatus = packet.manual_evidence.strict_login_qa.status;
        var humanStatus = packet.manual_evidence.human_login_qa.status;
        var redirectStatus = packet.manual_evidence.supabase_redirect_oauth.status;
        return [
          row('Identity proof status', packet.status === 'ready' ? 'Strict login QA, human browser QA, and Supabase redirect/OAuth settings are all recorded for this org.' : 'Keep this on HOLD until strict login QA, human login QA, and redirect/OAuth confirmation are recorded.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Enterprise login URL', packet.login_url, 'login', 'good'),
          row('Supabase redirect allowlist', packet.allowed_redirect_uri, redirectStatus, redirectStatus === 'passed' ? 'good' : 'warn'),
          row('External OAuth callback', packet.external_oauth_callback_uri, 'callback', 'good'),
          row('Strict login QA command', packet.strict_login_qa_command, strictStatus, strictStatus === 'passed' ? 'good' : 'warn'),
          row('OAuth redirect QA command', packet.oauth_redirect_qa_command, 'oauth redirect QA', 'warn'),
          row('Human browser QA action', packet.human_browser_qa_action, humanStatus, humanStatus === 'passed' ? 'good' : 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function slotMaterialCounts(bootstrap) {
        var counts = { total: 0, live_sealed: 0, demo_placeholder: 0, mixed: 0, missing: 0 };
        providerSlotsFromBootstrap(bootstrap).forEach(function(slot) {
          var mode = String(slot.material_mode || 'missing').replace(/-/g, '_');
          counts.total += 1;
          if (mode === 'sealed_live') counts.live_sealed += 1;
          else if (mode === 'demo_placeholder') counts.demo_placeholder += 1;
          else if (mode === 'mixed') counts.mixed += 1;
          else counts.missing += 1;
        });
        return counts;
      }
      function providersFromBootstrap(bootstrap) {
        var seen = {};
        return providerSlotsFromBootstrap(bootstrap).map(function(slot) {
          return String(slot.provider || slot.slug || '').trim().toLowerCase();
        }).filter(function(provider) {
          if (!provider || seen[provider]) return false;
          seen[provider] = true;
          return true;
        });
      }
      function buildKeyRotationPacket(goNoGo, bootstrap) {
        var manual = goNoGoManualById(goNoGo);
        var item = manual['key-rotation-reviewed'];
        var counts = slotMaterialCounts(bootstrap);
        var providers = providersFromBootstrap(bootstrap);
        var emailProviders = emailProvidersFromData({}, bootstrap);
        var status = item && item.passed ? 'accepted_for_pilot' : 'hold';
        return {
          status: status,
          decision: status === 'accepted_for_pilot' ? 'Pilot key posture is rotated or explicitly accepted for pilot-limited use in this browser evidence record.' : 'Hold until exposed/shared pilot keys are rotated or explicitly accepted for pilot-limited use.',
          manual_evidence: manualEvidenceSummary(item),
          provider_material_summary: {
            total_provider_slots: counts.total,
            live_sealed_slots: counts.live_sealed,
            placeholder_slots: counts.demo_placeholder,
            mixed_slots: counts.mixed,
            missing_slots: counts.missing,
            providers: providers,
            email_providers: emailProviders
          },
          paid_onboarding_actions: [
            'Rotate the shared MiniMax pilot key before paid customer data.',
            'Use sealed local ingest for any future live provider key material.',
            'Rotate Supabase service-role credentials after setup wiring stabilizes.',
            'Rotate origin-lock, executor signing, and runtime-token secrets before paid onboarding.',
            'Keep browser raw-key ingest disabled; dashboard-created slots may stay placeholder-only.'
          ],
          operator_commands: {
            sealed_provider_ingest: 'SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VAULT_UNWRAP_KEY_BASE64=... PROVIDER_API_KEY=... npm run seal:enterprise-provider-slot',
            first_goal_gate: 'npm run gate:gcp-first-goal with strict live material mode enabled',
            launch_evidence_note: 'Mark Key rotation status passed only after rotation or explicit pilot-limited acceptance is recorded.'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function keyRotationRows(packet) {
        var evidence = packet.manual_evidence || {};
        var summary = packet.provider_material_summary || {};
        var material = [
          (summary.live_sealed_slots || 0) + ' live sealed',
          (summary.placeholder_slots || 0) + ' placeholder',
          (summary.mixed_slots || 0) + ' mixed',
          (summary.missing_slots || 0) + ' missing'
        ].join(', ');
        return [
          row('Rotation decision', packet.decision, displayPilotStatus(packet.status), packet.status === 'accepted_for_pilot' ? 'good' : 'warn'),
          row('Evidence timestamp', evidence.updated_at ? 'Last updated ' + rel(evidence.updated_at) + (evidence.stale ? '; stale after 7 days.' : '.') : 'No key-rotation evidence timestamp yet.', evidence.status || 'missing', evidence.status === 'passed' && !evidence.stale ? 'good' : 'warn'),
          row('Provider material modes', material, (summary.total_provider_slots || 0) + ' slots', summary.live_sealed_slots ? 'good' : 'warn'),
          row('Providers in scope', (summary.providers && summary.providers.length ? summary.providers.join(', ') : 'none visible') + (summary.email_providers && summary.email_providers.length ? '. Email providers: ' + summary.email_providers.join(', ') + '.' : ''), 'inventory', summary.total_provider_slots ? 'good' : 'warn'),
          row('Paid onboarding actions', packet.paid_onboarding_actions.join(' '), 'before paid', 'warn'),
          row('Sealed ingest command', packet.operator_commands.sealed_provider_ingest, 'operator only', 'good'),
          row('Strict live material gate', packet.operator_commands.first_goal_gate, 'optional', 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function buildPilotOpsPacket(goNoGo, readiness, overview) {
        var manual = goNoGoManualById(goNoGo);
        var rollback = manual['rollback-owner-confirmed'];
        var budget = manual['budget-monitoring-reviewed'];
        var ready = rollback && rollback.passed && budget && budget.passed;
        return {
          status: ready ? 'ready' : 'hold',
          decision: ready ? 'Pilot operations evidence is recorded for rollback ownership and budget/monitoring review.' : 'Hold until rollback ownership and budget/monitoring review are recorded for this organization.',
          manual_evidence: {
            rollback_owner_path: manualEvidenceSummary(rollback),
            budget_monitoring: manualEvidenceSummary(budget)
          },
          rollback_paths: [
            'Emergency revoke a provider slot from /app/keys.',
            'Pause or redirect customer traffic through the GCP edge policy.',
            'Reset the GCP runtime VM if the container runtime becomes unhealthy.',
            'Roll back DNS or edge changes through the selected DNS provider and GCP load balancer config.',
            'Export audit, access-review, readiness, and evidence packet records before and after rollback.'
          ],
          monitoring_review: {
            runtime_production_ready: readiness.production_ready === true,
            security_profile: readiness.security_profile || null,
            proxy_calls: Number(overview.totalCalls || 0),
            denied_calls: Number(overview.deniedCalls || 0),
            error_calls: Number(overview.errorCalls || 0),
            budget_alert: 'VaultProof Production Monthly USD 50 alerting budget',
            review_scope: 'budget alert, uptime expectations, denial/error monitoring, and launch-week owner coverage'
          },
          operator_commands: {
            edge_verification: 'npm run verify:gcp-enterprise-edge',
            live_launch_gate: 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch',
            live_app_qa: 'npm run qa:enterprise-live-app',
            cloud_armor_verification: 'npm run verify:gcp-enterprise-cloud-armor',
            vm_reset_rollback: 'gcloud compute instances reset vaultproof-enterprise-runtime-1 --zone=us-central1-a --project=vaultproof-prod'
          },
          customer_boundary: 'Base enterprise pilot includes launch evidence and operator runbooks. Customer incident-response teams own 24-hour escalation unless that coverage is sold as an add-on.',
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function pilotOpsRows(packet) {
        var rollback = packet.manual_evidence.rollback_owner_path || {};
        var budget = packet.manual_evidence.budget_monitoring || {};
        var monitoring = packet.monitoring_review || {};
        return [
          row('Pilot operations status', packet.decision, packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Rollback owner/path evidence timestamp', rollback.updated_at ? 'Last updated ' + rel(rollback.updated_at) + (rollback.stale ? '; stale after 7 days.' : '.') : 'No rollback owner/path evidence timestamp yet.', rollback.status || 'missing', rollback.status === 'passed' && !rollback.stale ? 'good' : 'warn'),
          row('Budget/monitoring evidence timestamp', budget.updated_at ? 'Last updated ' + rel(budget.updated_at) + (budget.stale ? '; stale after 7 days.' : '.') : 'No budget/monitoring evidence timestamp yet.', budget.status || 'missing', budget.status === 'passed' && !budget.stale ? 'good' : 'warn'),
          row('Runtime monitoring posture', (monitoring.runtime_production_ready ? 'Runtime reports production-ready. ' : 'Runtime is not production-ready. ') + 'Security profile: ' + (monitoring.security_profile || 'not reported') + '.', monitoring.runtime_production_ready ? 'ready' : 'blocked', monitoring.runtime_production_ready ? 'good' : 'bad'),
          row('Traffic/error/denial monitoring', number(monitoring.proxy_calls) + ' calls, ' + number(monitoring.error_calls) + ' errors, ' + number(monitoring.denied_calls) + ' denied.', (monitoring.error_calls || monitoring.denied_calls) ? 'watch' : 'clean', (monitoring.error_calls || monitoring.denied_calls) ? 'warn' : 'good'),
          row('Rollback paths', packet.rollback_paths.join(' '), 'operator owned', 'good'),
          row('Live launch gate command', packet.operator_commands.live_launch_gate, 'strict gate', 'good'),
          row('Customer incident-response boundary', packet.customer_boundary, 'contract', 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function apiInventoryStorageKey() {
        return 'vaultproof_api_inventory::' + (currentOrgId || 'default');
      }
      function manualApiKeyStorageKey() {
        return 'vaultproof_manual_api_keys::' + (currentOrgId || 'default');
      }
      function redactApiInventoryNote(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key)/i.test(textValue)) {
          return '[redacted: note contained secret-like material]';
        }
        return textValue;
      }
      function readApiInventoryAnnotations() {
        try {
          var parsed = JSON.parse(localStorage.getItem(apiInventoryStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function readManualApiKeys() {
        try {
          var parsed = JSON.parse(localStorage.getItem(manualApiKeyStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function redactManualApiKeyText(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return '';
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+\\S+|service[_ -]?role|client[_ -]?secret\\s*[:=]?\\s*\\S+|api[_ -]?key\\s*[:=]\\s*\\S+|password\\s*[:=]\\s*\\S+|private[_ -]?key)/i.test(textValue)) {
          return '[redacted: secret-like material was not stored]';
        }
        return textValue.slice(0, 220);
      }
      function manualApiKeyRecords() {
        var records = readManualApiKeys();
        return Object.keys(records).map(function(id) {
          var record = records[id] && typeof records[id] === 'object' ? records[id] : {};
          return {
            id: id,
            project_id: redactManualApiKeyText(record.project_id),
            provider: redactManualApiKeyText(record.provider),
            key_label: redactManualApiKeyText(record.key_label),
            key_reference: redactManualApiKeyText(record.key_reference),
            key_location: redactManualApiKeyText(record.key_location),
            upstream_scope: redactManualApiKeyText(record.upstream_scope),
            business_owner: redactManualApiKeyText(record.business_owner),
            technical_owner: redactManualApiKeyText(record.technical_owner),
            business_service: redactManualApiKeyText(record.business_service),
            data_sensitivity: redactManualApiKeyText(record.data_sensitivity),
            risk: redactManualApiKeyText(record.risk),
            environment: redactManualApiKeyText(record.environment),
            rotation_status: redactManualApiKeyText(record.rotation_status || 'unknown'),
            review_status: redactManualApiKeyText(record.review_status || 'needs_review'),
            next_review_date: redactManualApiKeyText(record.next_review_date),
            source: redactManualApiKeyText(record.source),
            source_format: redactManualApiKeyText(record.source_format),
            source_detail: redactManualApiKeyText(record.source_detail),
            imported_at: redactManualApiKeyText(record.imported_at),
            created_at: redactManualApiKeyText(record.created_at),
            updated_at: redactManualApiKeyText(record.updated_at)
          };
        }).filter(function(record) {
          return record.provider || record.key_label || record.key_reference;
        });
      }
      function apiInventoryProjectHealthMap(overview) {
        var map = {};
        (Array.isArray(overview.projectHealth) ? overview.projectHealth : []).forEach(function(item) {
          if (item && item.project_id) map[item.project_id] = item;
        });
        return map;
      }
      function apiInventoryRowId(project, slot) {
        return project.id + '::' + (slot ? (slot.key_id || slot.slug || slot.provider) : 'missing-provider');
      }
      function apiInventoryPolicyComplete(project, slot) {
        var policy = project.caller_lock_policy || {};
        var slug = slot && (slot.slug || slot.provider);
        var override = slug && policy.provider_overrides && policy.provider_overrides[slug] && typeof policy.provider_overrides[slug] === 'object'
          ? policy.provider_overrides[slug]
          : {};
        var effective = Object.assign({}, policy, override || {});
        var hasGateway = Array.isArray(effective.allowed_customer_gateways) && effective.allowed_customer_gateways.length > 0;
        var hasMethod = Array.isArray(effective.allowed_methods) && effective.allowed_methods.length > 0;
        var hasUpstream = (Array.isArray(effective.allowed_upstream_hosts) && effective.allowed_upstream_hosts.length > 0)
          || (Array.isArray(effective.allowed_upstream_path_prefixes) && effective.allowed_upstream_path_prefixes.length > 0);
        return project.strict_origin === true && hasGateway && hasMethod && hasUpstream && Boolean(slot);
      }
      function apiInventoryManualRows(overview, bootstrap, annotations) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        var health = apiInventoryProjectHealthMap(overview || {});
        return manualApiKeyRecords().map(function(record) {
          var project = projects.find(function(item) { return item.id === record.project_id; }) || {
            id: record.project_id || record.id,
            name: record.project_id ? 'Manual API key project' : 'Unassigned manual API key',
            vp_proj_id: record.project_id || 'manual-api-key',
            strict_origin: false
          };
          var storedAnnotation = annotations[record.id] && typeof annotations[record.id] === 'object' ? annotations[record.id] : {};
          var reviewStatus = storedAnnotation.review_status || record.review_status || 'needs_review';
          var projectHealth = health[project.id] || {};
          var statuses = ['manual API key', 'missing provider slot', 'needs sealed ingest', 'policy incomplete'];
          if (record.source === 'vaultproof_inventory_import') statuses.push(record.source_format === 'openapi' ? 'OpenAPI import' : 'CSV import');
          if (!Number(projectHealth.calls || 0)) statuses.push('no recent traffic');
          if (!storedAnnotation.review_status || reviewStatus === 'needs_review') statuses.push('review due');
          if (reviewStatus === 'blocked') statuses.push('blocked');
          if (reviewStatus === 'exception') statuses.push('exception');
          return {
            id: record.id,
            project_id: project.id,
            project_name: project.name || project.vp_proj_id || 'Manual API key',
            vp_proj_id: project.vp_proj_id || null,
            provider: null,
            manual_key: {
              provider: record.provider || null,
              key_label: record.key_label || null,
              key_reference: record.key_reference || null,
              key_location: record.key_location || null,
              upstream_scope: record.upstream_scope || null,
              rotation_status: record.rotation_status || 'unknown',
              source: record.source || null,
              source_format: record.source_format || null,
              source_detail: record.source_detail || null,
              imported_at: record.imported_at || null,
              created_at: record.created_at || null,
              updated_at: record.updated_at || null
            },
            policy: {
              strict_origin: project.strict_origin === true,
              complete: false
            },
            traffic: {
              calls: Number(projectHealth.calls || 0),
              errors: Number(projectHealth.errors || 0),
              denied: Number(projectHealth.denied || 0),
              last_seen_at: projectHealth.lastActivity || null
            },
            annotation: {
              business_owner: storedAnnotation.business_owner || record.business_owner || null,
              technical_owner: storedAnnotation.technical_owner || record.technical_owner || null,
              environment: storedAnnotation.environment || record.environment || null,
              business_service: storedAnnotation.business_service || record.business_service || record.key_label || null,
              data_sensitivity: storedAnnotation.data_sensitivity || record.data_sensitivity || null,
              risk: storedAnnotation.risk || record.risk || null,
              review_status: reviewStatus,
              next_review_date: storedAnnotation.next_review_date || record.next_review_date || null,
              updated_at: storedAnnotation.updated_at || record.updated_at || null,
              note: redactApiInventoryNote(storedAnnotation.note)
            },
            statuses: statuses
          };
        });
      }
      function apiInventoryRowsFromData(overview, bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        var annotations = readApiInventoryAnnotations();
        var health = apiInventoryProjectHealthMap(overview || {});
        var rows = [];
        projects.forEach(function(project) {
          var slots = Array.isArray(project.provider_slots) && project.provider_slots.length ? project.provider_slots : [null];
          slots.forEach(function(slot) {
            var rowId = apiInventoryRowId(project, slot);
            var annotation = annotations[rowId] && typeof annotations[rowId] === 'object' ? annotations[rowId] : {};
            var projectHealth = health[project.id] || {};
            var calls = Number(projectHealth.calls || 0);
            var policyComplete = apiInventoryPolicyComplete(project, slot);
            var reviewStatus = annotation.review_status || 'needs_review';
            var statuses = [];
            if (slot && slot.material_ready === true && policyComplete) statuses.push('protected');
            if (!slot) statuses.push('missing provider slot');
            if (!policyComplete) statuses.push('policy incomplete');
            if (!calls) statuses.push('no recent traffic');
            if (!annotation.review_status || reviewStatus === 'needs_review') statuses.push('review due');
            if (reviewStatus === 'blocked') statuses.push('blocked');
            if (reviewStatus === 'exception') statuses.push('exception');
            return rows.push({
              id: rowId,
              project_id: project.id,
              project_name: project.name || project.vp_proj_id || 'Project',
              vp_proj_id: project.vp_proj_id || null,
              provider: slot ? {
                provider: slot.provider || null,
                slug: slot.slug || slot.provider || null,
                material_mode: slot.material_mode || 'missing',
                material_ready: slot.material_ready === true
              } : null,
              policy: {
                strict_origin: project.strict_origin === true,
                complete: policyComplete
              },
              traffic: {
                calls: calls,
                errors: Number(projectHealth.errors || 0),
                denied: Number(projectHealth.denied || 0),
                last_seen_at: projectHealth.lastActivity || null
              },
              annotation: {
                business_owner: annotation.business_owner || null,
                technical_owner: annotation.technical_owner || null,
                environment: annotation.environment || null,
                business_service: annotation.business_service || null,
                data_sensitivity: annotation.data_sensitivity || null,
                risk: annotation.risk || null,
                review_status: reviewStatus,
                next_review_date: annotation.next_review_date || null,
                updated_at: annotation.updated_at || null,
                note: redactApiInventoryNote(annotation.note)
              },
              statuses: statuses
            });
          });
        });
        apiInventoryManualRows(overview || {}, bootstrap || {}, annotations).forEach(function(row) {
          rows.push(row);
        });
        return rows;
      }
      function buildApiInventoryPacket(overview, bootstrap) {
        var rows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        var summary = {
          total_api_surfaces: rows.length,
          protected: rows.filter(function(item) { return item.statuses.indexOf('protected') !== -1; }).length,
          missing_provider_slot: rows.filter(function(item) { return !item.provider; }).length,
          manual_api_keys: rows.filter(function(item) { return Boolean(item.manual_key); }).length,
          imported_api_hints: rows.filter(function(item) { return Boolean(item.manual_key) && item.manual_key.source === 'vaultproof_inventory_import'; }).length,
          needs_sealed_ingest: rows.filter(function(item) { return Boolean(item.manual_key) && !item.provider; }).length,
          policy_incomplete: rows.filter(function(item) { return !item.policy.complete; }).length,
          no_recent_traffic: rows.filter(function(item) { return Number(item.traffic.calls || 0) === 0; }).length,
          review_due: rows.filter(function(item) { return item.statuses.indexOf('review due') !== -1; }).length,
          blocked: rows.filter(function(item) { return item.statuses.indexOf('blocked') !== -1; }).length
        };
        return {
          packet_type: 'vaultproof_enterprise_api_inventory',
          packet_version: 1,
          status: rows.length && summary.missing_provider_slot === 0 ? 'ready' : 'needs_review',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          inventory_page: '/app/inventory',
          summary: summary,
          rows: rows,
          secrets_excluded: [
            'raw provider keys',
            'raw manually entered API keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function apiInventoryProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('API inventory status', packet.status === 'ready' ? 'Inventory is populated from existing enterprise projects/provider slots and ready for customer review.' : 'Inventory exists but still needs owner, provider-slot, policy, or review cleanup before pilot traffic.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Inventory surfaces', number(summary.total_api_surfaces) + ' API surfaces, ' + number(summary.protected) + ' protected, ' + number(summary.missing_provider_slot) + ' missing provider slot, ' + number(summary.policy_incomplete) + ' policy incomplete.', number(summary.total_api_surfaces), summary.protected ? 'good' : 'warn'),
          row('Manual API keys', number(summary.manual_api_keys) + ' manual API key metadata records, ' + number(summary.needs_sealed_ingest) + ' still need sealed provider-slot ingest before protected execution.', 'metadata only', summary.needs_sealed_ingest ? 'warn' : 'good'),
          row('Imported API hints', number(summary.imported_api_hints) + ' CSV/OpenAPI inventory hints are included without raw keys, request bodies, response bodies, or customer payloads.', 'vaultproof_inventory_import', summary.imported_api_hints ? 'good' : 'warn'),
          row('Review state', number(summary.review_due) + ' review due, ' + number(summary.no_recent_traffic) + ' with no recent traffic, ' + number(summary.blocked) + ' blocked.', 'review due', summary.blocked ? 'bad' : 'warn'),
          linkRow('Open API inventory', 'Review owner, environment, business service, data sensitivity, risk, review status, and notes saved in this browser.', '/app/inventory', 'inventory', 'good'),
          row('Secret boundary', 'Inventory evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function policyDriftStorageKey() {
        return 'vaultproof_policy_exceptions::' + (currentOrgId || 'default');
      }
      function readPolicyDriftExceptions() {
        try {
          var parsed = JSON.parse(localStorage.getItem(policyDriftStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function redactPolicyDriftText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key)/i.test(textValue)) {
          return '[redacted: policy exception contained secret-like material]';
        }
        return textValue;
      }
      function policyDriftExceptionActive(exception) {
        if (!exception || ['accepted_demo', 'approved'].indexOf(exception.approval_status || '') === -1) return false;
        if (!exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires >= Date.now();
      }
      function policyDriftExceptionExpired(exception) {
        if (!exception || !exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires < Date.now();
      }
      function policyDriftRowStatus(row) {
        var exception = row.exception || {};
        if (exception.approval_status === 'blocked') return 'blocked';
        if (policyDriftExceptionActive(exception)) return exception.approval_status === 'approved' ? 'approved exception' : 'pilot accepted';
        if (policyDriftExceptionExpired(exception)) return 'expired exception';
        return 'open drift';
      }
      function addPolicyDriftRow(rows, exceptions, inventoryRow, controlId, title, detail, severity, action) {
        var id = inventoryRow.id + '::' + controlId;
        var exception = exceptions[id] && typeof exceptions[id] === 'object' ? exceptions[id] : {};
        rows.push({
          id: id,
          api_surface_id: inventoryRow.id,
          control_id: controlId,
          title: title,
          detail: detail,
          severity: severity,
          action: action,
          project: {
            id: inventoryRow.project_id,
            name: inventoryRow.project_name,
            vp_proj_id: inventoryRow.vp_proj_id
          },
          provider: inventoryRow.provider,
          traffic: inventoryRow.traffic,
          inventory_annotation: inventoryRow.annotation || {},
          exception: exception
        });
      }
      function policyDriftRowsFromData(overview, bootstrap) {
        var inventoryRows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        var exceptions = readPolicyDriftExceptions();
        var rows = [];
        inventoryRows.forEach(function(inventoryRow) {
          var annotation = inventoryRow.annotation || {};
          var traffic = inventoryRow.traffic || {};
          var statuses = Array.isArray(inventoryRow.statuses) ? inventoryRow.statuses : [];
          if (!inventoryRow.provider) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'missing-provider-slot', 'Missing provider slot', 'This API surface has no mapped provider slot, so protected execution cannot be proven.', 'critical', 'Create a provider slot and map it to project policy.');
          }
          if (inventoryRow.provider && inventoryRow.provider.material_mode === 'demo-placeholder') {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'demo-placeholder-material', 'Placeholder provider material', 'This provider slot is running placeholder material and needs paid-traffic acceptance or live sealed material.', 'high', 'Rotate to sealed live material before paid data, or record a pilot-limited accepted-risk expiry.');
          }
          if (statuses.indexOf('policy incomplete') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'policy-incomplete', 'Caller-lock policy incomplete', 'Strict origin, gateway, method, provider, host, or path-prefix controls are not complete for this API surface.', inventoryRow.policy && inventoryRow.policy.strict_origin ? 'high' : 'critical', 'Close caller-lock policy gaps in /app/control.');
          }
          if (!annotation.business_owner || !annotation.technical_owner) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'inventory-owner-missing', 'Owner metadata missing', 'Business and technical owner metadata are required before customer launch.', 'medium', 'Set owners in /app/inventory.');
          }
          if (statuses.indexOf('no recent traffic') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'traffic-evidence-missing', 'No recent traffic evidence', 'No proxy traffic is visible for this API surface yet.', 'medium', 'Run a dry-run self-test and verify /app/activity.');
          }
          if (statuses.indexOf('review due') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'inventory-review-due', 'Inventory review due', 'This API inventory row needs an approval, blocker, or accepted exception.', 'medium', 'Review status and next review date in /app/inventory.');
          }
          if (statuses.indexOf('blocked') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'inventory-blocked', 'Inventory row blocked', 'The API inventory record is explicitly blocked.', 'critical', 'Resolve blocker or record a customer-approved exception before launch.');
          }
        });
        return rows;
      }
      function buildPolicyDriftPacket(overview, bootstrap) {
        var rows = policyDriftRowsFromData(overview || {}, bootstrap || {});
        var blocked = rows.filter(function(item) { return policyDriftRowStatus(item) === 'blocked'; }).length;
        var openCritical = rows.filter(function(item) {
          return (item.severity === 'critical' || item.severity === 'high') && !policyDriftExceptionActive(item.exception) && policyDriftRowStatus(item) !== 'blocked';
        }).length;
        var summary = {
          total_drift_rows: rows.length,
          critical: rows.filter(function(item) { return item.severity === 'critical'; }).length,
          high: rows.filter(function(item) { return item.severity === 'high'; }).length,
          medium: rows.filter(function(item) { return item.severity === 'medium'; }).length,
          active_exceptions: rows.filter(function(item) { return policyDriftExceptionActive(item.exception); }).length,
          expired_exceptions: rows.filter(function(item) { return policyDriftExceptionExpired(item.exception); }).length,
          blocked: blocked
        };
        var status = blocked || openCritical ? 'hold' : rows.length ? 'ready_with_review' : 'clean';
        return {
          packet_type: 'vaultproof_enterprise_policy_drift',
          packet_version: 1,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          policy_page: '/app/policy',
          summary: summary,
          rows: rows.map(function(row) {
            return {
              id: row.id,
              api_surface_id: row.api_surface_id,
              control_id: row.control_id,
              title: row.title,
              severity: row.severity,
              status: policyDriftRowStatus(row),
              project: row.project,
              provider: row.provider,
              traffic: row.traffic,
              action: row.action,
              exception: {
                approval_status: row.exception.approval_status || null,
                owner: row.exception.owner || null,
                risk_level: row.exception.risk_level || null,
                expires_at: row.exception.expires_at || null,
                updated_at: row.exception.updated_at || null,
                reason: redactPolicyDriftText(row.exception.reason),
                compensating_control: redactPolicyDriftText(row.exception.compensating_control),
                next_action: redactPolicyDriftText(row.exception.next_action)
              }
            };
          }),
          workflow_links: {
            policy_drift: '/app/policy',
            api_inventory: '/app/inventory',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            security_review: '/app/security-review',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function policyDriftProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Policy drift status', packet.status === 'clean' ? 'No active drift rows are visible from project/provider/policy/traffic evidence.' : number(summary.total_drift_rows) + ' drift rows are visible. Critical/high rows must be closed or have current accepted-risk records before paid traffic.', packet.status, packet.status === 'hold' ? 'bad' : 'good'),
          row('Open severity mix', number(summary.critical) + ' critical, ' + number(summary.high) + ' high, ' + number(summary.medium) + ' medium. ' + number(summary.active_exceptions) + ' active accepted-risk records.', 'severity', summary.critical || summary.high ? 'warn' : 'good'),
          row('Exception hygiene', number(summary.expired_exceptions) + ' expired exceptions and ' + number(summary.blocked) + ' blocked rows.', summary.blocked ? 'blocked' : 'review', summary.blocked ? 'bad' : 'warn'),
          linkRow('Open policy drift', 'Review control gaps, owners, compensating controls, expiration date, and next action for each accepted-risk record.', '/app/policy', 'policy drift', 'good'),
          row('Secret boundary', 'Policy drift evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function integrationRolloutStorageKey() {
        return 'vaultproof_integration_rollouts::' + (currentOrgId || 'default');
      }
      function readIntegrationRollouts() {
        try {
          var parsed = JSON.parse(localStorage.getItem(integrationRolloutStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function redactIntegrationRolloutText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:)/i.test(textValue)) {
          return '[redacted: rollout text contained secret-like material]';
        }
        return textValue;
      }
      function integrationRolloutPercent(value) {
        var parsed = Number(value || 0);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
      function integrationRolloutBlockers(inventoryRow, state, policyRows) {
        var blockers = [];
        var annotation = inventoryRow.annotation || {};
        var statuses = Array.isArray(inventoryRow.statuses) ? inventoryRow.statuses : [];
        var testStatus = state.test_status || 'not_started';
        var canary = integrationRolloutPercent(state.canary_percent);
        var openPolicy = policyRows.filter(function(policyRow) {
          return (policyRow.severity === 'critical' || policyRow.severity === 'high') && !policyDriftExceptionActive(policyRow.exception) && policyDriftRowStatus(policyRow) !== 'blocked';
        });
        if (!inventoryRow.provider) blockers.push('missing provider slot');
        if (inventoryRow.provider && inventoryRow.provider.material_mode === 'demo-placeholder') blockers.push('placeholder provider material');
        if (statuses.indexOf('policy incomplete') !== -1) blockers.push('caller-lock policy incomplete');
        if (statuses.indexOf('blocked') !== -1 || annotation.review_status === 'blocked') blockers.push('API inventory row blocked');
        if (!annotation.business_owner || !annotation.technical_owner) blockers.push('API inventory owners missing');
        if (!state.application) blockers.push('application/workload name missing');
        if (!state.integration_mode) blockers.push('integration mode missing');
        if (!state.app_owner) blockers.push('app owner missing');
        if (!state.gateway_owner) blockers.push('gateway owner missing');
        if (!state.target_date) blockers.push('target date missing');
        if (!state.rollback_owner || !state.rollback_path) blockers.push('rollback owner/path missing');
        if (Number(inventoryRow.traffic && inventoryRow.traffic.calls || 0) === 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('dry-run or traffic evidence missing');
        if (canary > 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('canary needs test evidence');
        if (openPolicy.length) blockers.push(openPolicy.length + ' critical/high policy drift rows');
        if (state.rollout_status === 'blocked') blockers.push('rollout manually blocked');
        return blockers;
      }
      function integrationRolloutRowStatus(row) {
        var state = row.rollout || {};
        var canary = integrationRolloutPercent(state.canary_percent);
        if (state.rollout_status === 'rollback') return 'rollback';
        if (row.blockers && row.blockers.length) return 'hold';
        if (state.rollout_status === 'live' || state.test_status === 'live_verified') return 'live';
        if (state.test_status === 'canary_passed' || canary > 0) return 'canary';
        if (state.test_status === 'dry_run_passed' || state.test_status === 'denial_passed') return 'ready_for_canary';
        if (state.application || state.integration_mode || state.app_owner || state.gateway_owner) return 'planned';
        return 'draft';
      }
      function buildIntegrationRolloutPacket(overview, bootstrap) {
        var inventoryRows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        var policyRows = policyDriftRowsFromData(overview || {}, bootstrap || {});
        var state = readIntegrationRollouts();
        var rows = inventoryRows.map(function(inventoryRow) {
          var rollout = state[inventoryRow.id] && typeof state[inventoryRow.id] === 'object' ? state[inventoryRow.id] : {};
          var relatedPolicy = policyRows.filter(function(policyRow) { return policyRow.api_surface_id === inventoryRow.id; });
          var blockers = integrationRolloutBlockers(inventoryRow, rollout, relatedPolicy);
          return {
            id: inventoryRow.id,
            project: {
              id: inventoryRow.project_id,
              name: inventoryRow.project_name,
              vp_proj_id: inventoryRow.vp_proj_id
            },
            provider: inventoryRow.provider,
            traffic: inventoryRow.traffic,
            rollout: rollout,
            blockers: blockers,
            policy_drift: relatedPolicy.map(function(policyRow) {
              return { id: policyRow.id, title: policyRow.title, severity: policyRow.severity, status: policyDriftRowStatus(policyRow) };
            })
          };
        });
        var summary = {
          total_workloads: rows.length,
          live: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'live'; }).length,
          canary: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'canary'; }).length,
          ready_for_canary: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'ready_for_canary'; }).length,
          hold: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'hold'; }).length,
          draft: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'draft'; }).length,
          blocker_count: rows.reduce(function(total, item) { return total + (item.blockers || []).length; }, 0)
        };
        var status = summary.hold ? 'hold' : summary.live || summary.canary || summary.ready_for_canary ? 'ready' : 'draft';
        return {
          packet_type: 'vaultproof_enterprise_integration_rollout',
          packet_version: 1,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          rollout_page: '/app/rollout',
          summary: summary,
          rows: rows.map(function(row) {
            var rollout = row.rollout || {};
            return {
              id: row.id,
              status: integrationRolloutRowStatus(row),
              project: row.project,
              provider: row.provider,
              traffic: row.traffic,
              blockers: row.blockers,
              policy_drift: row.policy_drift,
              rollout: {
                application: rollout.application || null,
                environment: rollout.environment || null,
                integration_mode: rollout.integration_mode || null,
                rollout_status: rollout.rollout_status || null,
                app_owner: rollout.app_owner || null,
                gateway_owner: rollout.gateway_owner || null,
                target_date: rollout.target_date || null,
                support_window: rollout.support_window || null,
                canary_percent: integrationRolloutPercent(rollout.canary_percent),
                test_status: rollout.test_status || 'not_started',
                rollback_owner: rollout.rollback_owner || null,
                rollback_path: redactIntegrationRolloutText(rollout.rollback_path),
                note: redactIntegrationRolloutText(rollout.note),
                updated_at: rollout.updated_at || null
              }
            };
          }),
          workflow_links: {
            rollout_manager: '/app/rollout',
            api_inventory: '/app/inventory',
            policy_drift: '/app/policy',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            security_review: '/app/security-review',
            evidence: '/app/evidence'
          },
          snippets: {
            dry_run: 'Copy-safe dry-run snippets are generated in /app/rollout with YOUR_VAULTPROOF_SESSION_JWT placeholders only.'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function integrationRolloutProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Integration rollout status', number(summary.total_workloads) + ' candidate workloads, ' + number(summary.ready_for_canary) + ' ready for canary, ' + number(summary.canary) + ' in canary, ' + number(summary.live) + ' live, ' + number(summary.hold) + ' on hold.', packet.status, packet.status === 'hold' ? 'bad' : 'good'),
          row('Rollout blockers', number(summary.blocker_count) + ' blockers across rollout rows. Close owners, rollback, policy, provider material, and dry-run evidence before production traffic.', summary.blocker_count ? 'review' : 'clear', summary.blocker_count ? 'warn' : 'good'),
          linkRow('Open rollout manager', 'Review application, environment, integration mode, owners, target date, canary percent, rollback path, and copy-safe dry-run snippets.', '/app/rollout', 'rollout', 'good'),
          row('Secret boundary', 'Rollout evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function scannerStorageKey() {
        return 'vaultproof_scanner_findings::' + (currentOrgId || 'default');
      }
      function scannerSecretPattern(value) {
        return /(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:|x-api-key|secret_access_key)/i.test(String(value || ''));
      }
      function redactScannerText(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return '';
        if (scannerSecretPattern(textValue)) return '[redacted: scanner field contained secret-like material]';
        return textValue.slice(0, 500);
      }
      function readScannerFindings() {
        try {
          var parsed = JSON.parse(localStorage.getItem(scannerStorageKey()) || '[]');
          var rows = Array.isArray(parsed) ? parsed : Object.keys(parsed || {}).map(function(key) { return parsed[key]; });
          return rows.filter(function(row) { return row && typeof row === 'object'; }).map(function(row) {
            return {
              id: row.id || ('scanner-' + Math.random().toString(36).slice(2)),
              repository: redactScannerText(row.repository),
              branch: redactScannerText(row.branch),
              finding_type: redactScannerText(row.finding_type || 'hardcoded_secret'),
              secret_family: redactScannerText(row.secret_family),
              severity: ['critical', 'high', 'medium', 'low'].indexOf(row.severity) !== -1 ? row.severity : 'high',
              status: ['new', 'confirmed', 'rotating', 'rotated', 'accepted_demo', 'false_positive', 'blocked'].indexOf(row.status) !== -1 ? row.status : 'new',
              owner: redactScannerText(row.owner),
              provider_slot: redactScannerText(row.provider_slot),
              evidence_ref: redactScannerText(row.evidence_ref),
              note: redactScannerText(row.note),
              created_at: row.created_at || null,
              updated_at: row.updated_at || null
            };
          }).slice(0, 50);
        } catch (_error) {
          return [];
        }
      }
      function writeScannerFindings(rows) {
        localStorage.setItem(scannerStorageKey(), JSON.stringify((rows || []).slice(0, 50)));
      }
      function scannerStatusTone(status) {
        if (status === 'rotated' || status === 'false_positive') return 'good';
        if (status === 'blocked' || status === 'new' || status === 'confirmed') return 'bad';
        return 'warn';
      }
      function scannerSeverityTone(severity) {
        if (severity === 'critical' || severity === 'high') return 'bad';
        if (severity === 'medium') return 'warn';
        return 'good';
      }
      function scannerFindingOpen(finding) {
        return ['new', 'confirmed', 'rotating', 'blocked'].indexOf(finding.status) !== -1;
      }
      function scannerSelected(value, expected) {
        return String(value || '') === expected ? ' selected' : '';
      }
      function scannerCoverageRows(overview, bootstrap) {
        var inventoryRows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        return inventoryRows.map(function(row) {
          var provider = row.provider || {};
          return {
            id: row.id,
            project: {
              id: row.project_id,
              name: row.project_name,
              vp_proj_id: row.vp_proj_id
            },
            provider: row.provider ? {
              provider: provider.provider || null,
              slug: provider.slug || null,
              material_mode: displayMaterialMode(provider.material_mode || 'missing')
            } : null,
            risk_level: row.annotation && row.annotation.risk_level || 'unset',
            data_sensitivity: row.annotation && row.annotation.data_sensitivity || 'unset',
            traffic: row.traffic || {},
            coverage_status: 'manual_scanner_evidence_required'
          };
        });
      }
      function buildScannerExposurePacket(overview, bootstrap) {
        var findings = readScannerFindings();
        var coverage = scannerCoverageRows(overview || {}, bootstrap || {});
        var openCritical = findings.filter(function(item) {
          return scannerFindingOpen(item) && (item.severity === 'critical' || item.severity === 'high');
        }).length;
        var summary = {
          total_findings: findings.length,
          critical: findings.filter(function(item) { return item.severity === 'critical'; }).length,
          high: findings.filter(function(item) { return item.severity === 'high'; }).length,
          open_critical_or_high: openCritical,
          rotating: findings.filter(function(item) { return item.status === 'rotating'; }).length,
          rotated: findings.filter(function(item) { return item.status === 'rotated'; }).length,
          accepted_for_pilot: findings.filter(function(item) { return item.status === 'accepted_demo'; }).length,
          false_positive: findings.filter(function(item) { return item.status === 'false_positive'; }).length,
          blocked: findings.filter(function(item) { return item.status === 'blocked'; }).length,
          coverage_candidates: coverage.length
        };
        var status = openCritical || summary.blocked ? 'hold' : findings.length ? 'ready_with_review' : 'needs_scan_evidence';
        return {
          packet_type: 'vaultproof_enterprise_scanner_exposure_review',
          packet_version: 1,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          scanner_page: '/app/scanner',
          summary: summary,
          findings: findings.map(function(item) {
            return {
              id: item.id,
              repository: redactScannerText(item.repository),
              branch: redactScannerText(item.branch),
              finding_type: redactScannerText(item.finding_type),
              secret_family: redactScannerText(item.secret_family),
              severity: item.severity,
              status: item.status,
              owner: redactScannerText(item.owner),
              provider_slot: redactScannerText(item.provider_slot),
              evidence_ref: redactScannerText(item.evidence_ref),
              note: redactScannerText(item.note),
              created_at: item.created_at || null,
              updated_at: item.updated_at || null
            };
          }),
          coverage: coverage,
          workflow_links: {
            scanner: '/app/scanner',
            provider_slots: '/app/keys',
            policy_drift: '/app/policy',
            rollout_manager: '/app/rollout',
            security_review: '/app/security-review',
            evidence: '/app/evidence',
            audit: '/app/audit'
          },
          operator_actions: [
            'Run customer-approved scanner locally or in CI with redaction enabled.',
            'Record sanitized finding metadata only: repository, branch, class, owner, evidence id/hash, and ticket or PR link.',
            'Rotate or revoke any exposed provider/OAuth/webhook/private-key material before paid customer data.',
            'Link the remediation to Provider Slots, Policy Drift, Rollout Manager, and Launch go/no-go evidence.'
          ],
          secrets_excluded: [
            'raw secret values',
            'repository credentials',
            'source file contents',
            'provider API keys',
            'OAuth client secrets',
            'webhook signing secrets',
            'private key material',
            'bearer tokens',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function scannerExposureProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Scanner exposure status', packet.status === 'hold' ? number(summary.open_critical_or_high) + ' open critical/high exposure findings must be remediated or explicitly accepted before paid traffic.' : packet.status === 'needs_scan_evidence' ? 'No scanner findings have been recorded yet. Add a redacted local/CI scan summary before customer security review.' : 'Scanner evidence is recorded for customer review with no raw secret values.', packet.status, packet.status === 'hold' ? 'bad' : 'warn'),
          row('Finding summary', number(summary.total_findings) + ' findings, ' + number(summary.critical) + ' critical, ' + number(summary.high) + ' high, ' + number(summary.rotating) + ' rotating, ' + number(summary.rotated) + ' rotated.', 'exposure', summary.open_critical_or_high ? 'bad' : 'good'),
          row('Coverage candidates', number(summary.coverage_candidates) + ' API/provider surfaces should have repository or CI scanner evidence attached before paid rollout.', 'coverage', summary.coverage_candidates ? 'warn' : 'good'),
          linkRow('Open scanner', 'Record redacted scanner metadata, owners, rotation path, and evidence references for the customer packet.', '/app/scanner', 'scanner', 'good'),
          row('Secret boundary', 'Scanner evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function providerSlotEvidenceRowsFromBootstrap(bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        var rows = [];
        projects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) {
            rows.push({
              project: {
                id: project.id || null,
                name: project.name || null,
                vp_proj_id: project.vp_proj_id || null,
                strict_origin: project.strict_origin === true
              },
              provider: {
                key_id: slot.key_id || null,
                provider: slot.provider || null,
                slug: slot.slug || slot.provider || null,
                material_mode: slot.material_mode || 'missing',
                material_ready: slot.material_ready === true
              }
            });
          });
        });
        return rows;
      }
      function scannerFindingMatchesProviderSlot(finding, slot) {
        if (!finding || !slot) return false;
        var haystack = [
          finding.provider_slot,
          finding.secret_family,
          finding.note,
          finding.evidence_ref
        ].filter(Boolean).join(' ').toLowerCase();
        var provider = String(slot.provider || '').toLowerCase();
        var slug = String(slot.slug || slot.provider || '').toLowerCase();
        return Boolean(haystack && ((provider && haystack.indexOf(provider) !== -1) || (slug && haystack.indexOf(slug) !== -1)));
      }
      function exposureResponseRiskForSlot(row) {
        var openLinked = (row.linked_scanner_findings || []).filter(scannerFindingOpen);
        if (openLinked.some(function(finding) { return finding.severity === 'critical' || finding.severity === 'high'; })) return 'scanner_open_exposure';
        if (!row.provider.material_ready || row.provider.material_mode !== 'sealed-live') return 'needs_rotation';
        return 'ready_to_contain';
      }
      function exposureResponseActionsForSlot(row) {
        var actions = [];
        var openLinked = (row.linked_scanner_findings || []).filter(scannerFindingOpen);
        if (openLinked.length) actions.push('Close ' + openLinked.length + ' linked scanner finding' + (openLinked.length === 1 ? '' : 's') + ' or record accepted pilot-limited risk.');
        if (!row.provider.material_ready || row.provider.material_mode !== 'sealed-live') actions.push('Rotate upstream credential and seal a live provider slot before paid data.');
        actions.push('Use Provider Slots for emergency revoke and copy-safe incident JSON before sharing evidence.');
        return actions;
      }
      function buildKeyExposureResponsePacket(overview, bootstrap, scannerExposure) {
        var scannerPacket = scannerExposure || buildScannerExposurePacket(overview || {}, bootstrap || {});
        var scannerFindings = Array.isArray(scannerPacket.findings) ? scannerPacket.findings : [];
        var rows = providerSlotEvidenceRowsFromBootstrap(bootstrap || {}).map(function(row) {
          var linked = scannerFindings.filter(function(finding) { return scannerFindingMatchesProviderSlot(finding, row.provider); });
          var responseRow = {
            project: row.project,
            provider: row.provider,
            linked_scanner_findings: linked.map(function(finding) {
              return {
                id: finding.id,
                repository: finding.repository || null,
                branch: finding.branch || null,
                finding_type: finding.finding_type || null,
                secret_family: finding.secret_family || null,
                severity: finding.severity,
                status: finding.status,
                owner: finding.owner || null,
                provider_slot: finding.provider_slot || null,
                evidence_ref: finding.evidence_ref || null,
                note: finding.note || null
              };
            })
          };
          responseRow.risk = exposureResponseRiskForSlot(responseRow);
          responseRow.recommended_actions = exposureResponseActionsForSlot(responseRow);
          return responseRow;
        });
        var openLinked = rows.reduce(function(total, row) {
          return total + (row.linked_scanner_findings || []).filter(scannerFindingOpen).length;
        }, 0);
        var openCriticalLinked = rows.reduce(function(total, row) {
          return total + (row.linked_scanner_findings || []).filter(function(finding) {
            return scannerFindingOpen(finding) && (finding.severity === 'critical' || finding.severity === 'high');
          }).length;
        }, 0);
        var summary = {
          total_provider_slots: rows.length,
          live_sealed_slots: rows.filter(function(row) { return row.provider.material_mode === 'sealed-live' && row.provider.material_ready === true; }).length,
          placeholder_or_unready_slots: rows.filter(function(row) { return row.provider.material_mode !== 'sealed-live' || row.provider.material_ready !== true; }).length,
          linked_scanner_findings: rows.reduce(function(total, row) { return total + (row.linked_scanner_findings || []).length; }, 0),
          open_linked_scanner_findings: openLinked,
          open_critical_or_high_linked_findings: openCriticalLinked,
          scanner_findings_recorded: scannerPacket.summary && scannerPacket.summary.total_findings || scannerFindings.length,
          open_critical_or_high_scanner_findings: scannerPacket.summary && scannerPacket.summary.open_critical_or_high || 0,
          provider_slots_needing_rotation: rows.filter(function(row) { return row.risk === 'scanner_open_exposure' || row.risk === 'needs_rotation'; }).length
        };
        var status = !summary.total_provider_slots ? 'needs_provider_slots' : openCriticalLinked ? 'hold' : summary.provider_slots_needing_rotation ? 'rotation_review' : 'ready_to_contain';
        return {
          packet_type: 'vaultproof_enterprise_key_exposure_response',
          packet_version: 2,
          status: status,
          decision: status === 'ready_to_contain'
            ? 'Provider slots are live-sealed with no linked open critical/high scanner exposure in this browser evidence state.'
            : status === 'hold'
              ? 'Hold paid traffic until linked critical/high scanner exposure is rotated, revoked, or explicitly accepted for pilot-limited review.'
              : status === 'needs_provider_slots'
                ? 'Add provider slots before VaultProof can act as the incident containment layer.'
                : 'Review rotation posture before paid customer data; at least one provider slot is not live-sealed.',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          summary: summary,
          provider_slots: rows.map(function(row) {
            return Object.assign({}, row, {
              provider: Object.assign({}, row.provider, {
                material_mode: displayMaterialMode(row.provider && row.provider.material_mode)
              })
            });
          }),
          proof_boundary: {
            vaultproof_controls: 'VaultProof can revoke provider-slot use, copy incident JSON, and prove routed traffic, denials, and audit events that pass through VaultProof.',
            outside_boundary: 'Direct raw-provider-key use outside VaultProof still requires upstream provider rotation and customer-side log review.'
          },
          workflow_links: {
            provider_slots: '/app/keys',
            scanner: '/app/scanner',
            activity: '/app/activity',
            audit: '/app/audit',
            evidence: '/app/evidence',
            security_review: '/app/security-review'
          },
          operator_actions: [
            'Open Provider Slots and copy the key exposure response JSON.',
            'Emergency revoke affected provider slots before copying or rotating raw upstream credentials.',
            'Rotate upstream provider credentials, seal new material into VaultProof, and retire exposed env vars.',
            'Close linked scanner findings only after rotation, revoke, false-positive review, or explicit pilot-limited acceptance.',
            'Export audit CSV and activity evidence for the customer security review packet.'
          ],
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'OAuth client secrets',
            'webhook signing secrets',
            'private key material',
            'bearer tokens',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function keyExposureResponseProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Exposure response status', packet.decision, packet.status, packet.status === 'hold' ? 'bad' : packet.status === 'ready_to_contain' ? 'good' : 'warn'),
          row('Provider slot containment', number(summary.total_provider_slots) + ' provider slots in scope, ' + number(summary.live_sealed_slots) + ' live-sealed, ' + number(summary.placeholder_or_unready_slots) + ' placeholder or unready.', summary.total_provider_slots ? 'slots' : 'missing', summary.total_provider_slots ? 'good' : 'warn'),
          row('Linked scanner exposure', number(summary.linked_scanner_findings) + ' scanner findings linked to provider slots; ' + number(summary.open_critical_or_high_linked_findings) + ' linked critical/high findings remain open.', summary.open_critical_or_high_linked_findings ? 'hold' : 'review', summary.open_critical_or_high_linked_findings ? 'bad' : 'good'),
          row('Rotation scope', number(summary.provider_slots_needing_rotation) + ' provider slots need rotation or review before paid customer data.', summary.provider_slots_needing_rotation ? 'rotate' : 'clear', summary.provider_slots_needing_rotation ? 'warn' : 'good'),
          linkRow('Open Provider Slots', 'Use incident mode to emergency revoke affected slots and copy the customer-safe response JSON.', '/app/keys', 'incident', 'good'),
          linkRow('Open Scanner', 'Close or update linked exposure findings after rotation, revoke, or explicit pilot-limited acceptance.', '/app/scanner', 'scanner', summary.open_critical_or_high_linked_findings ? 'warn' : 'good'),
          row('Proof boundary', packet.proof_boundary.vaultproof_controls + ' ' + packet.proof_boundary.outside_boundary, 'boundary', 'good'),
          row('Secret boundary', 'Response evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function releaseEvidenceStorageKey() {
        return 'vaultproof_release_evidence::' + (currentOrgId || 'default');
      }
      function releaseSecretPattern(value) {
        return /(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:|x-api-key|secret_access_key|origin[_ -]?lock|runtime[_ -]?token|executor[_ -]?signing)/i.test(String(value || ''));
      }
      function redactReleaseText(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return '';
        if (releaseSecretPattern(textValue)) return '[redacted: release field contained secret-like material]';
        return textValue.slice(0, 700);
      }
      function releaseSelected(value, expected) {
        return String(value || '') === expected ? ' selected' : '';
      }
      function readReleaseEvidenceRecords() {
        try {
          var parsed = JSON.parse(localStorage.getItem(releaseEvidenceStorageKey()) || '[]');
          var rows = Array.isArray(parsed) ? parsed : Object.keys(parsed || {}).map(function(key) { return parsed[key]; });
          return rows.filter(function(row) { return row && typeof row === 'object'; }).map(function(row) {
            return {
              id: row.id || ('release-' + Math.random().toString(36).slice(2)),
              release_label: redactReleaseText(row.release_label),
              build_tag: redactReleaseText(row.build_tag),
              change_summary: redactReleaseText(row.change_summary),
              approver: redactReleaseText(row.approver),
              verifier: redactReleaseText(row.verifier),
              verification_status: ['pending', 'passed', 'failed', 'blocked', 'accepted_demo'].indexOf(row.verification_status) !== -1 ? row.verification_status : 'pending',
              rollout_status: ['planned', 'canary', 'live', 'rolled_back', 'paused'].indexOf(row.rollout_status) !== -1 ? row.rollout_status : 'planned',
              rollback_owner: redactReleaseText(row.rollback_owner),
              rollback_path: redactReleaseText(row.rollback_path),
              evidence_note: redactReleaseText(row.evidence_note),
              created_at: row.created_at || null,
              updated_at: row.updated_at || row.created_at || null
            };
          }).sort(function(a, b) {
            return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
          }).slice(0, 40);
        } catch (_error) {
          return [];
        }
      }
      function writeReleaseEvidenceRecords(rows) {
        localStorage.setItem(releaseEvidenceStorageKey(), JSON.stringify((rows || []).slice(0, 40)));
      }
      function releaseVerificationTone(status) {
        if (status === 'passed') return 'good';
        if (status === 'accepted_demo' || status === 'pending') return 'warn';
        return 'bad';
      }
      function releaseRolloutTone(status) {
        if (status === 'live' || status === 'canary') return 'good';
        if (status === 'planned') return 'warn';
        return 'bad';
      }
      function buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap) {
        var records = readReleaseEvidenceRecords();
        var latest = records[0] || null;
        var productionReady = readiness.production_ready === true;
        var verificationReady = Boolean(latest && (latest.verification_status === 'passed' || latest.verification_status === 'accepted_demo'));
        var rollbackReady = Boolean(latest && latest.rollback_owner && latest.rollback_path);
        var approvalReady = Boolean(latest && latest.approver);
        var rolloutReady = Boolean(latest && (latest.rollout_status === 'canary' || latest.rollout_status === 'live'));
        var blockedRollout = latest && (latest.rollout_status === 'rolled_back' || latest.rollout_status === 'paused');
        var blockers = [];
        if (!productionReady) blockers.push('Runtime readiness is not production-ready.');
        if (!records.length) blockers.push('No release evidence record is saved for this organization.');
        if (latest && !approvalReady) blockers.push('Latest release record is missing an approver.');
        if (latest && !verificationReady) blockers.push('Latest release record verification is not passed or pilot-accepted.');
        if (latest && !rollbackReady) blockers.push('Latest release record is missing rollback owner/path.');
        if (latest && !rolloutReady) blockers.push('Latest release record is not canary or live.');
        if (blockedRollout) blockers.push('Latest release record is paused or rolled back.');
        var status = blockers.length ? (records.length ? 'hold' : 'needs_release_record') : 'ready_with_review';
        return {
          packet_type: 'vaultproof_enterprise_release_evidence',
          packet_version: 1,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/release',
          release_page: '/app/release',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCountFromData(org, overview, bootstrap),
            provider_slots: providerCountFromData(overview, bootstrap)
          },
          runtime: {
            production_ready: productionReady,
            security_profile: readiness.security_profile || null,
            runtime_tier: displayRuntimeTier(readiness.runtime_tier),
            customer_dedicated_runtime: readiness.customer_dedicated_runtime === true
          },
          latest_release: latest,
          summary: {
            total_records: records.length,
            latest_build_tag: latest && latest.build_tag || null,
            latest_verification_status: latest && latest.verification_status || 'missing',
            latest_rollout_status: latest && latest.rollout_status || 'missing',
            approved: approvalReady === true,
            rollback_ready: rollbackReady === true,
            blockers: blockers
          },
          records: records,
          workflow_links: {
            release_evidence: '/app/release',
            evidence_packet: '/app/evidence',
            rollout_manager: '/app/rollout',
            security_review: '/app/security-review',
            activity: '/app/activity',
            audit: '/app/audit',
            runbooks: '/app/runbooks'
          },
          operator_commands: [
            'npm run build:gcp-enterprise-images',
            'npm run qa:enterprise-live-app',
            'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true npm run gate:gcp-customer-launch',
            "gcloud compute instances describe vaultproof-enterprise-runtime-1 --zone=us-central1-a --project=vaultproof-prod --format='get(metadata.items.vaultproof-build-tag)'",
            'gcloud compute instances reset vaultproof-enterprise-runtime-1 --zone=us-central1-a --project=vaultproof-prod'
          ],
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'environment variables',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function releaseEvidenceProofRows(packet) {
        var summary = packet.summary || {};
        var latest = packet.latest_release || {};
        return [
          row('Release evidence status', packet.status === 'ready_with_review' ? 'Latest release is approved, verified, in canary/live state, and has rollback owner/path recorded.' : 'Hold until release evidence, approval, verification, canary/live state, and rollback owner/path are complete.', packet.status, packet.status === 'ready_with_review' ? 'good' : 'warn'),
          row('Latest build tag', summary.latest_build_tag || 'No build/image tag recorded yet.', summary.latest_build_tag ? 'recorded' : 'missing', summary.latest_build_tag ? 'good' : 'warn'),
          row('Verification status', latest.verification_status ? 'Verifier: ' + (latest.verifier || 'not set') + '. Status: ' + latest.verification_status + '.' : 'No verification record saved yet.', latest.verification_status || 'missing', releaseVerificationTone(latest.verification_status)),
          row('Rollback path', latest.rollback_owner && latest.rollback_path ? 'Owner: ' + latest.rollback_owner + '. Path: ' + latest.rollback_path + '.' : 'No rollback owner/path recorded for the latest release.', latest.rollback_owner && latest.rollback_path ? 'ready' : 'missing', latest.rollback_owner && latest.rollback_path ? 'good' : 'warn'),
          linkRow('Open release evidence', 'Record the latest build/image tag, approver, verifier, test result, rollout state, rollback path, and customer-safe notes.', '/app/release', 'release', packet.status === 'ready_with_review' ? 'good' : 'warn'),
          row('Secret boundary', 'Release evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function pilotTesterStorageKey() {
        return 'vaultproof_pilot_testers::' + (currentOrgId || 'default');
      }
      function pilotTesterSessionStorageKey() {
        return 'vaultproof_pilot_tester_session::' + (currentOrgId || 'default');
      }
      function testerSecretPattern(value) {
        return /(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:|x-api-key|secret_access_key|origin[_ -]?lock|runtime[_ -]?token|executor[_ -]?signing)/i.test(String(value || ''));
      }
      function redactTesterText(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return '';
        if (testerSecretPattern(textValue)) return '[redacted: tester field contained secret-like material]';
        return textValue.slice(0, 700);
      }
      function testerSelected(value, expected) {
        return String(value || '') === expected ? ' selected' : '';
      }
      function testerStatusTone(status) {
        if (status === 'complete' || status === 'scenario_passed' || status === 'feedback_received' || status === 'login_passed') return 'good';
        if (status === 'login_blocked') return 'bad';
        return 'warn';
      }
      function testerScenarioLabel(value) {
        var labels = {
          login_and_sso: 'login and SSO',
          evidence_review: 'evidence review',
          api_proxy_self_test: 'API proxy self-test',
          provider_slot_review: 'provider slot review',
          security_review: 'security review',
          rollout_review: 'rollout review',
          support_handoff: 'support handoff'
        };
        return labels[value] || value || 'scenario';
      }
      function readPilotTesterRecords() {
        try {
          var parsed = JSON.parse(localStorage.getItem(pilotTesterStorageKey()) || '[]');
          var rows = Array.isArray(parsed) ? parsed : Object.keys(parsed || {}).map(function(key) { return parsed[key]; });
          return rows.filter(function(row) { return row && typeof row === 'object'; }).map(function(row) {
            return {
              id: row.id || ('tester-' + Math.random().toString(36).slice(2)),
              tester_name: redactTesterText(row.tester_name),
              team: redactTesterText(row.team),
              role: ['security_reviewer', 'platform_admin', 'app_owner', 'developer', 'procurement', 'executive_sponsor'].indexOf(row.role) !== -1 ? row.role : 'security_reviewer',
              scenario: ['login_and_sso', 'evidence_review', 'api_proxy_self_test', 'provider_slot_review', 'security_review', 'rollout_review', 'support_handoff'].indexOf(row.scenario) !== -1 ? row.scenario : 'login_and_sso',
              status: ['not_invited', 'invited', 'login_blocked', 'login_passed', 'scenario_passed', 'feedback_received', 'complete'].indexOf(row.status) !== -1 ? row.status : 'not_invited',
              owner: redactTesterText(row.owner),
              blocker: redactTesterText(row.blocker),
              feedback: redactTesterText(row.feedback),
              created_at: row.created_at || null,
              updated_at: row.updated_at || row.created_at || null
            };
          }).sort(function(a, b) {
            return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
          }).slice(0, 60);
        } catch (_error) {
          return [];
        }
      }
      function writePilotTesterRecords(rows) {
        localStorage.setItem(pilotTesterStorageKey(), JSON.stringify((rows || []).slice(0, 60)));
      }
      function defaultPilotTesterSessionState() {
        return {
          status: 'not_scheduled',
          session_window: '',
          facilitator: '',
          customer_owner: '',
          success_criteria: '',
          customer_action: '',
          session_note: ''
        };
      }
      function getPilotTesterSessionState() {
        try {
          var parsed = JSON.parse(localStorage.getItem(pilotTesterSessionStorageKey()) || '{}');
          return Object.assign(defaultPilotTesterSessionState(), parsed && typeof parsed === 'object' ? parsed : {});
        } catch (_) {
          return defaultPilotTesterSessionState();
        }
      }
      function normalizeTesterSessionStatus(value) {
        var status = String(value || '').toLowerCase();
        return ['not_scheduled', 'scheduled', 'in_progress', 'complete', 'blocked'].indexOf(status) !== -1 ? status : 'not_scheduled';
      }
      function setPilotTesterSessionState(field, value) {
        var state = getPilotTesterSessionState();
        state[field] = field === 'status' ? normalizeTesterSessionStatus(value) : redactTesterText(value);
        state.updated_at = new Date().toISOString();
        localStorage.setItem(pilotTesterSessionStorageKey(), JSON.stringify(state));
      }
      function buildTesterSessionPacket(state) {
        var normalized = Object.assign(defaultPilotTesterSessionState(), state || {});
        normalized.status = normalizeTesterSessionStatus(normalized.status);
        var ready = ['scheduled', 'in_progress', 'complete'].indexOf(normalized.status) !== -1 &&
          Boolean(String(normalized.session_window || '').trim()) &&
          Boolean(String(normalized.facilitator || '').trim()) &&
          Boolean(String(normalized.customer_owner || '').trim()) &&
          Boolean(String(normalized.success_criteria || '').trim());
        var actions = [];
        if (normalized.status === 'blocked') actions.push('Resolve session blocker before inviting paid-pilot testers.');
        if (!normalized.session_window) actions.push('Record the guided session window.');
        if (!normalized.facilitator) actions.push('Assign a VaultProof facilitator.');
        if (!normalized.customer_owner) actions.push('Confirm the customer owner who can make the next decision.');
        if (!normalized.success_criteria) actions.push('Write the customer-safe success criteria for this guided session.');
        if (!actions.length) actions.push('Run the guided session, capture feedback, and move any blockers to the right evidence board.');
        return {
          status: normalized.status,
          ready: ready,
          session_window: redactTesterText(normalized.session_window) || null,
          facilitator: redactTesterText(normalized.facilitator) || null,
          customer_owner: redactTesterText(normalized.customer_owner) || null,
          success_criteria: redactTesterText(normalized.success_criteria) || null,
          customer_action: redactTesterText(normalized.customer_action) || null,
          session_note: redactTesterText(normalized.session_note) || null,
          updated_at: normalized.updated_at || null,
          next_actions: actions,
          secret_boundary: 'Session planning is metadata-only and excludes passwords, tokens, provider keys, request bodies, responses, and customer payloads.'
        };
      }
      function buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap) {
        var testers = readPilotTesterRecords();
        var guidedSession = buildTesterSessionPacket(getPilotTesterSessionState());
        var productionReady = readiness.production_ready === true;
        var loginReadyStatuses = ['login_passed', 'scenario_passed', 'feedback_received', 'complete'];
        var scenarioReadyStatuses = ['scenario_passed', 'feedback_received', 'complete'];
        var blocked = testers.filter(function(item) { return item.status === 'login_blocked' || Boolean(item.blocker); }).length;
        var loginPassed = testers.filter(function(item) { return loginReadyStatuses.indexOf(item.status) !== -1; }).length;
        var scenarioPassed = testers.filter(function(item) { return scenarioReadyStatuses.indexOf(item.status) !== -1; }).length;
        var feedbackReceived = testers.filter(function(item) { return item.status === 'feedback_received' || item.status === 'complete' || Boolean(item.feedback); }).length;
        var complete = testers.filter(function(item) { return item.status === 'complete'; }).length;
        var scenarios = {};
        testers.forEach(function(item) { scenarios[item.scenario] = true; });
        var blockers = [];
        if (!productionReady) blockers.push('Runtime readiness is not production-ready.');
        if (!currentOrgId) blockers.push('No organization is selected.');
        if (!testers.length) blockers.push('No paid-pilot testers are recorded for this organization.');
        if (testers.length && !loginPassed) blockers.push('No tester has a recorded login pass yet.');
        if (blocked) blockers.push(number(blocked) + ' tester rows have a login blocker or blocker note.');
        if (testers.length && !guidedSession.ready) blockers.push('Guided session plan is incomplete.');
        if (guidedSession.status === 'blocked') blockers.push('Guided session is blocked.');
        var status = blockers.length ? (testers.length ? 'hold' : 'needs_testers') : 'ready_for_guided_testing';
        return {
          packet_type: 'vaultproof_enterprise_paid_pilot_tester_readiness',
          packet_version: 2,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/testers',
          tester_page: '/app/testers',
          login_url: location.origin + '/app/login',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            member_count: Number(org.member_count || 0),
            project_count: projectCountFromData(org, overview, bootstrap),
            provider_slots: providerCountFromData(overview, bootstrap),
            sso_provider_status: sso.provider_status || 'not confirmed',
            sso_login_mode: sso.login_mode || 'assisted'
          },
          runtime: {
            production_ready: productionReady,
            security_profile: readiness.security_profile || null,
            runtime_tier: displayRuntimeTier(readiness.runtime_tier)
          },
          summary: {
            total_testers: testers.length,
            invited: testers.filter(function(item) { return item.status !== 'not_invited'; }).length,
            login_passed: loginPassed,
            scenario_passed: scenarioPassed,
            feedback_received: feedbackReceived,
            complete: complete,
            blocked: blocked,
            scenario_count: Object.keys(scenarios).length,
            guided_session_ready: guidedSession.ready,
            blockers: blockers
          },
          guided_session: guidedSession,
          testers: testers,
          tester_scenarios: [
            { id: 'login_and_sso', title: 'Login and SSO', path: '/app/login', success: 'Tester signs in and lands on the enterprise dashboard for the selected organization.' },
            { id: 'evidence_review', title: 'Evidence review', path: '/app/evidence', success: 'Tester can explain the evidence packet and confirm no secrets are present.' },
            { id: 'api_proxy_self_test', title: 'API proxy self-test', path: '/app/keys', success: 'Tester reviews dry-run request, caller-lock headers, and blocked-recipient denial evidence.' },
            { id: 'provider_slot_review', title: 'Provider slot review', path: '/app/keys', success: 'Tester can explain provider slot material mode, emergency revoke, and the no-raw-key boundary.' },
            { id: 'security_review', title: 'Security review', path: '/app/security-review', success: 'Security/procurement reviewer can copy the customer-safe packet and list open items.' },
            { id: 'rollout_review', title: 'Rollout review', path: '/app/rollout', success: 'App/platform owner can see first workload, owners, canary, blockers, and rollback path.' },
            { id: 'support_handoff', title: 'Support handoff', path: '/app/support', success: 'Tester understands support boundary, internal admin boundary, and optional incident-response add-on.' }
          ],
          workflow_links: {
            testers: '/app/testers',
            members: '/app/members',
            org_sso: '/app/org',
            evidence: '/app/evidence',
            api_proxy_self_test: '/app/keys',
            security_review: '/app/security-review',
            rollout: '/app/rollout',
            support: '/app/support',
            runbooks: '/app/runbooks'
          },
          operator_actions: [
            'Invite testers from /app/members or confirm SSO assignment before the session.',
            'Run a real login rehearsal for at least one tester before the meeting.',
            'Record the guided session window, facilitator, customer owner, and success criteria before paid-pilot testing.',
            'Assign each tester one primary scenario so feedback is focused.',
            'Record blockers and feedback as metadata only; do not paste passwords, tokens, provider keys, request bodies, or customer payloads.',
            'Move blockers into Launch, Policy Drift, Rollout, Scanner, or Release Evidence before paid traffic.'
          ],
          secrets_excluded: [
            'passwords',
            'browser session tokens',
            'Supabase service-role key',
            'OAuth client secret',
            'provider API keys',
            'encrypted provider shares',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function pilotTesterProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Paid-pilot tester status', packet.status === 'ready_for_guided_testing' ? 'Tester roster has a login pass recorded and no blockers in this browser evidence state.' : 'Hold until testers are recorded, at least one login pass is confirmed, and blockers are resolved.', packet.status, packet.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          row('Tester roster', number(summary.total_testers) + ' testers, ' + number(summary.invited) + ' invited, ' + number(summary.login_passed) + ' login passed, ' + number(summary.scenario_passed) + ' scenario passed, ' + number(summary.feedback_received) + ' feedback received.', summary.total_testers ? 'recorded' : 'missing', summary.total_testers ? 'good' : 'warn'),
          row('Blockers', summary.blocked ? number(summary.blocked) + ' tester blockers need owner follow-up before paid traffic.' : 'No tester blockers are recorded in this browser evidence state.', summary.blocked ? 'blocked' : 'clear', summary.blocked ? 'bad' : 'good'),
          linkRow('Open pilot testers', 'Prepare tester roster, login status, scenario assignment, feedback, and blockers for the paid-pilot walkthrough.', '/app/testers', 'testers', packet.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          row('Secret boundary', 'Tester evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function buildApiProxySelfTestPacket(overview, bootstrap) {
        var slots = providerSlotsFromBootstrap(bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        return {
          status: slots.length && totalCalls > 0 ? 'ready' : 'hold',
          execute_endpoint_pattern: '/api/v1/enterprise/projects/{projectId}/providers/{providerSlug}/execute',
          required_headers: [
            'Authorization: Bearer <VaultProof session or runtime token>',
            'Content-Type: application/json',
            'x-vaultproof-organization: <organization id>',
            'x-vaultproof-customer-gateway: vaultproof-managed',
            'x-vaultproof-client-class: browser'
          ],
          dry_run_contract: 'Use dry_run: true for the customer self-test. The control plane validates auth, caller lock, policy, signing, executor reachability, and audit metadata without exposing provider keys.',
          pass_criteria: [
            'Dry-run request returns accepted/validated execution evidence.',
            'Blocked-recipient email test returns 403 and creates denial evidence.',
            'Activity/Audit shows provider, status, policy, latency, request id, and protected-secret classification.',
            'Customer packet excludes raw provider keys, encrypted shares, service-role keys, and origin-lock values.'
          ],
          traffic_evidence: {
            proxy_calls: totalCalls,
            denied_calls: deniedCalls,
            error_calls: errorCalls
          },
          provider_slots: slots.map(function(slot) {
            return {
              provider: slot.provider || null,
              slug: slot.slug || slot.provider || null,
              material_mode: displayMaterialMode(slot.material_mode || 'missing'),
              material_ready: slot.material_ready === true,
              secret_kind: isEmailProviderName(slot.provider || slot.slug) ? 'email_api_key' : 'provider_api_key'
            };
          }),
          email_walkthrough: {
            providers: emailProviders,
            dry_run_available: emailProviders.length > 0,
            blocked_recipient_test_available: emailProviders.length > 0
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function apiProxySelfTestRows(packet) {
        var traffic = packet.traffic_evidence || {};
        var slots = packet.provider_slots || [];
        var email = packet.email_walkthrough || {};
        return [
          row('API proxy self-test status', packet.status === 'ready' ? 'Provider slots and traffic evidence are visible for a customer dry-run walkthrough.' : 'Hold until a provider slot and at least one proxy test event are visible.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Execute endpoint pattern', packet.execute_endpoint_pattern, 'customer test', 'good'),
          row('Required headers', packet.required_headers.join('; '), 'caller lock', 'good'),
          row('Dry-run contract', packet.dry_run_contract, 'no upstream spend', 'good'),
          row('Provider slots in scope', slots.length ? slots.map(function(slot) { return (slot.slug || slot.provider || 'provider') + ' (' + slot.material_mode + ')'; }).join(', ') : 'No provider slots visible yet.', slots.length + ' slots', slots.length ? 'good' : 'warn'),
          row('Email denial test', email.blocked_recipient_test_available ? 'Protected email dry-run and blocked-recipient test are available for: ' + email.providers.join(', ') + '.' : 'Add an email provider slot to show the denial evidence path.', email.blocked_recipient_test_available ? 'available' : 'todo', email.blocked_recipient_test_available ? 'good' : 'warn'),
          row('Traffic evidence', number(traffic.proxy_calls) + ' calls, ' + number(traffic.error_calls) + ' errors, ' + number(traffic.denied_calls) + ' denied.', traffic.proxy_calls ? 'observed' : 'pending', traffic.error_calls || traffic.denied_calls ? 'warn' : traffic.proxy_calls ? 'good' : 'warn'),
          row('Pass criteria', packet.pass_criteria.join(' '), 'pilot proof', 'good'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var manual = goNoGoManualById(goNoGo);
        var rollback = manual['rollback-owner-confirmed'];
        var budget = manual['budget-monitoring-reviewed'];
        var scannerExposure = buildScannerExposurePacket(overview, bootstrap);
        var keyExposureResponse = buildKeyExposureResponsePacket(overview, bootstrap, scannerExposure);
        var ready = readiness.production_ready === true && Boolean(currentOrgId) && projectCount > 0 && memberCount > 0 && providerCount > 0;
        return {
          status: ready ? 'ready' : 'hold',
          support_model: 'Founder-led launch-week support for the first paid pilot. 24-hour incident response is an optional add-on, not included in the base pilot package.',
          support_page: location.origin + '/app/support',
          guided_pilot_positioning: {
            ready_for: 'Guided design partners and paid pilots where VaultProof walks the customer through one real API/key workflow.',
            not_ready_for: 'Fully self-serve enterprise signup, SSO, broad team invite, production cutover, and unsupported operation.',
            pmf_focus: 'Use the enterprise site for PMF: API-heavy Seed/Series A companies building AI agents, preparing for SOC 2, or fighting credential sprawl.'
          },
          buyer_qualification: [
            'Seed or Series A, 10-50 people, API-heavy product, AI/fintech/devtools/healthtech/data/security-adjacent.',
            'Trigger is live: just raised, security review coming, SOC 2 in progress, AI agents touching keys, or engineering team scaling.',
            'Buyer can name one real provider/API key, the app that uses it, the owner, and the risk if it leaks.',
            'Good call outcome is a tester, technical review, paid-pilot path, or clear customer quote that proves the pain.'
          ],
          guided_demo_sequence: [
            'Dashboard: runtime posture, org scope, workspace tabs, and where the customer starts.',
            'API Inventory: owners, risk, environment, provider-slot mapping, review state, and evidence export.',
            'Provider Slots: material status, dry-run, blocked-recipient denial, emergency revoke, and key exposure response.',
            'Policy, Activity, Audit, Evidence, Security Review: show controls, proof, and customer-safe exports.',
            'Pilot Testers and Pilot Proposal: close on one workload, one provider path, one owner group, and one success metric.'
          ],
          customer_setup_sequence: [
            'Create or confirm the business in admin.vaultproof.dev, then invite the first owner or confirm the login path.',
            'Pick SSO mode, first workload, provider path, owner group, success metric, and testing window.',
            'Record the API surface in /app/inventory, confirm project scope, and map it to the provider slot.',
            'Configure provider slot and policy, then run dry-run before live upstream dispatch.',
            'Confirm Activity, Audit, Evidence, Tester readiness, and Customer Success before asking for expansion.'
          ],
          internal_admin_surface: 'VaultProof staff/admin belongs to the separate VaultProof B2C/root admin system, not enterprise.vaultproof.dev.',
          internal_admin_boundary: {
            hostname: 'vaultproof.dev admin system',
            default_mode: 'read_only',
            writes: 'Support notes, invitations, business status updates, destructive action requests, executions, and rollbacks require internal admin actions to be enabled plus the approval secret header.',
            audit: 'Employee console views and approved actions are recorded in the internal admin audit stream.',
            customer_access: 'Customers do not receive access to the employee admin console; they receive evidence exports, support summaries, and approved action notes.'
          },
          coverage: {
            organization_id: currentOrgId || null,
            organization_name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCount,
            member_count: memberCount,
            provider_slots: providerCount,
            proxy_calls: Number(overview.totalCalls || 0),
            denied_calls: Number(overview.deniedCalls || 0),
            error_calls: Number(overview.errorCalls || 0),
            runtime_production_ready: readiness.production_ready === true,
            security_profile: readiness.security_profile || null
          },
          manual_evidence: {
            rollback_owner_path: manualEvidenceSummary(rollback),
            budget_monitoring: manualEvidenceSummary(budget)
          },
          exposure_response: {
            status: keyExposureResponse.status,
            decision: keyExposureResponse.decision,
            summary: keyExposureResponse.summary,
            workflow_links: keyExposureResponse.workflow_links,
            proof_boundary: keyExposureResponse.proof_boundary,
            operator_actions: keyExposureResponse.operator_actions
          },
          launch_week_workflow: [
            'Review /readiness, /app/evidence, /app/activity, /app/audit, /app/keys, /app/alerts, and /app/support before each customer test.',
            'Record customer-visible notes in the launch brief or evidence packet, not in chat threads.',
            'Use the separate VaultProof staff/admin system only for employee support triage and approval-gated administrative actions.',
            'Escalate real incidents to the customer incident-response team unless 24-hour response is sold as an add-on.',
            'Export audit/access-review evidence after policy, key, member, or support-action changes.'
          ],
          customer_handoff: [
            'Evidence JSON from /app/evidence.',
            'Support brief from /app/support.',
            'Key exposure response JSON from /app/keys when an exposure review is active.',
            'Audit CSV and access-review CSV.',
            'API proxy self-test output from /app/keys.',
            'Named rollback owner/path and budget/monitoring review status.'
          ],
          operator_commands: [
            'npm run qa:enterprise-live-app',
            'npm run verify:gcp-enterprise-edge',
            'npm run verify:gcp-enterprise-cloud-armor',
            'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch',
            'Confirm staff/admin tooling is not exposed on enterprise.vaultproof.dev'
          ],
          secrets_excluded: [
            'Supabase service-role key',
            'browser session token',
            'provider API keys',
            'encrypted provider shares',
            'origin-lock secret',
            'executor signing secret',
            'internal admin approval secret'
          ]
        };
      }
      function launchSupportReadinessRows(packet) {
        var coverage = packet.coverage || {};
        return [
          row('Launch support status', packet.status === 'ready' ? 'Support page can be used for customer pilot prep with runtime, org, member, project, and provider evidence visible.' : 'Hold until runtime, org, member, project, and provider evidence are visible.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Support model', packet.support_model, 'founder-led launch-week support', 'good'),
          row('Runtime support posture', (coverage.runtime_production_ready ? 'Production-ready runtime. ' : 'Runtime is not production-ready. ') + 'Security profile: ' + (coverage.security_profile || 'not reported') + '.', coverage.runtime_production_ready ? 'ready' : 'blocked', coverage.runtime_production_ready ? 'good' : 'bad'),
          row('Customer scope', number(coverage.project_count) + ' projects, ' + number(coverage.member_count) + ' members, ' + number(coverage.provider_slots) + ' provider slots.', currentOrgId ? 'scoped' : 'select org', currentOrgId ? 'good' : 'warn'),
          row('Traffic watch', number(coverage.proxy_calls) + ' calls, ' + number(coverage.error_calls) + ' errors, ' + number(coverage.denied_calls) + ' denied.', coverage.proxy_calls ? 'observed' : 'pending', coverage.error_calls || coverage.denied_calls ? 'warn' : coverage.proxy_calls ? 'good' : 'warn')
        ];
      }
      function launchSupportGuidedPilotRows(packet) {
        var positioning = packet.guided_pilot_positioning || {};
        return [
          row('Are we ready?', positioning.ready_for || 'Ready for guided design partners and paid pilots.', 'guided pilot', 'good'),
          row('Do not promise yet', positioning.not_ready_for || 'Do not position VaultProof as fully self-serve enterprise onboarding yet.', 'not self-serve', 'warn'),
          row('PMF focus', positioning.pmf_focus || 'Use enterprise pilots to find product-market fit.', 'enterprise first', 'good'),
          row('Demo sequence', (packet.guided_demo_sequence || []).join(' '), 'talk track', 'good'),
          linkRow('Full repo playbook', 'Use docs/enterprise/guided-pilot-playbook.md for outreach, qualification, call agenda, setup steps, and PMF review.', '/app/support', 'internal doc', 'good')
        ];
      }
      function launchSupportQualificationRows(packet) {
        return [
          row('Ideal customer', (packet.buyer_qualification || []).join(' '), 'ICP', 'good'),
          row('First call ask', 'Ask for a guided walkthrough to see whether VaultProof solves a real key-security problem. Do not ask them to self-onboard alone.', 'guided demo', 'good'),
          row('Strong PMF signal', 'They can name one provider key, owner, app, security trigger, and next tester or technical reviewer.', 'signal', 'good'),
          row('Weak PMF signal', 'They need a fully self-serve procurement-grade rollout before trying one guided workflow, or cannot name a real API/key problem.', 'filter', 'warn')
        ];
      }
      function launchSupportSetupSequenceRows(packet) {
        var setup = packet.customer_setup_sequence || [];
        return [
          row('Guided setup order', setup.join(' '), 'onboarding', 'good'),
          linkRow('API Inventory', 'Record the customer API surface, owners, environment, risk, data sensitivity, and provider-slot mapping.', '/app/inventory', 'step 1', 'good'),
          linkRow('Provider Slots', 'Create or review the protected provider slot, dry-run request, material status, policy denial, and exposure response.', '/app/keys', 'step 2', 'good'),
          linkRow('Pilot Testers', 'Record tester roster, login state, scenario, feedback, blockers, session window, and customer success criteria.', '/app/testers', 'step 3', 'good'),
          linkRow('Customer Success', 'After the guided session, capture weekly update copy, milestones, blockers, and expansion or hold decision.', '/app/pilot-success', 'step 4', 'good')
        ];
      }
      function launchSupportBoundaryRows(packet) {
        var boundary = packet.internal_admin_boundary || {};
        return [
          row('Employee admin surface', packet.internal_admin_surface || 'VaultProof employee admin stays off the customer dashboard.', boundary.hostname || 'separate host', 'good'),
          row('Internal admin default mode', 'The support console is ' + (boundary.default_mode || 'read_only') + ' by default.', boundary.default_mode || 'read_only', 'good'),
          row('Approval-gated actions', boundary.writes || 'Administrative writes require explicit approval.', 'approval secret header', 'warn'),
          row('Internal audit', boundary.audit || 'Employee support views and actions are audited.', 'audit trail', 'good'),
          row('Customer boundary', boundary.customer_access || 'Customers receive evidence exports, not employee-console access.', 'no customer admin access', 'good')
        ];
      }
      function launchSupportWorkflowRows(packet) {
        return [
          row('Launch-week workflow', packet.launch_week_workflow.join(' '), 'runbook', 'good'),
          row('Operator commands', packet.operator_commands.join(' | '), 'verification', 'good'),
          row('Rollback evidence', packet.manual_evidence.rollback_owner_path.updated_at ? 'Rollback owner/path recorded ' + rel(packet.manual_evidence.rollback_owner_path.updated_at) + '.' : 'Rollback owner/path has not been recorded in this browser evidence yet.', packet.manual_evidence.rollback_owner_path.status || 'missing', packet.manual_evidence.rollback_owner_path.status === 'passed' ? 'good' : 'warn'),
          row('Budget/monitoring evidence', packet.manual_evidence.budget_monitoring.updated_at ? 'Budget/monitoring recorded ' + rel(packet.manual_evidence.budget_monitoring.updated_at) + '.' : 'Budget/monitoring review has not been recorded in this browser evidence yet.', packet.manual_evidence.budget_monitoring.status || 'missing', packet.manual_evidence.budget_monitoring.status === 'passed' ? 'good' : 'warn')
        ];
      }
      function launchSupportExposureRows(packet) {
        var response = packet.exposure_response || {};
        var summary = response.summary || {};
        var boundary = response.proof_boundary || {};
        return [
          row('Exposure response status', response.decision || 'Key exposure response packet is not available yet.', response.status || 'missing', response.status === 'hold' ? 'bad' : response.status === 'ready_to_contain' ? 'good' : 'warn'),
          row('Provider-slot containment', number(summary.total_provider_slots) + ' slots in scope; ' + number(summary.live_sealed_slots) + ' live-sealed; ' + number(summary.provider_slots_needing_rotation) + ' need rotation or review.', summary.total_provider_slots ? 'slots' : 'missing', summary.provider_slots_needing_rotation ? 'warn' : 'good'),
          row('Linked scanner findings', number(summary.linked_scanner_findings) + ' linked findings; ' + number(summary.open_critical_or_high_linked_findings) + ' linked critical/high findings remain open.', summary.open_critical_or_high_linked_findings ? 'hold' : 'review', summary.open_critical_or_high_linked_findings ? 'bad' : 'good'),
          linkRow('Provider Slots incident JSON', 'Copy the customer-safe exposure response JSON and use emergency revoke for affected provider slots.', '/app/keys', 'incident', 'good'),
          linkRow('Scanner remediation', 'Update scanner findings after rotation, revoke, false-positive review, or pilot-limited acceptance.', '/app/scanner', 'scanner', summary.open_critical_or_high_linked_findings ? 'warn' : 'good'),
          linkRow('Runbook sequence', 'Use the operator runbook for activity/audit exports, proof-boundary language, and response order.', '/app/runbooks', 'runbook', 'good'),
          row('Proof boundary', (boundary.vaultproof_controls || '') + ' ' + (boundary.outside_boundary || ''), 'boundary', 'good')
        ];
      }
      function launchSupportHandoffRows(packet) {
        return [
          row('Customer handoff package', packet.customer_handoff.join(' '), 'shareable', 'good'),
          row('Support page', packet.support_page, 'customer-safe', 'good'),
          row('Incident response boundary', '24-hour incident response add-on is optional; base pilot uses customer incident-response team plus VaultProof launch support.', 'contract', 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function launchSupportProofRows(packet) {
        return launchSupportReadinessRows(packet)
          .concat(launchSupportBoundaryRows(packet))
          .concat(launchSupportExposureRows(packet))
          .concat(launchSupportHandoffRows(packet));
      }
      function buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var manual = goNoGoManualById(goNoGo);
        var cloudArmor = manual['cloud-armor-verified'];
        var budget = manual['budget-monitoring-reviewed'];
        var rollback = manual['rollback-owner-confirmed'];
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var runtimeReady = readiness.production_ready === true;
        var ready = runtimeReady && Boolean(currentOrgId) && projectCount > 0 && providerCount > 0 && totalCalls > 0 && cloudArmor && cloudArmor.passed && budget && budget.passed;
        return {
          status: ready ? 'ready' : 'hold',
          decision: ready ? 'Monitoring evidence is ready for launch-week customer testing.' : 'Hold until runtime readiness, traffic evidence, Cloud Armor verification, and budget/monitoring review are recorded.',
          monitoring_page: location.origin + '/app/alerts',
          readiness_source: location.origin + '/readiness',
          manual_evidence: {
            cloud_armor_verification: manualEvidenceSummary(cloudArmor),
            budget_monitoring: manualEvidenceSummary(budget),
            rollback_owner_path: manualEvidenceSummary(rollback)
          },
          telemetry: {
            runtime_production_ready: runtimeReady,
            security_profile: readiness.security_profile || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCount,
            provider_slots: providerCount,
            proxy_calls: totalCalls,
            denied_calls: deniedCalls,
            error_calls: errorCalls
          },
          signals: [
            'Runtime posture from /readiness.',
            'Traffic, denial, and error posture from enterprise overview/bootstrap data.',
            'Alert destinations, delivery logs, and test-send workflow from /app/alerts.',
            'Cloud Armor verification is operator-confirmed until policy state is exposed through a trusted backend source.',
            'Budget/monitoring review is operator-confirmed in the launch board for this pilot workflow.'
          ],
          operator_commands: {
            live_gate: 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch',
            cloud_armor_verification: 'npm run verify:gcp-enterprise-cloud-armor',
            live_app_qa: 'npm run qa:enterprise-live-app',
            edge_verification: 'npm run verify:gcp-enterprise-edge',
            evidence_bundle: 'npm run evidence:enterprise-production'
          },
          budget_alert: 'VaultProof Production Monthly USD 50 alerting budget. Raise or tune before a paid pilot because the fixed shared-runtime estimate is about $85-$90/month before traffic.',
          customer_handoff: [
            'Open /app/alerts to review destinations, delivery logs, dispatch runs, and test-send behavior.',
            'Open /app/activity for runtime status, latency, denial, and provider request evidence.',
            'Open /app/audit and /app/evidence for customer-safe exports.',
            'Keep launch-week owner coverage and rollback owner/path visible before pilot traffic.'
          ],
          secrets_excluded: [
            'alert webhook secrets',
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function monitoringEvidenceRows(packet) {
        var telemetry = packet.telemetry || {};
        var manual = packet.manual_evidence || {};
        var cloudArmor = manual.cloud_armor_verification || {};
        var budget = manual.budget_monitoring || {};
        return [
          row('Monitoring evidence status', packet.decision, packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Runtime readiness signal', (telemetry.runtime_production_ready ? 'Runtime reports production-ready. ' : 'Runtime is not production-ready. ') + 'Security profile: ' + (telemetry.security_profile || 'not reported') + '.', telemetry.runtime_production_ready ? 'ready' : 'blocked', telemetry.runtime_production_ready ? 'good' : 'bad'),
          row('Traffic, denial, and error watch', number(telemetry.proxy_calls) + ' calls, ' + number(telemetry.error_calls) + ' errors, ' + number(telemetry.denied_calls) + ' denied across ' + number(telemetry.project_count) + ' projects and ' + number(telemetry.provider_slots) + ' provider slots.', telemetry.proxy_calls ? 'observed' : 'pending', telemetry.error_calls || telemetry.denied_calls ? 'warn' : telemetry.proxy_calls ? 'good' : 'warn'),
          row('Alert operations path', 'Use ' + packet.monitoring_page + ' to review destinations, delivery logs, dispatch runs, and test-send workflow before customer traffic.', 'alerts', 'good'),
          row('Cloud Armor verification timestamp', cloudArmor.updated_at ? 'Verified ' + rel(cloudArmor.updated_at) + (cloudArmor.stale ? '; stale after 7 days.' : '.') : 'No Cloud Armor verification timestamp is saved in this browser evidence yet.', cloudArmor.status || 'missing', cloudArmor.status === 'passed' && !cloudArmor.stale ? 'good' : 'warn'),
          row('Budget/monitoring review timestamp', budget.updated_at ? 'Reviewed ' + rel(budget.updated_at) + (budget.stale ? '; stale after 7 days.' : '.') : 'No budget/monitoring review timestamp is saved in this browser evidence yet.', budget.status || 'missing', budget.status === 'passed' && !budget.stale ? 'good' : 'warn'),
          row('Budget alert', packet.budget_alert, 'cost guardrail', 'warn'),
          row('Live monitoring gate', packet.operator_commands.live_gate, 'strict gate', 'good'),
          row('Customer monitoring handoff', packet.customer_handoff.join(' '), 'shareable', 'good'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var apiInventory = buildApiInventoryPacket(overview, bootstrap);
        var policyDrift = buildPolicyDriftPacket(overview, bootstrap);
        var integrationRollout = buildIntegrationRolloutPacket(overview, bootstrap);
        var scannerExposure = buildScannerExposurePacket(overview, bootstrap);
        var keyExposureResponse = buildKeyExposureResponsePacket(overview, bootstrap, scannerExposure);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var releaseEvidence = buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap);
        var pilotTesters = buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var entitlements = buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var onboarding = buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var productionReady = readiness.production_ready === true;
        var blockers = Array.isArray(goNoGo.blockers) ? goNoGo.blockers : [];
        var status = productionReady && currentOrgId ? 'ready_for_review' : 'hold';
        return {
          packet_type: 'vaultproof_enterprise_security_review_packet',
          packet_version: 1,
          status: status,
          decision: status === 'ready_for_review' ? 'Ready to share for customer security review with live evidence links and explicit launch blockers.' : 'Hold until runtime readiness and organization scope are visible.',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/security-review',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            role: org.role || null,
            project_count: projectCount,
            member_count: memberCount,
            provider_slots: providerCount,
            sso_provider_status: sso.provider_status || 'not confirmed'
          },
          architecture: [
            'Enterprise browser calls only organization-scoped /api/v1/enterprise APIs on enterprise.vaultproof.dev.',
            'The control plane validates session, organization membership, project access, caller lock, policy, and request signing metadata.',
            'Protected provider work is sent to the secure executor through the enterprise runtime path.',
            'The executor verifies request signatures, replay protection, attestation posture, and key-release readiness before using protected provider material.',
            'GCP edge, origin lock, Cloud Armor, request-size limits, and runtime readiness checks sit in front of the shared pilot runtime.'
          ],
          controls: [
            { name: 'Identity and RBAC', status: identityQa.status, tone: identityQa.status === 'ready' ? 'good' : 'warn', detail: 'Supabase-brokered enterprise session plus VaultProof organization membership, roles, project assignment, and access-review exports.' },
            { name: 'Caller-lock policy', status: 'built', tone: 'good', detail: 'Control policy can bind protected calls to approved origins, gateways, CIDRs, methods, upstream hosts, path prefixes, provider families, and rate limits.' },
            { name: 'Provider key custody', status: displayPilotStatus(rotation.status), tone: rotation.status === 'accepted_for_pilot' ? 'good' : 'warn', detail: 'Provider slots expose posture and material mode without returning plaintext keys or encrypted shares to customer browsers.' },
            { name: 'API inventory', status: apiInventory.status, tone: apiInventory.status === 'ready' ? 'good' : 'warn', detail: 'API surfaces are derived from projects, provider slots, policy, traffic evidence, and browser-local owner/review metadata without storing secrets.' },
            { name: 'Policy drift and exceptions', status: policyDrift.status, tone: policyDrift.status === 'hold' ? 'warn' : 'good', detail: 'Policy drift rows are derived from existing project/provider/policy/traffic evidence, with browser-local accepted-risk records, owners, expiry, and compensating controls.' },
            { name: 'Integration rollout', status: integrationRollout.status, tone: integrationRollout.status === 'hold' ? 'warn' : 'good', detail: 'Rollout rows tie API inventory, policy drift, owners, canary status, rollback path, and copy-safe dry-run snippets into one customer cutover plan.' },
            { name: 'Secret exposure review', status: scannerExposure.status, tone: scannerExposure.status === 'hold' ? 'warn' : 'good', detail: 'Scanner intake records redacted repository exposure metadata, owners, rotation/remediation status, and customer-safe evidence references without uploading repo contents or secret values.' },
            { name: 'Key exposure response', status: keyExposureResponse.status, tone: keyExposureResponse.status === 'hold' ? 'bad' : keyExposureResponse.status === 'ready_to_contain' ? 'good' : 'warn', detail: 'Provider Slots ties exposure findings to protected provider slots, emergency revoke, rotation review, customer-safe incident JSON, and an explicit VaultProof proof boundary.' },
            { name: 'Release evidence', status: releaseEvidence.status, tone: releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn', detail: 'Release evidence records build/image tags, approver, verifier, QA/gate summary, rollout state, rollback owner/path, and customer-safe notes without exposing secrets.' },
            { name: 'Paid-pilot tester readiness', status: pilotTesters.status, tone: pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn', detail: 'Pilot tester evidence tracks roster, login status, scenario assignments, feedback, and blockers in browser-local metadata without storing secrets.' },
            { name: 'Contract entitlements', status: entitlements.status, tone: entitlements.status === 'ready_for_paid_pilot' ? 'good' : 'warn', detail: 'Contract package, capacity envelope, support tier, renewal owner, and incident-response boundary are tracked as customer-safe browser-local metadata for the paid pilot.' },
            { name: 'Paid customer onboarding', status: onboarding.status, tone: onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn', detail: 'Activation milestones connect entitlements, launch readiness, customer login handoff, first workload ownership, support coverage, and customer testing evidence.' },
            { name: 'Runtime attestation', status: productionReady ? 'ready' : 'blocked', tone: productionReady ? 'good' : 'bad', detail: 'Readiness reports GCP confidential production posture, key release readiness, signature verification, replay protection, and executor reachability.' },
            { name: 'Audit and evidence', status: 'exportable', tone: 'good', detail: 'Evidence packet, audit CSV, access-review CSV, activity records, launch brief, and security review packet are customer-safe review artifacts.' },
            { name: 'Monitoring and edge protection', status: monitoring.status, tone: monitoring.status === 'ready' ? 'good' : 'warn', detail: 'Monitoring evidence links readiness, traffic/error/denial posture, alert workflow, Cloud Armor verification, live gate, and budget guardrails.' },
            { name: 'Support boundary', status: support.status, tone: support.status === 'ready' ? 'good' : 'warn', detail: 'Founder-led launch-week support is packaged with internal admin boundaries and optional 24-hour incident-response add-on language.' }
          ],
          evidence_links: [
            { title: 'Readiness', href: '/readiness', detail: 'Runtime, executor, key release, attestation, origin-lock, and production blocker summary.', tag: productionReady ? 'ready' : 'blocked', tone: productionReady ? 'good' : 'bad' },
            { title: 'Evidence packet', href: '/app/evidence', detail: 'Customer-safe JSON proof, audit/access exports, identity, rotation, operations, proxy, support, and monitoring evidence.', tag: 'packet', tone: 'good' },
            { title: 'Audit CSV', href: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'), detail: 'Governance and runtime event export for review.', tag: 'csv', tone: 'good' },
            { title: 'Access review CSV', href: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv'), detail: 'Members, roles, invitations, and project assignments.', tag: 'csv', tone: 'good' },
            { title: 'Activity', href: '/app/activity', detail: 'Runtime status codes, latency, provider request IDs, denials, and attestation hints.', tag: 'events', tone: 'good' },
            { title: 'API Inventory', href: '/app/inventory', detail: 'API catalog with owners, environment, risk, provider-slot mapping, policy posture, traffic evidence, review status, and JSON export.', tag: apiInventory.status, tone: apiInventory.status === 'ready' ? 'good' : 'warn' },
            { title: 'Policy Drift', href: '/app/policy', detail: 'Control gaps, placeholder material, owner gaps, stale traffic, accepted-risk records, expiry dates, and customer-safe JSON export.', tag: policyDrift.status, tone: policyDrift.status === 'hold' ? 'warn' : 'good' },
            { title: 'Rollout Manager', href: '/app/rollout', detail: 'Workload cutover plan with owners, integration mode, canary percentage, test status, rollback path, blockers, and evidence export.', tag: integrationRollout.status, tone: integrationRollout.status === 'hold' ? 'warn' : 'good' },
            { title: 'Scanner Exposure', href: '/app/scanner', detail: 'Redacted repository exposure findings, owners, rotation status, scanner evidence references, and remediation workflow.', tag: scannerExposure.status, tone: scannerExposure.status === 'hold' ? 'warn' : 'good' },
            { title: 'Key Exposure Response', href: '/app/keys', detail: 'Provider-slot incident mode with linked scanner findings, emergency revoke, rotation scope, and customer-safe response JSON.', tag: keyExposureResponse.status, tone: keyExposureResponse.status === 'hold' ? 'bad' : keyExposureResponse.status === 'ready_to_contain' ? 'good' : 'warn' },
            { title: 'Release Evidence', href: '/app/release', detail: 'Build/image tag, approval, verification, rollout state, rollback owner/path, and customer-safe release proof.', tag: releaseEvidence.status, tone: releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn' },
            { title: 'Tester readiness', href: '/app/testers', detail: 'Paid-user tester roster, login readiness, scenario assignment, feedback capture, blocker state, and JSON packet.', tag: pilotTesters.status, tone: pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn' },
            { title: 'Entitlements', href: '/app/entitlements', detail: 'Contract capacity, support tier, renewal/review date, billing owner, success owner, and paid-user guardrails.', tag: entitlements.status, tone: entitlements.status === 'ready_for_paid_pilot' ? 'good' : 'warn' },
            { title: 'Alerts', href: '/app/alerts', detail: 'Destinations, delivery logs, dispatch runs, and test-send workflow.', tag: 'monitoring', tone: 'good' },
            { title: 'Provider slots', href: '/app/keys', detail: 'Provider material mode, rotation status, dry-run self-test, protected email workflow, and emergency revoke.', tag: 'keys', tone: providerCount ? 'good' : 'warn' },
            { title: 'Technical guide', href: '/app/technical-guide', detail: 'Architecture, identity, network, key custody, caller lock, evidence, and troubleshooting answers.', tag: 'guide', tone: 'good' },
            { title: 'Runbooks', href: '/app/runbooks', detail: 'Read-only verification commands, evidence bundle, launch gate, and gated infrastructure actions.', tag: 'ops', tone: 'good' }
          ],
          open_items: blockers.length ? blockers.map(function(blocker) { return { title: blocker, detail: 'Close or explicitly accept this launch blocker before paid customer traffic.', tag: 'blocker', tone: 'warn' }; }) : [
            { title: 'No critical go/no-go blockers in this browser evidence state', detail: 'Still review customer-specific contract, traffic, retention, support, and incident-response expectations before paid rollout.', tag: 'review', tone: 'good' }
          ],
          known_limitations: [
            'Manual go/no-go evidence is browser-local for this pilot workflow; persistent audit-backed manual evidence can come later.',
            'Plan limits, traffic envelopes, retention terms, and support cadence remain contract-controlled until billing/limits APIs are built.',
            '24-hour incident response is optional add-on coverage unless the customer contract includes it.',
            'VaultProof can prove and control routed provider usage; direct raw-key use outside VaultProof still requires upstream provider rotation and customer-side log review.'
          ],
          security_answers: [
            { question: 'Will provider keys appear in the browser or evidence packet?', answer: 'No. Customer pages show provider posture and material mode only. Raw keys, encrypted shares, service-role keys, origin-lock values, signing secrets, alert webhook secrets, and unwrap roots are excluded.' },
            { question: 'How is a stolen browser session limited?', answer: 'The session still needs organization membership, project access, caller-lock policy, allowed provider/upstream policy, rate limits, request signing, executor verification, and runtime readiness before protected provider work proceeds.' },
            { question: 'What happens after an external platform or repository key exposure?', answer: 'Provider Slots can copy a customer-safe incident packet, show linked scanner findings, emergency revoke VaultProof-routed provider use, and guide upstream rotation. Direct raw-key use outside VaultProof remains outside the VaultProof proof boundary.' },
            { question: 'What can the customer export for review?', answer: 'Readiness, evidence packet JSON, audit CSV, access-review CSV, activity records, launch brief, and this security review packet.' },
            { question: 'Who owns incident response?', answer: 'Base pilot uses the customer incident-response team plus VaultProof launch support. 24-hour incident response can be sold as an add-on.' }
          ],
          related_packets: {
            go_no_go_status: goNoGo.status,
            identity_login_qa: identityQa.status,
            key_rotation_evidence: displayPilotStatus(rotation.status),
            pilot_operations_evidence: pilotOps.status,
            api_proxy_self_test: apiProxy.status,
            api_inventory: apiInventory.status,
            policy_drift_exceptions: policyDrift.status,
            integration_rollout: integrationRollout.status,
            scanner_exposure_review: scannerExposure.status,
            key_exposure_response: keyExposureResponse.status,
            launch_support_readiness: support.status,
            release_evidence: releaseEvidence.status,
            pilot_tester_readiness: pilotTesters.status,
            contract_entitlements: entitlements.status,
            paid_onboarding: onboarding.status,
            monitoring_evidence: monitoring.status
          },
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'alert webhook secrets',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function securityReviewStatusRows(packet) {
        var org = packet.organization || {};
        return [
          row('Security review packet status', packet.decision, packet.status, packet.status === 'ready_for_review' ? 'good' : 'warn'),
          row('Organization scope', (org.name || 'Selected workspace') + ' with ' + number(org.project_count) + ' projects, ' + number(org.member_count) + ' members, and ' + number(org.provider_slots) + ' provider slots.', org.id ? 'scoped' : 'select org', org.id ? 'good' : 'warn'),
          row('Go/no-go decision', 'Current launch board status is ' + packet.related_packets.go_no_go_status + '.', packet.related_packets.go_no_go_status, packet.related_packets.go_no_go_status === 'go' ? 'good' : 'warn'),
          row('Related proof packets', 'Identity: ' + packet.related_packets.identity_login_qa + '. Rotation: ' + packet.related_packets.key_rotation_evidence + '. Pilot ops: ' + packet.related_packets.pilot_operations_evidence + '. Proxy self-test: ' + packet.related_packets.api_proxy_self_test + '. API inventory: ' + packet.related_packets.api_inventory + '. Policy drift: ' + packet.related_packets.policy_drift_exceptions + '. Rollout: ' + packet.related_packets.integration_rollout + '. Scanner: ' + packet.related_packets.scanner_exposure_review + '. Exposure response: ' + packet.related_packets.key_exposure_response + '. Release: ' + packet.related_packets.release_evidence + '. Testers: ' + packet.related_packets.pilot_tester_readiness + '. Entitlements: ' + packet.related_packets.contract_entitlements + '. Paid onboarding: ' + packet.related_packets.paid_onboarding + '. Monitoring: ' + packet.related_packets.monitoring_evidence + '.', 'summary', 'good'),
          row('Secret boundary', 'This packet excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function securityReviewControlRows(packet) {
        return packet.controls.map(function(control) {
          return row(control.name, control.detail, control.status, control.tone);
        });
      }
      function securityReviewEvidenceRows(packet) {
        return packet.evidence_links.map(function(link) {
          return linkRow(link.title, link.detail, link.href, link.tag, link.tone);
        });
      }
      function securityReviewOpenFilterState() {
        return {
          search: ((byId('securityReviewOpenSearch') && byId('securityReviewOpenSearch').value) || '').trim().toLowerCase(),
          type: (byId('securityReviewOpenType') && byId('securityReviewOpenType').value) || ''
        };
      }
      function securityReviewOpenItems(packet) {
        return (packet.open_items || []).map(function(item) {
          return {
            title: item.title,
            detail: item.detail,
            tag: item.tag,
            tone: item.tone,
            type: item.tag === 'blocker' ? 'blocker' : 'review'
          };
        }).concat((packet.known_limitations || []).map(function(item) {
          return {
            title: 'Known limitation',
            detail: item,
            tag: 'transparent',
            tone: 'warn',
            type: 'known_limitation'
          };
        }));
      }
      function securityReviewOpenItemMatches(item, filters) {
        var textValue = [item.title, item.detail, item.tag, item.type].filter(Boolean).join(' ').toLowerCase();
        if (filters.search && textValue.indexOf(filters.search) === -1) return false;
        if (filters.type && item.type !== filters.type) return false;
        return true;
      }
      function filteredSecurityReviewOpenItems(packet, filters) {
        var currentFilters = filters || securityReviewOpenFilterState();
        return securityReviewOpenItems(packet).filter(function(item) {
          return securityReviewOpenItemMatches(item, currentFilters);
        });
      }
      function renderSecurityReviewOpenItems(packet) {
        if (PAGE_MODE !== 'security-review') return;
        var filters = securityReviewOpenFilterState();
        var items = filteredSecurityReviewOpenItems(packet, filters);
        var allItems = securityReviewOpenItems(packet);
        text('securityReviewOpenMeta', (items.length !== allItems.length || filters.search || filters.type ? number(items.length) + ' of ' : '') + number(allItems.length) + ' items');
        byId('securityReviewOpenList').innerHTML = items.length ? items.map(function(item) {
          return row(item.title, item.detail, item.tag, item.tone);
        }).join('') : '<div class="empty">No security review items match these filters.</div>';
      }
      function securityReviewBriefText(packet) {
        return [
          'VaultProof Enterprise security review packet',
          'Generated: ' + packet.generated_at,
          'Status: ' + packet.status,
          'Decision: ' + packet.decision,
          '',
          'Organization:',
          '- Name: ' + (packet.organization.name || 'selected workspace'),
          '- Projects: ' + number(packet.organization.project_count),
          '- Members: ' + number(packet.organization.member_count),
          '- Provider slots: ' + number(packet.organization.provider_slots),
          '- SSO/login status: ' + (packet.organization.sso_provider_status || 'not confirmed'),
          '',
          'Architecture summary:',
          '- ' + packet.architecture.join('\\n- '),
          '',
          'Control coverage:',
          '- ' + packet.controls.map(function(control) { return control.name + ': ' + control.status + ' - ' + control.detail; }).join('\\n- '),
          '',
          'Evidence links:',
          '- ' + packet.evidence_links.map(function(link) { return link.title + ': ' + location.origin + link.href; }).join('\\n- '),
          '',
          'Open review items:',
          '- ' + packet.open_items.map(function(item) { return item.title + ': ' + item.detail; }).join('\\n- '),
          '',
          'Known limitations:',
          '- ' + packet.known_limitations.join('\\n- '),
          '',
          'Common answers:',
          '- ' + packet.security_answers.map(function(item) { return item.question + ' ' + item.answer; }).join('\\n- '),
          '',
          'Secrets excluded:',
          '- ' + packet.secrets_excluded.join('\\n- ')
        ].join('\\n');
      }
      function securityReviewFocusBriefText(packet) {
        var filters = securityReviewOpenFilterState();
        var items = filteredSecurityReviewOpenItems(packet, filters);
        var blockerCount = items.filter(function(item) { return item.type === 'blocker'; }).length;
        var limitationCount = items.filter(function(item) { return item.type === 'known_limitation'; }).length;
        return [
          'VaultProof Enterprise security review brief',
          'Generated: ' + packet.generated_at,
          'Status: ' + packet.status,
          'Organization: ' + (packet.organization.name || 'selected workspace'),
          'Scope: ' + (filters.search || filters.type ? 'filtered open review items' : 'all open review items') + ' (' + number(items.length) + ' item(s))',
          '',
          'Decision:',
          '- ' + packet.decision,
          '',
          'Open review summary:',
          '- Blockers: ' + number(blockerCount),
          '- Known limitations: ' + number(limitationCount),
          '- Go/no-go: ' + packet.related_packets.go_no_go_status,
          '- API inventory: ' + packet.related_packets.api_inventory,
          '- Policy drift: ' + packet.related_packets.policy_drift_exceptions,
          '- Integration rollout: ' + packet.related_packets.integration_rollout,
          '- Monitoring: ' + packet.related_packets.monitoring_evidence,
          '',
          'Items to discuss:',
          items.length ? '- ' + items.map(function(item) { return item.title + ': ' + item.detail; }).join('\\n- ') : '- No open review items match the current filter.',
          '',
          'Secret boundary:',
          '- This brief is metadata-only and excludes ' + packet.secrets_excluded.join(', ') + '.'
        ].join('\\n');
      }
      function parseMoney(value, fallback) {
        var parsed = Number(String(value || '').replace(/[^0-9.]/g, ''));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      }
      function buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var state = getPilotProposalState();
        var monthlyPrice = parseMoney(state.monthly_price_usd, 5000);
        var monthlyCalls = parseMoney(state.monthly_calls, 100000);
        var salesCommission = Math.round(monthlyPrice * 0.2);
        var netAfterCommission = monthlyPrice - salesCommission;
        var providerCount = providerCountFromData(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var productionReady = readiness.production_ready === true;
        var proposalReady = Boolean(state.workload && state.provider_path && state.owner_group && state.success_metric);
        return {
          packet_type: 'vaultproof_enterprise_pilot_proposal',
          packet_version: 1,
          status: proposalReady && productionReady && currentOrgId ? 'ready_to_send' : 'draft',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/pilot',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCountFromData(org, overview, bootstrap),
            member_count: Number(org.member_count || 0),
            provider_slots: providerCount,
            email_providers: emailProviders
          },
          scope: {
            workload: state.workload,
            provider_path: state.provider_path,
            owner_group: state.owner_group,
            monthly_calls: monthlyCalls,
            start_window: state.start_window,
            success_metric: state.success_metric
          },
          commercial: {
            monthly_price_usd: monthlyPrice,
            sales_commission_pct: 20,
            sales_commission_usd: salesCommission,
            net_after_commission_usd: netAfterCommission,
            support_tier: state.support_tier,
            incident_response_add_on: state.incident_response_add_on,
            included: [
              'one guided customer rollout',
              'one first workload',
              'one provider path',
              'customer proof reviews',
              'production-readiness support',
              'audit/access/evidence exports'
            ]
          },
          readiness: {
            runtime_production_ready: productionReady,
            security_profile: readiness.security_profile || null,
            go_no_go_status: goNoGo.status,
            blockers: goNoGo.blockers || [],
            proxy_calls_observed: Number(overview.totalCalls || 0)
          },
          guardrails: [
            'Start with one low-risk workflow and one owner group.',
            'Use dry-run or low-volume traffic before production volume.',
            'Complete strict login QA, Cloud Armor verification, key-rotation review, rollback owner/path, and budget/monitoring review before live customer traffic.',
            'Keep 24-hour incident response optional unless the customer contract includes it.',
            'Keep traffic envelope, retention, support cadence, SSO depth, and dedicated-runtime needs in the contract until billing and limits APIs enforce them.'
          ],
          close_steps: [
            'Confirm business, security, identity, network, developer, and incident owners.',
            'Approve the first workload, provider path, expected monthly calls, and success metric.',
            'Review /app/security-review, /app/evidence, /app/support, and /app/runbooks.',
            'Sign paid-pilot order form with support and incident-response terms.',
            'Schedule launch-week validation and rollback owner review.'
          ],
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'alert webhook secrets',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function pilotCommercialRows(packet) {
        var commercial = packet.commercial || {};
        return [
          row('Proposal status', packet.status === 'ready_to_send' ? 'Proposal is ready to share after final customer review.' : 'Draft proposal; complete scope and readiness before sending.', packet.status, packet.status === 'ready_to_send' ? 'good' : 'warn'),
          row('Monthly pilot price', '$' + number(commercial.monthly_price_usd) + '/month for one first workload and one provider path.', '$' + number(commercial.monthly_price_usd), 'good'),
          row('Sales commission', '20% commission is $' + number(commercial.sales_commission_usd) + '; net after commission is $' + number(commercial.net_after_commission_usd) + ' before infrastructure and support labor.', '20%', 'warn'),
          row('Support tier', commercial.support_tier || 'founder-led launch-week support', 'support', 'good'),
          row('Incident response', commercial.incident_response_add_on || 'optional add-on', 'contract', commercial.incident_response_add_on === 'included for pilot' ? 'good' : 'warn')
        ];
      }
      function pilotGuardrailRows(packet) {
        return packet.guardrails.map(function(item) {
          return row('Pilot guardrail', item, 'required', 'warn');
        });
      }
      function pilotCloseRows(packet) {
        return packet.close_steps.map(function(item) {
          return row('Close step', item, 'next', 'good');
        });
      }
      function pilotProposalText(packet) {
        var org = packet.organization || {};
        var scope = packet.scope || {};
        var commercial = packet.commercial || {};
        return [
          'VaultProof Enterprise first-workload proposal',
          'Organization: ' + (org.name || 'selected workspace'),
          'Status: ' + packet.status,
          '',
          'Pilot scope:',
          '- Workload: ' + scope.workload,
          '- Provider path: ' + scope.provider_path,
          '- Owner group: ' + scope.owner_group,
          '- Expected monthly calls: ' + number(scope.monthly_calls),
          '- Start window: ' + scope.start_window,
          '- Success metric: ' + scope.success_metric,
          '',
          'Commercial package:',
          '- Price: $' + number(commercial.monthly_price_usd) + '/month',
          '- Sales commission: 20% ($' + number(commercial.sales_commission_usd) + ')',
          '- Net after commission before infrastructure/support labor: $' + number(commercial.net_after_commission_usd),
          '- Support: ' + commercial.support_tier,
          '- 24-hour incident response: ' + commercial.incident_response_add_on,
          '- Included: ' + commercial.included.join(', '),
          '',
          'Readiness:',
          '- Runtime production-ready: ' + (packet.readiness.runtime_production_ready ? 'yes' : 'no'),
          '- Security profile: ' + (packet.readiness.security_profile || 'not reported'),
          '- Go/no-go status: ' + packet.readiness.go_no_go_status,
          '- Blockers: ' + (packet.readiness.blockers.length ? packet.readiness.blockers.join('; ') : 'none'),
          '',
          'Guardrails:',
          '- ' + packet.guardrails.join('\\n- '),
          '',
          'Next steps:',
          '- ' + packet.close_steps.join('\\n- '),
          '',
          'Review links:',
          '- Security review: ' + location.origin + '/app/security-review',
          '- Evidence packet: ' + location.origin + '/app/evidence',
          '- Launch support: ' + location.origin + '/app/support',
          '- Runbooks: ' + location.origin + '/app/runbooks',
          '',
          'Secrets excluded:',
          '- ' + packet.secrets_excluded.join('\\n- ')
        ].join('\\n');
      }
      function buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var proposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var state = getPilotSuccessState();
        var decisionState = getPilotSuccessDecisionState();
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var auto = [
          { id: 'runtime-ready', title: 'Runtime production-ready', sub: readiness.production_ready === true ? 'Runtime reports production-ready with executor evidence visible.' : 'Runtime readiness is not green.', passed: readiness.production_ready === true, critical: true },
          { id: 'proposal-ready', title: 'Customer proposal ready', sub: proposal.status === 'ready_to_send' ? 'First workload, provider path, price, support boundary, and success metric are scoped.' : 'Finish the customer proposal scope before sending customer update.', passed: proposal.status === 'ready_to_send', critical: true },
          { id: 'provider-scope-visible', title: 'Provider scope visible', sub: providerCount + ' provider slots are visible for this organization.', passed: providerCount > 0, critical: true },
          { id: 'traffic-evidence-visible', title: 'Traffic evidence visible', sub: totalCalls + ' proxy calls, ' + errorCalls + ' errors, ' + deniedCalls + ' denied are visible.', passed: totalCalls > 0, critical: true }
        ];
        var manual = PILOT_SUCCESS_ITEMS.map(function(item) {
          var saved = state[item.id] && typeof state[item.id] === 'object' ? state[item.id] : {};
          return Object.assign({}, item, {
            status: saved.passed ? 'passed' : 'missing',
            passed: saved.passed === true,
            updated_at: saved.updated_at || null,
            note: String(saved.note || '')
          });
        });
        var blockers = auto.filter(function(item) { return item.critical && !item.passed; }).map(function(item) { return item.title; })
          .concat(manual.filter(function(item) { return item.critical && !item.passed; }).map(function(item) { return item.title; }));
        var manualPassed = manual.filter(function(item) { return item.passed; }).length;
        var autoPassed = auto.filter(function(item) { return item.passed; }).length;
        var decisionStatus = ['expand', 'hold', 'no_go'].indexOf(String(decisionState.decision_status || '').toLowerCase()) !== -1 ? String(decisionState.decision_status || '').toLowerCase() : 'not_ready';
        var decisionReady = decisionStatus !== 'not_ready' && Boolean(String(decisionState.owner || '').trim()) && Boolean(String(decisionState.target_date || '').trim());
        return {
          packet_type: 'vaultproof_enterprise_pilot_success_tracker',
          packet_version: 2,
          status: blockers.length ? 'at_risk' : 'on_track',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/pilot-success',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCount,
            provider_slots: providerCount
          },
          proposal: {
            status: proposal.status,
            workload: proposal.scope.workload,
            provider_path: proposal.scope.provider_path,
            owner_group: proposal.scope.owner_group,
            monthly_price_usd: proposal.commercial.monthly_price_usd,
            success_metric: proposal.scope.success_metric
          },
          telemetry: {
            runtime_production_ready: readiness.production_ready === true,
            security_profile: readiness.security_profile || null,
            proxy_calls: totalCalls,
            denied_calls: deniedCalls,
            error_calls: errorCalls,
            go_no_go_status: goNoGo.status
          },
          automated_checks: auto,
          milestones: manual,
          progress: {
            automated_passed: autoPassed,
            automated_total: auto.length,
            milestones_passed: manualPassed,
            milestones_total: manual.length
          },
          expansion_decision: {
            decision_status: decisionStatus,
            ready: decisionReady,
            next_package: safeOnboardingText(decisionState.next_package) || null,
            owner: safeOnboardingText(decisionState.owner) || null,
            target_date: safeOnboardingText(decisionState.target_date) || null,
            next_step: safeOnboardingText(decisionState.next_step) || null,
            note: safeOnboardingText(decisionState.note) || null,
            updated_at: decisionState.updated_at || null,
            recommendation: decisionReady
              ? (decisionStatus === 'expand' ? 'Prepare expansion terms, next workload scope, and capacity/support review.' : decisionStatus === 'hold' ? 'Keep pilot open with a named unblock condition and next review date.' : 'Record no-go reason and retain customer-safe evidence for follow-up.')
              : 'Set decision, owner, and target date before closing the pilot review.'
          },
          blockers: blockers,
          evidence_links: [
            { title: 'Customer proposal', href: '/app/pilot', detail: 'Scope, price, support terms, success metric, and close steps.', tag: proposal.status, tone: proposal.status === 'ready_to_send' ? 'good' : 'warn' },
            { title: 'Security review', href: '/app/security-review', detail: 'Architecture, controls, evidence links, open items, and customer answers.', tag: 'review', tone: 'good' },
            { title: 'Evidence packet', href: '/app/evidence', detail: 'Customer-safe proof packet with readiness, launch, operations, support, and monitoring evidence.', tag: 'packet', tone: 'good' },
            { title: 'Activity', href: '/app/activity', detail: 'Runtime traffic, latency, denials, errors, provider request IDs, and attestation hints.', tag: totalCalls ? 'observed' : 'pending', tone: totalCalls ? 'good' : 'warn' },
            { title: 'Launch support', href: '/app/support', detail: 'Support model, staff handoff, operator boundaries, and customer blockers.', tag: 'support', tone: 'good' },
            { title: 'Alerts', href: '/app/alerts', detail: 'Alert destinations, delivery logs, dispatch runs, and test-send workflow.', tag: 'monitor', tone: 'good' }
          ],
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'alert webhook secrets',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function pilotSuccessStatusRows(packet) {
        var progress = packet.progress || {};
        var telemetry = packet.telemetry || {};
        var decision = packet.expansion_decision || {};
        return [
          row('Customer success status', packet.status === 'on_track' ? 'Customer evidence is on track for the scoped first workload.' : 'Customer rollout is at risk until blockers are closed: ' + packet.blockers.join('; '), packet.status, packet.status === 'on_track' ? 'good' : 'warn'),
          row('Success metric', packet.proposal.success_metric || 'No success metric set yet.', packet.proposal.status || 'draft', packet.proposal.status === 'ready_to_send' ? 'good' : 'warn'),
          row('Automated proof progress', number(progress.automated_passed) + '/' + number(progress.automated_total) + ' live checks passed.', 'live checks', progress.automated_passed === progress.automated_total ? 'good' : 'warn'),
          row('Milestone progress', number(progress.milestones_passed) + '/' + number(progress.milestones_total) + ' customer milestones complete.', 'milestones', progress.milestones_passed === progress.milestones_total ? 'good' : 'warn'),
          row('Expansion decision', decision.ready ? 'Decision path is recorded with owner and target date.' : 'Set decision, owner, and target date before closing the pilot review.', decision.decision_status || 'not_ready', decision.ready ? 'good' : 'warn'),
          row('Traffic watch', number(telemetry.proxy_calls) + ' calls, ' + number(telemetry.error_calls) + ' errors, ' + number(telemetry.denied_calls) + ' denied.', telemetry.proxy_calls ? 'observed' : 'pending', telemetry.error_calls || telemetry.denied_calls ? 'warn' : telemetry.proxy_calls ? 'good' : 'warn')
        ];
      }
      function pilotSuccessMilestoneRow(item) {
        var updated = item.updated_at ? 'Last updated ' + rel(item.updated_at) + '.' : 'No milestone evidence timestamp yet.';
        return '<label class="go-evidence-row" data-complete="' + (item.passed ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-pilot-success-check="' + escapeHtml(item.id) + '"' + (item.passed ? ' checked' : '') + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span><span class="go-action">Action: <code>' + escapeHtml(item.action) + '</code></span><span class="go-action">' + escapeHtml(updated) + '</span><input class="go-note" data-pilot-success-note="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.note || '') + '" placeholder="Optional customer update note" /></span>' +
          '<span><span class="tag ' + (item.passed ? 'good' : item.critical ? 'warn' : '') + '">' + escapeHtml(item.status) + '</span></span>' +
        '</label>';
      }
      function pilotSuccessMilestoneRows(packet) {
        return packet.automated_checks.map(function(item) {
          return row(item.title, item.sub, item.passed ? 'pass' : (item.critical ? 'blocked' : 'watch'), item.passed ? 'good' : (item.critical ? 'bad' : 'warn'));
        }).concat(packet.milestones.map(pilotSuccessMilestoneRow));
      }
      function pilotSuccessEvidenceRows(packet) {
        return packet.evidence_links.map(function(link) {
          return linkRow(link.title, link.detail, link.href, link.tag, link.tone);
        });
      }
      function pilotSuccessDecisionRows(packet) {
        var decision = packet.expansion_decision || {};
        return [
          row('Decision status', decision.recommendation || 'Set decision, owner, and target date before closing the pilot review.', decision.decision_status || 'not_ready', decision.ready ? 'good' : 'warn'),
          row('Decision owner', decision.owner || 'missing', decision.owner ? 'owner' : 'missing', decision.owner ? 'good' : 'warn'),
          row('Target date', decision.target_date || 'missing', decision.target_date ? 'scheduled' : 'missing', decision.target_date ? 'good' : 'warn'),
          row('Next package/path', decision.next_package || 'not set', 'package', decision.next_package ? 'good' : 'warn'),
          row('Next step', decision.next_step || 'not set', 'next', decision.next_step ? 'good' : 'warn'),
          row('Decision note', decision.note || 'No customer-safe note recorded.', 'note', decision.note ? 'good' : 'warn')
        ];
      }
      function pilotSuccessDecisionBriefText(packet) {
        var decision = packet.expansion_decision || {};
        return [
          'VaultProof pilot expansion decision brief',
          'Generated: ' + packet.generated_at,
          'Organization: ' + (packet.organization.name || 'selected workspace'),
          'Pilot status: ' + packet.status,
          'Decision: ' + (decision.decision_status || 'not_ready'),
          'Decision ready: ' + (decision.ready ? 'yes' : 'no'),
          'Owner: ' + (decision.owner || 'missing'),
          'Target date: ' + (decision.target_date || 'missing'),
          'Next package/path: ' + (decision.next_package || 'not set'),
          '',
          'Recommendation:',
          '- ' + (decision.recommendation || 'Set decision, owner, and target date before closing the pilot review.'),
          '',
          'Next step:',
          '- ' + (decision.next_step || 'not set'),
          '',
          'Decision note:',
          '- ' + (decision.note || 'none'),
          '',
          'Evidence context:',
          '- Live checks: ' + number((packet.progress || {}).automated_passed) + '/' + number((packet.progress || {}).automated_total),
          '- Milestones: ' + number((packet.progress || {}).milestones_passed) + '/' + number((packet.progress || {}).milestones_total),
          '- Traffic: ' + number((packet.telemetry || {}).proxy_calls) + ' calls, ' + number((packet.telemetry || {}).error_calls) + ' errors, ' + number((packet.telemetry || {}).denied_calls) + ' denied',
          '- Open blockers: ' + (packet.blockers.length ? packet.blockers.join('; ') : 'none'),
          '',
          'Secret boundary:',
          '- This brief is metadata-only and excludes ' + packet.secrets_excluded.join(', ') + '.'
        ].join('\\n');
      }
      function pilotSuccessBriefText(packet) {
        var telemetry = packet.telemetry || {};
        var progress = packet.progress || {};
        var decision = packet.expansion_decision || {};
        var completedMilestones = packet.milestones.filter(function(item) {
          return item.passed;
        }).map(function(item) {
          return item.title + (item.note ? ': ' + item.note : '');
        });
        return [
          'VaultProof Enterprise pilot weekly update',
          'Organization: ' + (packet.organization.name || 'selected workspace'),
          'Status: ' + packet.status,
          'Workload: ' + (packet.proposal.workload || 'not set'),
          'Provider path: ' + (packet.proposal.provider_path || 'not set'),
          'Owner group: ' + (packet.proposal.owner_group || 'not set'),
          'Success metric: ' + (packet.proposal.success_metric || 'not set'),
          '',
          'Progress:',
          '- Live checks: ' + number(progress.automated_passed) + '/' + number(progress.automated_total),
          '- Customer milestones: ' + number(progress.milestones_passed) + '/' + number(progress.milestones_total),
          '- Traffic: ' + number(telemetry.proxy_calls) + ' calls, ' + number(telemetry.error_calls) + ' errors, ' + number(telemetry.denied_calls) + ' denied',
          '- Go/no-go: ' + telemetry.go_no_go_status,
          '- Expansion decision: ' + (decision.decision_status || 'not_ready') + (decision.owner ? ' owned by ' + decision.owner : ''),
          '',
          'Completed milestones:',
          '- ' + (completedMilestones.length ? completedMilestones.join('\\n- ') : 'none yet'),
          '',
          'Open blockers:',
          '- ' + (packet.blockers.length ? packet.blockers.join('\\n- ') : 'none'),
          '',
          'Evidence links:',
          '- ' + packet.evidence_links.map(function(link) { return link.title + ': ' + location.origin + link.href; }).join('\\n- '),
          '',
          'Secrets excluded:',
          '- ' + packet.secrets_excluded.join('\\n- ')
        ].join('\\n');
      }
      function providerSlotsFromBootstrap(bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        var slots = [];
        projects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) { slots.push(slot); });
        });
        return slots;
      }
      function providerCountFromData(overview, bootstrap) {
        var slots = providerSlotsFromBootstrap(bootstrap);
        if (slots.length) return slots.length;
        return Number(overview.activeApps || overview.providerCount || overview.provider_count || 0);
      }
      function projectCountFromData(org, overview, bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        return Number(org.project_count || overview.totalProjects || projects.length || 0);
      }
      function entitlementNumber(value) {
        var n = Number(String(value || '').replace(/,/g, '').trim());
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
      function entitlementUtilization(used, allowance) {
        var denominator = Number(allowance || 0);
        if (!denominator) return 0;
        return Math.round(Number(used || 0) * 1000 / denominator) / 10;
      }
      function entitlementMeterWidth(used, allowance) {
        return Math.max(0, Math.min(100, Math.round(entitlementUtilization(used, allowance))));
      }
      function entitlementCapacityStatus(capacity) {
        if (!capacity.monthly_call_allowance || !capacity.provider_slot_allowance || !capacity.seat_allowance) return 'missing_allowance';
        if (capacity.observed_proxy_calls > capacity.monthly_call_allowance || capacity.active_provider_slots > capacity.provider_slot_allowance || capacity.visible_members > capacity.seat_allowance) return 'over_contract';
        if (capacity.call_utilization_percent >= 80 || capacity.provider_slot_utilization_percent >= 80 || capacity.seat_utilization_percent >= 80) return 'expansion_review';
        if (!capacity.observed_proxy_calls) return 'pilot_not_observed';
        return 'within_contract';
      }
      function entitlementCapacityTone(status) {
        if (status === 'within_contract') return 'good';
        if (status === 'over_contract') return 'bad';
        return 'warn';
      }
      function entitlementCapacityRecommendation(status) {
        if (status === 'over_contract') return 'Hold paid onboarding or expansion traffic until the contract allowance is amended or usage is reduced.';
        if (status === 'expansion_review') return 'Schedule an expansion review before the customer approaches the contracted allowance.';
        if (status === 'pilot_not_observed') return 'Run the protected API proxy self-test and capture traffic before treating the allowance as proven.';
        if (status === 'missing_allowance') return 'Record monthly call, provider-slot, and seat allowances before customer onboarding.';
        return 'Usage fits inside the current contract envelope; keep monitoring before renewal.';
      }
      function entitlementUsageActions(capacity, usageStatus) {
        var actions = [];
        if (usageStatus === 'missing_allowance') actions.push('Record contract allowances for monthly calls, provider slots, and seats.');
        if (usageStatus === 'pilot_not_observed') actions.push('Run /app/keys protected dry-run or the customer workflow to create traffic evidence.');
        if (usageStatus === 'expansion_review') actions.push('Review expansion package, provider-slot allowance, and support tier before the next traffic increase.');
        if (usageStatus === 'over_contract') actions.push('Pause paid onboarding or amend the contract before accepting more traffic.');
        if (capacity.denied_calls || capacity.error_calls) actions.push('Review Activity, Policy Drift, and Integration Rollout before using the capacity proof with a customer.');
        if (!actions.length) actions.push('Keep usage review in the renewal cadence and monitor Evidence after every deploy.');
        return actions;
      }
      function entitlementContractReady(status) {
        return ['accepted_demo', 'signed', 'active'].indexOf(String(status || '').toLowerCase()) !== -1;
      }
      function entitlementAllowedValue(value, allowed, fallback) {
        var normalized = String(value || '').toLowerCase();
        return allowed.indexOf(normalized) !== -1 ? normalized : fallback;
      }
      function entitlementBillingReady(handoff) {
        var invoiceStatus = String((handoff && handoff.invoice_status) || '').toLowerCase();
        var poStatus = String((handoff && handoff.purchase_order_status) || '').toLowerCase();
        return ['invoice_ready', 'paid'].indexOf(invoiceStatus) !== -1 &&
          ['not_required', 'received'].indexOf(poStatus) !== -1 &&
          Boolean(String((handoff && handoff.procurement_owner) || '').trim()) &&
          Boolean(String((handoff && handoff.payment_terms) || '').trim());
      }
      function entitlementBillingTone(handoff) {
        if (entitlementBillingReady(handoff)) return 'good';
        if (String((handoff && handoff.invoice_status) || '').toLowerCase() === 'blocked' || String((handoff && handoff.purchase_order_status) || '').toLowerCase() === 'blocked') return 'bad';
        return 'warn';
      }
      function entitlementBillingNextAction(handoff) {
        var actions = [];
        var invoiceStatus = String((handoff && handoff.invoice_status) || '').toLowerCase();
        var poStatus = String((handoff && handoff.purchase_order_status) || '').toLowerCase();
        if (!String((handoff && handoff.procurement_owner) || '').trim()) actions.push('Assign the buyer finance/procurement owner.');
        if (!String((handoff && handoff.payment_terms) || '').trim()) actions.push('Record customer-safe payment terms.');
        if (invoiceStatus === 'not_started') actions.push('Send quote or mark invoice ready before closing paid onboarding.');
        if (invoiceStatus === 'quote_sent' || invoiceStatus === 'po_pending') actions.push('Track PO or invoice approval before expansion traffic.');
        if (invoiceStatus === 'blocked' || poStatus === 'blocked') actions.push('Resolve commercial blocker before treating the account as paid-ready.');
        if (poStatus === 'requested') actions.push('Confirm PO received or not required.');
        if (!actions.length) actions.push('Keep invoice and expansion review in the renewal cadence.');
        return actions;
      }
      function redactEntitlementNote(value) {
        var note = String(value || '').trim();
        if (!note) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|token|card number|bank account|routing number|cvv|cvc)/i.test(note)) {
          return '[redacted: note contained secret-like material]';
        }
        return note;
      }
      function entitlementDateDeltaDays(value) {
        if (!value) return null;
        var parsed = new Date(String(value).trim());
        if (!Number.isFinite(parsed.getTime())) return null;
        var today = new Date();
        var todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        var targetMidnight = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
        return Math.round((targetMidnight - todayMidnight) / 86400000);
      }
      function normalizeEntitlementAmendment(record) {
        var now = new Date().toISOString();
        var source = record && typeof record === 'object' ? record : {};
        return {
          id: String(source.id || ('amendment-' + Date.now().toString(36))),
          change_type: entitlementAllowedValue(source.change_type, ['allowance_change', 'commercial_change', 'support_change', 'renewal_review', 'risk_acceptance', 'other'], 'other'),
          status: entitlementAllowedValue(source.status, ['proposed', 'approved', 'active', 'blocked'], 'proposed'),
          effective_date: redactEntitlementNote(source.effective_date) || '',
          owner: redactEntitlementNote(source.owner) || '',
          note: redactEntitlementNote(source.note) || '',
          created_at: source.created_at || now,
          updated_at: source.updated_at || source.created_at || now
        };
      }
      function readEntitlementAmendments() {
        var state = getEntitlementsState();
        var rows = Array.isArray(state.amendments) ? state.amendments : [];
        return rows.map(normalizeEntitlementAmendment).filter(function(row) {
          return row.id && (row.owner || row.note || row.effective_date || row.status);
        }).slice(0, 20);
      }
      function writeEntitlementAmendments(rows) {
        var state = getEntitlementsState();
        state.amendments = rows.map(normalizeEntitlementAmendment).slice(0, 20);
        state.updated_at = new Date().toISOString();
        localStorage.setItem(entitlementsStorageKey(), JSON.stringify(state));
      }
      function entitlementRenewalSummary(state, billingHandoff, amendments) {
        var candidates = [];
        var renewalDays = entitlementDateDeltaDays(state.renewal_date);
        var expansionDays = entitlementDateDeltaDays(billingHandoff && billingHandoff.expansion_review_date);
        if (renewalDays !== null) candidates.push({ type: 'contract renewal/review', date: String(state.renewal_date || ''), days_until: renewalDays });
        if (expansionDays !== null) candidates.push({ type: 'expansion review', date: String((billingHandoff && billingHandoff.expansion_review_date) || ''), days_until: expansionDays });
        candidates.sort(function(a, b) { return a.days_until - b.days_until; });
        var next = candidates[0] || null;
        var pending = (amendments || []).filter(function(item) {
          return item.status === 'proposed' || item.status === 'blocked';
        });
        var status = !next ? 'missing_review_date' : next.days_until <= 0 ? 'review_due' : next.days_until <= 30 ? 'review_soon' : 'scheduled';
        if (pending.some(function(item) { return item.status === 'blocked'; })) status = 'amendment_blocked';
        var actions = [];
        if (!next) actions.push('Record renewal/review date or expansion review date.');
        if (next && next.days_until <= 0) actions.push('Run renewal or expansion review now.');
        if (next && next.days_until > 0 && next.days_until <= 30) actions.push('Prepare renewal, allowance, support, and billing review before the due date.');
        if (pending.length) actions.push('Resolve ' + number(pending.length) + ' proposed or blocked amendment records.');
        if (!actions.length) actions.push('Keep renewal and amendment review in the customer success cadence.');
        return {
          status: status,
          next_review_type: next ? next.type : null,
          next_review_date: next ? next.date : null,
          days_until_next_review: next ? next.days_until : null,
          pending_amendments: pending.length,
          total_amendments: (amendments || []).length,
          next_actions: actions
        };
      }
      function buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var state = getEntitlementsState();
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var callAllowance = entitlementNumber(state.monthly_call_allowance);
        var providerAllowance = entitlementNumber(state.provider_slot_allowance);
        var seatAllowance = entitlementNumber(state.seat_allowance);
        var blockers = [];
        if (!currentOrgId) blockers.push('No enterprise organization is selected.');
        if (!entitlementContractReady(state.contract_status)) blockers.push('Contract status is not accepted, signed, or active.');
        if (!String(state.billing_owner || '').trim()) blockers.push('Billing owner is missing.');
        if (!String(state.success_owner || '').trim()) blockers.push('Customer success owner is missing.');
        if (!String(state.renewal_date || '').trim()) blockers.push('Renewal/review date is missing.');
        if (!callAllowance) blockers.push('Monthly call allowance is missing.');
        if (!providerAllowance) blockers.push('Provider-slot allowance is missing.');
        if (!seatAllowance) blockers.push('Seat allowance is missing.');
        if (callAllowance && totalCalls > callAllowance) blockers.push('Observed proxy calls exceed the monthly contract allowance.');
        if (providerAllowance && providerCount > providerAllowance) blockers.push('Visible provider slots exceed the contract allowance.');
        if (seatAllowance && memberCount > seatAllowance) blockers.push('Visible members exceed the contract seat allowance.');
        if (goNoGo && goNoGo.status !== 'go') blockers.push('Go/no-go launch board is still on hold.');
        var utilization = callAllowance ? Math.round(totalCalls * 1000 / callAllowance) / 10 : 0;
        var capacity = {
          monthly_call_allowance: callAllowance,
          observed_proxy_calls: totalCalls,
          remaining_calls: callAllowance ? Math.max(0, callAllowance - totalCalls) : 0,
          call_utilization_percent: utilization,
          call_headroom_percent: callAllowance ? Math.max(0, Math.round((callAllowance - totalCalls) * 1000 / callAllowance) / 10) : 0,
          provider_slot_allowance: providerAllowance,
          active_provider_slots: providerCount,
          provider_slots_remaining: providerAllowance ? Math.max(0, providerAllowance - providerCount) : 0,
          provider_slot_utilization_percent: entitlementUtilization(providerCount, providerAllowance),
          seat_allowance: seatAllowance,
          visible_members: memberCount,
          seats_remaining: seatAllowance ? Math.max(0, seatAllowance - memberCount) : 0,
          seat_utilization_percent: entitlementUtilization(memberCount, seatAllowance),
          visible_projects: projectCount,
          denied_calls: deniedCalls,
          error_calls: errorCalls
        };
        var capacityStatus = entitlementCapacityStatus(capacity);
        var billingHandoff = {
          invoice_status: entitlementAllowedValue(state.invoice_status, ['not_started', 'quote_sent', 'po_pending', 'invoice_ready', 'paid', 'blocked'], 'not_started'),
          purchase_order_status: entitlementAllowedValue(state.purchase_order_status, ['not_required', 'requested', 'received', 'blocked'], 'not_required'),
          procurement_owner: redactEntitlementNote(state.procurement_owner),
          payment_terms: redactEntitlementNote(state.payment_terms),
          expansion_review_date: redactEntitlementNote(state.expansion_review_date),
          billing_note: redactEntitlementNote(state.billing_note),
          updated_at: state.updated_at || null
        };
        billingHandoff.ready = entitlementBillingReady(billingHandoff);
        billingHandoff.status = billingHandoff.ready ? 'commercial_ready' : 'commercial_review';
        billingHandoff.status_tone = entitlementBillingTone(billingHandoff);
        billingHandoff.next_actions = entitlementBillingNextAction(billingHandoff);
        var amendments = readEntitlementAmendments();
        var renewalSummary = entitlementRenewalSummary(state, billingHandoff, amendments);
        if (renewalSummary.status === 'amendment_blocked') blockers.push('Contract amendment log has a blocked change.');
        if (renewalSummary.status === 'review_due') blockers.push('Contract renewal or expansion review is due.');
        var status = blockers.length ? 'contract_review' : 'ready_for_paid_pilot';
        return {
          packet_type: 'vaultproof_enterprise_entitlements',
          packet_version: 3,
          status: status,
          decision: status === 'ready_for_paid_pilot' ? 'Paid-user contract package is ready for the selected enterprise organization.' : 'Hold paid-user onboarding until contract, capacity, owners, and launch evidence are complete.',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/entitlements',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            role: org.role || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            production_ready: readiness.production_ready === true
          },
          contract: {
            package_label: state.package_label || 'Enterprise paid pilot',
            contract_status: state.contract_status || 'draft',
            billing_owner: String(state.billing_owner || '').trim() || null,
            success_owner: String(state.success_owner || '').trim() || null,
            renewal_date: String(state.renewal_date || '').trim() || null,
            retention_label: String(state.retention_label || '').trim() || null,
            customer_note: redactEntitlementNote(state.customer_note),
            updated_at: state.updated_at || null
          },
          capacity: capacity,
          usage_guardrails: {
            capacity_status: capacityStatus,
            status_tone: entitlementCapacityTone(capacityStatus),
            expansion_recommendation: entitlementCapacityRecommendation(capacityStatus),
            hard_limit_enforcement: 'Manual contract-controlled for this pilot; automated hard usage limits, overage billing, and invoice status remain production follow-up work.',
            actions: entitlementUsageActions(capacity, capacityStatus),
            review_links: ['/app/evidence', '/app/activity', '/app/inventory', '/app/rollout', '/app/plans']
          },
          billing_handoff: billingHandoff,
          amendment_history: {
            records: amendments,
            renewal_summary: renewalSummary,
            latest_record: amendments[0] || null,
            secrets_excluded: ['card numbers', 'bank data', 'provider keys', 'tokens', 'request bodies', 'customer payloads']
          },
          support: {
            support_tier: state.support_tier || 'founder-led launch-week support',
            incident_response_add_on: state.incident_response_add_on || 'optional add-on',
            runtime_label: state.runtime_label || 'shared confidential runtime',
            response_boundary: 'Base enterprise package uses customer incident-response ownership plus VaultProof launch support unless a 24-hour response add-on is included in the contract.'
          },
          guardrails: [
            'Enterprise entitlements are contract-controlled for this pilot workflow; billing APIs and hard limit enforcement can come later.',
            'Capacity changes should be reviewed against API inventory, policy drift, rollout, monitoring, support tier, and renewal terms.',
            'Raw provider keys, encrypted shares, service-role keys, origin-lock values, signing secrets, and browser tokens are excluded from this packet.',
            'Enterprise customers use enterprise.vaultproof.dev; VaultProof staff/admin workflows stay on the separate admin.vaultproof.dev system.'
          ],
          blockers: blockers,
          exports: {
            evidence_packet: '/app/evidence',
            plans: '/app/plans',
            onboarding: '/app/evidence',
            launch_board: '/app/evidence',
            support_room: '/app/evidence',
            security_review: '/app/security-review'
          },
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function entitlementsSummaryRows(packet) {
        var contract = packet.contract || {};
        var org = packet.organization || {};
        var billing = packet.billing_handoff || {};
        return [
          row('Paid-user status', packet.decision, packet.status, packet.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          row('Organization scope', (org.name || 'Selected workspace') + ' on enterprise.vaultproof.dev. SSO/login status: ' + (org.sso_provider_status || 'not confirmed') + '.', org.id ? 'scoped' : 'select org', org.id ? 'good' : 'warn'),
          row('Contract status', contract.contract_status || 'draft', entitlementContractReady(contract.contract_status) ? 'accepted' : 'draft', entitlementContractReady(contract.contract_status) ? 'good' : 'warn'),
          row('Package', contract.package_label || 'Enterprise paid pilot', packet.support.runtime_label || 'runtime', 'good'),
          row('Billing owner', contract.billing_owner || 'missing', contract.billing_owner ? 'set' : 'missing', contract.billing_owner ? 'good' : 'warn'),
          row('Commercial handoff', billing.ready ? 'Invoice/PO handoff is recorded for this paid account.' : 'Finish invoice status, PO status, procurement owner, and payment terms before treating the account as commercially closed.', billing.status || 'commercial_review', billing.status_tone || 'warn'),
          row('Customer success owner', contract.success_owner || 'missing', contract.success_owner ? 'set' : 'missing', contract.success_owner ? 'good' : 'warn'),
          row('Renewal/review date', contract.renewal_date || 'missing', contract.renewal_date ? 'scheduled' : 'missing', contract.renewal_date ? 'good' : 'warn'),
          row('Go/no-go dependency', packet.blockers.indexOf('Go/no-go launch board is still on hold.') === -1 ? 'Launch board is not blocking the paid-user package.' : 'Finish the launch board before paid onboarding.', 'launch', packet.blockers.indexOf('Go/no-go launch board is still on hold.') === -1 ? 'good' : 'warn')
        ];
      }
      function entitlementsCapacityRows(packet) {
        var capacity = packet.capacity || {};
        return [
          row('Monthly call allowance', number(capacity.observed_proxy_calls) + ' observed of ' + number(capacity.monthly_call_allowance) + ' contracted calls. Utilization: ' + number(capacity.call_utilization_percent) + '%.', capacity.monthly_call_allowance ? 'calls' : 'missing', capacity.monthly_call_allowance && capacity.observed_proxy_calls <= capacity.monthly_call_allowance ? 'good' : 'warn'),
          row('Provider-slot allowance', number(capacity.active_provider_slots) + ' visible of ' + number(capacity.provider_slot_allowance) + ' contracted provider slots.', capacity.provider_slot_allowance ? 'slots' : 'missing', capacity.provider_slot_allowance && capacity.active_provider_slots <= capacity.provider_slot_allowance ? 'good' : 'warn'),
          row('Seat allowance', number(capacity.visible_members) + ' visible members of ' + number(capacity.seat_allowance) + ' contracted seats.', capacity.seat_allowance ? 'seats' : 'missing', capacity.seat_allowance && capacity.visible_members <= capacity.seat_allowance ? 'good' : 'warn'),
          row('Project scope', number(capacity.visible_projects) + ' enterprise projects are visible for this organization.', 'projects', capacity.visible_projects ? 'good' : 'warn'),
          row('Traffic quality', number(capacity.error_calls) + ' errors and ' + number(capacity.denied_calls) + ' denials are visible in the overview window.', capacity.error_calls || capacity.denied_calls ? 'watch' : 'clean', capacity.error_calls || capacity.denied_calls ? 'warn' : 'good')
        ];
      }
      function entitlementMeter(title, used, allowance, percent, tone) {
        var width = entitlementMeterWidth(used, allowance);
        var label = allowance ? number(used) + ' of ' + number(allowance) + ' - ' + number(percent) + '%' : number(used) + ' observed - allowance missing';
        return '<div class="entitlement-meter">' +
          '<div class="entitlement-meter-head"><div class="entitlement-meter-title">' + escapeHtml(title) + '</div><div class="entitlement-meter-value">' + escapeHtml(label) + '</div></div>' +
          '<div class="entitlement-meter-track" aria-hidden="true"><span class="entitlement-meter-fill ' + escapeHtml(tone || '') + '" style="width:' + width + '%"></span></div>' +
        '</div>';
      }
      function entitlementsUsageMeterRows(packet) {
        var capacity = packet.capacity || {};
        var usage = packet.usage_guardrails || {};
        var tone = usage.status_tone || entitlementCapacityTone(entitlementCapacityStatus(capacity));
        return [
          entitlementMeter('Monthly calls', capacity.observed_proxy_calls || 0, capacity.monthly_call_allowance || 0, capacity.call_utilization_percent || 0, tone),
          entitlementMeter('Provider slots', capacity.active_provider_slots || 0, capacity.provider_slot_allowance || 0, capacity.provider_slot_utilization_percent || 0, capacity.active_provider_slots > capacity.provider_slot_allowance && capacity.provider_slot_allowance ? 'bad' : capacity.provider_slot_utilization_percent >= 80 ? 'warn' : 'good'),
          entitlementMeter('Seats', capacity.visible_members || 0, capacity.seat_allowance || 0, capacity.seat_utilization_percent || 0, capacity.visible_members > capacity.seat_allowance && capacity.seat_allowance ? 'bad' : capacity.seat_utilization_percent >= 80 ? 'warn' : 'good')
        ];
      }
      function entitlementsUsageGuardrailRows(packet) {
        var capacity = packet.capacity || {};
        var usage = packet.usage_guardrails || {};
        return [
          row('Capacity status', usage.expansion_recommendation || 'Record capacity allowances before onboarding.', usage.capacity_status || 'missing_allowance', usage.status_tone || 'warn'),
          row('Remaining calls', number(capacity.remaining_calls) + ' calls remain inside the recorded monthly allowance. Headroom: ' + number(capacity.call_headroom_percent) + '%.', capacity.monthly_call_allowance ? 'headroom' : 'missing', capacity.monthly_call_allowance && capacity.observed_proxy_calls <= capacity.monthly_call_allowance ? 'good' : 'warn'),
          row('Expansion recommendation', usage.expansion_recommendation || 'Record capacity allowances before onboarding.', 'expansion', usage.status_tone || 'warn'),
          row('Hard limit enforcement', usage.hard_limit_enforcement || 'Manual contract-controlled for this pilot.', 'manual', 'warn')
        ].concat((usage.actions || []).map(function(action) {
          return row('Usage action', action, 'next', action.indexOf('Pause') === 0 ? 'bad' : 'warn');
        }));
      }
      function entitlementsBillingRows(packet) {
        var handoff = packet.billing_handoff || {};
        return [
          row('Billing handoff status', handoff.ready ? 'Commercial handoff has enough metadata for a paid-pilot close path.' : 'Record invoice status, PO status, procurement owner, and payment terms before treating the account as commercially closed.', handoff.status || 'commercial_review', handoff.status_tone || 'warn'),
          row('Invoice status', handoff.invoice_status || 'not_started', 'invoice', handoff.invoice_status === 'paid' || handoff.invoice_status === 'invoice_ready' ? 'good' : handoff.invoice_status === 'blocked' ? 'bad' : 'warn'),
          row('PO status', handoff.purchase_order_status || 'not_required', 'purchase order', handoff.purchase_order_status === 'not_required' || handoff.purchase_order_status === 'received' ? 'good' : handoff.purchase_order_status === 'blocked' ? 'bad' : 'warn'),
          row('Procurement owner', handoff.procurement_owner || 'missing', handoff.procurement_owner ? 'owner' : 'missing', handoff.procurement_owner ? 'good' : 'warn'),
          row('Payment terms', handoff.payment_terms || 'missing', handoff.payment_terms ? 'terms' : 'missing', handoff.payment_terms ? 'good' : 'warn'),
          row('Expansion review', handoff.expansion_review_date || 'not scheduled', handoff.expansion_review_date ? 'scheduled' : 'review', handoff.expansion_review_date ? 'good' : 'warn'),
          row('Billing note', handoff.billing_note || 'No billing-safe note recorded.', 'note', handoff.billing_note ? 'good' : 'warn')
        ].concat((handoff.next_actions || []).map(function(action) {
          return row('Commercial action', action, 'next', action.indexOf('Resolve') === 0 ? 'bad' : 'warn');
        }));
      }
      function entitlementAmendmentLabel(value) {
        var labels = {
          allowance_change: 'allowance change',
          commercial_change: 'commercial change',
          support_change: 'support change',
          renewal_review: 'renewal review',
          risk_acceptance: 'risk acceptance',
          other: 'other'
        };
        return labels[value] || labels.other;
      }
      function entitlementsRenewalRows(packet) {
        var history = packet.amendment_history || {};
        var summary = history.renewal_summary || {};
        return [
          row('Renewal watch', summary.next_review_date ? (summary.next_review_type + ' on ' + summary.next_review_date + ' (' + number(summary.days_until_next_review) + ' days).') : 'No renewal or expansion review date is recorded yet.', summary.status || 'missing_review_date', summary.status === 'scheduled' ? 'good' : summary.status === 'amendment_blocked' || summary.status === 'review_due' ? 'bad' : 'warn'),
          row('Amendment count', number(summary.total_amendments) + ' amendment records, ' + number(summary.pending_amendments) + ' proposed or blocked.', summary.pending_amendments ? 'review' : 'clear', summary.pending_amendments ? 'warn' : 'good')
        ].concat((summary.next_actions || []).map(function(action) {
          return row('Renewal action', action, 'next', action.indexOf('Resolve') === 0 || action.indexOf('Run') === 0 ? 'bad' : 'warn');
        }));
      }
      function renderEntitlementAmendmentRecord(record) {
        var tone = record.status === 'active' || record.status === 'approved' ? 'good' : record.status === 'blocked' ? 'bad' : 'warn';
        var detail = [
          entitlementAmendmentLabel(record.change_type),
          record.effective_date ? 'effective ' + record.effective_date : 'no effective date',
          record.owner ? 'owner ' + record.owner : 'owner missing',
          record.note || 'No customer-safe note recorded.'
        ].join(' - ');
        return '<div class="row">' +
          '<div><div class="row-title">' + escapeHtml(entitlementAmendmentLabel(record.change_type)) + '</div><div class="row-sub">' + escapeHtml(detail) + '</div></div>' +
          '<span class="row-actions"><span class="tag ' + tone + '">' + escapeHtml(record.status || 'proposed') + '</span><button type="button" data-remove-entitlement-amendment="' + escapeHtml(record.id) + '">remove</button></span>' +
        '</div>';
      }
      function entitlementAmendmentRows(packet) {
        var records = ((packet.amendment_history || {}).records || []);
        return records.length ? records.map(renderEntitlementAmendmentRecord).join('') : '<div class="empty">No amendment records yet. Add contract, capacity, support, renewal, or commercial changes as customer-safe metadata.</div>';
      }
      function entitlementsCapacityBriefText(packet) {
        var contract = packet.contract || {};
        var capacity = packet.capacity || {};
        var usage = packet.usage_guardrails || {};
        var handoff = packet.billing_handoff || {};
        var history = packet.amendment_history || {};
        var renewal = history.renewal_summary || {};
        return [
          'VaultProof entitlement capacity brief',
          'Generated: ' + packet.generated_at,
          'Organization: ' + ((packet.organization && packet.organization.name) || 'selected workspace'),
          'Package: ' + (contract.package_label || 'Enterprise paid pilot'),
          'Paid-user status: ' + packet.status,
          'Capacity status: ' + (usage.capacity_status || 'missing_allowance'),
          'Commercial handoff: ' + (handoff.status || 'commercial_review'),
          'Renewal/amendments: ' + (renewal.status || 'missing_review_date'),
          '',
          'Contract envelope:',
          '- Monthly calls: ' + number(capacity.observed_proxy_calls) + ' observed of ' + number(capacity.monthly_call_allowance) + ' allowed (' + number(capacity.call_utilization_percent) + '% used, ' + number(capacity.remaining_calls) + ' remaining)',
          '- Provider slots: ' + number(capacity.active_provider_slots) + ' visible of ' + number(capacity.provider_slot_allowance) + ' allowed (' + number(capacity.provider_slot_utilization_percent) + '% used)',
          '- Seats: ' + number(capacity.visible_members) + ' visible of ' + number(capacity.seat_allowance) + ' allowed (' + number(capacity.seat_utilization_percent) + '% used)',
          '- Traffic quality: ' + number(capacity.error_calls) + ' errors and ' + number(capacity.denied_calls) + ' denials in the current overview evidence',
          '',
          'Recommendation:',
          '- ' + (usage.expansion_recommendation || 'Record capacity allowances before customer onboarding.'),
          '',
          'Actions:',
          '- ' + ((usage.actions || []).length ? usage.actions.join('\\n- ') : 'Keep usage review in the renewal cadence.'),
          '',
          'Commercial handoff:',
          '- Invoice status: ' + (handoff.invoice_status || 'not_started'),
          '- PO status: ' + (handoff.purchase_order_status || 'not_required'),
          '- Procurement owner: ' + (handoff.procurement_owner || 'missing'),
          '- Payment terms: ' + (handoff.payment_terms || 'missing'),
          '- Expansion review: ' + (handoff.expansion_review_date || 'not scheduled'),
          '- Next action: ' + ((handoff.next_actions || []).length ? handoff.next_actions.join('\\n- ') : 'Keep billing review in the renewal cadence.'),
          '',
          'Renewal and amendment log:',
          '- Next review: ' + (renewal.next_review_date ? renewal.next_review_type + ' on ' + renewal.next_review_date + ' (' + number(renewal.days_until_next_review) + ' days)' : 'missing'),
          '- Amendment records: ' + number(renewal.total_amendments) + ' total, ' + number(renewal.pending_amendments) + ' pending or blocked',
          '- Latest amendment: ' + (history.latest_record ? entitlementAmendmentLabel(history.latest_record.change_type) + ' / ' + history.latest_record.status + ' / ' + (history.latest_record.effective_date || 'no effective date') : 'none'),
          '',
          'Boundary:',
          '- ' + (usage.hard_limit_enforcement || 'Manual contract-controlled for this pilot.'),
          '- Commercial handoff is metadata-only. No card numbers, bank data, provider keys, encrypted shares, service-role keys, browser sessions, OAuth secrets, origin-lock values, signing secrets, runtime-token secrets, or unwrap roots are included.'
        ].join('\\n');
      }
      function entitlementsGuardrailRows(packet) {
        return [
          row('Support tier', packet.support.support_tier, 'support', 'good'),
          row('Incident response boundary', packet.support.response_boundary + ' Current setting: ' + packet.support.incident_response_add_on + '.', 'contract', packet.support.incident_response_add_on === 'included' ? 'good' : 'warn'),
          row('Retention', (packet.contract && packet.contract.retention_label) || 'not set', 'contract', packet.contract && packet.contract.retention_label ? 'good' : 'warn'),
          row('Billing enforcement', 'Commercial handoff is metadata-only for this pilot. Billing APIs, invoice automation, and hard limit enforcement are a later paid buildout.', 'manual', 'warn'),
          row('Commercial status', ((packet.billing_handoff || {}).next_actions || []).join(' ') || 'Billing handoff is ready.', (packet.billing_handoff || {}).status || 'commercial_review', (packet.billing_handoff || {}).status_tone || 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ].concat(packet.guardrails.map(function(item) {
          return row('Guardrail', item, 'paid-user', item.indexOf('contract-controlled') === -1 ? 'good' : 'warn');
        })).concat(packet.blockers.length ? packet.blockers.map(function(blocker) {
          return row('Blocker', blocker, 'hold', 'warn');
        }) : [row('Blockers', 'No paid-user contract blockers in this browser/org evidence state.', 'clear', 'good')]);
      }
      function entitlementsHandoffRows(packet) {
        return [
          linkRow('Evidence packet', 'Export the full customer-safe proof packet, including entitlements status.', packet.exports.evidence_packet, 'evidence', 'good'),
          linkRow('Plans', 'Review packaging, starting price, expansion path, and contract-facing guardrails.', packet.exports.plans, 'plans', 'good'),
          linkRow('Paid onboarding evidence', 'Customer-safe onboarding status appears in Evidence; staff workflow stays on admin.vaultproof.dev.', packet.exports.onboarding, 'onboarding', packet.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          linkRow('Launch readiness evidence', 'Close go/no-go blockers before paid customer traffic; customer-safe status is summarized in Evidence.', packet.exports.launch_board, 'launch', packet.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          linkRow('Support evidence', 'Confirm support scope, incident-response add-on boundary, and admin separation from the customer-safe proof packet.', packet.exports.support_room, 'support', 'good'),
          linkRow('Security review', 'Share architecture, controls, evidence links, known limitations, and customer-safe answers.', packet.exports.security_review, 'security', 'good')
        ];
      }
      function addEntitlementAmendmentFromForm() {
        var record = normalizeEntitlementAmendment({
          id: 'amendment-' + Date.now().toString(36),
          change_type: byId('entitlementAmendmentType') && byId('entitlementAmendmentType').value,
          status: byId('entitlementAmendmentStatus') && byId('entitlementAmendmentStatus').value,
          effective_date: byId('entitlementAmendmentEffective') && byId('entitlementAmendmentEffective').value,
          owner: byId('entitlementAmendmentOwner') && byId('entitlementAmendmentOwner').value,
          note: byId('entitlementAmendmentNote') && byId('entitlementAmendmentNote').value,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        if (!record.owner && !record.note && !record.effective_date) {
          notice('Add an owner, effective date, or customer-safe note before saving an amendment.');
          return;
        }
        var rows = readEntitlementAmendments();
        rows.unshift(record);
        writeEntitlementAmendments(rows);
        ['entitlementAmendmentEffective', 'entitlementAmendmentOwner', 'entitlementAmendmentNote'].forEach(function(id) {
          var el = byId(id);
          if (el) el.value = '';
        });
        notice('Entitlement amendment saved as browser-local metadata.');
        if (latestOrgPayload && latestReadiness) {
          renderEntitlementsPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function removeEntitlementAmendment(id) {
        writeEntitlementAmendments(readEntitlementAmendments().filter(function(record) { return record.id !== id; }));
        if (latestOrgPayload && latestReadiness) {
          renderEntitlementsPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function renderEntitlementsPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        latestEntitlementsPacket = packet;
        var state = getEntitlementsState();
        [
          ['entitlementPackage', 'package_label'],
          ['entitlementStatus', 'contract_status'],
          ['entitlementCalls', 'monthly_call_allowance'],
          ['entitlementSlots', 'provider_slot_allowance'],
          ['entitlementSeats', 'seat_allowance'],
          ['entitlementSupport', 'support_tier'],
          ['entitlementIr', 'incident_response_add_on'],
          ['entitlementRuntime', 'runtime_label'],
          ['entitlementRenewal', 'renewal_date'],
          ['entitlementBillingOwner', 'billing_owner'],
          ['entitlementSuccessOwner', 'success_owner'],
          ['entitlementRetention', 'retention_label'],
          ['entitlementInvoiceStatus', 'invoice_status'],
          ['entitlementPoStatus', 'purchase_order_status'],
          ['entitlementProcurementOwner', 'procurement_owner'],
          ['entitlementPaymentTerms', 'payment_terms'],
          ['entitlementExpansionReview', 'expansion_review_date'],
          ['entitlementBillingNote', 'billing_note'],
          ['entitlementNotes', 'customer_note']
        ].forEach(function(pair) {
          var el = byId(pair[0]);
          if (el && document.activeElement !== el) el.value = state[pair[1]] || '';
        });
        text('entitlementsMeta', state.updated_at ? 'updated ' + rel(state.updated_at) : 'browser-local');
        text('entitlementsStatusMeta', packet.status === 'ready_for_paid_pilot' ? 'ready' : 'contract review');
        text('entitlementsBillingMeta', (packet.billing_handoff || {}).status || 'commercial review');
        text('entitlementsRenewalMeta', ((packet.amendment_history || {}).renewal_summary || {}).status || 'renewal watch');
        byId('entitlementsSummaryList').innerHTML = entitlementsSummaryRows(packet).join('');
        byId('entitlementsCapacityList').innerHTML = entitlementsCapacityRows(packet).join('');
        byId('entitlementsBillingList').innerHTML = entitlementsBillingRows(packet).join('');
        byId('entitlementsRenewalList').innerHTML = entitlementsRenewalRows(packet).join('');
        byId('entitlementAmendmentList').innerHTML = entitlementAmendmentRows(packet);
        byId('entitlementsUsageMeterList').innerHTML = entitlementsUsageMeterRows(packet).join('');
        byId('entitlementsUsageGuardrailList').innerHTML = entitlementsUsageGuardrailRows(packet).join('');
        byId('entitlementsGuardrailList').innerHTML = entitlementsGuardrailRows(packet).join('');
        byId('entitlementsHandoffList').innerHTML = entitlementsHandoffRows(packet).join('');
        var packetBox = byId('entitlementsPacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function normalizePaidOnboardingStatus(value, legacyPassed) {
        var status = String(value || '').trim().toLowerCase();
        if (['passed', 'blocked', 'missing'].indexOf(status) !== -1) return status;
        return legacyPassed === true ? 'passed' : 'missing';
      }
      function isStalePaidOnboardingEvidence(updatedAt) {
        if (!updatedAt) return true;
        var age = Date.now() - new Date(updatedAt).getTime();
        return !Number.isFinite(age) || age > PAID_ONBOARDING_MANUAL_STALE_MS;
      }
      function paidOnboardingOption(status, expected, label) {
        return '<option value="' + escapeHtml(expected) + '"' + (status === expected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
      }
      function safeOnboardingText(value) {
        return redactEntitlementNote(value);
      }
      function paidOnboardingManualRows() {
        var state = getPaidOnboardingManualState();
        return PAID_ONBOARDING_MANUAL_ITEMS.map(function(item) {
          var record = state[item.id] && typeof state[item.id] === 'object' ? state[item.id] : {};
          var status = normalizePaidOnboardingStatus(record.status, record.passed);
          var stale = status === 'passed' && isStalePaidOnboardingEvidence(record.updated_at);
          return Object.assign({}, item, {
            status: status,
            passed: status === 'passed' && !stale,
            blocked: status === 'blocked',
            stale: stale,
            updated_at: record.updated_at || null,
            owner: safeOnboardingText(record.owner) || null,
            due_date: safeOnboardingText(record.due_date) || null,
            note: safeOnboardingText(record.note) || null
          });
        });
      }
      function paidOnboardingRoleTaskRows() {
        var state = getPaidOnboardingManualState();
        return PAID_ONBOARDING_ROLE_TASKS.map(function(item) {
          var record = state[item.id] && typeof state[item.id] === 'object' ? state[item.id] : {};
          var status = normalizePaidOnboardingStatus(record.status, record.passed);
          var stale = status === 'passed' && isStalePaidOnboardingEvidence(record.updated_at);
          return Object.assign({}, item, {
            status: status,
            passed: status === 'passed' && !stale,
            blocked: status === 'blocked',
            stale: stale,
            updated_at: record.updated_at || null,
            owner: safeOnboardingText(record.owner) || null,
            due_date: safeOnboardingText(record.due_date) || null,
            note: safeOnboardingText(record.note) || null
          });
        });
      }
      function paidOnboardingTaskSummary(tasks) {
        return {
          total: tasks.length,
          passed: tasks.filter(function(item) { return item.passed; }).length,
          blocked: tasks.filter(function(item) { return item.blocked; }).length,
          missing: tasks.filter(function(item) { return item.status === 'missing' || item.stale; }).length,
          stale: tasks.filter(function(item) { return item.stale; }).length,
          status: tasks.some(function(item) { return item.blocked; }) ? 'blocked' : tasks.every(function(item) { return item.passed; }) ? 'complete' : 'assigning'
        };
      }
      function buildPaidOnboardingAutomatedChecks(org, sso, readiness, overview, bootstrap, goNoGo, entitlements, pilotTesters) {
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        return [
          { id: 'runtime-production-ready', title: 'Runtime production-ready', detail: readiness.production_ready === true ? 'The control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; ') || 'Runtime readiness is not green.', passed: readiness.production_ready === true, critical: true },
          { id: 'enterprise-host', title: 'Enterprise host boundary', detail: 'Customer activation happens on enterprise.vaultproof.dev; staff/admin stays off the customer system.', passed: location.hostname === 'enterprise.vaultproof.dev' || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '', critical: true },
          { id: 'organization-scope', title: 'Organization selected', detail: currentOrgId ? 'This activation is scoped to the selected enterprise organization.' : 'Select an enterprise organization before onboarding.', passed: Boolean(currentOrgId), critical: true },
          { id: 'sso-login-configured', title: 'SSO/login configured', detail: 'SSO status is ' + (sso.provider_status || 'not confirmed') + ' with login mode ' + (sso.login_mode || 'assisted') + '.', passed: sso.provider_status === 'configured', critical: true },
          { id: 'project-scope', title: 'Project scope exists', detail: number(projectCount) + ' enterprise projects are visible.', passed: projectCount > 0, critical: true },
          { id: 'members-visible', title: 'Members visible', detail: number(memberCount) + ' members are visible for access review.', passed: memberCount > 0, critical: true },
          { id: 'provider-slots-visible', title: 'Provider slots visible', detail: number(providerCount) + ' provider slots are visible.', passed: providerCount > 0, critical: true },
          { id: 'go-no-go-green', title: 'Launch board GO', detail: goNoGo.status === 'go' ? 'Go/no-go board is green for this browser/org evidence state.' : 'Launch board status is ' + goNoGo.status + '.', passed: goNoGo.status === 'go', critical: true },
          { id: 'contract-entitlements-ready', title: 'Entitlements ready', detail: entitlements.decision, passed: entitlements.status === 'ready_for_paid_pilot', critical: true },
          { id: 'tester-readiness', title: 'Pilot tester readiness', detail: pilotTesters.status === 'ready_for_guided_testing' ? 'Tester roster has login/scenario evidence.' : 'Tester roster is not fully ready yet; keep as a visible paid-customer task.', passed: pilotTesters.status === 'ready_for_guided_testing', critical: false }
        ];
      }
      function buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var entitlements = buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotTesters = buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var apiInventory = buildApiInventoryPacket(overview, bootstrap);
        var integrationRollout = buildIntegrationRolloutPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var automated = buildPaidOnboardingAutomatedChecks(org, sso, readiness, overview, bootstrap, goNoGo, entitlements, pilotTesters);
        var manual = paidOnboardingManualRows();
        var roleTasks = paidOnboardingRoleTaskRows();
        var taskSummary = paidOnboardingTaskSummary(roleTasks);
        var blockers = automated.filter(function(item) { return item.critical && !item.passed; }).map(function(item) {
          return item.title + ': ' + item.detail;
        }).concat(manual.filter(function(item) { return item.critical && (!item.passed || item.blocked || item.stale); }).map(function(item) {
          return item.title + ': ' + (item.blocked ? 'blocked' : item.stale ? 'stale' : 'missing') + '. ' + item.action;
        })).concat(roleTasks.filter(function(item) { return item.blocked; }).map(function(item) {
          return item.title + ': blocked. ' + item.action;
        }));
        var status = blockers.length ? 'hold_for_activation' : 'ready_for_customer_testing';
        return {
          packet_type: 'vaultproof_enterprise_paid_onboarding',
          packet_version: 2,
          status: status,
          decision: status === 'ready_for_customer_testing' ? 'Paid-customer activation is ready for guided testing on enterprise.vaultproof.dev.' : 'Hold customer activation until automated gates and critical manual handoff evidence are complete.',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/onboarding',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            role: org.role || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            sso_login_mode: sso.login_mode || 'assisted',
            project_count: projectCountFromData(org, overview, bootstrap),
            member_count: Number(org.member_count || 0),
            provider_slots: providerCountFromData(overview, bootstrap)
          },
          automated_checks: automated,
          manual_evidence: manual.map(function(item) {
            return {
              id: item.id,
              title: item.title,
              status: item.status,
              critical: item.critical === true,
              owner: item.owner,
              due_date: item.due_date,
              updated_at: item.updated_at,
              stale: item.stale === true,
              note: item.note,
              action: item.action
            };
          }),
          role_task_summary: taskSummary,
          role_task_checklist: roleTasks.map(function(item) {
            return {
              id: item.id,
              role: item.role,
              title: item.title,
              status: item.status,
              owner: item.owner,
              due_date: item.due_date,
              updated_at: item.updated_at,
              stale: item.stale === true,
              note: item.note,
              action: item.action
            };
          }),
          dependencies: {
            go_no_go: goNoGo.status,
            contract_entitlements: entitlements.status,
            pilot_tester_readiness: pilotTesters.status,
            api_inventory: apiInventory.status,
            integration_rollout: integrationRollout.status,
            launch_support: support.status
          },
          handoff: {
            billing_owner: entitlements.contract && entitlements.contract.billing_owner,
            success_owner: entitlements.contract && entitlements.contract.success_owner,
            support_tier: entitlements.support && entitlements.support.support_tier,
            incident_response_add_on: entitlements.support && entitlements.support.incident_response_add_on,
            runtime_label: entitlements.support && entitlements.support.runtime_label,
            renewal_date: entitlements.contract && entitlements.contract.renewal_date,
            customer_login_url: location.origin + '/app/login',
            customer_system: 'enterprise.vaultproof.dev',
            staff_admin_system: 'admin.vaultproof.dev'
          },
          blockers: blockers,
          exports: {
            evidence_packet: '/app/evidence',
            entitlements: '/app/entitlements',
            pilot_testers: '/app/testers',
            rollout: '/app/rollout',
            support_room: '/app/support',
            security_review: '/app/security-review'
          },
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'customer payloads',
            'request and response bodies'
          ]
        };
      }
      function paidOnboardingSummaryRows(packet) {
        var org = packet.organization || {};
        var automatedPassed = packet.automated_checks.filter(function(item) { return item.passed; }).length;
        var manualPassed = packet.manual_evidence.filter(function(item) { return item.status === 'passed' && item.stale !== true; }).length;
        var taskSummary = packet.role_task_summary || {};
        return [
          row('Paid onboarding status', packet.decision, packet.status, packet.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          row('Organization scope', (org.name || 'Selected workspace') + ' on enterprise.vaultproof.dev with ' + number(org.project_count) + ' projects, ' + number(org.member_count) + ' members, and ' + number(org.provider_slots) + ' provider slots.', org.id ? 'scoped' : 'select org', org.id ? 'good' : 'warn'),
          row('Automated gates', number(automatedPassed) + ' of ' + number(packet.automated_checks.length) + ' automated activation checks pass.', automatedPassed + '/' + packet.automated_checks.length, automatedPassed === packet.automated_checks.length ? 'good' : 'warn'),
          row('Manual handoff evidence', number(manualPassed) + ' of ' + number(packet.manual_evidence.length) + ' critical activation milestones are current.', manualPassed + '/' + packet.manual_evidence.length, manualPassed === packet.manual_evidence.length ? 'good' : 'warn'),
          row('Role task checklist', number(taskSummary.passed) + ' of ' + number(taskSummary.total) + ' role tasks complete. Blocked: ' + number(taskSummary.blocked) + '. Missing: ' + number(taskSummary.missing) + '.', taskSummary.status || 'assigning', taskSummary.blocked ? 'bad' : taskSummary.status === 'complete' ? 'good' : 'warn'),
          row('Customer login URL', packet.handoff.customer_login_url, 'enterprise login', 'good')
        ].concat(packet.automated_checks.map(function(item) {
          return row(item.title, item.detail, item.passed ? 'pass' : item.critical ? 'block' : 'watch', item.passed ? 'good' : item.critical ? 'bad' : 'warn');
        })).concat(packet.blockers.length ? packet.blockers.map(function(blocker) {
          return row('Activation blocker', blocker, 'hold', 'warn');
        }) : [row('Activation blockers', 'No paid onboarding blockers in this browser/org evidence state.', 'clear', 'good')]);
      }
      function paidOnboardingManualRow(item) {
        var status = item.status || 'missing';
        var complete = item.passed && !item.stale;
        var statusOptions = paidOnboardingOption(status, 'missing', 'missing') + paidOnboardingOption(status, 'passed', 'passed') + paidOnboardingOption(status, 'blocked', 'blocked');
        return '<div class="go-evidence-row onboarding-evidence-row" data-complete="' + (complete ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-onboarding-check="' + escapeHtml(item.id) + '"' + (complete ? ' checked' : '') + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span><span class="go-action"><code>' + escapeHtml(item.action) + '</code></span><span class="go-action">' + escapeHtml(item.updated_at ? 'updated ' + rel(item.updated_at) + (item.stale ? ' - stale after 14 days' : '') : 'no timestamp yet') + '</span></span>' +
          '<span class="onboarding-controls"><select class="go-status" data-onboarding-status="' + escapeHtml(item.id) + '">' + statusOptions + '</select><input data-onboarding-owner="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.owner || '') + '" placeholder="owner" /><input data-onboarding-due="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.due_date || '') + '" placeholder="due date or test window" /><textarea class="go-note" data-onboarding-note="' + escapeHtml(item.id) + '" placeholder="customer-safe note; no secrets">' + escapeHtml(item.note || '') + '</textarea></span>' +
        '</div>';
      }
      function paidOnboardingTaskRow(item) {
        var status = item.status || 'missing';
        var complete = item.passed && !item.stale;
        var statusOptions = paidOnboardingOption(status, 'missing', 'missing') + paidOnboardingOption(status, 'passed', 'passed') + paidOnboardingOption(status, 'blocked', 'blocked');
        return '<div class="go-evidence-row onboarding-evidence-row" data-complete="' + (complete ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-onboarding-check="' + escapeHtml(item.id) + '"' + (complete ? ' checked' : '') + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="tag">' + escapeHtml(item.role) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span><span class="go-action"><code>' + escapeHtml(item.action) + '</code></span><span class="go-action">' + escapeHtml(item.updated_at ? 'updated ' + rel(item.updated_at) + (item.stale ? ' - stale after 14 days' : '') : 'no timestamp yet') + '</span></span>' +
          '<span class="onboarding-controls"><select class="go-status" data-onboarding-status="' + escapeHtml(item.id) + '">' + statusOptions + '</select><input data-onboarding-owner="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.owner || '') + '" placeholder="customer owner" /><input data-onboarding-due="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.due_date || '') + '" placeholder="due date" /><textarea class="go-note" data-onboarding-note="' + escapeHtml(item.id) + '" placeholder="task note; no secrets">' + escapeHtml(item.note || '') + '</textarea></span>' +
        '</div>';
      }
      function paidOnboardingTaskBriefText(packet) {
        var tasks = packet.role_task_checklist || [];
        var summary = packet.role_task_summary || {};
        return [
          'VaultProof paid onboarding task brief',
          'Generated: ' + packet.generated_at,
          'Organization: ' + ((packet.organization && packet.organization.name) || 'selected workspace'),
          'Status: ' + packet.status,
          'Task checklist: ' + number(summary.passed) + '/' + number(summary.total) + ' complete, ' + number(summary.blocked) + ' blocked, ' + number(summary.missing) + ' missing',
          '',
          'Role tasks:',
          tasks.length ? '- ' + tasks.map(function(item) {
            return item.role + ' - ' + item.title + ': ' + item.status + '; owner: ' + (item.owner || 'missing') + '; due: ' + (item.due_date || 'missing') + '; action: ' + item.action;
          }).join('\\n- ') : '- No role tasks available.',
          '',
          'Secret boundary:',
          '- This task brief is metadata-only and excludes ' + packet.secrets_excluded.join(', ') + '.'
        ].join('\\n');
      }
      function paidOnboardingHandoffRows(packet) {
        var handoff = packet.handoff || {};
        return [
          row('Billing owner', handoff.billing_owner || 'missing', handoff.billing_owner ? 'set' : 'missing', handoff.billing_owner ? 'good' : 'warn'),
          row('Customer success owner', handoff.success_owner || 'missing', handoff.success_owner ? 'set' : 'missing', handoff.success_owner ? 'good' : 'warn'),
          row('Support tier', handoff.support_tier || 'not set', 'support', handoff.support_tier ? 'good' : 'warn'),
          row('Incident response boundary', 'Current setting: ' + (handoff.incident_response_add_on || 'not set') + '. Base enterprise pilot keeps customer incident-response ownership unless the 24-hour response add-on is sold.', 'contract', handoff.incident_response_add_on === 'included' ? 'good' : 'warn'),
          row('System separation', 'Customer work stays on ' + handoff.customer_system + '; VaultProof staff/admin stays on ' + handoff.staff_admin_system + '.', 'separate systems', 'good'),
          row('Renewal/review date', handoff.renewal_date || 'missing', handoff.renewal_date ? 'scheduled' : 'missing', handoff.renewal_date ? 'good' : 'warn')
        ];
      }
      function paidOnboardingEvidenceRows(packet) {
        return [
          linkRow('Evidence packet', 'Export the customer-safe packet with paid onboarding status included.', packet.exports.evidence_packet, 'evidence', 'good'),
          linkRow('Entitlements', 'Confirm contract status, capacity, owners, support tier, and renewal date.', packet.exports.entitlements, 'entitlements', packet.dependencies.contract_entitlements === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          linkRow('Launch board', 'Close go/no-go blockers and manual evidence before customer testing.', packet.exports.launch_board, 'launch', packet.dependencies.go_no_go === 'go' ? 'good' : 'warn'),
          linkRow('Pilot testers', 'Prepare login/scenario tester evidence before the guided session.', packet.exports.pilot_testers, 'testers', packet.dependencies.pilot_tester_readiness === 'ready_for_guided_testing' ? 'good' : 'warn'),
          linkRow('Rollout manager', 'Review workload cutover, canary, rollback, and dry-run evidence.', packet.exports.rollout, 'rollout', packet.dependencies.integration_rollout === 'hold' ? 'warn' : 'good'),
          linkRow('Support room', 'Confirm support handoff, escalation boundary, and internal admin separation.', packet.exports.support_room, 'support', packet.dependencies.launch_support === 'ready' ? 'good' : 'warn'),
          linkRow('Security review', 'Share the security/procurement packet after activation blockers are assigned.', packet.exports.security_review, 'security', 'good'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function renderPaidOnboardingPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        latestPaidOnboardingPacket = packet;
        var taskSummary = packet.role_task_summary || {};
        text('onboardingMeta', packet.status === 'ready_for_customer_testing' ? 'ready' : 'hold');
        text('onboardingTaskMeta', number(taskSummary.passed) + '/' + number(taskSummary.total) + ' complete');
        byId('onboardingSummaryList').innerHTML = paidOnboardingSummaryRows(packet).join('');
        byId('onboardingHandoffList').innerHTML = paidOnboardingHandoffRows(packet).join('');
        byId('onboardingMilestoneList').innerHTML = paidOnboardingManualRows().map(paidOnboardingManualRow).join('');
        byId('onboardingTaskList').innerHTML = paidOnboardingRoleTaskRows().map(paidOnboardingTaskRow).join('');
        byId('onboardingEvidenceList').innerHTML = paidOnboardingEvidenceRows(packet).join('');
        var packetBox = byId('onboardingPacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function normalizeGoNoGoStatus(value, legacyPassed) {
        var status = String(value || '').trim().toLowerCase();
        if (['passed', 'blocked', 'missing'].indexOf(status) !== -1) return status;
        return legacyPassed === true ? 'passed' : 'missing';
      }
      function isStaleGoNoGoEvidence(updatedAt) {
        if (!updatedAt) return true;
        var age = Date.now() - new Date(updatedAt).getTime();
        return !Number.isFinite(age) || age > GO_NO_GO_MANUAL_STALE_MS;
      }
      function buildGoNoGoAutomatedChecks(org, sso, readiness, overview, bootstrap) {
        var controlPlane = readiness.control_plane || {};
        var executor = readiness.executor || {};
        var executorHealth = executor.health || {};
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        return [
          { id: 'runtime-production-ready', title: 'Runtime production readiness', sub: readiness.production_ready === true ? 'Control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; ') || 'Production readiness is not green.', passed: readiness.production_ready === true, critical: true },
          { id: 'security-profile', title: 'GCP confidential security profile', sub: readiness.security_profile || 'not reported', passed: readiness.security_profile === 'google-confidential-production', critical: true },
          { id: 'origin-lock', title: 'Origin lock enforced', sub: controlPlane.origin_lock_configured ? 'GCP edge origin-lock header is configured and required state is visible.' : 'Origin lock is not configured.', passed: controlPlane.origin_lock_configured === true && controlPlane.origin_lock_required === true, critical: true },
          { id: 'executor-private-health', title: 'Executor private health', sub: executor.reachable ? 'Executor health is reachable through the private runtime path with key release and attestation evidence status visible.' : 'Executor health is not reachable from readiness.', passed: executor.reachable === true && executorHealth.production_ready === true, critical: true },
          { id: 'organization-scope', title: 'Organization selected', sub: currentOrgId ? 'This decision is scoped to the selected organization.' : 'Select an organization before launch.', passed: Boolean(currentOrgId), critical: true },
          { id: 'project-scope', title: 'Project scope exists', sub: projectCount + ' project scopes are visible.', passed: projectCount > 0, critical: true },
          { id: 'members-visible', title: 'Members visible', sub: memberCount + ' members are visible for access review.', passed: memberCount > 0, critical: true },
          { id: 'provider-slots-visible', title: 'Provider slots visible', sub: providerCount + ' provider/app connections are visible.', passed: providerCount > 0, critical: true },
          { id: 'email-demo-ready', title: 'Email provider readiness', sub: emailProviders.length ? 'Email API key provider visible: ' + emailProviders.join(', ') + '.' : 'Add Resend, SendGrid, Mailgun, Postmark, or AWS SES before this pilot path.', passed: emailProviders.length > 0, critical: true },
          { id: 'traffic-evidence', title: 'Traffic evidence observed', sub: totalCalls + ' proxy calls are visible in the overview window.', passed: totalCalls > 0, critical: true },
          { id: 'sso-status', title: 'SSO/login posture reported', sub: sso.provider_status || 'not confirmed', passed: Boolean(sso.provider_status), critical: false }
        ];
      }
      function buildGoNoGoStatus(org, sso, readiness, overview, bootstrap) {
        var manualState = getGoNoGoManualState();
        var automated = buildGoNoGoAutomatedChecks(org, sso, readiness, overview, bootstrap);
        var manual = GO_NO_GO_MANUAL_ITEMS.map(function(item) {
          var saved = manualState[item.id] && typeof manualState[item.id] === 'object' ? manualState[item.id] : {};
          var status = normalizeGoNoGoStatus(saved.status, saved.passed);
          var updatedAt = saved.updated_at || null;
          var stale = status === 'passed' && isStaleGoNoGoEvidence(updatedAt);
          return Object.assign({}, item, {
            status: stale ? 'stale' : status,
            passed: status === 'passed' && !stale,
            stale: stale,
            note: String(saved.note || ''),
            updated_at: updatedAt
          });
        });
        var blockers = automated.filter(function(item) { return item.critical && !item.passed; })
          .map(function(item) { return item.title; })
          .concat(manual.filter(function(item) { return item.critical && !item.passed; }).map(function(item) {
            return item.title + (item.status === 'blocked' ? ' (blocked)' : item.status === 'stale' ? ' (stale)' : '');
          }));
        return {
          status: blockers.length ? 'hold' : 'go',
          automated: automated,
          manual: manual,
          blockers: blockers,
          automated_passed: automated.filter(function(item) { return item.passed; }).length,
          manual_passed: manual.filter(function(item) { return item.passed; }).length
        };
      }
      function goNoGoAutomatedRow(item) {
        return row(item.title, item.sub, item.passed ? 'pass' : (item.critical ? 'blocked' : 'watch'), item.passed ? 'good' : (item.critical ? 'bad' : 'warn'));
      }
      function goNoGoManualRow(item) {
        var updated = item.updated_at ? 'Last updated ' + rel(item.updated_at) + (item.stale ? '; stale after 7 days.' : '.') : 'No operator evidence timestamp yet.';
        var tagTone = item.passed ? 'good' : item.status === 'blocked' || item.status === 'stale' ? 'bad' : 'warn';
        return '<label class="go-evidence-row" data-complete="' + (item.passed ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-go-no-go-check="' + escapeHtml(item.id) + '"' + (item.passed ? ' checked' : '') + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span><span class="go-action">Action: <code>' + escapeHtml(item.action) + '</code></span><span class="go-action">' + escapeHtml(updated) + '</span><input class="go-note" data-go-no-go-note="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.note) + '" placeholder="Optional note for the customer launch record" /></span>' +
          '<span><select class="go-status" data-go-no-go-status="' + escapeHtml(item.id) + '"><option value="missing"' + (item.status === 'missing' ? ' selected' : '') + '>missing</option><option value="passed"' + (item.status === 'passed' || item.status === 'stale' ? ' selected' : '') + '>passed</option><option value="blocked"' + (item.status === 'blocked' ? ' selected' : '') + '>blocked</option></select><span class="tag ' + tagTone + '">' + escapeHtml(item.status) + '</span></span>' +
        '</label>';
      }
      function isEmailProviderName(value) {
        return ['resend', 'sendgrid', 'mailgun', 'postmark', 'aws-ses', 'aws_ses'].indexOf(String(value || '').trim().toLowerCase()) !== -1;
      }
      function emailProvidersFromOverview(overview) {
        var providers = Array.isArray(overview.providers) ? overview.providers : [];
        return providers.map(function(provider) { return String(provider || '').trim().toLowerCase(); }).filter(isEmailProviderName);
      }
      function emailProvidersFromData(overview, bootstrap) {
        var fromSlots = providerSlotsFromBootstrap(bootstrap).map(function(slot) {
          return String(slot.provider || slot.slug || '').trim().toLowerCase();
        }).filter(isEmailProviderName);
        var seen = {};
        return fromSlots.concat(emailProvidersFromOverview(overview)).filter(function(provider) {
          if (!provider || seen[provider]) return false;
          seen[provider] = true;
          return true;
        });
      }
      function buildLaunchItems(org, sso, readiness, overview, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        return [
          { id: 'production-ready', auto: true, complete: productionReady, tag: 'blocked', title: 'Runtime readiness is green', sub: productionReady ? 'The confidential runtime reports production-ready.' : 'Open readiness and clear runtime blockers before customer traffic.' },
          { id: 'org-selected', auto: true, complete: Boolean(currentOrgId), tag: 'select org', title: 'Workspace selected', sub: currentOrgId ? 'This launch board is scoped to the selected organization.' : 'Select the customer organization before reviewing launch state.' },
          { id: 'projects-created', auto: true, complete: projectCount > 0, tag: 'todo', title: 'At least one project exists', sub: projectCount + ' project scopes are visible for this organization.' },
          { id: 'members-added', auto: true, complete: memberCount > 0, tag: 'todo', title: 'Members are visible', sub: memberCount + ' organization members are visible.' },
          { id: 'sso-confirmed', auto: true, complete: sso.provider_status === 'configured', tag: 'confirm', title: 'SSO or login path confirmed', sub: sso.provider_status === 'configured' ? 'Company sign-in is configured.' : 'Confirm SSO or the assisted login path before customer testing.' },
          { id: 'provider-posture', auto: true, complete: providerCount > 0, tag: 'todo', title: 'Provider posture visible', sub: providerCount + ' provider/app connections are visible in the overview.' },
          { id: 'email-key-protected', auto: true, complete: emailProviders.length > 0, tag: 'email key', title: 'Email provider key protected', sub: emailProviders.length ? 'Email API key provider visible: ' + emailProviders.join(', ') + '.' : 'Add Resend, SendGrid, Mailgun, Postmark, or AWS SES before the customer walkthrough.' },
          { id: 'traffic-observed', auto: true, complete: totalCalls > 0, tag: 'manual', title: 'Test traffic observed', sub: totalCalls + ' proxy calls are visible in the overview window.' },
          { id: 'owners-confirmed', tag: 'owner', title: 'Customer owners confirmed', sub: 'Business, security, identity, network, developer, and incident owners are named.' },
          { id: 'first-workload-picked', tag: 'scope', title: 'First workload selected', sub: 'One low-risk production workflow, one provider path, and one owner group are chosen.' },
          { id: 'policy-reviewed', tag: 'policy', title: 'Caller policy reviewed', sub: 'Origins, gateways, CIDRs, methods, hosts, path prefixes, and rate limits are approved.' },
          { id: 'evidence-exported', tag: 'evidence', title: 'Evidence exports reviewed', sub: 'Readiness, audit CSV, access-review CSV, and activity views are ready for customer review.' },
          { id: 'alerts-tested', tag: 'alerts', title: 'Alerts tested', sub: 'Alert destinations are configured and a test alert has reached the right responders.' },
          { id: 'rollback-owner', tag: 'rollback', title: 'Rollback owner assigned', sub: 'A named owner can pause traffic, revoke provider slots, or roll back the first workload.' },
        ];
      }
      function launchBriefText(org, sso, readiness, overview, percent, doneCount, totalCount, goNoGo, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap || {});
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap || {});
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap || {}, goNoGo);
        var blockers = goNoGo && goNoGo.blockers && goNoGo.blockers.length
          ? goNoGo.blockers.join('; ')
          : 'none';
        return [
          'VaultProof Enterprise launch brief',
          'Organization: ' + (org.name || 'selected workspace'),
          'Launch progress: ' + percent + '% (' + doneCount + '/' + totalCount + ' tasks)',
          'Go/no-go decision: ' + (goNoGo && goNoGo.status === 'go' ? 'GO' : 'HOLD'),
          'Go/no-go blockers: ' + blockers,
          'Identity/OAuth proof status: ' + identityQa.status,
          'Enterprise login URL: ' + identityQa.login_url,
          'Supabase redirect allowlist: ' + identityQa.allowed_redirect_uri,
          'External OAuth callback: ' + identityQa.external_oauth_callback_uri,
          'Key rotation proof status: ' + displayPilotStatus(rotation.status),
          'Provider material modes: ' + rotation.provider_material_summary.live_sealed_slots + ' live sealed / ' + rotation.provider_material_summary.placeholder_slots + ' placeholder / ' + rotation.provider_material_summary.missing_slots + ' missing',
          'Pilot operations proof status: ' + pilotOps.status,
          'Rollback owner/path: ' + pilotOps.manual_evidence.rollback_owner_path.status,
          'Budget/monitoring review: ' + pilotOps.manual_evidence.budget_monitoring.status,
          'API proxy self-test status: ' + apiProxy.status,
          'API proxy execute endpoint: ' + apiProxy.execute_endpoint_pattern,
          'Monitoring evidence status: ' + monitoring.status,
          'Monitoring live gate: ' + monitoring.operator_commands.live_gate,
          'Runtime production-ready: ' + (productionReady ? 'yes' : 'no'),
          'SSO/login status: ' + (sso.provider_status || 'not confirmed'),
          'Projects: ' + number(org.project_count || overview.totalProjects),
          'Members: ' + number(org.member_count),
          'Proxy calls observed: ' + number(overview.totalCalls),
          'Manual launch evidence passed: ' + (goNoGo ? goNoGo.manual_passed + '/' + goNoGo.manual.length : '0/0'),
          '',
          'Next customer actions:',
          '- Confirm the first workload, owner, provider path, and expected volume.',
          '- Review caller-lock policy in Control.',
          '- Review provider slot posture and emergency revoke path.',
          '- Run or copy the API proxy self-test dry-run from Provider Slots.',
          '- Review Monitoring evidence in Evidence and alert operations in Alerts.',
          '- Complete strict login QA, Cloud Armor verification, key-rotation review, rollback owner, and budget/monitoring review.',
          '- Export audit and access-review evidence.',
          '- Send one low-volume dry-run or test request before production traffic.',
        ].join('\\n');
      }
      function renderLaunchPanel(org, sso, readiness, overview, bootstrap) {
        var manualState = getLaunchManualState();
        var items = buildLaunchItems(org, sso, readiness, overview, bootstrap);
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var doneCount = items.filter(function(item) {
          return item.auto ? item.complete : manualState[item.id];
        }).length;
        var totalCount = items.length;
        var percent = totalCount ? Math.round(doneCount * 100 / totalCount) : 0;
        text('launchProgressValue', percent + '%');
        text('launchProgressMeta', doneCount + ' of ' + totalCount);
        text('launchProgressCopy', percent >= 80 ? 'This workspace is close to a customer test.' : 'Work through the remaining launch tasks before inviting customer traffic.');
        var bar = byId('launchProgressBar');
        if (bar) bar.style.width = percent + '%';
        byId('launchSummaryList').innerHTML = [
          row('Production readiness', readiness.production_ready === true ? 'Control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; '), readiness.production_ready === true ? 'ready' : 'blocked', readiness.production_ready === true ? 'good' : 'bad'),
          row('Organization role', org.role || 'member', org.kind || 'workspace', org.role === 'owner' || org.role === 'admin' ? 'good' : 'warn'),
          row('SSO/login posture', sso.provider_status || 'not confirmed', sso.login_mode || 'assisted', sso.provider_status === 'configured' ? 'good' : 'warn'),
          row('Usage posture', number(overview.totalCalls) + ' calls, ' + number(overview.errorCalls) + ' errors, ' + number(overview.deniedCalls) + ' denied.', (overview.errorCalls || overview.deniedCalls) ? 'watch' : 'clean', (overview.errorCalls || overview.deniedCalls) ? 'warn' : 'good')
        ].join('');
        text('goNoGoMeta', goNoGo.status === 'go' ? 'go' : 'hold');
        byId('goNoGoDecision').innerHTML =
          '<div class="go-decision-title">' + (goNoGo.status === 'go' ? 'GO: safe to start pilot testing' : 'HOLD: finish launch evidence first') + '</div>' +
          '<span class="mini">' + (goNoGo.status === 'go' ? 'Automated readiness is green and all critical operator evidence is recorded for this organization.' : 'Remaining blockers: ' + escapeHtml(goNoGo.blockers.join('; '))) + '</span>' +
          '<div><span class="tag ' + (goNoGo.status === 'go' ? 'good' : 'bad') + '">' + (goNoGo.status === 'go' ? 'go' : 'hold') + '</span><span class="tag">go/hold decision copy</span><span class="tag">' + goNoGo.automated_passed + '/' + goNoGo.automated.length + ' automated</span><span class="tag">' + goNoGo.manual_passed + '/' + goNoGo.manual.length + ' manual</span></div>';
        byId('goNoGoList').innerHTML =
          '<div class="mini">Automated checks from readiness and workspace data</div>' +
          goNoGo.automated.map(goNoGoAutomatedRow).join('') +
          '<div class="mini" style="margin-top:8px">Operator-confirmed evidence saved in this browser</div>' +
          goNoGo.manual.map(goNoGoManualRow).join('');
        text('identityQaMeta', identityQa.status);
        byId('identityQaList').innerHTML = identityQaRows(identityQa).join('');
        text('keyRotationMeta', displayPilotStatus(rotation.status));
        byId('keyRotationList').innerHTML = keyRotationRows(rotation).join('');
        text('pilotOpsMeta', pilotOps.status);
        byId('pilotOpsList').innerHTML = pilotOpsRows(pilotOps).join('');
        byId('launchChecklist').innerHTML = items.map(function(item) {
          return launchCheckRow(item, manualState[item.id]);
        }).join('');
        byId('launchActions').innerHTML = [
          linkRow('Review policy', 'Open Control to confirm origins, gateways, provider allowlists, upstream restrictions, and rate limits.', '/app/control', 'control', 'good'),
          linkRow('Check provider slots', 'Confirm material mode, owner, rotation, and emergency revoke posture before customer calls.', '/app/keys', 'slots', 'good'),
          linkRow('Export audit evidence', 'Open Audit to search events and export CSV evidence for the customer packet.', '/app/audit', 'audit', 'good'),
          linkRow('Export access review', 'Open Members to review roles and export access-review CSV.', '/app/members', 'members', 'good'),
          linkRow('Open readiness', 'Confirm the live runtime reports the current production posture.', '/readiness', 'readiness', readiness.production_ready === true ? 'good' : 'warn')
        ].join('');
        var brief = byId('launchBrief');
        if (brief) brief.value = launchBriefText(org, sso, readiness, overview, percent, doneCount, totalCount, goNoGo, bootstrap);
      }
      function evidenceExportHref(path) {
        if (!currentOrgId) return path;
        var joiner = path.indexOf('?') === -1 ? '?' : '&';
        return path + joiner + 'org=' + encodeURIComponent(currentOrgId);
      }
      function evidencePacketObject(org, sso, readiness, overview, bootstrap) {
        var controlPlane = readiness.control_plane || {};
        var executor = readiness.executor || {};
        var executorHealth = executor.health || {};
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var apiInventory = buildApiInventoryPacket(overview, bootstrap);
        var policyDrift = buildPolicyDriftPacket(overview, bootstrap);
        var integrationRollout = buildIntegrationRolloutPacket(overview, bootstrap);
        var scannerExposure = buildScannerExposurePacket(overview, bootstrap);
        var keyExposureResponse = buildKeyExposureResponsePacket(overview, bootstrap, scannerExposure);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var releaseEvidence = buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap);
        var pilotTesters = buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var entitlements = buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var onboarding = buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var securityReview = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        return {
          packet_type: 'vaultproof_enterprise_evidence_packet',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            role: org.role || null,
            kind: org.kind || null,
            project_count: projectCountFromData(org, overview, bootstrap),
            member_count: Number(org.member_count || 0),
            sso_provider_status: sso.provider_status || 'not confirmed',
            sso_login_mode: sso.login_mode || 'assisted'
          },
          runtime_readiness: {
            production_ready: readiness.production_ready === true,
            pilot_ready: readiness.demo_ready === true,
            security_profile: readiness.security_profile || null,
            runtime_tier: displayRuntimeTier(readiness.runtime_tier),
            customer_dedicated_runtime: readiness.customer_dedicated_runtime === true,
            control_plane: {
              executor_configured: controlPlane.executor_configured === true,
              supabase_configured: controlPlane.supabase_configured === true,
              origin_lock_configured: controlPlane.origin_lock_configured === true,
              origin_lock_required: controlPlane.origin_lock_required === true
            },
            executor: {
              reachable: executor.reachable === true,
              status: executor.status || null,
              production_ready: executorHealth.production_ready === true,
              key_release_ready: executorHealth.key_release_ready === true,
              attestation_evidence_ready: executorHealth.attestation_evidence_ready === true,
              security_profile: executorHealth.security_profile || null
            }
          },
          usage_summary: {
            proxy_calls: Number(overview.totalCalls || 0),
            denied_calls: Number(overview.deniedCalls || 0),
            error_calls: Number(overview.errorCalls || 0),
            active_provider_slots: providerCountFromData(overview, bootstrap),
            email_provider_slots: emailProviders.length,
            email_providers: emailProviders
          },
          go_no_go: {
            status: goNoGo.status,
            blockers: goNoGo.blockers,
            automated_checks: goNoGo.automated.map(function(item) {
              return {
                id: item.id,
                title: item.title,
                status: item.passed ? 'pass' : 'block',
                critical: item.critical === true,
                detail: item.sub
              };
            }),
            manual_evidence: goNoGo.manual.map(function(item) {
              return {
                id: item.id,
                title: item.title,
                status: item.status || (item.passed ? 'passed' : 'missing'),
                critical: item.critical === true,
                stale: item.stale === true,
                updated_at: item.updated_at,
                note: item.note || null,
                action: item.action
              };
            })
          },
          identity_login_qa: identityQa,
          key_rotation_evidence: rotation,
          pilot_operations_evidence: pilotOps,
          api_proxy_self_test: apiProxy,
          api_inventory: apiInventory,
          policy_drift_exceptions: policyDrift,
          integration_rollout: integrationRollout,
          scanner_exposure_review: scannerExposure,
          key_exposure_response: keyExposureResponse,
          launch_support_readiness: support,
          monitoring_evidence: monitoring,
          release_evidence: releaseEvidence,
          pilot_tester_readiness: pilotTesters,
          contract_entitlements: entitlements,
          paid_onboarding: onboarding,
          security_review_packet: securityReview,
          exports: {
            readiness: '/readiness',
            audit_csv_30_days: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'),
            access_review_csv: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv'),
            activity: '/app/activity',
            api_inventory: '/app/inventory',
            policy_drift: '/app/policy',
            integration_rollout: '/app/rollout',
            scanner_exposure: '/app/scanner',
            key_exposure_response: '/app/keys',
            release_evidence: '/app/release',
            pilot_testers: '/app/testers',
            entitlements: '/app/entitlements',
            paid_onboarding: '/app/onboarding',
            provider_slots: '/app/keys',
            security_review: '/app/security-review'
          },
          customer_review_notes: [
            'Verify production readiness before customer traffic.',
            'Review the go/no-go launch decision and close any hold blockers.',
            'Export audit CSV and access-review CSV for the review packet.',
            'Confirm caller-lock policy, provider slot posture, and emergency revoke owners.',
            'Rotate shared or exposed pilot keys before paid customer data, or keep a pilot-limited acceptance note in the launch board.',
            'Confirm rollback ownership, budget alert coverage, and launch-week monitoring ownership before live customer traffic.',
            'Run the API proxy dry-run self-test and blocked-recipient email denial test before the customer walkthrough.',
            'Review the API inventory for owners, environment, data sensitivity, risk, provider-slot mapping, policy posture, stale traffic, and review due items.',
            'Review policy drift and accepted-risk exceptions for owner, reason, compensating control, expiration date, next action, and launch hold status.',
            'Review the integration rollout plan for application owner, gateway owner, target date, canary percent, test status, rollback owner/path, blockers, and copy-safe dry-run snippet.',
            'Review scanner exposure evidence for redacted finding metadata, owner, rotation status, evidence reference, and open critical/high remediation before paid traffic.',
            'Review key exposure response proof for linked scanner findings, provider-slot containment, emergency revoke, rotation scope, and proof boundaries.',
            'Review launch support scope, internal admin boundary, approval gates, and customer handoff notes before pilot traffic.',
            'Review monitoring evidence, alert destination/test-send workflow, Cloud Armor verification, and budget alert posture before launch-week traffic.',
            'Review release evidence for build/image tag, approver, verifier, QA/gate result, rollout state, rollback owner/path, and customer-safe notes after each deploy.',
            'Prepare paid-pilot testers in /app/testers with login status, scenario assignments, feedback, and blockers before the guided session.',
            'Confirm contract entitlements in /app/entitlements before paid onboarding: package, capacity, owners, support tier, renewal date, and incident-response boundary.',
            'Use /app/onboarding to confirm paid-customer activation owners, login handoff, first workload scope, support handoff, capacity review, key posture, and testing window.',
            'Share the security review packet with customer security, procurement, and technical reviewers after validating launch blockers.',
            'VaultProof staff handles proposal drafting and pilot-success tracking on admin.vaultproof.dev, outside the customer workspace.',
            'For the protected email API key workflow, verify sender, recipient, template, gateway, and rate policy before live sends.',
            'Keep provider keys, encrypted shares, service-role keys, origin-lock values, and signing secrets out of customer packets.'
          ]
        };
      }
      function renderEvidencePanel(org, sso, readiness, overview, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var controlPlane = readiness.control_plane || {};
        var executor = readiness.executor || {};
        var executorHealth = executor.health || {};
        var packet = evidencePacketObject(org, sso, readiness, overview, bootstrap);
        var identityQa = packet.identity_login_qa || buildIdentityQaPacket(buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        var rotation = packet.key_rotation_evidence || buildKeyRotationPacket(buildGoNoGoStatus(org, sso, readiness, overview, bootstrap), bootstrap);
        var pilotOps = packet.pilot_operations_evidence || buildPilotOpsPacket(buildGoNoGoStatus(org, sso, readiness, overview, bootstrap), readiness, overview);
        var apiProxy = packet.api_proxy_self_test || buildApiProxySelfTestPacket(overview, bootstrap);
        var apiInventory = packet.api_inventory || buildApiInventoryPacket(overview, bootstrap);
        var policyDrift = packet.policy_drift_exceptions || buildPolicyDriftPacket(overview, bootstrap);
        var integrationRollout = packet.integration_rollout || buildIntegrationRolloutPacket(overview, bootstrap);
        var scannerExposure = packet.scanner_exposure_review || buildScannerExposurePacket(overview, bootstrap);
        var keyExposureResponse = packet.key_exposure_response || buildKeyExposureResponsePacket(overview, bootstrap, scannerExposure);
        var support = packet.launch_support_readiness || buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        var monitoring = packet.monitoring_evidence || buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        var releaseEvidence = packet.release_evidence || buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap);
        var pilotTesters = packet.pilot_tester_readiness || buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var entitlements = packet.contract_entitlements || buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        var onboarding = packet.paid_onboarding || buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        text('evidenceMeta', productionReady ? 'ready for review' : 'needs attention');
        byId('evidenceReadinessList').innerHTML = [
          row('Production readiness', productionReady ? 'Control plane and confidential executor report production-ready.' : (readiness.production_blockers || []).join('; '), productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
          row('Go/no-go launch decision', packet.go_no_go.status === 'go' ? 'Launch board says GO for pilot testing.' : 'Launch board says HOLD: ' + packet.go_no_go.blockers.join('; '), packet.go_no_go.status, packet.go_no_go.status === 'go' ? 'good' : 'bad'),
          row('Security profile', readiness.security_profile || 'not reported', displayRuntimeTier(readiness.runtime_tier), readiness.security_profile === 'google-confidential-production' ? 'good' : 'warn'),
          row('Origin lock', controlPlane.origin_lock_configured ? 'GCP edge origin-lock header is configured and enforced by the control plane.' : 'Origin lock still needs configuration review.', controlPlane.origin_lock_required ? 'required' : 'optional', controlPlane.origin_lock_configured ? 'good' : 'warn'),
          row('Executor evidence', executor.reachable ? 'Executor health is reachable through the private runtime path. Key release: ' + (executorHealth.key_release_ready ? 'ready' : 'attention') + '. Attestation: ' + (executorHealth.attestation_evidence_ready ? 'ready' : 'attention') + '.' : 'Executor health was not reachable from readiness.', executor.reachable ? 'reachable' : 'attention', executor.reachable ? 'good' : 'bad')
        ].join('');
        byId('evidenceExportList').innerHTML = [
          linkRow('Readiness summary', 'Customer-facing production gate for runtime, executor, key release, and Cloud KMS posture.', '/readiness', 'open', productionReady ? 'good' : 'warn'),
          linkRow('Audit CSV', 'Governance and runtime evidence for the last 30 days.', packet.exports.audit_csv_30_days, 'CSV', 'good'),
          linkRow('Access review CSV', 'Members, roles, invitations, and project assignment evidence.', packet.exports.access_review_csv, 'CSV', 'good'),
          linkRow('Activity review', 'Runtime events, status codes, latency, provider request IDs, and attestation hints.', '/app/activity', 'open', 'good'),
          linkRow('API inventory export', 'Metadata-only API inventory with owners, risk, provider mapping, policy posture, traffic evidence, and review state.', '/app/inventory', 'inventory', 'good'),
          linkRow('Policy drift export', 'Customer-safe policy drift and accepted-risk evidence with owners, expiry, compensating controls, and launch status.', '/app/policy', 'policy drift', policyDrift.status === 'hold' ? 'warn' : 'good'),
          linkRow('Integration rollout export', 'Customer-safe cutover plan with application/gateway owners, canary status, rollback path, blockers, and copy-safe snippet guidance.', '/app/rollout', 'rollout', integrationRollout.status === 'hold' ? 'warn' : 'good'),
          linkRow('Scanner exposure export', 'Customer-safe secret exposure intake with redacted finding metadata, owners, rotation status, and remediation evidence.', '/app/scanner', 'scanner', scannerExposure.status === 'hold' ? 'warn' : 'good'),
          linkRow('Key exposure response export', 'Customer-safe incident response packet with linked scanner findings, provider-slot containment, emergency revoke path, and rotation scope.', '/app/keys', 'incident', keyExposureResponse.status === 'hold' ? 'warn' : 'good'),
          linkRow('Release evidence export', 'Customer-safe release proof with build/image tag, approval, verification, rollout state, and rollback path.', '/app/release', 'release', releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn'),
          linkRow('Paid-pilot tester export', 'Customer-safe tester roster, login readiness, scenario assignments, feedback, and blocker metadata.', '/app/testers', 'testers', pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          linkRow('Entitlements export', 'Customer-safe paid-user package, capacity, support tier, renewal, and incident-response boundary.', '/app/entitlements', 'entitlements', entitlements.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          linkRow('Paid onboarding export', 'Customer-safe activation proof with owners, login handoff, workload scope, support handoff, capacity review, key posture, and testing window.', '/app/onboarding', 'onboarding', onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          linkRow('Provider slot posture', 'Protected provider slots, material mode, rotation, and emergency revoke state.', '/app/keys', 'open', 'good')
        ].join('');
        byId('evidenceProofList').innerHTML = [
          row('Organization scope', org.name || 'Selected workspace', org.role || 'member', currentOrgId ? 'good' : 'warn'),
          row('Projects', number(packet.organization.project_count) + ' project scopes are visible for this organization.', number(packet.organization.project_count), packet.organization.project_count ? 'good' : 'warn'),
          row('Members', number(packet.organization.member_count) + ' members are visible for access review.', number(packet.organization.member_count), packet.organization.member_count ? 'good' : 'warn'),
          row('Provider posture', number(packet.usage_summary.active_provider_slots) + ' active provider/app connections are visible in overview.', number(packet.usage_summary.active_provider_slots), packet.usage_summary.active_provider_slots ? 'good' : 'warn'),
          row('Email API key protection', packet.usage_summary.email_provider_slots ? 'Email provider slots visible: ' + packet.usage_summary.email_providers.join(', ') + '. Run protected email dry-run before the customer walkthrough.' : 'No email provider key slot is visible yet. Add Resend, SendGrid, Mailgun, Postmark, or AWS SES before the walkthrough.', packet.usage_summary.email_provider_slots ? 'ready' : 'todo', packet.usage_summary.email_provider_slots ? 'good' : 'warn'),
          row('Traffic evidence', number(packet.usage_summary.proxy_calls) + ' proxy calls, ' + number(packet.usage_summary.denied_calls) + ' denied, ' + number(packet.usage_summary.error_calls) + ' errors.', packet.usage_summary.proxy_calls ? 'observed' : 'pending', packet.usage_summary.error_calls || packet.usage_summary.denied_calls ? 'warn' : 'good')
        ].join('');
        byId('evidenceWorkflowList').innerHTML = [
          linkRow('Review launch support', 'Confirm support boundary, customer handoff, escalation path, and first workload scope.', '/app/support', 'support', 'good'),
          linkRow('Review policy control', 'Confirm origins, gateways, CIDRs, upstream hosts, path prefixes, and rate limits.', '/app/control', 'control', 'good'),
          linkRow('Review policy drift', 'Confirm every critical/high drift row is closed, blocked intentionally, or accepted with owner and expiration date.', '/app/policy', 'policy drift', policyDrift.status === 'hold' ? 'warn' : 'good'),
          linkRow('Review integration rollout', 'Confirm first workload, owners, target date, canary percentage, rollback path, and dry-run evidence before live traffic.', '/app/rollout', 'rollout', integrationRollout.status === 'hold' ? 'warn' : 'good'),
          linkRow('Review scanner exposure', 'Confirm redacted repository scan findings, owners, rotation/remediation status, and scanner evidence references before paid traffic.', '/app/scanner', 'scanner', scannerExposure.status === 'hold' ? 'warn' : 'good'),
          linkRow('Review key exposure response', 'Confirm linked scanner findings, provider-slot containment, rotation scope, and proof boundary before sharing the incident packet.', '/app/keys', 'incident', keyExposureResponse.status === 'hold' ? 'warn' : 'good'),
          linkRow('Review release evidence', 'Confirm the active build tag, approval, verification, rollout state, rollback path, and customer-safe release notes.', '/app/release', 'release', releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn'),
          linkRow('Review pilot testers', 'Confirm tester roster, login status, scenario assignments, feedback, and blockers before the guided session.', '/app/testers', 'testers', pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          linkRow('Review entitlements', 'Confirm contract status, package, capacity, billing owner, success owner, support tier, renewal date, and IR boundary before paid onboarding.', '/app/entitlements', 'entitlements', entitlements.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          linkRow('Review paid onboarding', 'Confirm activation owners, login handoff, first workload owner, support handoff, capacity review, key posture, and customer testing window.', '/app/onboarding', 'onboarding', onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          linkRow('Review technical guide', 'Use the implementation guide for architecture, trust boundaries, key custody, and troubleshooting answers.', '/app/technical-guide', 'guide', 'good'),
          linkRow('Review security packet', 'Share the concise architecture, controls, evidence links, open items, and customer-safe answers with security reviewers.', '/app/security-review', 'security', 'good'),
          linkRow('Review runbooks', 'Operator commands for verification, evidence capture, deploys, secrets, DNS, edge, SSH, and cleanup.', '/app/runbooks', 'runbooks', 'good')
        ].join('');
        text('evidenceIdentityMeta', identityQa.status);
        byId('evidenceIdentityList').innerHTML = identityQaRows(identityQa).join('');
        text('evidenceKeyRotationMeta', displayPilotStatus(rotation.status));
        byId('evidenceKeyRotationList').innerHTML = keyRotationRows(rotation).join('');
        text('evidencePilotOpsMeta', pilotOps.status);
        byId('evidencePilotOpsList').innerHTML = pilotOpsRows(pilotOps).join('');
        text('evidenceApiProxyMeta', apiProxy.status);
        byId('evidenceApiProxyList').innerHTML = apiProxySelfTestRows(apiProxy).join('');
        text('evidenceApiInventoryMeta', apiInventory.status);
        byId('evidenceApiInventoryList').innerHTML = apiInventoryProofRows(apiInventory).join('');
        text('evidencePolicyDriftMeta', policyDrift.status);
        byId('evidencePolicyDriftList').innerHTML = policyDriftProofRows(policyDrift).join('');
        text('evidenceRolloutMeta', integrationRollout.status);
        byId('evidenceRolloutList').innerHTML = integrationRolloutProofRows(integrationRollout).join('');
        text('evidenceScannerMeta', scannerExposure.status);
        byId('evidenceScannerList').innerHTML = scannerExposureProofRows(scannerExposure).join('');
        text('evidenceExposureResponseMeta', keyExposureResponse.status);
        byId('evidenceExposureResponseList').innerHTML = keyExposureResponseProofRows(keyExposureResponse).join('');
        text('evidenceSupportMeta', support.status);
        byId('evidenceSupportList').innerHTML = launchSupportProofRows(support).join('');
        text('evidenceMonitoringMeta', monitoring.status);
        byId('evidenceMonitoringList').innerHTML = monitoringEvidenceRows(monitoring).join('');
        text('evidenceReleaseMeta', releaseEvidence.status);
        byId('evidenceReleaseList').innerHTML = releaseEvidenceProofRows(releaseEvidence).join('');
        text('evidenceTesterMeta', pilotTesters.status);
        byId('evidenceTesterList').innerHTML = pilotTesterProofRows(pilotTesters).join('');
        text('evidenceEntitlementsMeta', entitlements.status);
        byId('evidenceEntitlementsList').innerHTML = entitlementsSummaryRows(entitlements).concat(entitlementsCapacityRows(entitlements)).concat(entitlementsUsageGuardrailRows(entitlements)).join('');
        text('evidenceOnboardingMeta', onboarding.status);
        byId('evidenceOnboardingList').innerHTML = paidOnboardingSummaryRows(onboarding).concat(paidOnboardingEvidenceRows(onboarding)).join('');
        var packetBox = byId('evidencePacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function demoScriptText(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var releaseEvidence = buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap);
        var pilotTesters = buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var securityReview = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotProposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotSuccess = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var entitlements = buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var onboarding = buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var scannerExposure = buildScannerExposurePacket(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var blockers = goNoGo.blockers.length ? goNoGo.blockers.join('; ') : 'none';
        return [
          'VaultProof Enterprise walkthrough talk track',
          'Headline: Active Key Protection for every API call.',
          '',
          '1. Open with the risk',
          'Leaked API keys are not just an AI problem. Email-provider keys, model-provider keys, automation keys, and partner API keys can all become live abuse paths if they sit in app code, browser storage, logs, or ordinary dashboards.',
          '',
          '2. Show the active protection path',
          'Organization: ' + (org.name || 'selected workspace'),
          'Projects visible: ' + number(projectCount),
          'Provider slots visible: ' + number(providerCount),
          'Email provider slots: ' + (emailProviders.length ? emailProviders.join(', ') : 'none yet'),
          'Proxy calls observed: ' + number(overview.totalCalls),
          'Runtime production-ready: ' + (readiness.production_ready === true ? 'yes' : 'no'),
          'SSO/login status: ' + (sso.provider_status || 'not confirmed'),
          'Identity/OAuth proof status: ' + identityQa.status,
          'OAuth callback: ' + identityQa.external_oauth_callback_uri,
          'Key rotation proof status: ' + displayPilotStatus(rotation.status),
          'Pilot operations proof status: ' + pilotOps.status,
          'API proxy self-test status: ' + apiProxy.status,
          'Launch support proof status: ' + support.status,
          'Monitoring evidence proof status: ' + monitoring.status,
          'Release evidence proof status: ' + releaseEvidence.status,
          'Paid-pilot tester readiness status: ' + pilotTesters.status,
          'Security review packet status: ' + securityReview.status,
          'Customer proposal status: ' + pilotProposal.status,
          'Customer success tracker status: ' + pilotSuccess.status,
          'Contract entitlements status: ' + entitlements.status,
          'Paid onboarding status: ' + onboarding.status,
          'Scanner exposure review status: ' + scannerExposure.status,
          '',
          '3. Walk the buyer through the product',
          '- Dashboard: current runtime, access, project, and evidence posture.',
          '- Provider slots: protected key slots, material mode, dry-run email send, blocked-recipient denial, and emergency revoke.',
          '- Activity and Audit: runtime status, denial evidence, latency, provider request IDs, and governance exports.',
          '- Evidence packet: customer-safe JSON and CSV proof with no raw provider key material.',
          '- Identity/OAuth evidence packet: strict QA command, redirect allowlist, callback URL, and browser QA status without secrets.',
          '- Key rotation evidence packet: material-mode inventory, paid-onboarding rotation actions, sealed ingest command, and redacted secret boundary.',
          '- Pilot operations evidence packet: rollback owner/path, budget/monitoring review, live launch gate command, and incident-response boundary.',
          '- API proxy self-test kit: copy-safe dry-run request, required caller-lock headers, protected email proof, and blocked-recipient denial test.',
          '- Launch support room: support model, internal admin boundary, approval gates, and customer-safe handoff package.',
          '- Monitoring evidence kit: readiness, traffic, denial/error posture, alert workflow, Cloud Armor verification, and budget guardrails.',
          '- Release evidence: active build/image tag, approver, verifier, gate result, rollout state, rollback path, and secret-safe release notes.',
          '- Pilot testers: browser-local roster, login status, scenario assignments, customer-safe feedback, and blocker tracking.',
          '- Security review packet: architecture summary, control coverage, evidence links, open launch items, and common customer answers.',
          '- Customer proposal builder: first workload scope, expected volume, price, commission math, support boundary, and close steps.',
          '- Customer success tracker: weekly customer update, milestone proof, live traffic posture, blockers, and expansion decision trail.',
          '- Entitlements: contract status, capacity envelope, support tier, renewal owner, and paid-user guardrails.',
          '- Paid onboarding: customer activation owners, login handoff, first workload scope, support handoff, key posture, and testing-window proof.',
          '- Scanner exposure intake: redacted repository findings, owner, rotation status, and evidence reference without uploading repo contents or secret values.',
          '- Launch checklist: go/no-go board, manual evidence, stale holds, and remaining blockers.',
          '',
          '4. Be crisp about boundaries',
          'VaultProof does not show raw provider keys in the browser, customer packet, logs, or ordinary dashboard views. Dry-runs are safe by default. Live sandbox delivery needs sealed provider material first.',
          '',
          '5. Current go/no-go',
          'Decision: ' + (goNoGo.status === 'go' ? 'GO' : 'HOLD'),
          'Blockers: ' + blockers,
          '',
          '6. Close',
          'The first paid pilot is one low-risk workload, one owner group, one provider path, exported evidence, and a rollback owner. Expansion happens project by project after the first workflow is stable.'
        ].join('\\n');
      }
      function renderDemoPanel(org, sso, readiness, overview, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var releaseEvidence = buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap);
        var pilotTesters = buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var securityReview = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotProposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotSuccess = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var entitlements = buildEntitlementsPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var onboarding = buildPaidOnboardingPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var scannerExposure = buildScannerExposurePacket(overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        text('demoMeta', goNoGo.status === 'go' ? 'ready to pilot' : 'hold for evidence');
        byId('demoObjectiveList').innerHTML = [
          row('Active Key Protection for every API call.', 'Start with a simple claim buyers remember: VaultProof protects sensitive provider/API calls while keeping raw keys out of app code, browser storage, logs, and customer packets.', 'headline', 'good'),
          row('Email API key story', emailProviders.length ? 'Use ' + emailProviders.join(', ') + ' as the easy-to-understand protected secret.' : 'Create or select an email provider slot before relying on the email-key story.', emailProviders.length ? 'ready' : 'todo', emailProviders.length ? 'good' : 'warn'),
          row('One paid-pilot ask', 'Close on one low-risk workflow, one owner group, one provider path, exported evidence, and rollback owner.', 'focused', 'good')
        ].join('');
        byId('demoPathList').innerHTML = [
          linkRow('Dashboard posture', 'Show runtime readiness, organization scope, project count, member count, and quick links.', '/app/dashboard', 'open', 'good'),
          linkRow('Provider slot walkthrough', 'Show material mode, protected email dry-run, blocked recipient test, policy denial evidence, and emergency revoke.', '/app/keys', 'open', providerCount ? 'good' : 'warn'),
          linkRow('Runtime activity', 'Show status codes, denial events, latency, provider request IDs, and recent traffic.', '/app/activity', 'open', overview.totalCalls ? 'good' : 'warn'),
          linkRow('Alert operations', 'Show monitoring destinations, delivery logs, dispatch runs, and test-send workflow.', '/app/alerts', 'open', monitoring.status === 'ready' ? 'good' : 'warn'),
          linkRow('Release evidence', 'Show active build/image tag, approval, verification, rollout state, rollback path, and customer-safe notes.', '/app/release', 'release', releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn'),
          linkRow('Pilot testers', 'Show tester roster, login status, scenario assignments, feedback, blockers, and readiness JSON before the guided session.', '/app/testers', 'testers', pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          linkRow('Evidence packet', 'Copy/download the customer-safe proof packet and explain what secrets are excluded.', '/app/evidence', 'packet', 'good'),
          linkRow('Security review packet', 'Show the copyable buyer packet for security, procurement, and technical review.', '/app/security-review', 'review', securityReview.status === 'ready_for_review' ? 'good' : 'warn'),
          linkRow('Customer proposal', 'Show the first workload, price, owner group, expected traffic, support terms, and close steps.', '/app/pilot', 'proposal', pilotProposal.status === 'ready_to_send' ? 'good' : 'warn'),
          linkRow('Customer success tracker', 'Show milestones, weekly update copy, traffic posture, blockers, and expansion decision evidence.', '/app/pilot-success', 'success', pilotSuccess.status === 'on_track' ? 'good' : 'warn'),
          linkRow('Entitlements', 'Show contract status, capacity allowance, billing owner, success owner, support tier, and renewal date.', '/app/entitlements', 'entitlements', entitlements.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          linkRow('Paid onboarding', 'Show customer activation owners, login handoff, first workload scope, support handoff, key posture, and testing window.', '/app/onboarding', 'onboarding', onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          linkRow('Scanner exposure intake', 'Show redacted repo scan findings, owner, rotation state, evidence reference, and secret boundary.', '/app/scanner', 'scanner', scannerExposure.status === 'hold' ? 'warn' : 'good'),
          linkRow('Launch support room', 'Show support model, internal admin boundary, approval gates, and customer handoff package.', '/app/support', 'support', support.status === 'ready' ? 'good' : 'warn'),
          linkRow('Go/no-go summary', 'Show the current launch decision, remaining blockers, and customer-safe evidence packet.', '/app/evidence', 'evidence', goNoGo.status === 'go' ? 'good' : 'warn')
        ].join('');
        byId('demoProofList').innerHTML = [
          row('GCP confidential runtime', productionReady ? 'Readiness reports production-ready with the expected GCP confidential security profile.' : 'Readiness is not green; use this as a blocker instead of a claim.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
          row('Identity/OAuth proof kit', identityQa.status === 'ready' ? 'Login QA evidence is recorded with redirect allowlist and external OAuth callback facts.' : 'Use Launch to record strict login QA, human browser QA, and Supabase redirect/OAuth confirmation.', identityQa.status, identityQa.status === 'ready' ? 'good' : 'warn'),
          row('Key rotation proof kit', rotation.status === 'accepted_for_pilot' ? 'Launch evidence records either rotation or explicit pilot-limited acceptance for shared pilot key posture.' : 'Use Launch to record key rotation or pilot-limited acceptance before a customer pilot.', displayPilotStatus(rotation.status), rotation.status === 'accepted_for_pilot' ? 'good' : 'warn'),
          row('Pilot operations proof kit', pilotOps.status === 'ready' ? 'Rollback ownership and budget/monitoring review evidence are recorded for this pilot.' : 'Use Launch to record rollback owner/path and budget/monitoring review before customer traffic.', pilotOps.status, pilotOps.status === 'ready' ? 'good' : 'warn'),
          row('API proxy self-test kit', apiProxy.status === 'ready' ? 'Provider slots and proxy traffic evidence are visible; use Provider Slots to copy the safe dry-run request.' : 'Use Provider Slots to run/copy a dry-run request and create proxy traffic evidence before the customer walkthrough.', apiProxy.status, apiProxy.status === 'ready' ? 'good' : 'warn'),
          row('Launch support kit', support.status === 'ready' ? 'Support model, internal admin boundary, and customer handoff package are ready for the pilot story.' : 'Use Support to review launch-week support scope and customer handoff boundaries.', support.status, support.status === 'ready' ? 'good' : 'warn'),
          row('Monitoring evidence kit', monitoring.status === 'ready' ? 'Runtime, traffic, alert workflow, Cloud Armor, and budget evidence are ready for launch-week review.' : 'Use Launch and Alerts to record Cloud Armor verification, budget/monitoring review, and alert test workflow before pilot traffic.', monitoring.status, monitoring.status === 'ready' ? 'good' : 'warn'),
          row('Release evidence kit', releaseEvidence.status === 'ready_with_review' ? 'Latest release has build tag, approval, verification, rollout state, and rollback evidence recorded.' : 'Use Release Evidence after each deploy so customer reviewers can see what changed and how it was verified.', releaseEvidence.status, releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn'),
          row('Paid-pilot tester readiness', pilotTesters.status === 'ready_for_guided_testing' ? 'Tester roster has a login pass recorded, assigned scenarios, and no unresolved blocker notes.' : 'Use Pilot Testers to record tester roster, login status, scenario assignment, feedback, and blockers before the guided session.', pilotTesters.status, pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          row('Security review packet', securityReview.status === 'ready_for_review' ? 'A copyable customer-safe packet is ready for security, procurement, and technical reviewers.' : 'Runtime readiness or organization scope still needs attention before sharing the review packet.', securityReview.status, securityReview.status === 'ready_for_review' ? 'good' : 'warn'),
          row('Customer proposal builder', pilotProposal.status === 'ready_to_send' ? 'The paid-pilot proposal is scoped and ready to send after customer review.' : 'Use Customer Proposal to confirm workload, provider path, owner group, price, support terms, and success metric.', pilotProposal.status, pilotProposal.status === 'ready_to_send' ? 'good' : 'warn'),
          row('Customer success tracker', pilotSuccess.status === 'on_track' ? 'Customer milestones, live checks, and weekly update proof are on track.' : 'Use Customer Success to record kickoff, dry-run, customer review, low-volume traffic, and success metric evidence.', pilotSuccess.status, pilotSuccess.status === 'on_track' ? 'good' : 'warn'),
          row('Contract entitlements', entitlements.status === 'ready_for_paid_pilot' ? 'Paid-user package, capacity, support tier, owners, renewal, and guardrails are recorded for this organization.' : 'Use Entitlements to finish contract status, capacity, billing owner, success owner, support tier, renewal date, and launch dependency checks.', entitlements.status, entitlements.status === 'ready_for_paid_pilot' ? 'good' : 'warn'),
          row('Paid onboarding', onboarding.status === 'ready_for_customer_testing' ? 'Activation owners, login handoff, support handoff, key posture, and customer testing window are recorded for this organization.' : 'Use Paid Onboarding to finish customer activation owners, login handoff, workload owner, support handoff, capacity review, key posture, and testing window.', onboarding.status, onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          row('Secret exposure intake', scannerExposure.status === 'hold' ? 'Open critical/high exposure findings remain; rotate or explicitly accept pilot-limited risk before paid data.' : scannerExposure.status === 'needs_scan_evidence' ? 'Record a redacted local/CI scanner summary before relying on this proof point.' : 'Scanner evidence is recorded with redacted metadata and no raw secret values.', scannerExposure.status, scannerExposure.status === 'hold' ? 'bad' : 'warn'),
          row('No raw key exposure', 'Provider slots show posture and material mode without returning encrypted shares or plaintext provider material to the browser.', 'secret safe', 'good'),
          row('Policy denial evidence', 'The blocked-recipient test gives a buyer a concrete denial story: policy rejected unsafe traffic and recorded evidence.', 'auditable', 'good'),
          row('Access and audit exports', 'Members, Audit, Activity, and Evidence produce reviewable CSV/JSON artifacts for security teams.', 'exportable', 'good')
        ].join('');
        byId('demoGuardrailList').innerHTML = [
          row('Dry-run first', 'Use dry-run provider execution unless sealed sandbox provider material is intentionally installed for this walkthrough.', 'safe default', 'good'),
          row('Login proof before customer testing', identityQa.status === 'ready' ? 'Identity proof is recorded for this organization.' : 'Do not invite a customer pilot user until login/OAuth proof is recorded or explicitly accepted as a pilot hold.', 'identity gate', identityQa.status === 'ready' ? 'good' : 'warn'),
          row('Rotate before paid data', rotation.status === 'accepted_for_pilot' ? 'Pilot-limited key posture is acknowledged; rotate shared material before paid customer data.' : 'Shared/exposed pilot keys still need rotation or an explicit pilot-limited acceptance note.', 'key gate', rotation.status === 'accepted_for_pilot' ? 'good' : 'warn'),
          row('Rollback/monitoring before traffic', pilotOps.status === 'ready' ? 'Rollback and monitoring ownership is recorded for this organization.' : 'Do not start pilot traffic until rollback owner/path and budget/monitoring review are recorded.', 'ops gate', pilotOps.status === 'ready' ? 'good' : 'warn'),
          row('Self-test before live calls', apiProxy.status === 'ready' ? 'API proxy self-test evidence is visible for this organization.' : 'Use dry-run and blocked-recipient tests before enabling any live sandbox provider call.', 'proxy gate', apiProxy.status === 'ready' ? 'good' : 'warn'),
          row('Support boundary before pilot', support.status === 'ready' ? 'Support scope and internal admin boundaries are visible.' : 'Review support model and internal admin boundaries before the customer starts testing.', 'support gate', support.status === 'ready' ? 'good' : 'warn'),
          row('Monitoring before pilot', monitoring.status === 'ready' ? 'Monitoring evidence is ready for launch-week customer testing.' : 'Do not start pilot traffic until runtime, traffic, alert workflow, Cloud Armor, and budget evidence are reviewed.', 'monitoring gate', monitoring.status === 'ready' ? 'good' : 'warn'),
          row('Release proof after deploy', releaseEvidence.status === 'ready_with_review' ? 'The current release is recorded with approval, verification, and rollback evidence.' : 'Do not present a deploy as customer-ready until Release Evidence records approver, verifier, build tag, rollout state, and rollback path.', 'release gate', releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn'),
          row('Tester rehearsal before live walkthrough', pilotTesters.status === 'ready_for_guided_testing' ? 'Paid-pilot tester rehearsal evidence is ready for this browser/org state.' : 'Record at least one login pass, assigned scenarios, and blocker-free tester evidence before inviting testers.', 'tester gate', pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          row('Customer activation before paid testing', onboarding.status === 'ready_for_customer_testing' ? 'Paid onboarding is ready for a guided customer testing session.' : 'Keep customer activation on hold until the paid onboarding board is complete.', 'onboarding gate', onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          row('Scanner before paid data', scannerExposure.status === 'hold' ? 'Open exposure findings are a paid-data blocker until rotated, revoked, or explicitly accepted for pilot-limited use.' : 'Use Scanner to keep redacted exposure findings tied to owner and rotation evidence.', 'scanner gate', scannerExposure.status === 'hold' ? 'bad' : 'warn'),
          row('Do not mark GO casually', goNoGo.status === 'go' ? 'The board is green for this browser/org evidence state.' : 'The board is holding on: ' + goNoGo.blockers.join('; '), goNoGo.status, goNoGo.status === 'go' ? 'good' : 'warn'),
          row('Cloud Armor evidence', 'Keep Cloud Armor as a required operator-confirmed check until the live policy exists and verify passes.', 'manual proof', 'warn'),
          row('Key rotation before paid onboarding', 'Shared or exposed pilot keys should be rotated or explicitly accepted for pilot-limited use before paid customer data.', 'required', 'warn')
        ].join('');
        byId('demoObjectionList').innerHTML = [
          row('Why charge for this?', 'The value is reducing key-leak blast radius, speeding security review, giving audit evidence, and avoiding incident cleanup from abused provider keys.', 'value', 'good'),
          row('Why keep Supabase for the pilot?', 'Supabase keeps OAuth/session/Admin Auth working now; a fresh GCP database can be planned after the pilot without delaying customer conversations.', 'practical', 'good'),
          row('Do customers need incident response included?', 'Most enterprise buyers have their own teams. Treat 24-hour response as optional add-on or higher-tier coverage, not a mandatory base feature.', 'package', 'good'),
          row('Is this only AI?', 'No. The email-key workflow proves the broader category: VaultProof protects sensitive API calls, including email, model, automation, and partner providers.', 'broader', 'good')
        ].join('');
        byId('demoCloseList').innerHTML = [
          linkRow('Package and price', 'Use Plans for the paid-pilot scope, $5k/month starting package, guardrails, and expansion path.', '/app/plans', 'plans', 'good'),
          linkRow('Customer proposal', 'Copy the first-workload proposal with price, scope, commission math, support terms, and close steps.', '/app/pilot', 'proposal', pilotProposal.status === 'ready_to_send' ? 'good' : 'warn'),
          linkRow('Customer success', 'Send a weekly update with milestones, blockers, evidence links, and expansion/no-go path.', '/app/pilot-success', 'success', pilotSuccess.status === 'on_track' ? 'good' : 'warn'),
          linkRow('Pilot testers', 'Prepare tester roster, login rehearsal state, scenario ownership, and blocker notes before the guided session.', '/app/testers', 'testers', pilotTesters.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          linkRow('Paid onboarding', 'Confirm activation owners, login handoff, first workload scope, support handoff, capacity review, key posture, and testing window.', '/app/onboarding', 'onboarding', onboarding.status === 'ready_for_customer_testing' ? 'good' : 'warn'),
          linkRow('Security review packet', 'Give customer reviewers the concise controls, evidence links, open items, and common answers packet.', '/app/security-review', 'review', securityReview.status === 'ready_for_review' ? 'good' : 'warn'),
          linkRow('Launch support', 'Use Support to prove support boundaries, handoff, and escalation paths are visible before customer traffic.', '/app/support', 'support', support.status === 'ready' ? 'good' : 'warn'),
          linkRow('Release evidence', 'Record the active build tag, approver, verification result, rollout state, rollback path, and customer-safe notes after each deploy.', '/app/release', 'release', releaseEvidence.status === 'ready_with_review' ? 'good' : 'warn'),
          linkRow('Support room', 'Use Support to explain launch-week support, evidence handoff, internal admin boundary, and approval gates.', '/app/support', 'support', support.status === 'ready' ? 'good' : 'warn'),
          linkRow('Runbooks', 'Use Runbooks for verification, deploy, evidence, secrets, DNS, edge, and cleanup commands.', '/app/runbooks', 'runbooks', 'good'),
          linkRow('Technical review', 'Use the Technical guide for architecture, identity, gateway, key custody, policy, and troubleshooting questions.', '/app/technical-guide', 'guide', 'good')
        ].join('');
        var scriptBox = byId('demoScript');
        if (scriptBox) scriptBox.value = demoScriptText(org, sso, readiness, overview, bootstrap);
      }
      function supportBriefText(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var coverage = support.coverage || {};
        var exposure = support.exposure_response || {};
        var exposureSummary = exposure.summary || {};
        return [
          'VaultProof Enterprise launch support brief',
          'Organization: ' + (coverage.organization_name || org.name || 'selected workspace'),
          'Support readiness: ' + support.status,
          'Support model: ' + support.support_model,
          'Guided pilot ready for: ' + ((support.guided_pilot_positioning || {}).ready_for || 'guided design partners and paid pilots'),
          'Not ready to promise: ' + ((support.guided_pilot_positioning || {}).not_ready_for || 'fully self-serve enterprise onboarding'),
          'PMF focus: ' + ((support.guided_pilot_positioning || {}).pmf_focus || 'enterprise pilots first'),
          'Runtime production-ready: ' + (coverage.runtime_production_ready ? 'yes' : 'no'),
          'Security profile: ' + (coverage.security_profile || 'not reported'),
          'SSO/login status: ' + (coverage.sso_provider_status || sso.provider_status || 'not confirmed'),
          'Projects: ' + number(coverage.project_count),
          'Members: ' + number(coverage.member_count),
          'Provider slots: ' + number(coverage.provider_slots),
          'Proxy calls observed: ' + number(coverage.proxy_calls),
          'Exposure response status: ' + (exposure.status || 'missing'),
          'Exposure response decision: ' + (exposure.decision || 'not available'),
          'Exposure linked scanner findings: ' + number(exposureSummary.linked_scanner_findings) + ' total / ' + number(exposureSummary.open_critical_or_high_linked_findings) + ' open critical-high',
          'Exposure provider-slot rotation scope: ' + number(exposureSummary.provider_slots_needing_rotation),
          'Employee admin surface: ' + support.internal_admin_surface,
          'Employee admin system: ' + support.internal_admin_boundary.hostname,
          'Internal admin mode: ' + support.internal_admin_boundary.default_mode,
          'Approval gate: ' + support.internal_admin_boundary.writes,
          'Incident response boundary: base pilot uses customer IR plus VaultProof launch support; 24-hour response is an optional add-on.',
          '',
          'Buyer qualification:',
          '- ' + (support.buyer_qualification || []).join('\\n- '),
          '',
          'Demo sequence:',
          '- ' + (support.guided_demo_sequence || []).join('\\n- '),
          '',
          'Guided customer setup:',
          '- ' + (support.customer_setup_sequence || []).join('\\n- '),
          '',
          'Customer handoff:',
          '- ' + support.customer_handoff.join('\\n- '),
          '',
          'Launch-week workflow:',
          '- ' + support.launch_week_workflow.join('\\n- '),
          '',
          'Exposure response handoff:',
          '- Provider Slots incident JSON: ' + location.origin + '/app/keys',
          '- Scanner remediation: ' + location.origin + '/app/scanner',
          '- Operator runbook: ' + location.origin + '/app/runbooks',
          '- Proof boundary: ' + (((exposure.proof_boundary || {}).vaultproof_controls || '') + ' ' + ((exposure.proof_boundary || {}).outside_boundary || '')).trim(),
        ].join('\\n');
      }
      function renderSupportPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        text('supportMeta', support.status === 'ready' ? 'ready for pilot' : 'hold for evidence');
        byId('supportReadinessList').innerHTML = launchSupportReadinessRows(support).join('');
        byId('supportGuidedPilotList').innerHTML = launchSupportGuidedPilotRows(support).join('');
        byId('supportQualificationList').innerHTML = launchSupportQualificationRows(support).join('');
        byId('supportSetupSequenceList').innerHTML = launchSupportSetupSequenceRows(support).join('');
        byId('supportBoundaryList').innerHTML = launchSupportBoundaryRows(support).join('');
        byId('supportWorkflowList').innerHTML = launchSupportWorkflowRows(support).join('');
        byId('supportExposureList').innerHTML = launchSupportExposureRows(support).join('');
        byId('supportHandoffList').innerHTML = launchSupportHandoffRows(support).join('');
        var brief = byId('supportBrief');
        if (brief) brief.value = supportBriefText(org, sso, readiness, overview, bootstrap);
      }
      function renderSecurityReviewPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        latestSecurityReviewPacket = packet;
        text('securityReviewMeta', packet.status === 'ready_for_review' ? 'ready for review' : 'hold for review');
        byId('securityReviewStatusList').innerHTML = securityReviewStatusRows(packet).join('');
        byId('securityReviewControlList').innerHTML = securityReviewControlRows(packet).join('');
        byId('securityReviewEvidenceList').innerHTML = securityReviewEvidenceRows(packet).join('');
        renderSecurityReviewOpenItems(packet);
        var brief = byId('securityReviewBrief');
        if (brief) brief.value = securityReviewBriefText(packet);
      }
      function renderPilotProposalPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var state = getPilotProposalState();
        text('pilotMeta', packet.status === 'ready_to_send' ? 'ready to send' : 'draft');
        [
          ['pilotWorkload', 'workload'],
          ['pilotProvider', 'provider_path'],
          ['pilotOwner', 'owner_group'],
          ['pilotMonthlyCalls', 'monthly_calls'],
          ['pilotPrice', 'monthly_price_usd'],
          ['pilotSupportTier', 'support_tier'],
          ['pilotIrAddon', 'incident_response_add_on'],
          ['pilotStartWindow', 'start_window'],
          ['pilotSuccessMetric', 'success_metric']
        ].forEach(function(item) {
          var el = byId(item[0]);
          if (el && document.activeElement !== el) el.value = state[item[1]] || '';
        });
        byId('pilotCommercialList').innerHTML = pilotCommercialRows(packet).join('');
        byId('pilotGuardrailList').innerHTML = pilotGuardrailRows(packet).join('');
        byId('pilotCloseList').innerHTML = pilotCloseRows(packet).join('');
        var brief = byId('pilotProposalBrief');
        if (brief) brief.value = pilotProposalText(packet);
      }
      function renderPilotSuccessPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        latestPilotSuccessPacket = packet;
        var decisionState = getPilotSuccessDecisionState();
        [
          ['pilotSuccessDecisionStatus', 'decision_status'],
          ['pilotSuccessDecisionPackage', 'next_package'],
          ['pilotSuccessDecisionOwner', 'owner'],
          ['pilotSuccessDecisionTarget', 'target_date'],
          ['pilotSuccessDecisionNextStep', 'next_step'],
          ['pilotSuccessDecisionNote', 'note']
        ].forEach(function(item) {
          var el = byId(item[0]);
          if (el && document.activeElement !== el) el.value = decisionState[item[1]] || '';
        });
        text('pilotSuccessMeta', packet.status === 'on_track' ? 'on track' : 'at risk');
        text('pilotSuccessDecisionMeta', packet.expansion_decision.ready ? packet.expansion_decision.decision_status : 'not ready');
        byId('pilotSuccessStatusList').innerHTML = pilotSuccessStatusRows(packet).join('');
        byId('pilotSuccessMilestoneList').innerHTML = pilotSuccessMilestoneRows(packet).join('');
        byId('pilotSuccessEvidenceList').innerHTML = pilotSuccessEvidenceRows(packet).join('');
        byId('pilotSuccessDecisionList').innerHTML = pilotSuccessDecisionRows(packet).join('');
        var brief = byId('pilotSuccessBrief');
        if (brief) brief.value = pilotSuccessBriefText(packet);
      }
      function testerInput(record, field, label, placeholder) {
        return '<div class="tester-field"><label>' + escapeHtml(label) + '</label><input data-tester-record-id="' + escapeHtml(record.id) + '" data-tester-field="' + escapeHtml(field) + '" value="' + escapeHtml(record[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function testerSelect(record, field, label, options) {
        return '<div class="tester-field"><label>' + escapeHtml(label) + '</label><select data-tester-record-id="' + escapeHtml(record.id) + '" data-tester-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + testerSelected(record[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderPilotTesterRecord(record) {
        return '<div class="tester-row" data-tester-card="' + escapeHtml(record.id) + '">' +
          '<div class="tester-head"><div><div class="row-title">' + escapeHtml(record.tester_name || 'Tester not named') + '</div>' +
          '<div class="row-sub">' + escapeHtml((record.team || 'team not set') + ' - ' + testerScenarioLabel(record.scenario) + ' - updated ' + rel(record.updated_at || record.created_at)) + '</div>' +
          '<div><span class="tag ' + testerStatusTone(record.status) + '">' + escapeHtml(record.status || 'not_invited') + '</span><span class="tag">' + escapeHtml(record.role || 'security_reviewer') + '</span><span class="tag">' + escapeHtml(record.owner || 'owner missing') + '</span></div></div>' +
          '<div class="row-actions"><button type="button" data-action="remove-pilot-tester" data-tester-record-id="' + escapeHtml(record.id) + '">remove</button><a class="tag" href="/app/members">members</a><a class="tag" href="/app/evidence">evidence</a></div></div>' +
          '<div class="tester-fields">' +
          testerInput(record, 'tester_name', 'tester name/email', 'security reviewer or tester@example.com') +
          testerInput(record, 'team', 'team', 'Security, platform, app team') +
          testerSelect(record, 'role', 'role', [
            { value: 'security_reviewer', label: 'security reviewer' },
            { value: 'platform_admin', label: 'platform admin' },
            { value: 'app_owner', label: 'app owner' },
            { value: 'developer', label: 'developer' },
            { value: 'procurement', label: 'procurement' },
            { value: 'executive_sponsor', label: 'executive sponsor' }
          ]) +
          testerSelect(record, 'scenario', 'scenario', [
            { value: 'login_and_sso', label: 'login and SSO' },
            { value: 'evidence_review', label: 'evidence review' },
            { value: 'api_proxy_self_test', label: 'API proxy self-test' },
            { value: 'provider_slot_review', label: 'provider slot review' },
            { value: 'security_review', label: 'security review' },
            { value: 'rollout_review', label: 'rollout review' },
            { value: 'support_handoff', label: 'support handoff' }
          ]) +
          testerSelect(record, 'status', 'status', [
            { value: 'not_invited', label: 'not invited' },
            { value: 'invited', label: 'invited' },
            { value: 'login_blocked', label: 'login blocked' },
            { value: 'login_passed', label: 'login passed' },
            { value: 'scenario_passed', label: 'scenario passed' },
            { value: 'feedback_received', label: 'feedback received' },
            { value: 'complete', label: 'complete' }
          ]) +
          testerInput(record, 'owner', 'VaultProof owner', 'owner for follow-up') +
          '<div class="tester-field wide"><label>blocker</label><textarea data-tester-record-id="' + escapeHtml(record.id) + '" data-tester-field="blocker" placeholder="What blocks this tester. Metadata only.">' + escapeHtml(record.blocker || '') + '</textarea></div>' +
          '<div class="tester-field wide"><label>feedback note</label><textarea data-tester-record-id="' + escapeHtml(record.id) + '" data-tester-field="feedback" placeholder="Customer-safe feedback, next step, or objection. Metadata only.">' + escapeHtml(record.feedback || '') + '</textarea></div>' +
          '</div></div>';
      }
      function testerSessionRows(packet) {
        var session = packet.guided_session || {};
        return [
          row('Guided session status', session.ready ? 'Session plan is ready for customer testing.' : 'Record session status, window, facilitator, customer owner, and success criteria before guided testing.', session.status || 'not_scheduled', session.ready ? 'good' : session.status === 'blocked' ? 'bad' : 'warn'),
          row('Session window', session.session_window || 'missing', session.session_window ? 'scheduled' : 'missing', session.session_window ? 'good' : 'warn'),
          row('Facilitator', session.facilitator || 'missing', session.facilitator ? 'owner' : 'missing', session.facilitator ? 'good' : 'warn'),
          row('Customer owner', session.customer_owner || 'missing', session.customer_owner ? 'owner' : 'missing', session.customer_owner ? 'good' : 'warn'),
          row('Success criteria', session.success_criteria || 'missing', session.success_criteria ? 'criteria' : 'missing', session.success_criteria ? 'good' : 'warn'),
          row('Customer action', session.customer_action || 'No customer action recorded yet.', 'next', session.customer_action ? 'good' : 'warn'),
          row('Session note', session.session_note || 'No customer-safe session note recorded.', 'note', session.session_note ? 'good' : 'warn')
        ].concat((session.next_actions || []).map(function(action) {
          return row('Session action', action, 'next', action.indexOf('Resolve') === 0 ? 'bad' : 'warn');
        }));
      }
      function testerSessionBriefText(packet) {
        var session = packet.guided_session || {};
        var summary = packet.summary || {};
        var testers = (packet.testers || []).map(function(item) {
          return (item.tester_name || 'tester') + ' - ' + testerScenarioLabel(item.scenario) + ' - ' + (item.status || 'not_invited') + (item.owner ? ' - owner ' + item.owner : '');
        });
        return [
          'VaultProof paid-pilot guided tester session brief',
          'Generated: ' + packet.generated_at,
          'Organization: ' + ((packet.organization && packet.organization.name) || 'selected workspace'),
          'Tester readiness: ' + packet.status,
          'Guided session: ' + (session.status || 'not_scheduled') + ' / ready: ' + (session.ready ? 'yes' : 'no'),
          'Session window: ' + (session.session_window || 'missing'),
          'VaultProof facilitator: ' + (session.facilitator || 'missing'),
          'Customer owner: ' + (session.customer_owner || 'missing'),
          '',
          'Success criteria:',
          '- ' + (session.success_criteria || 'missing'),
          '',
          'Customer action:',
          '- ' + (session.customer_action || 'not recorded'),
          '',
          'Tester roster:',
          '- ' + (testers.length ? testers.join('\\n- ') : 'none recorded'),
          '',
          'Readiness counts:',
          '- Total testers: ' + number(summary.total_testers),
          '- Invited: ' + number(summary.invited),
          '- Login passed: ' + number(summary.login_passed),
          '- Scenario passed: ' + number(summary.scenario_passed),
          '- Feedback received: ' + number(summary.feedback_received),
          '- Blockers: ' + (summary.blockers && summary.blockers.length ? summary.blockers.join('; ') : 'none'),
          '',
          'Next actions:',
          '- ' + ((session.next_actions || []).length ? session.next_actions.join('\\n- ') : 'Run the guided session and capture feedback.'),
          '',
          'Secret boundary:',
          '- ' + (session.secret_boundary || 'Metadata only; no secrets or payloads are included.')
        ].join('\\n');
      }
      function savePilotTesterField(target) {
        var id = target.getAttribute('data-tester-record-id');
        var field = target.getAttribute('data-tester-field');
        if (!id || !field) return;
        var rows = readPilotTesterRecords();
        var now = new Date().toISOString();
        rows = rows.map(function(row) {
          if (row.id !== id) return row;
          row[field] = ['role', 'scenario', 'status'].indexOf(field) !== -1 ? target.value : redactTesterText(target.value);
          row.updated_at = now;
          return row;
        });
        writePilotTesterRecords(rows);
        if (latestOrgPayload && latestReadiness) {
          renderPilotTestersPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function addPilotTesterFromForm() {
        var now = new Date().toISOString();
        var record = {
          id: 'tester-' + Date.now().toString(36),
          tester_name: redactTesterText(byId('testerName') && byId('testerName').value),
          team: redactTesterText(byId('testerTeam') && byId('testerTeam').value),
          role: byId('testerRole') && byId('testerRole').value || 'security_reviewer',
          scenario: byId('testerScenario') && byId('testerScenario').value || 'login_and_sso',
          status: byId('testerStatus') && byId('testerStatus').value || 'not_invited',
          owner: redactTesterText(byId('testerOwner') && byId('testerOwner').value),
          blocker: redactTesterText(byId('testerBlocker') && byId('testerBlocker').value),
          feedback: redactTesterText(byId('testerFeedback') && byId('testerFeedback').value),
          created_at: now,
          updated_at: now
        };
        if (!record.tester_name && !record.team && !record.owner) {
          notice('Add a tester name, team, or owner before saving pilot tester evidence.');
          return;
        }
        var rows = readPilotTesterRecords();
        rows.unshift(record);
        writePilotTesterRecords(rows);
        ['testerName', 'testerTeam', 'testerOwner', 'testerBlocker', 'testerFeedback'].forEach(function(id) {
          var el = byId(id);
          if (el) el.value = '';
        });
        notice('Pilot tester evidence saved as browser-local metadata.');
        if (latestOrgPayload && latestReadiness) {
          renderPilotTestersPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function removePilotTester(id) {
        writePilotTesterRecords(readPilotTesterRecords().filter(function(row) { return row.id !== id; }));
        if (latestOrgPayload && latestReadiness) {
          renderPilotTestersPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function renderPilotTestersPanel(org, sso, readiness, overview, bootstrap) {
        var packet = buildPilotTesterReadinessPacket(org, sso, readiness, overview, bootstrap);
        var summary = packet.summary || {};
        var sessionState = getPilotTesterSessionState();
        [
          ['testerSessionStatus', 'status'],
          ['testerSessionWindow', 'session_window'],
          ['testerSessionFacilitator', 'facilitator'],
          ['testerSessionCustomerOwner', 'customer_owner'],
          ['testerSessionSuccess', 'success_criteria'],
          ['testerSessionAction', 'customer_action'],
          ['testerSessionNote', 'session_note']
        ].forEach(function(item) {
          var el = byId(item[0]);
          if (el && document.activeElement !== el) el.value = sessionState[item[1]] || '';
        });
        latestPilotTesterPacket = packet;
        text('testerMeta', packet.status);
        text('testerSessionMeta', packet.guided_session.ready ? 'ready' : packet.guided_session.status || 'not scheduled');
        byId('testerReadinessList').innerHTML = [
          row('Paid-pilot tester readiness', packet.status === 'ready_for_guided_testing' ? 'Tester roster has a login pass and no unresolved blocker notes in this browser evidence state.' : 'Hold until testers are recorded, at least one login pass is confirmed, and blocker notes are resolved.', packet.status, packet.status === 'ready_for_guided_testing' ? 'good' : 'warn'),
          row('Tester progress', number(summary.total_testers) + ' testers, ' + number(summary.invited) + ' invited, ' + number(summary.login_passed) + ' login passed, ' + number(summary.scenario_passed) + ' scenario passed, ' + number(summary.feedback_received) + ' feedback received.', summary.total_testers ? 'recorded' : 'missing', summary.total_testers ? 'good' : 'warn'),
          row('Guided session', packet.guided_session.ready ? 'Guided session plan has a window, facilitator, customer owner, and success criteria.' : 'Guided session plan is not ready yet.', packet.guided_session.status, packet.guided_session.ready ? 'good' : 'warn'),
          row('Runtime and SSO context', 'Runtime production-ready: ' + (packet.runtime.production_ready ? 'yes' : 'no') + '. SSO/login posture: ' + (packet.organization.sso_provider_status || 'not confirmed') + '.', packet.runtime.production_ready ? 'ready' : 'blocked', packet.runtime.production_ready ? 'good' : 'bad'),
          row('Blockers', summary.blockers && summary.blockers.length ? summary.blockers.join('; ') : 'No tester blockers recorded in this browser evidence state.', summary.blocked ? 'blocked' : 'clear', summary.blocked ? 'bad' : 'good')
        ].join('');
        byId('testerSessionList').innerHTML = testerSessionRows(packet).join('');
        var sessionBrief = byId('testerSessionBrief');
        if (sessionBrief) sessionBrief.value = testerSessionBriefText(packet);
        byId('testerRosterList').innerHTML = packet.testers.length ? packet.testers.map(renderPilotTesterRecord).join('') : '<div class="empty">No pilot testers saved yet. Add at least one tester, assign a scenario, and record login status before the guided session.</div>';
        byId('testerWorkflowList').innerHTML = [
          linkRow('Invite or confirm testers', 'Use Members to confirm organization access before the guided session.', '/app/members', 'members', 'good'),
          linkRow('Confirm Org + SSO', 'Use Org + SSO to confirm login path and company sign-in posture.', '/app/org', 'SSO', packet.organization.sso_provider_status === 'configured' ? 'good' : 'warn'),
          linkRow('Review launch proof', 'Use Evidence for strict login QA, Cloud Armor, key rotation, rollback, and budget evidence summaries.', '/app/evidence', 'evidence', 'good'),
          linkRow('Walk evidence packet', 'Use Evidence to show customer-safe proof and explain secret exclusions.', '/app/evidence', 'packet', 'good'),
          linkRow('Run API self-test', 'Use Provider Slots for protected dry-run and blocked-recipient denial evidence.', '/app/keys', 'self-test', 'good'),
          linkRow('Review security packet', 'Use Security Review for procurement and technical reviewer questions.', '/app/security-review', 'review', 'good'),
          linkRow('Capture support handoff', 'Use Support to explain launch-week boundary and optional incident-response add-on.', '/app/support', 'support', 'good')
        ].join('');
        var packetBox = byId('testerEvidencePacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function releaseInput(record, field, label, placeholder) {
        return '<div class="release-field"><label>' + escapeHtml(label) + '</label><input data-release-record-id="' + escapeHtml(record.id) + '" data-release-field="' + escapeHtml(field) + '" value="' + escapeHtml(record[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function releaseSelect(record, field, label, options) {
        return '<div class="release-field"><label>' + escapeHtml(label) + '</label><select data-release-record-id="' + escapeHtml(record.id) + '" data-release-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + releaseSelected(record[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderReleaseRecord(record) {
        return '<div class="release-row" data-release-card="' + escapeHtml(record.id) + '">' +
          '<div class="release-head"><div><div class="row-title">' + escapeHtml(record.release_label || 'Release label not set') + '</div>' +
          '<div class="row-sub">' + escapeHtml((record.build_tag || 'build tag missing') + ' - ' + (record.rollout_status || 'planned') + ' - updated ' + rel(record.updated_at || record.created_at)) + '</div>' +
          '<div><span class="tag ' + releaseVerificationTone(record.verification_status) + '">' + escapeHtml(record.verification_status || 'pending') + '</span><span class="tag ' + releaseRolloutTone(record.rollout_status) + '">' + escapeHtml(record.rollout_status || 'planned') + '</span><span class="tag">' + escapeHtml(record.approver || 'approver missing') + '</span></div></div>' +
          '<div class="row-actions"><button type="button" data-action="remove-release-record" data-release-record-id="' + escapeHtml(record.id) + '">remove</button><a class="tag" href="/app/runbooks">runbooks</a><a class="tag" href="/app/rollout">rollout</a></div></div>' +
          '<div class="release-fields">' +
          releaseInput(record, 'release_label', 'release label', 'enterprise pilot release') +
          releaseInput(record, 'build_tag', 'build/image tag', 'git sha or image tag') +
          releaseInput(record, 'approver', 'approver', 'operator or customer owner') +
          releaseInput(record, 'verifier', 'verifier', 'person who ran QA/gates') +
          releaseSelect(record, 'verification_status', 'verification status', [
            { value: 'pending', label: 'pending' },
            { value: 'passed', label: 'passed' },
            { value: 'failed', label: 'failed' },
            { value: 'blocked', label: 'blocked' },
            { value: 'accepted_demo', label: 'accepted for pilot' }
          ]) +
          releaseSelect(record, 'rollout_status', 'rollout status', [
            { value: 'planned', label: 'planned' },
            { value: 'canary', label: 'canary' },
            { value: 'live', label: 'live' },
            { value: 'rolled_back', label: 'rolled back' },
            { value: 'paused', label: 'paused' }
          ]) +
          releaseInput(record, 'rollback_owner', 'rollback owner', 'operator or team') +
          releaseInput(record, 'rollback_path', 'rollback path', 'previous tag, reset plan, or runbook ref') +
          '<div class="release-field wide"><label>change summary</label><textarea data-release-record-id="' + escapeHtml(record.id) + '" data-release-field="change_summary" placeholder="Customer-visible change summary. Metadata only.">' + escapeHtml(record.change_summary || '') + '</textarea></div>' +
          '<div class="release-field wide"><label>verification evidence note</label><textarea data-release-record-id="' + escapeHtml(record.id) + '" data-release-field="evidence_note" placeholder="Smoke/gate results, build id, deploy ticket, or approval reference. Metadata only.">' + escapeHtml(record.evidence_note || '') + '</textarea></div>' +
          '</div></div>';
      }
      function saveReleaseRecordField(target) {
        var id = target.getAttribute('data-release-record-id');
        var field = target.getAttribute('data-release-field');
        if (!id || !field) return;
        var rows = readReleaseEvidenceRecords();
        var now = new Date().toISOString();
        rows = rows.map(function(row) {
          if (row.id !== id) return row;
          row[field] = field === 'verification_status' || field === 'rollout_status' ? target.value : redactReleaseText(target.value);
          row.updated_at = now;
          return row;
        });
        writeReleaseEvidenceRecords(rows);
        if (latestOrgPayload && latestReadiness) {
          renderReleasePanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function addReleaseRecordFromForm() {
        var now = new Date().toISOString();
        var record = {
          id: 'release-' + Date.now().toString(36),
          release_label: redactReleaseText(byId('releaseLabel') && byId('releaseLabel').value),
          build_tag: redactReleaseText(byId('releaseBuildTag') && byId('releaseBuildTag').value),
          change_summary: redactReleaseText(byId('releaseSummary') && byId('releaseSummary').value),
          approver: redactReleaseText(byId('releaseApprover') && byId('releaseApprover').value),
          verifier: redactReleaseText(byId('releaseVerifier') && byId('releaseVerifier').value),
          verification_status: byId('releaseVerificationStatus') && byId('releaseVerificationStatus').value || 'pending',
          rollout_status: byId('releaseRolloutStatus') && byId('releaseRolloutStatus').value || 'planned',
          rollback_owner: redactReleaseText(byId('releaseRollbackOwner') && byId('releaseRollbackOwner').value),
          rollback_path: redactReleaseText(byId('releaseRollbackPath') && byId('releaseRollbackPath').value),
          evidence_note: redactReleaseText(byId('releaseEvidenceNote') && byId('releaseEvidenceNote').value),
          created_at: now,
          updated_at: now
        };
        if (!record.release_label && !record.build_tag && !record.change_summary) {
          notice('Add a release label, build tag, or change summary before saving release evidence.');
          return;
        }
        var rows = readReleaseEvidenceRecords();
        rows.unshift(record);
        writeReleaseEvidenceRecords(rows);
        ['releaseLabel', 'releaseBuildTag', 'releaseSummary', 'releaseApprover', 'releaseVerifier', 'releaseRollbackOwner', 'releaseRollbackPath', 'releaseEvidenceNote'].forEach(function(id) {
          var el = byId(id);
          if (el) el.value = '';
        });
        notice('Release evidence saved as customer-safe metadata.');
        if (latestOrgPayload && latestReadiness) {
          renderReleasePanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function removeReleaseRecord(id) {
        writeReleaseEvidenceRecords(readReleaseEvidenceRecords().filter(function(row) { return row.id !== id; }));
        if (latestOrgPayload && latestReadiness) {
          renderReleasePanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function renderReleasePanel(org, sso, readiness, overview, bootstrap) {
        var packet = buildReleaseEvidencePacket(org, sso, readiness, overview, bootstrap);
        var summary = packet.summary || {};
        var latest = packet.latest_release || {};
        text('releaseMeta', packet.status);
        byId('releaseReadinessList').innerHTML = [
          row('Release evidence status', packet.status === 'ready_with_review' ? 'The latest release is approved, verified, canary/live, and has rollback owner/path recorded.' : 'Hold until release record, approval, verification, canary/live status, and rollback path are complete.', packet.status, packet.status === 'ready_with_review' ? 'good' : 'warn'),
          row('Runtime readiness', packet.runtime.production_ready ? 'Runtime reports production-ready for this release evidence state.' : 'Runtime readiness is not green; treat this release as a hold for customer traffic.', packet.runtime.production_ready ? 'ready' : 'blocked', packet.runtime.production_ready ? 'good' : 'bad'),
          row('Latest build/image tag', summary.latest_build_tag || 'Missing build/image tag.', summary.latest_build_tag ? 'recorded' : 'missing', summary.latest_build_tag ? 'good' : 'warn'),
          row('Latest verification', latest.verification_status ? 'Verifier: ' + (latest.verifier || 'not set') + '. Status: ' + latest.verification_status + '.' : 'No release verification record exists yet.', latest.verification_status || 'missing', releaseVerificationTone(latest.verification_status)),
          row('Rollback coverage', latest.rollback_owner && latest.rollback_path ? 'Owner: ' + latest.rollback_owner + '. Path: ' + latest.rollback_path + '.' : 'Rollback owner/path is required before treating a release as customer-ready.', latest.rollback_owner && latest.rollback_path ? 'ready' : 'missing', latest.rollback_owner && latest.rollback_path ? 'good' : 'warn')
        ].join('');
        byId('releaseRecordList').innerHTML = packet.records.length ? packet.records.map(renderReleaseRecord).join('') : '<div class="empty">No release evidence recorded yet. Add the latest build/image tag, approver, verifier, rollout state, rollback path, and customer-safe notes above.</div>';
        byId('releaseWorkflowList').innerHTML = [
          row('Build and tag evidence', 'Record the Git SHA or container tag after Cloud Build or the selected build system finishes. Do not paste environment variables or secrets.', 'metadata only', 'good'),
          row('Verify before customer traffic', packet.operator_commands[1] + ' and ' + packet.operator_commands[2] + ' should pass before marking verification passed.', 'gate', 'good'),
          linkRow('Runbooks', 'Use deploy, evidence, live QA, reset, rollback, and cleanup commands from the operator runbooks.', '/app/runbooks', 'runbooks', 'good'),
          linkRow('Rollout Manager', 'Tie the release to the workload canary, rollout state, blockers, and rollback owner/path.', '/app/rollout', 'rollout', 'good'),
          linkRow('Evidence packet', 'Export the release evidence with the rest of the customer-safe proof packet.', '/app/evidence', 'packet', 'good'),
          row('Secret boundary', 'Release evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ].join('');
        var packetBox = byId('releaseEvidencePacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function scannerInput(finding, field, label, placeholder) {
        return '<div class="scanner-field"><label>' + escapeHtml(label) + '</label><input data-scanner-finding-id="' + escapeHtml(finding.id) + '" data-scanner-field="' + escapeHtml(field) + '" value="' + escapeHtml(finding[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function scannerSelect(finding, field, label, options) {
        return '<div class="scanner-field"><label>' + escapeHtml(label) + '</label><select data-scanner-finding-id="' + escapeHtml(finding.id) + '" data-scanner-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + scannerSelected(finding[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderScannerFinding(finding) {
        return '<div class="scanner-row" data-scanner-card="' + escapeHtml(finding.id) + '">' +
          '<div class="scanner-head"><div><div class="row-title">' + escapeHtml(finding.repository || 'Repository not set') + '</div>' +
          '<div class="row-sub">' + escapeHtml((finding.secret_family || 'secret family unset') + ' - ' + (finding.branch || 'branch unset') + ' - updated ' + rel(finding.updated_at || finding.created_at)) + '</div>' +
          '<div><span class="tag ' + scannerSeverityTone(finding.severity) + '">' + escapeHtml(finding.severity) + '</span><span class="tag ' + scannerStatusTone(finding.status) + '">' + escapeHtml(finding.status) + '</span><span class="tag">' + escapeHtml(finding.finding_type || 'finding') + '</span></div></div>' +
          '<div class="row-actions"><button type="button" data-action="remove-scanner-finding" data-scanner-finding-id="' + escapeHtml(finding.id) + '">remove</button><a class="tag" href="/app/keys">provider slots</a><a class="tag" href="/app/policy">policy</a></div></div>' +
          '<div class="scanner-fields">' +
          scannerInput(finding, 'repository', 'repository', 'customer/app-service') +
          scannerInput(finding, 'branch', 'branch/ref', 'main or commit hash') +
          scannerSelect(finding, 'finding_type', 'finding type', [
            { value: 'hardcoded_secret', label: 'hardcoded secret' },
            { value: 'env_file', label: 'env/config file' },
            { value: 'oauth_secret', label: 'OAuth/client secret' },
            { value: 'webhook_secret', label: 'webhook signing secret' },
            { value: 'provider_key', label: 'provider API key' },
            { value: 'private_key', label: 'private key material' },
            { value: 'other', label: 'other' }
          ]) +
          scannerInput(finding, 'secret_family', 'secret family', 'provider or secret class') +
          scannerSelect(finding, 'severity', 'severity', [
            { value: 'critical', label: 'critical' },
            { value: 'high', label: 'high' },
            { value: 'medium', label: 'medium' },
            { value: 'low', label: 'low' }
          ]) +
          scannerSelect(finding, 'status', 'status', [
            { value: 'new', label: 'new' },
            { value: 'confirmed', label: 'confirmed' },
            { value: 'rotating', label: 'rotating' },
            { value: 'rotated', label: 'rotated' },
            { value: 'accepted_demo', label: 'accepted for pilot' },
            { value: 'false_positive', label: 'false positive' },
            { value: 'blocked', label: 'blocked' }
          ]) +
          scannerInput(finding, 'owner', 'owner', 'security or app owner') +
          scannerInput(finding, 'provider_slot', 'provider slot', 'provider slug or slot name') +
          '<div class="scanner-field wide"><label>redacted scanner evidence</label><textarea data-scanner-finding-id="' + escapeHtml(finding.id) + '" data-scanner-field="evidence_ref" placeholder="Sanitized path, scanner id, PR/ticket, or hash only. Do not paste secrets.">' + escapeHtml(finding.evidence_ref || '') + '</textarea></div>' +
          '<div class="scanner-field wide"><label>remediation note</label><textarea data-scanner-finding-id="' + escapeHtml(finding.id) + '" data-scanner-field="note" placeholder="Metadata-only rotation/remediation note.">' + escapeHtml(finding.note || '') + '</textarea></div>' +
          '</div></div>';
      }
      function saveScannerFindingField(target) {
        var id = target.getAttribute('data-scanner-finding-id');
        var field = target.getAttribute('data-scanner-field');
        if (!id || !field) return;
        var rows = readScannerFindings();
        var now = new Date().toISOString();
        rows = rows.map(function(row) {
          if (row.id !== id) return row;
          row[field] = redactScannerText(target.value);
          row.updated_at = now;
          return row;
        });
        writeScannerFindings(rows);
        if (latestOrgPayload && latestReadiness) {
          renderScannerPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function addScannerFindingFromForm() {
        var now = new Date().toISOString();
        var finding = {
          id: 'scanner-' + Date.now().toString(36),
          repository: redactScannerText(byId('scannerRepository') && byId('scannerRepository').value),
          branch: redactScannerText(byId('scannerBranch') && byId('scannerBranch').value),
          finding_type: redactScannerText(byId('scannerFindingType') && byId('scannerFindingType').value) || 'hardcoded_secret',
          secret_family: redactScannerText(byId('scannerSecretFamily') && byId('scannerSecretFamily').value),
          severity: byId('scannerSeverity') && byId('scannerSeverity').value || 'high',
          status: byId('scannerStatus') && byId('scannerStatus').value || 'new',
          owner: redactScannerText(byId('scannerOwner') && byId('scannerOwner').value),
          provider_slot: redactScannerText(byId('scannerProviderSlot') && byId('scannerProviderSlot').value),
          evidence_ref: redactScannerText(byId('scannerEvidenceRef') && byId('scannerEvidenceRef').value),
          note: redactScannerText(byId('scannerNote') && byId('scannerNote').value),
          created_at: now,
          updated_at: now
        };
        if (!finding.repository && !finding.secret_family && !finding.evidence_ref) {
          notice('Add repository, secret family, or redacted evidence reference before saving scanner evidence.');
          return;
        }
        var rows = readScannerFindings();
        rows.unshift(finding);
        writeScannerFindings(rows);
        ['scannerRepository', 'scannerBranch', 'scannerSecretFamily', 'scannerOwner', 'scannerProviderSlot', 'scannerEvidenceRef', 'scannerNote'].forEach(function(id) {
          var el = byId(id);
          if (el) el.value = '';
        });
        notice('Scanner finding saved as redacted metadata. No raw secret values are required.');
        if (latestOrgPayload && latestReadiness) {
          renderScannerPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function removeScannerFinding(id) {
        writeScannerFindings(readScannerFindings().filter(function(row) { return row.id !== id; }));
        if (latestOrgPayload && latestReadiness) {
          renderScannerPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
        }
      }
      function renderScannerPanel(org, sso, readiness, overview, bootstrap) {
        var packet = buildScannerExposurePacket(overview, bootstrap);
        var summary = packet.summary || {};
        text('scannerMeta', packet.status);
        byId('scannerList').innerHTML = [
          row('Enterprise scanner isolation', 'This page does not call legacy scanner endpoints, upload repositories, or store raw secret values. It records browser-local, redacted finding metadata for customer review.', 'isolated', 'good'),
          row('Scanner evidence source', 'Use customer-approved local or CI scanning with redaction enabled, then record only sanitized repository, branch, finding class, owner, ticket, PR, or hash references.', 'manual', 'good'),
          row('Open exposure posture', number(summary.open_critical_or_high) + ' open critical/high findings and ' + number(summary.blocked) + ' blocked findings are visible in this browser evidence state.', packet.status, packet.status === 'hold' ? 'bad' : 'warn'),
          row('Provider/API coverage', number(summary.coverage_candidates) + ' API or provider surfaces should have scanner coverage attached before paid rollout.', 'coverage', summary.coverage_candidates ? 'warn' : 'good')
        ].join('');
        byId('scannerFindingList').innerHTML = packet.findings.length ? packet.findings.map(renderScannerFinding).join('') : '<div class="empty">No scanner findings recorded yet. Add a redacted local or CI scan summary above before customer security review.</div>';
        byId('scannerChecklist').innerHTML = [
          row('Run a redacted scan', 'Run the customer-approved repository scanner locally or in CI with redaction/masking enabled before copying metadata here.', 'required', 'warn'),
          row('Do not paste secrets', 'Record finding id, sanitized path, repository, branch, owner, ticket, PR, or hash only. Secret-like input is redacted before browser storage and JSON export.', 'redacted', 'good'),
          linkRow('Rotate provider slot', 'Use Provider Slots to rotate, revoke, or replace exposed provider material before paid customer data.', '/app/keys', 'slots', 'good'),
          linkRow('Track policy exception', 'Use Policy Drift only for explicit pilot-limited acceptance with owner, reason, compensating control, and expiration date.', '/app/policy', 'policy', 'good'),
          linkRow('Review rollout hold', 'Use Rollout Manager and Launch to keep open critical/high findings from becoming hidden launch risk.', '/app/rollout', 'rollout', packet.status === 'hold' ? 'warn' : 'good')
        ].join('');
        var packetBox = byId('scannerEvidencePacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderPanels(orgPayload, readiness, overview, bootstrap) {
        var org = orgPayload.organization || {};
        var sso = orgPayload.sso_status || {};
        var productionReady = readiness.production_ready === true;
        text('kpiProduction', productionReady ? 'yes' : 'no');
        text('kpiProjects', number(org.project_count || overview.totalProjects));
        text('kpiMembers', number(org.member_count));
        text('kpiOrgRole', org.role || 'member');
        text('kpiCalls', number(overview.totalCalls));
        byId('supportKpis').style.display = PAGE_MODE === 'docs' || PAGE_MODE === 'setup' || PAGE_MODE === 'technical-guide' ? 'none' : 'grid';
        byId('launchPanel').style.display = PAGE_MODE === 'launch' ? 'grid' : 'none';
        byId('evidencePanel').style.display = PAGE_MODE === 'evidence' ? 'grid' : 'none';
        byId('demoPanel').style.display = PAGE_MODE === 'demo' ? 'grid' : 'none';
        byId('enterpriseDocsPanel').style.display = PAGE_MODE === 'docs' ? 'block' : 'none';
        byId('setupPanel').style.display = PAGE_MODE === 'setup' ? 'block' : 'none';
        byId('technicalGuidePanel').style.display = PAGE_MODE === 'technical-guide' ? 'block' : 'none';
        byId('settingsPanel').style.display = PAGE_MODE === 'settings' ? 'grid' : 'none';
        byId('entitlementsPanel').style.display = PAGE_MODE === 'entitlements' ? 'grid' : 'none';
        byId('onboardingPanel').style.display = PAGE_MODE === 'onboarding' ? 'grid' : 'none';
        byId('plansPanel').style.display = PAGE_MODE === 'plans' ? 'grid' : 'none';
        byId('pilotPanel').style.display = PAGE_MODE === 'pilot' ? 'grid' : 'none';
        byId('pilotSuccessPanel').style.display = PAGE_MODE === 'pilot-success' ? 'grid' : 'none';
        byId('testersPanel').style.display = PAGE_MODE === 'testers' ? 'grid' : 'none';
        byId('releasePanel').style.display = PAGE_MODE === 'release' ? 'grid' : 'none';
        byId('scannerPanel').style.display = PAGE_MODE === 'scanner' ? 'grid' : 'none';
        byId('supportPanel').style.display = PAGE_MODE === 'support' ? 'grid' : 'none';
        byId('securityReviewPanel').style.display = PAGE_MODE === 'security-review' ? 'grid' : 'none';
        byId('verifierPanel').style.display = PAGE_MODE === 'verifier' ? 'grid' : 'none';
        byId('runbooksPanel').style.display = PAGE_MODE === 'runbooks' ? 'grid' : 'none';
        if (PAGE_MODE === 'setup') {
          byId('setupStatusList').innerHTML = [
            row('Organization selected', currentOrgId ? 'The page is scoped to the selected organization.' : 'Select an organization before configuring projects, members, or audit exports.', currentOrgId ? 'selected' : 'select org', currentOrgId ? 'good' : 'warn'),
            row('Production readiness', productionReady ? 'The confidential runtime reports production-ready.' : 'Open readiness and clear blockers before sending real traffic.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('SSO status', sso.provider_status === 'configured' ? 'Company sign-in is configured for this organization.' : 'Company sign-in still needs setup or confirmation.', sso.provider_status || 'todo', sso.provider_status === 'configured' ? 'good' : 'warn'),
            row('Projects', number(org.project_count || overview.totalProjects) + ' project scopes are visible for this organization.', number(org.project_count || overview.totalProjects), (org.project_count || overview.totalProjects) ? 'good' : 'warn'),
            row('Members', number(org.member_count) + ' members are visible for this organization.', number(org.member_count), org.member_count ? 'good' : 'warn'),
            row('Recent traffic', number(overview.totalCalls) + ' proxy calls are visible in the current overview window.', 'activity', overview.totalCalls ? 'good' : 'warn')
          ].join('');
          byId('setupReferenceList').innerHTML = [
            linkRow('Dashboard overview', 'Check runtime readiness, organization health, projects, members, calls, and shortcuts.', '/app/dashboard', 'dashboard', 'good'),
            linkRow('Org + SSO', 'Confirm your organization details and company sign-in status.', '/app/org', 'open', 'good'),
            linkRow('Members', 'Invite teammates, assign roles, manage project access, and export access reviews.', '/app/members', 'open', 'good'),
            linkRow('Projects', 'Review project inventory, provider slots, policy status, and health.', '/app/projects', 'open', 'good'),
            linkRow('Control', 'Set caller lock, provider allowlists, upstream restrictions, rate limits, and secure execution policy.', '/app/control', 'open', 'good'),
            linkRow('Provider slots', 'Review active providers, rotation state, Cloud KMS notes, and emergency revoke.', '/app/keys', 'open', 'good'),
            linkRow('Audit', 'Search governance/runtime events and export CSV evidence.', '/app/audit', 'open', 'good'),
            linkRow('Alerts', 'Set destinations, review delivery logs, and send test alerts.', '/app/alerts', 'open', 'good'),
            linkRow('Technical guide', 'Deep implementation details for identity, gateways, key custody, caller lock, evidence, rollout, and troubleshooting.', '/app/technical-guide', 'open', 'good'),
            linkRow('Runbooks', 'Use operator commands for verification, evidence, deployment, secrets, DNS, edge, SSH, and cleanup.', '/app/runbooks', 'open', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'launch') {
          renderLaunchPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'evidence') {
          renderEvidencePanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'demo') {
          renderDemoPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'support') {
          renderSupportPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'security-review') {
          renderSecurityReviewPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'pilot') {
          renderPilotProposalPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'pilot-success') {
          renderPilotSuccessPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'testers') {
          renderPilotTestersPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'release') {
          renderReleasePanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'scanner') {
          renderScannerPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'settings') {
          text('settingsMeta', org.kind || 'organization');
          byId('settingsList').innerHTML = [
            row('Organization name', org.name || 'Organization', org.role || 'member', 'good'),
            row('Organization slug', org.slug || 'not set', org.can_archive ? 'owner controls' : 'standard', org.can_archive ? 'good' : 'warn'),
            row('SSO rollout', sso.provider_status || 'not_started', sso.login_mode || 'assisted', sso.provider_status === 'configured' ? 'good' : 'warn'),
            row('Last SSO membership resolution', sso.last_membership_resolution_email || 'none recorded', sso.last_membership_resolution || 'pending', sso.last_membership_resolution ? 'good' : 'warn')
          ].join('');
          byId('securityList').innerHTML = [
            row('Production readiness', productionReady ? 'Control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; '), productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('Origin lock', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'GCP edge/custom origin lock configured.' : 'Origin lock is not configured.', readiness.control_plane && readiness.control_plane.origin_lock_required ? 'required' : 'optional', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'good' : 'warn'),
            row('Dashboard session storage', 'Enterprise pages read the Supabase session from local storage and call only enterprise control-plane APIs.', 'enterprise only', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'entitlements') {
          renderEntitlementsPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'onboarding') {
          renderPaidOnboardingPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'plans') {
          text('planMeta', productionReady ? 'production package' : 'pre-production');
          byId('planList').innerHTML = [
            row('GCP confidential runtime', productionReady ? 'Secure executor is production-ready.' : 'Runtime needs blocker review.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('GCP edge package', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'Origin protection is configured for enterprise edge routing.' : 'Edge/origin lock still needs final packaging.', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'ready' : 'todo', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'good' : 'warn'),
            row('Usage posture', number(overview.totalCalls) + ' calls, ' + number(overview.errorCalls) + ' errors, ' + number(overview.deniedCalls) + ' denied.', (overview.errorRate || 0).toFixed ? (overview.errorRate || 0).toFixed(1) + '% error' : 'usage', (overview.errorCalls || overview.deniedCalls) ? 'warn' : 'good')
          ].join('');
          byId('commercialList').innerHTML = [
            row('Starting package', 'Enterprise paid pilot starts at $5,000/month for one guided customer rollout, one first workload, customer proof reviews, and production-readiness support.', '$5k+/mo', 'good'),
            row('Included controls', 'Company login path, organization/project roles, caller-lock policy, provider/email key slot controls, audit CSV, access-review CSV, alerts, readiness, and evidence packet.', 'included', 'good'),
            row('Capacity envelope', 'Traffic, retention, key slots, SSO depth, support cadence, and dedicated-runtime needs are set in the customer contract until billing APIs enforce them.', 'contract', 'warn'),
            row('Entitlements record', 'Use /app/entitlements to record paid-user package, contract status, capacity allowance, owners, support tier, renewal date, and incident-response boundary.', 'paid-user', 'good'),
            row('Paid onboarding record', 'Use /app/onboarding to turn entitlements into customer activation owners, login handoff, first workload scope, support handoff, key posture, and testing-window proof.', 'activation', 'good'),
            row('Expansion path', 'After the first workload is stable, expand project by project with a new policy/evidence review instead of a broad all-at-once cutover.', 'phased', 'good')
          ].join('');
          byId('guardrailList').innerHTML = [
            row('SOC 2 access evidence', 'Members page exports access review evidence and audit page exports governance/runtime CSV.', 'available', 'good'),
            row('Plan limits', 'Enterprise commercial limits are not enforced by this control plane yet; keep capacity and support terms in the customer contract until billing APIs exist.', 'manual', 'warn'),
            row('Security boundaries', 'Provider keys, encrypted shares, service-role keys, origin-lock values, and signing secrets stay out of customer packets and browser responses.', 'secret safe', 'good'),
            row('Customer rollout notes', 'Use /app/readiness, /app/evidence, /app/audit, /app/members, and /app/keys as the contract-facing evidence bundle.', 'ready', 'good')
          ].join('');
          byId('buyerReviewList').innerHTML = [
            linkRow('Evidence packet', 'Copy or download the customer proof packet before security review.', '/app/evidence', 'packet', 'good'),
            linkRow('Security review packet', 'Share architecture, controls, evidence links, open items, and common answers with customer reviewers.', '/app/security-review', 'review', 'good'),
            linkRow('Entitlements', 'Confirm contract status, capacity, owners, support tier, renewal date, and paid-user guardrails before onboarding.', '/app/entitlements', 'entitlements', 'good'),
            linkRow('Paid onboarding', 'Confirm activation owners, login handoff, first workload scope, support handoff, key posture, and customer testing window.', '/app/onboarding', 'onboarding', 'good'),
            linkRow('Tester readiness', 'Prepare tester roster, login status, scenario assignment, feedback, and blockers before the guided session.', '/app/testers', 'testers', 'good'),
            linkRow('Launch support', 'Review support model, internal admin boundary, approval gates, and customer handoff package.', '/app/support', 'support', 'good'),
            linkRow('Technical guide', 'Answer architecture, key custody, caller-lock, GCP runtime, and troubleshooting questions.', '/app/technical-guide', 'guide', 'good'),
            linkRow('Runbooks', 'Keep verification, evidence, deploy, DNS, edge, SSH, and cleanup commands visible to operators.', '/app/runbooks', 'runbooks', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'verifier') {
          loadVerifier();
        }
        if (PAGE_MODE === 'runbooks') {
          var scannerExposureForRunbook = buildScannerExposurePacket(overview, bootstrap);
          var exposureResponseForRunbook = buildKeyExposureResponsePacket(overview, bootstrap, scannerExposureForRunbook);
          var exposureSummaryForRunbook = exposureResponseForRunbook.summary || {};
          text('runbooksExposureMeta', exposureResponseForRunbook.status);
          byId('runbooksSafeList').innerHTML = [
            row('Hardening status', 'npm run status:enterprise-hardening runs the safe verifier, TLS preflight, gateway plan, alternate-access prep/check, SSH plan, and old prototype inventory in one read-only pass.', 'read-only', 'good'),
            row('Production verifier', 'npm run verify:gcp-enterprise-edge checks the GCP edge, backend health, managed TLS, and live readiness.', 'read-only', 'good'),
            row('Evidence bundle', 'npm run evidence:enterprise-production captures timestamped infrastructure, app, readiness, and monitoring evidence for review.', 'read-only', 'good'),
            row('Evidence validator', 'npm run validate:enterprise-evidence validates the latest evidence bundle before customer or compliance handoff.', 'read-only', 'good'),
            row('Security review packet', 'Open /app/security-review to copy customer-safe architecture, controls, evidence links, open items, common answers, and secret exclusions before procurement review.', 'read-only', 'good'),
            row('Entitlements review', 'Open /app/entitlements to confirm contract status, capacity allowances, billing owner, success owner, support tier, renewal/review date, and incident-response boundary before paid onboarding.', 'read-only', 'good'),
            row('Paid onboarding review', 'Open /app/onboarding to confirm activation owners, enterprise login handoff, first workload owner, support handoff, capacity/renewal review, key posture, and testing window before customer testing.', 'read-only', 'good'),
            row('Tester readiness review', 'Open /app/testers to confirm the tester roster, login pass, scenario assignment, customer-safe feedback notes, and blocker state before a guided enterprise session.', 'read-only', 'good'),
            row('Monitoring evidence review', 'Review /app/evidence monitoring_evidence plus /app/alerts destinations, delivery logs, dispatch runs, and test-send workflow before launch-week traffic.', 'read-only', 'good'),
            row('Customer launch gate', 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch runs live edge, app QA, Cloud Armor, and customer-launch evidence checks before customer traffic.', 'read-only', 'good'),
            row('Handoff package', 'npm run package:enterprise-handoff assembles customer/compliance docs, gateway templates, latest local evidence, and a manifest without changing live infrastructure.', 'read-only', 'good'),
            row('Handoff gate', 'npm run gate:enterprise-handoff validates gateway templates, builds the package, verifies the manifest, and can optionally require live QA/evidence strictness.', 'read-only', 'good'),
            row('Finish gate', 'npm run gate:enterprise-finish runs local smoke, gateway policy smoke, handoff gate, live app QA, and hardening status into one ok/attention/blocked release view with structured blocker/warning details.', 'read-only', 'good'),
            row('Live app QA', 'npm run qa:enterprise-live-app checks enterprise app pages, internal links, auth-safe rendering, and production readiness.', 'read-only', 'good'),
            row('Strict login QA', 'LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login validates live login redirects, generates a temporary Supabase session, and checks authenticated enterprise APIs when service-role env is loaded.', 'identity', 'good'),
            row('OAuth redirect QA', 'LOGIN_QA_OAUTH_PROVIDER=google npm run qa:enterprise-login checks the public Supabase OAuth authorize redirect after the external provider app is configured.', 'identity', 'good'),
            row('Sealed provider ingest', 'npm run seal:enterprise-provider-slot is the local operator path for live provider material. Keep raw keys out of browser forms and customer packets.', 'rotation', 'good'),
            row('Strict live material gate', 'Run the first-goal gate in strict live-material mode so live encrypted provider material is required instead of placeholders before paid customer data.', 'rotation', 'good'),
            row('Secret rotation preparation', 'npm run prepare:enterprise-secret-rotation plans the install order and can generate fresh executor signing material without printing secrets.', 'read-only', 'good'),
            row('Private origin preparation', 'npm run prepare:enterprise-private-origin inventories edge, gateway, VM network posture, and private-origin migration choices without changing live infrastructure.', 'read-only', 'good'),
            row('Gateway JWT validation preparation', 'npm run prepare:enterprise-apim-jwt plans Supabase or Entra JWT validation settings before enabling gateway JWT validation and can discover the Supabase issuer from the live enterprise login script.', 'read-only', 'good'),
            row('Staff/admin boundary', 'Keep VaultProof staff/admin pages in the separate root/B2C admin system and keep them off enterprise.vaultproof.dev customer routes.', 'read-only', 'good'),
            row('mTLS caller-lock preparation', 'npm run prepare:enterprise-mtls computes a client certificate thumbprint, subject fragment, gateway header contract, and caller-lock policy snippet without changing live infrastructure.', 'read-only', 'good'),
            row('gateway policy template smoke', 'npm run test:enterprise-apim-policies validates provider-secret stripping plus caller-lock header delete/override behavior across VaultProof-managed, customer-managed, device, and mTLS gateway templates before customer handoff.', 'read-only', 'good'),
            row('Origin TLS certificate plan', 'npm run prepare:enterprise-origin-cert plans VM CSR generation, signed certificate install, self-signed marker removal, and local TLS checks.', 'read-only', 'good'),
            row('Origin TLS preparation plan', 'npm run prepare:enterprise-origin-tls previews DNS, firewall, and backend steps before any HTTPS origin cutover.', 'read-only', 'good'),
            row('Origin DNS guardrail', 'Origin DNS changes must happen only through the selected DNS provider and with an explicit operator confirmation phrase.', 'read-only', 'good'),
            row('Origin TLS preflight', 'npm run verify:enterprise-origin-tls checks DNS, NSG 443, nginx, certificate SAN/trust, and local origin health before HttpsOnly cutover.', 'read-only', 'good'),
            row('Alternate access preparation', 'npm run prepare:enterprise-alternate-access plans boot diagnostics and Bastion setup with confirmation-gated live actions.', 'read-only', 'good'),
            row('Alternate access readiness', 'npm run verify:enterprise-alternate-access checks Bastion, boot diagnostics/serial-console prerequisites, Defender JIT visibility, and SSH NSG posture before public SSH closure.', 'read-only', 'good'),
            row('Execution dry run', 'npm run qa:enterprise-live-execute validates auth, policy, signing, and executor reachability without dispatching real provider work.', 'safe default', 'good')
          ].join('');
          byId('runbooksGatedList').innerHTML = [
            row('Deploy to Confidential VM', 'npm run deploy:enterprise-vm copies code, rebuilds, and restarts selected systemd services on the GCP VM.', 'operator', 'warn'),
            row('Secret verification and rotation', 'npm run verify:enterprise-secrets checks installed env posture after the prepared rotation bundle is installed; Supabase key rotation and live env installs remain operator actions.', 'operator', 'warn'),
            row('Origin DNS record', 'DNS record updates require the selected DNS provider and the required operator confirmation phrase.', 'approval', 'warn'),
            row('TLS origin cutover', 'npm run cutover:enterprise-origin-tls plans the GCP edge HTTPS origin cutover and requires strict preflight plus confirmation-gated enable/rollback.', 'blocked', 'warn'),
            row('gateway cutover', 'npm run cutover:enterprise-apim previews gateway route cutover and requires confirmation-gated enable/rollback before GCP edge changes.', 'blocked', 'warn'),
            row('SSH hardening', 'npm run harden:enterprise-ssh can plan, close, or reopen bootstrap SSH with readiness, alternate-access, and confirmation gates.', 'approval', 'warn'),
            row('GCP runtime reset rollback', 'gcloud compute instances reset vaultproof-enterprise-runtime-1 --zone=us-central1-a --project=vaultproof-prod resets the current enterprise runtime VM when the named rollback owner approves.', 'operator', 'warn'),
            row('old prototype cleanup', 'npm run cleanup:enterprise-container-apps inventories the old prototype resources and requires action-specific confirmation before ingress disable/restore/delete.', 'approval', 'warn')
          ].join('');
          byId('runbooksExposureList').innerHTML = [
            row('Current exposure response status', exposureResponseForRunbook.decision, exposureResponseForRunbook.status, exposureResponseForRunbook.status === 'hold' ? 'bad' : exposureResponseForRunbook.status === 'ready_to_contain' ? 'good' : 'warn'),
            row('Triage linked scanner findings', number(exposureSummaryForRunbook.linked_scanner_findings) + ' scanner findings are linked to provider slots; ' + number(exposureSummaryForRunbook.open_critical_or_high_linked_findings) + ' linked critical/high findings remain open.', exposureSummaryForRunbook.open_critical_or_high_linked_findings ? 'hold' : 'review', exposureSummaryForRunbook.open_critical_or_high_linked_findings ? 'bad' : 'good'),
            linkRow('Open Provider Slots incident mode', 'Copy the customer-safe incident JSON, review material mode, and emergency revoke affected provider slots without exposing raw upstream keys.', '/app/keys', 'incident JSON', 'good'),
            linkRow('Open Scanner findings', 'Update linked exposure findings only after rotation, revoke, false-positive review, or explicit pilot-limited acceptance.', '/app/scanner', 'scanner', exposureSummaryForRunbook.open_critical_or_high_linked_findings ? 'warn' : 'good'),
            linkRow('Export activity evidence', 'Review routed traffic, denials, latency, provider request IDs, and attestation hints for what VaultProof actually saw.', '/app/activity', 'activity', 'good'),
            linkRow('Export audit CSV', 'Attach governance and runtime audit evidence to the security-review packet for the response window.', evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'), 'audit CSV', 'good'),
            linkRow('Share Evidence packet', 'Use Evidence after Provider Slots and Scanner are updated so customers see exposure response, scanner, rotation, and proof-boundary status together.', '/app/evidence', 'evidence', 'good'),
            row('Proof boundary', exposureResponseForRunbook.proof_boundary.vaultproof_controls + ' ' + exposureResponseForRunbook.proof_boundary.outside_boundary, 'boundary', 'good'),
            row('Operator order', exposureResponseForRunbook.operator_actions.join(' '), 'sequence', 'good'),
            row('Secret boundary', 'Never paste provider API keys, OAuth secrets, webhook secrets, private keys, bearer tokens, request bodies, response bodies, or customer payloads into incident notes or packets.', 'redacted', 'good')
          ].join('');
        }
      }
      function populateVerifierSelect(selectId, rows, current) {
        var select = byId(selectId);
        if (!select) return;
        select.innerHTML = rows.length ? rows.map(function(row) {
          return '<option value="' + escapeHtml(row.value) + '"' + (current === row.value ? ' selected' : '') + '>' + escapeHtml(row.label) + '</option>';
        }).join('') : '<option value="">No options</option>';
      }
      function renderVerifier(payload) {
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        var models = Array.isArray(payload.models) ? payload.models : [];
        var verifications = Array.isArray(payload.verifications) ? payload.verifications : [];
        var sharedAttestation = payload.shared_attestation || {};
        var projectOptions = projects.map(function(project) {
          return { value: project.id, label: (project.name || project.vp_proj_id || project.id) + ' - ' + (project.project_role || 'project') };
        });
        byId('verifierAttestationList').innerHTML = row(
          sharedAttestation.label || 'Shared enterprise runtime attestation',
          'Mode: ' + (sharedAttestation.mode || 'shared-enterprise-runtime-attestation') + '. Tier: ' + displayRuntimeTier(sharedAttestation.runtime_tier) + '. Source: ' + (sharedAttestation.source || '/readiness') + '. Dynamic guest attestation is required; static attestation tokens stay disabled.',
          sharedAttestation.customer_dedicated_runtime ? 'dedicated' : 'shared',
          'good'
        );
        populateVerifierSelect('verifierModelProjectSelect', projectOptions, projectOptions[0] && projectOptions[0].value);
        populateVerifierSelect('verifierProofProjectSelect', projectOptions, projectOptions[0] && projectOptions[0].value);
        populateVerifierSelect('verifierProofModelSelect', models.map(function(model) {
          return { value: model.model_ref, label: (model.display_name || model.model_ref) + ' - ' + model.model_ref };
        }), models[0] && models[0].model_ref);
        if (!payload.schema_ready) {
          byId('verifierModelList').innerHTML = '<div class="empty">AI Proof Verifier tables are not deployed yet. Apply the verifier Supabase migration before customer use.</div>';
          byId('verifierEvidenceList').innerHTML = '<div class="empty">Proof evidence will appear after the migration is deployed and proof bundles are submitted.</div>';
          return;
        }
        byId('verifierModelList').innerHTML = models.length ? models.map(function(model) {
          var systems = Array.isArray(model.allowed_proof_systems) ? model.allowed_proof_systems.join(', ') : 'vaultproof-manifest-v1';
          return row(model.display_name || model.model_ref, 'External model only. Family: ' + (model.model_family || 'custom') + '. Proof systems: ' + systems, model.status || 'enabled', model.status === 'enabled' ? 'good' : 'warn');
        }).join('') : '<div class="empty">No models registered yet. Add the external model ID first, then submit proof bundles from jobs that ran outside VaultProof.</div>';
        byId('verifierEvidenceList').innerHTML = verifications.length ? verifications.map(function(item) {
          var tone = item.status === 'verified' ? 'good' : item.status === 'failed' ? 'bad' : 'warn';
          var detail = 'Proof system: ' + (item.proof_system || 'unknown') + '. Hash: ' + (item.proof_hash || '').slice(0, 38) + (item.failure_reason ? '. ' + item.failure_reason : '');
          return row((item.model_ref || 'model') + ' - ' + (item.status || 'recorded'), detail, item.status || 'recorded', tone);
        }).join('') : '<div class="empty">No proof bundles submitted yet. VaultProof verifies/stores evidence; it does not run the model.</div>';
      }
      async function loadVerifier() {
        try {
          renderVerifier(await fetchJson('/api/v1/enterprise/verifier'));
        } catch (error) {
          byId('verifierModelList').innerHTML = '<div class="empty">' + escapeHtml(error && error.message ? error.message : 'Verifier failed to load.') + '</div>';
          byId('verifierEvidenceList').innerHTML = '<div class="empty">Proof evidence unavailable.</div>';
        }
      }
      async function submitVerifierModel(event) {
        event.preventDefault();
        try {
          await fetchJson('/api/v1/enterprise/verifier/models', {
            method: 'POST',
            body: JSON.stringify({
              project_id: byId('verifierModelProjectSelect').value,
              model_ref: byId('verifierModelRef').value,
              display_name: byId('verifierModelName').value,
              model_family: byId('verifierModelFamily').value,
              allowed_proof_systems: byId('verifierProofSystems').value.split(',').map(function(value) { return value.trim(); }).filter(Boolean),
            })
          });
          byId('verifierModelRef').value = '';
          byId('verifierModelName').value = '';
          await loadVerifier();
        } catch (error) {
          notice(error && error.message ? error.message : 'Failed to save verifier model.');
        }
      }
      async function submitVerifierProof(event) {
        event.preventDefault();
        try {
          var bundleRaw = byId('verifierProofBundle').value.trim();
          var proofBundle = bundleRaw ? JSON.parse(bundleRaw) : undefined;
          await fetchJson('/api/v1/enterprise/verifier/proofs', {
            method: 'POST',
            body: JSON.stringify({
              project_id: byId('verifierProofProjectSelect').value,
              model_ref: byId('verifierProofModelSelect').value,
              proof_system: byId('verifierProofSystem').value,
              claimed_output_hash: byId('verifierOutputHash').value,
              proof_bundle: proofBundle,
            })
          });
          byId('verifierProofBundle').value = '';
          await loadVerifier();
        } catch (error) {
          notice(error && error.message ? error.message : 'Failed to verify proof bundle. Use valid JSON for the proof bundle.');
        }
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          var bootstrap = await fetchJson('/api/v1/enterprise/projects/bootstrap');
          renderOrgSelector(bootstrap);
          var results = await Promise.all([
            fetchJson('/api/v1/enterprise/orgs/current'),
            fetchJson('/readiness')
          ]);
          latestOrgPayload = results[0];
          latestReadiness = results[1];
          latestOverview = (bootstrap && bootstrap.overview) || {};
          latestBootstrap = bootstrap || {};
          renderPanels(latestOrgPayload, latestReadiness, latestOverview, latestBootstrap);
        } catch (error) {
          notice(error && error.message ? error.message : 'Enterprise admin page failed to load.');
        }
      }
      byId('refreshBtn').addEventListener('click', reload);
      var verifierModelForm = byId('verifierModelForm');
      if (verifierModelForm) verifierModelForm.addEventListener('submit', submitVerifierModel);
      var verifierProofForm = byId('verifierProofForm');
      if (verifierProofForm) verifierProofForm.addEventListener('submit', submitVerifierProof);
      var pilotProposalForm = byId('pilotProposalForm');
      if (pilotProposalForm) pilotProposalForm.addEventListener('submit', function(event) {
        event.preventDefault();
      });
      var pilotSuccessDecisionForm = byId('pilotSuccessDecisionForm');
      if (pilotSuccessDecisionForm) pilotSuccessDecisionForm.addEventListener('submit', function(event) {
        event.preventDefault();
      });
      var entitlementsForm = byId('entitlementsForm');
      if (entitlementsForm) entitlementsForm.addEventListener('submit', function(event) {
        event.preventDefault();
      });
      var entitlementsBillingForm = byId('entitlementsBillingForm');
      if (entitlementsBillingForm) entitlementsBillingForm.addEventListener('submit', function(event) {
        event.preventDefault();
      });
      var entitlementAmendmentForm = byId('entitlementAmendmentForm');
      if (entitlementAmendmentForm) entitlementAmendmentForm.addEventListener('submit', function(event) {
        event.preventDefault();
        addEntitlementAmendmentFromForm();
      });
      var scannerFindingForm = byId('scannerFindingForm');
      if (scannerFindingForm) scannerFindingForm.addEventListener('submit', function(event) {
        event.preventDefault();
        addScannerFindingFromForm();
      });
      var releaseEvidenceForm = byId('releaseEvidenceForm');
      if (releaseEvidenceForm) releaseEvidenceForm.addEventListener('submit', function(event) {
        event.preventDefault();
        addReleaseRecordFromForm();
      });
      var securityReviewOpenFilterForm = byId('securityReviewOpenFilterForm');
      if (securityReviewOpenFilterForm) securityReviewOpenFilterForm.addEventListener('submit', function(event) {
        event.preventDefault();
        if (latestSecurityReviewPacket) renderSecurityReviewOpenItems(latestSecurityReviewPacket);
      });
      var securityReviewOpenSearch = byId('securityReviewOpenSearch');
      if (securityReviewOpenSearch) securityReviewOpenSearch.addEventListener('input', function() {
        if (latestSecurityReviewPacket) renderSecurityReviewOpenItems(latestSecurityReviewPacket);
      });
      var securityReviewOpenType = byId('securityReviewOpenType');
      if (securityReviewOpenType) securityReviewOpenType.addEventListener('change', function() {
        if (latestSecurityReviewPacket) renderSecurityReviewOpenItems(latestSecurityReviewPacket);
      });
      var clearSecurityReviewFilters = byId('clearSecurityReviewFilters');
      if (clearSecurityReviewFilters) clearSecurityReviewFilters.addEventListener('click', function() {
        if (byId('securityReviewOpenSearch')) byId('securityReviewOpenSearch').value = '';
        if (byId('securityReviewOpenType')) byId('securityReviewOpenType').value = '';
        if (latestSecurityReviewPacket) renderSecurityReviewOpenItems(latestSecurityReviewPacket);
      });
      var pilotTesterForm = byId('pilotTesterForm');
      if (pilotTesterForm) pilotTesterForm.addEventListener('submit', function(event) {
        event.preventDefault();
        addPilotTesterFromForm();
      });
      var testerSessionForm = byId('testerSessionForm');
      if (testerSessionForm) testerSessionForm.addEventListener('submit', function(event) {
        event.preventDefault();
      });
      document.addEventListener('change', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.hasAttribute('data-go-no-go-check')) {
          setGoNoGoManualState(target.getAttribute('data-go-no-go-check') || '', { status: target.checked ? 'passed' : 'missing', passed: target.checked });
          reload();
          return;
        }
        if (target.hasAttribute('data-go-no-go-status')) {
          var status = normalizeGoNoGoStatus(target.value, false);
          setGoNoGoManualState(target.getAttribute('data-go-no-go-status') || '', { status: status, passed: status === 'passed' });
          reload();
          return;
        }
        if (target.hasAttribute('data-go-no-go-note')) {
          setGoNoGoManualState(target.getAttribute('data-go-no-go-note') || '', { note: target.value });
          reload();
          return;
        }
        if (target.hasAttribute('data-pilot-field')) {
          setPilotProposalState(target.getAttribute('data-pilot-field') || '', target.value);
          if (latestOrgPayload && latestReadiness) {
            renderPilotProposalPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-pilot-success-check')) {
          setPilotSuccessState(target.getAttribute('data-pilot-success-check') || '', { passed: target.checked === true });
          if (latestOrgPayload && latestReadiness) {
            renderPilotSuccessPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-pilot-success-note')) {
          setPilotSuccessState(target.getAttribute('data-pilot-success-note') || '', { note: target.value });
          if (latestOrgPayload && latestReadiness) {
            renderPilotSuccessPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-pilot-success-decision-field')) {
          setPilotSuccessDecisionState(target.getAttribute('data-pilot-success-decision-field') || '', target.value);
          if (latestOrgPayload && latestReadiness) {
            renderPilotSuccessPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-entitlement-field')) {
          setEntitlementsState(target.getAttribute('data-entitlement-field') || '', target.value);
          if (latestOrgPayload && latestReadiness) {
            renderEntitlementsPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-onboarding-check')) {
          setPaidOnboardingManualState(target.getAttribute('data-onboarding-check') || '', { status: target.checked ? 'passed' : 'missing' });
          if (latestOrgPayload && latestReadiness) {
            renderPaidOnboardingPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-onboarding-status')) {
          setPaidOnboardingManualState(target.getAttribute('data-onboarding-status') || '', { status: normalizePaidOnboardingStatus(target.value) });
          if (latestOrgPayload && latestReadiness) {
            renderPaidOnboardingPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-onboarding-owner')) {
          setPaidOnboardingManualState(target.getAttribute('data-onboarding-owner') || '', { owner: target.value });
          if (latestOrgPayload && latestReadiness) {
            renderPaidOnboardingPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-onboarding-due')) {
          setPaidOnboardingManualState(target.getAttribute('data-onboarding-due') || '', { due_date: target.value });
          if (latestOrgPayload && latestReadiness) {
            renderPaidOnboardingPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-onboarding-note')) {
          setPaidOnboardingManualState(target.getAttribute('data-onboarding-note') || '', { note: target.value });
          if (latestOrgPayload && latestReadiness) {
            renderPaidOnboardingPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-scanner-field')) {
          saveScannerFindingField(target);
          return;
        }
        if (target.hasAttribute('data-release-field')) {
          saveReleaseRecordField(target);
          return;
        }
        if (target.hasAttribute('data-tester-field')) {
          savePilotTesterField(target);
          return;
        }
        if (target.hasAttribute('data-tester-session-field')) {
          setPilotTesterSessionState(target.getAttribute('data-tester-session-field') || '', target.value);
          if (latestOrgPayload && latestReadiness) {
            renderPilotTestersPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (!target.hasAttribute('data-launch-check')) return;
        setLaunchManualState(target.getAttribute('data-launch-check') || '', target.checked);
        reload();
      });
      document.addEventListener('click', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-action') === 'remove-scanner-finding') {
          removeScannerFinding(target.getAttribute('data-scanner-finding-id') || '');
        }
        if (target.getAttribute('data-action') === 'remove-release-record') {
          removeReleaseRecord(target.getAttribute('data-release-record-id') || '');
        }
        if (target.getAttribute('data-action') === 'remove-pilot-tester') {
          removePilotTester(target.getAttribute('data-tester-record-id') || '');
        }
        if (target.hasAttribute('data-remove-entitlement-amendment')) {
          removeEntitlementAmendment(target.getAttribute('data-remove-entitlement-amendment') || '');
        }
      });
      var copyLaunchBriefBtn = byId('copyLaunchBriefBtn');
      if (copyLaunchBriefBtn) copyLaunchBriefBtn.addEventListener('click', async function() {
        var brief = byId('launchBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copyLaunchBriefBtn.textContent = 'copied';
          setTimeout(function() { copyLaunchBriefBtn.textContent = 'copy brief'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyEvidencePacketBtn = byId('copyEvidencePacketBtn');
      if (copyEvidencePacketBtn) copyEvidencePacketBtn.addEventListener('click', async function() {
        var packet = byId('evidencePacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyEvidencePacketBtn.textContent = 'copied';
          setTimeout(function() { copyEvidencePacketBtn.textContent = 'copy JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var copyDemoScriptBtn = byId('copyDemoScriptBtn');
      if (copyDemoScriptBtn) copyDemoScriptBtn.addEventListener('click', async function() {
        var script = byId('demoScript');
        if (!script) return;
        try {
          await navigator.clipboard.writeText(script.value);
          copyDemoScriptBtn.textContent = 'copied';
          setTimeout(function() { copyDemoScriptBtn.textContent = 'copy script'; }, 1400);
        } catch (_) {
          script.focus();
          script.select();
        }
      });
      var copySupportBriefBtn = byId('copySupportBriefBtn');
      if (copySupportBriefBtn) copySupportBriefBtn.addEventListener('click', async function() {
        var brief = byId('supportBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copySupportBriefBtn.textContent = 'copied';
          setTimeout(function() { copySupportBriefBtn.textContent = 'copy brief'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copySecurityReviewBriefBtn = byId('copySecurityReviewBriefBtn');
      if (copySecurityReviewBriefBtn) copySecurityReviewBriefBtn.addEventListener('click', async function() {
        if (!latestSecurityReviewPacket) return;
        var textValue = securityReviewFocusBriefText(latestSecurityReviewPacket);
        try {
          await navigator.clipboard.writeText(textValue);
          copySecurityReviewBriefBtn.textContent = 'copied';
          setTimeout(function() { copySecurityReviewBriefBtn.textContent = 'copy review brief'; }, 1400);
        } catch (_) {
          var brief = byId('securityReviewBrief');
          if (brief) {
            brief.value = textValue;
            brief.focus();
            brief.select();
          }
        }
      });
      var copySecurityReviewBtn = byId('copySecurityReviewBtn');
      if (copySecurityReviewBtn) copySecurityReviewBtn.addEventListener('click', async function() {
        var brief = byId('securityReviewBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copySecurityReviewBtn.textContent = 'copied';
          setTimeout(function() { copySecurityReviewBtn.textContent = 'copy packet'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyPilotProposalBtn = byId('copyPilotProposalBtn');
      if (copyPilotProposalBtn) copyPilotProposalBtn.addEventListener('click', async function() {
        var brief = byId('pilotProposalBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copyPilotProposalBtn.textContent = 'copied';
          setTimeout(function() { copyPilotProposalBtn.textContent = 'copy proposal'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyPilotSuccessBtn = byId('copyPilotSuccessBtn');
      if (copyPilotSuccessBtn) copyPilotSuccessBtn.addEventListener('click', async function() {
        var brief = byId('pilotSuccessBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copyPilotSuccessBtn.textContent = 'copied';
          setTimeout(function() { copyPilotSuccessBtn.textContent = 'copy update'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyPilotSuccessDecisionBtn = byId('copyPilotSuccessDecisionBtn');
      if (copyPilotSuccessDecisionBtn) copyPilotSuccessDecisionBtn.addEventListener('click', async function() {
        if (!latestPilotSuccessPacket) return;
        var textValue = pilotSuccessDecisionBriefText(latestPilotSuccessPacket);
        try {
          await navigator.clipboard.writeText(textValue);
          copyPilotSuccessDecisionBtn.textContent = 'copied';
          setTimeout(function() { copyPilotSuccessDecisionBtn.textContent = 'copy decision brief'; }, 1400);
        } catch (_) {
          var brief = byId('pilotSuccessBrief');
          if (brief) {
            brief.value = textValue;
            brief.focus();
            brief.select();
          }
        }
      });
      var copyScannerJsonBtn = byId('copyScannerJsonBtn');
      if (copyScannerJsonBtn) copyScannerJsonBtn.addEventListener('click', async function() {
        var packet = byId('scannerEvidencePacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyScannerJsonBtn.textContent = 'copied';
          setTimeout(function() { copyScannerJsonBtn.textContent = 'copy scanner JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var copyReleaseJsonBtn = byId('copyReleaseJsonBtn');
      if (copyReleaseJsonBtn) copyReleaseJsonBtn.addEventListener('click', async function() {
        var packet = byId('releaseEvidencePacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyReleaseJsonBtn.textContent = 'copied';
          setTimeout(function() { copyReleaseJsonBtn.textContent = 'copy release JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var copyTesterJsonBtn = byId('copyTesterJsonBtn');
      if (copyTesterJsonBtn) copyTesterJsonBtn.addEventListener('click', async function() {
        var packet = byId('testerEvidencePacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyTesterJsonBtn.textContent = 'copied';
          setTimeout(function() { copyTesterJsonBtn.textContent = 'copy tester JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var copyTesterSessionBriefBtn = byId('copyTesterSessionBriefBtn');
      if (copyTesterSessionBriefBtn) copyTesterSessionBriefBtn.addEventListener('click', async function() {
        if (!latestPilotTesterPacket) return;
        var textValue = testerSessionBriefText(latestPilotTesterPacket);
        try {
          await navigator.clipboard.writeText(textValue);
          copyTesterSessionBriefBtn.textContent = 'copied';
          setTimeout(function() { copyTesterSessionBriefBtn.textContent = 'copy session brief'; }, 1400);
        } catch (_) {
          var brief = byId('testerSessionBrief');
          if (brief) {
            brief.value = textValue;
            brief.focus();
            brief.select();
          }
        }
      });
      var copyEntitlementsCapacityBriefBtn = byId('copyEntitlementsCapacityBriefBtn');
      if (copyEntitlementsCapacityBriefBtn) copyEntitlementsCapacityBriefBtn.addEventListener('click', async function() {
        if (!latestEntitlementsPacket) return;
        var textValue = entitlementsCapacityBriefText(latestEntitlementsPacket);
        try {
          await navigator.clipboard.writeText(textValue);
          copyEntitlementsCapacityBriefBtn.textContent = 'copied';
          setTimeout(function() { copyEntitlementsCapacityBriefBtn.textContent = 'copy capacity brief'; }, 1400);
        } catch (_) {
          var packet = byId('entitlementsPacket');
          if (packet) {
            packet.value = textValue;
            packet.focus();
            packet.select();
          }
        }
      });
      var copyEntitlementsJsonBtn = byId('copyEntitlementsJsonBtn');
      if (copyEntitlementsJsonBtn) copyEntitlementsJsonBtn.addEventListener('click', async function() {
        var packet = byId('entitlementsPacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyEntitlementsJsonBtn.textContent = 'copied';
          setTimeout(function() { copyEntitlementsJsonBtn.textContent = 'copy entitlements JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var copyOnboardingTaskBriefBtn = byId('copyOnboardingTaskBriefBtn');
      if (copyOnboardingTaskBriefBtn) copyOnboardingTaskBriefBtn.addEventListener('click', async function() {
        if (!latestPaidOnboardingPacket) return;
        var textValue = paidOnboardingTaskBriefText(latestPaidOnboardingPacket);
        try {
          await navigator.clipboard.writeText(textValue);
          copyOnboardingTaskBriefBtn.textContent = 'copied';
          setTimeout(function() { copyOnboardingTaskBriefBtn.textContent = 'copy task brief'; }, 1400);
        } catch (_) {
          var packet = byId('onboardingPacket');
          if (packet) {
            packet.value = textValue;
            packet.focus();
            packet.select();
          }
        }
      });
      var copyOnboardingJsonBtn = byId('copyOnboardingJsonBtn');
      if (copyOnboardingJsonBtn) copyOnboardingJsonBtn.addEventListener('click', async function() {
        var packet = byId('onboardingPacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyOnboardingJsonBtn.textContent = 'copied';
          setTimeout(function() { copyOnboardingJsonBtn.textContent = 'copy onboarding JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var downloadEvidencePacketBtn = byId('downloadEvidencePacketBtn');
      if (downloadEvidencePacketBtn) downloadEvidencePacketBtn.addEventListener('click', function() {
        var packet = byId('evidencePacket');
        if (!packet) return;
        var blob = new Blob([packet.value], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'vaultproof-evidence-packet.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      });
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderEnterprisePlannedAppPage(pageName: string, env: EnterpriseControlPlaneEnv = {}): string | null {
  if (pageName === 'members') return injectEnterpriseAnalytics(renderEnterpriseMembersPage(), env, 'members');
  if (pageName === 'audit') return injectEnterpriseAnalytics(renderEnterpriseAuditPage(), env, 'audit');
  if (pageName === 'alerts') return injectEnterpriseAnalytics(renderEnterpriseAlertsPage(), env, 'alerts');
  if (pageName === 'activity' || pageName === 'projects' || pageName === 'inventory' || pageName === 'policy' || pageName === 'rollout' || pageName === 'keys') {
    return injectEnterpriseAnalytics(renderEnterpriseOperationsPage(pageName), env, pageName);
  }
  if (pageName === 'docs' || pageName === 'setup' || pageName === 'launch' || pageName === 'evidence' || pageName === 'demo' || pageName === 'technical-guide' || pageName === 'security-review' || pageName === 'verifier' || pageName === 'settings' || pageName === 'entitlements' || pageName === 'onboarding' || pageName === 'plans' || pageName === 'pilot' || pageName === 'pilot-success' || pageName === 'testers' || pageName === 'release' || pageName === 'scanner' || pageName === 'support' || pageName === 'runbooks') {
    return injectEnterpriseAnalytics(renderEnterpriseSupportPage(pageName), env, pageName);
  }

  const page = plannedEnterprisePages[pageName];
  if (!page) return null;

  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(page.title)} - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .card { width: min(940px, 100%); border: 1px solid var(--line); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.86)); padding: clamp(24px, 5vw, 48px); box-shadow: 0 22px 72px rgba(26,40,52,.18); }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 10px 0 12px; font-size: clamp(40px, 7vw, 82px); letter-spacing: -.075em; line-height: .9; }
    .summary { color: var(--muted); font-size: 17px; line-height: 1.65; max-width: 760px; }
    .grid { margin-top: 28px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .feature { border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px; background: rgba(248,250,252,.82); color: var(--text); }
    .actions { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; background: rgba(255,255,255,.78); }
    .btn.primary { background: linear-gradient(135deg, var(--gold), #23466f); color: var(--ink); border: 0; font-weight: 850; }
    .note { margin-top: 20px; color: var(--muted); font-size: 13px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar(pageName as EnterpriseAppNavPage, page.kicker)}
    <main class="main">
      <section class="card">
      <div class="kicker">${escapeHtml(page.kicker)}</div>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="summary">${escapeHtml(page.summary)}</p>
      <div class="grid">
        ${page.features.map((feature) => `<div class="feature">${escapeHtml(feature)}</div>`).join('')}
      </div>
      <div class="actions">
        <a class="btn primary" href="${escapeHtml(page.primaryHref)}">${escapeHtml(page.primaryLabel)}</a>
        <a class="btn" href="/app/dashboard">dashboard</a>
        <a class="btn" href="/app/control">control</a>
        <a class="btn" href="/app/org">org + SSO</a>
      </div>
      <div class="note">Navigation baseline is live. This page is scheduled for API-backed enterprise features in Phase 6 of the build plan.</div>
      </section>
    </main>
  </div>
</body>
</html>`, env, pageName);
}

export function renderEnterpriseControlPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(
    applyEnterpriseStaticAppTheme(readEnterpriseAppPage('control.html'), 'control', 'policy control'),
    env,
    'control',
  );
}

export function renderEnterpriseOrgPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(
    applyEnterpriseStaticAppTheme(readEnterpriseAppPage('org.html'), 'org', 'organization setup'),
    env,
    'org',
  );
}
