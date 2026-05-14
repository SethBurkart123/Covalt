import GitHubIcon from './icons/GitHub';
import { PROVIDER_ICON_ASSETS } from './icon-assets';
import { type ProviderIcon, getProviderImageIcon } from './provider-image-icon';

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

type ProviderIconKey = keyof typeof PROVIDER_ICON_ASSETS | 'GitHub';

const ICON_MAP: Record<string, ProviderIconKey> = {
  abacus: 'Abacus',
  aihubmix: 'AIHubMix',
  alibaba: 'Alibaba',
  alibabacn: 'Alibaba',
  anthropic: 'Claude',
  amazonbedrock: 'AwsBedrock',
  awsbedrock: 'AwsBedrock',
  azure: 'Azure',
  azurecognitiveservices: 'AzureCognitiveServices',
  baseten: 'Baseten',
  berget: 'Berget',
  cerebras: 'Cerebras',
  chutes: 'Chutes',
  claude: 'Claude',
  cloudferro: 'CloudFerro',
  cloudferrosherlock: 'CloudFerro',
  cloudflare: 'Cloudflare',
  cloudflareaigateway: 'Cloudflare',
  cloudflareworkersai: 'Cloudflare',
  cohere: 'Cohere',
  cortecs: 'Cortecs',
  deepinfra: 'DeepInfra',
  deepseek: 'DeepSeek',
  evroc: 'Evroc',
  fastrouter: 'FastRouter',
  fireworksai: 'FireworksAI',
  firmware: 'Firmware',
  friendli: 'Friendli',
  gemini: 'Gemini',
  googlegeminicli: 'GeminiCli',
  github: 'GitHub',
  githubcopilot: 'GitHubCopilot',
  githubcopilotapi: 'GitHubCopilot',
  githubmodels: 'GitHub',
  gitlab: 'GitLab',
  groq: 'Groq',
  helicone: 'Helicone',
  huggingface: 'HuggingFace',
  iflowcn: 'IFlowCN',
  google: 'Gemini',
  inference: 'OpenAI',
  inception: 'Inception',
  ionet: 'IONet',
  jiekou: 'JieKou',
  kilo: 'Kilo',
  kimi: 'Kimi',
  lmstudio: 'LMStudio',
  llama: 'Llama',
  lucidquery: 'LucidQuery',
  meganova: 'Meganova',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  moark: 'Moark',
  modelscope: 'ModelScope',
  moonshot: 'Moonshot',
  moonshotai: 'Moonshot',
  moonshotaicn: 'Moonshot',
  morph: 'Morph',
  nanogpt: 'NanoGPT',
  nebius: 'Nebius',
  nova: 'Nova',
  novita: 'Novita',
  novitaai: 'Novita',
  ollama: 'Ollama',
  ollamacloud: 'Ollama',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  opencode: 'Opencode',
  ovhcloud: 'OvhCloud',
  p302ai: 'P302AI',
  '302ai': 'P302AI',
  perplexity: 'Perplexity',
  poe: 'Poe',
  privatemodeai: 'PrivateModeAI',
  qihangai: 'OpenAI',
  qiniuai: 'OpenAI',
  kuaecloudcodingplan: 'OpenAI',
  bailing: 'OpenAI',
  nvidia: 'OpenAI',
  requesty: 'Requesty',
  sapaicore: 'OpenAI',
  scaleway: 'Scaleway',
  siliconflow: 'SiliconFlow',
  siliconflowcn: 'SiliconFlow',
  stackit: 'Stackit',
  stepfun: 'StepFun',
  submodel: 'Submodel',
  synthetic: 'Synthetic',
  togetherai: 'TogetherAI',
  upstage: 'UpstageAI',
  v0: 'V0',
  venice: 'Venice',
  vercel: 'Vercel',
  vertexai: 'VertexAI',
  vivgrid: 'Vivgrid',
  vllm: 'VLLM',
  vultr: 'Vultr',
  wandb: 'WandB',
  xai: 'XAI',
  xiaomi: 'Xiaomi',
  zai: 'ZAI',
  zaicodingplan: 'ZAI',
  zhipuai: 'ZhipuAI',
  zhipuaicodingplan: 'ZhipuAI',
  zenmux: 'OpenAI',
};

const resolveProviderIcon = (iconKey: ProviderIconKey): ProviderIcon => {
  if (iconKey === 'GitHub') {
    return GitHubIcon;
  }
  return getProviderImageIcon(iconKey, PROVIDER_ICON_ASSETS);
};

export const OpenAIIcon = getProviderImageIcon('OpenAI', PROVIDER_ICON_ASSETS);

export const getProviderIcon = (iconKey?: string | null): ProviderIcon => {
  if (!iconKey) return OpenAIIcon;
  const normalizedKey = normalize(iconKey);
  const mappedKey = ICON_MAP[normalizedKey] || ('OpenAI' as ProviderIconKey);
  return resolveProviderIcon(mappedKey);
};
