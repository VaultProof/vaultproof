export type Provider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'together'
  | 'adzuna'
  | 'other';

export interface ProviderInfo {
  id: Provider;
  name: string;
  placeholder: string;
  prefix: string;
  docsUrl: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    placeholder: 'sk-proj-...',
    prefix: 'sk-',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    placeholder: 'sk-ant-...',
    prefix: 'sk-ant-',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    id: 'google',
    name: 'Google AI',
    placeholder: 'AIza...',
    prefix: 'AIza',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  together: {
    id: 'together',
    name: 'Together.ai',
    placeholder: 'tgp-...',
    prefix: '',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
  },
  adzuna: {
    id: 'adzuna',
    name: 'Adzuna',
    placeholder: 'Your Adzuna app key',
    prefix: '',
    docsUrl: 'https://developer.adzuna.com/',
  },
  other: {
    id: 'other',
    name: 'Other',
    placeholder: 'Paste your API key',
    prefix: '',
    docsUrl: '',
  },
};

export type WidgetStatus =
  | 'idle'
  | 'splitting'
  | 'storing'
  | 'success'
  | 'error';

export interface ZKKeyConnectProps {
  vaultUrl: string;
  appId: string;
  appName: string;
  userId: string;
  providers?: Provider[];
  onSuccess?: (keySlotId: string, provider: string) => void;
  onError?: (error: string) => void;
  theme?: 'light' | 'dark';
}
