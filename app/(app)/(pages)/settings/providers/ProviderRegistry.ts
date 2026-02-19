import OpenAIIcon from './icons/OpenAI';
import ClaudeIcon from './icons/Claude';
import GroqIcon from './icons/Groq';
import OpenRouterIcon from './icons/OpenRouter';
import OllamaIcon from './icons/Ollama';
import VLLMIcon from './icons/VLLM';
import LMStudioIcon from './icons/LMStudio';
import GeminiIcon from './icons/Gemini';
import GitHubIcon from './icons/GitHub';
import GeminiCliIcon from './icons/GeminiCli';

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  extra?: string;
  enabled: boolean;
}

export type FieldId = 'apiKey' | 'baseUrl' | 'extra';

export interface ProviderFieldDef {
  id: FieldId;
  label: string;
  type: 'password' | 'text' | 'textarea';
  placeholder?: string;
  required?: boolean;
}

export interface ProviderDefinition {
  key: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  fields: ProviderFieldDef[];
  defaults?: Partial<ProviderConfig>;
  authType?: 'apiKey' | 'oauth';
  oauth?: {
    enterpriseDomain?: boolean;
    variant?: 'panel' | 'compact' | 'inline-code' | 'device';
  };
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    key: 'google',
    name: 'Google AI Studio',
    description: 'Gemini models via Google AI Studio',
    icon: GeminiIcon,
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'AIza...' },
      { id: 'extra', label: 'Extra (JSON)', type: 'textarea', placeholder: '{\n  "vertexai": false,\n  "project_id": "",\n  "location": ""\n}', required: false },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    description: 'GPT‑4, GPT‑4o, and other OpenAI models',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.openai.com', required: false },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5 Sonnet, Haiku, and Opus',
    icon: ClaudeIcon,
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'groq',
    name: 'Groq',
    description: 'Fast Llama and Mixtral models',
    icon: GroqIcon,
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'gsk_...' },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Access to 100+ AI models from multiple providers',
    icon: OpenRouterIcon,
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-or-v1-...' },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'ollama',
    name: 'Ollama',
    description: 'Local models running on your machine',
    icon: OllamaIcon,
    fields: [
      { id: 'baseUrl', label: 'Host URL', type: 'text', placeholder: 'http://localhost:11434' },
    ],
    defaults: { enabled: true, baseUrl: 'http://localhost:11434' },
    authType: 'apiKey',
  },
  {
    key: 'vllm',
    name: 'vLLM',
    description: 'Local vLLM server (OpenAI‑compatible)',
    icon: VLLMIcon,
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://localhost:8000/v1' },
    ],
    defaults: { enabled: true, baseUrl: 'http://localhost:8000/v1' },
    authType: 'apiKey',
  },
  {
    key: 'lmstudio',
    name: 'LM Studio',
    description: 'Local LM Studio server',
    icon: LMStudioIcon,
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://localhost:1234/v1' },
    ],
    defaults: { enabled: true, baseUrl: 'http://localhost:1234/v1' },
    authType: 'apiKey',
  },
  {
    key: 'openai_like',
    name: 'OpenAI‑Compatible',
    description: 'Any OpenAI‑like API (Together, DeepInfra, OpenRouter, …)',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key', type: 'password', placeholder: '<provider api key>' },
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.example.com/v1' },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'anthropic_oauth',
    name: 'Claude',
    description: 'Claude Pro/Max via OAuth sign-in',
    icon: ClaudeIcon,
    fields: [],
    defaults: { enabled: true },
    authType: 'oauth',
    oauth: { variant: 'inline-code' },
  },
  {
    key: 'openai_codex',
    name: 'ChatGPT',
    description: 'ChatGPT Plus/Pro via OAuth',
    icon: OpenAIIcon,
    fields: [],
    defaults: { enabled: true },
    authType: 'oauth',
    oauth: { variant: 'compact' },
  },
  {
    key: 'github_copilot',
    name: 'GitHub Copilot OAuth',
    description: 'Copilot models via device flow',
    icon: GitHubIcon,
    fields: [],
    defaults: { enabled: true },
    authType: 'oauth',
    oauth: { enterpriseDomain: true, variant: 'device' },
  },
  {
    key: 'google_gemini_cli',
    name: 'Gemini CLI OAuth',
    description: 'Cloud Code Assist Gemini models via OAuth',
    icon: GeminiCliIcon,
    fields: [],
    defaults: { enabled: true },
    authType: 'oauth',
    oauth: { variant: 'compact' },
  },
];

export const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]));
