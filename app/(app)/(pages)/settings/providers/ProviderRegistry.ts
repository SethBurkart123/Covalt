import AIHubMixIcon from './icons/AIHubMix';
import AbacusIcon from './icons/Abacus';
import AlibabaIcon from './icons/Alibaba';
import AwsBedrockIcon from './icons/AwsBedrock';
import AzureCognitiveServicesIcon from './icons/AzureCognitiveServices';
import AzureIcon from './icons/Azure';
import BasetenIcon from './icons/Baseten';
import BergetIcon from './icons/Berget';
import CerebrasIcon from './icons/Cerebras';
import ChutesIcon from './icons/Chutes';
import ClaudeIcon from './icons/Claude';
import CloudFerroIcon from './icons/CloudFerro';
import CloudflareIcon from './icons/Cloudflare';
import CohereIcon from './icons/Cohere';
import CortecsIcon from './icons/Cortecs';
import DeepInfraIcon from './icons/DeepInfra';
import DeepSeekIcon from './icons/DeepSeek';
import EvrocIcon from './icons/Evroc';
import FastRouterIcon from './icons/FastRouter';
import FireworksAIIcon from './icons/FireworksAI';
import FirmwareIcon from './icons/Firmware';
import FriendliIcon from './icons/Friendli';
import GeminiCliIcon from './icons/GeminiCli';
import GeminiIcon from './icons/Gemini';
import GitHubCopilotIcon from './icons/GitHubCopilot';
import GitHubIcon from './icons/GitHub';
import GitLabIcon from './icons/GitLab';
import GroqIcon from './icons/Groq';
import HeliconeIcon from './icons/Helicone';
import HuggingFaceIcon from './icons/HuggingFace';
import IFlowCNIcon from './icons/IFlowCN';
import IONetIcon from './icons/IONet';
import InceptionIcon from './icons/Inception';
import JieKouIcon from './icons/JieKou';
import KiloIcon from './icons/Kilo';
import KimiIcon from './icons/Kimi';
import LMStudioIcon from './icons/LMStudio';
import LlamaIcon from './icons/Llama';
import LucidQueryIcon from './icons/LucidQuery';
import MeganovaIcon from './icons/Meganova';
import MiniMaxIcon from './icons/MiniMax';
import MistralIcon from './icons/Mistral';
import MoarkIcon from './icons/Moark';
import ModelScopeIcon from './icons/ModelScope';
import MoonshotIcon from './icons/Moonshot';
import MorphIcon from './icons/Morph';
import NanoGPTIcon from './icons/NanoGPT';
import NebiusIcon from './icons/Nebius';
import NovaIcon from './icons/Nova';
import NovitaIcon from './icons/Novita';
import OllamaIcon from './icons/Ollama';
import OpenAIIcon from './icons/OpenAI';
import OpenRouterIcon from './icons/OpenRouter';
import OpencodeIcon from './icons/Opencode';
import OvhCloudIcon from './icons/OvhCloud';
import P302AIIcon from './icons/P302AI';
import PerplexityIcon from './icons/Perplexity';
import PoeIcon from './icons/Poe';
import PrivateModeAIIcon from './icons/PrivateModeAI';
import RequestyIcon from './icons/Requesty';
import ScalewayIcon from './icons/Scaleway';
import SiliconFlowIcon from './icons/SiliconFlow';
import StackitIcon from './icons/Stackit';
import StepFunIcon from './icons/StepFun';
import SubmodelIcon from './icons/Submodel';
import SyntheticIcon from './icons/Synthetic';
import TogetherAIIcon from './icons/TogetherAI';
import UpstageAIIcon from './icons/UpstageAI';
import V0Icon from './icons/V0';
import VLLMIcon from './icons/VLLM';
import VeniceIcon from './icons/Venice';
import VercelIcon from './icons/Vercel';
import VertexAIIcon from './icons/VertexAI';
import VivgridIcon from './icons/Vivgrid';
import VultrIcon from './icons/Vultr';
import WandBIcon from './icons/WandB';
import XAIIcon from './icons/XAI';
import XiaomiIcon from './icons/Xiaomi';
import ZAIIcon from './icons/ZAI';
import ZhipuAIIcon from './icons/ZhipuAI';

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
}

export type FieldId = 'apiKey' | 'baseUrl';

export interface ProviderFieldDef {
  id: FieldId;
  label: string;
  type: 'password' | 'text';
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

const API_PROVIDERS: ProviderDefinition[] = [
  {
    key: '302ai',
    name: '302.AI',
    description: '302.AI API',
    icon: P302AIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: '302AI_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.302.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.302.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'abacus',
    name: 'Abacus',
    description: 'Abacus API',
    icon: AbacusIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ABACUS_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://routellm.abacus.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://routellm.abacus.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'aihubmix',
    name: 'AIHubMix',
    description: 'AIHubMix API',
    icon: AIHubMixIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'AIHUBMIX_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://aihubmix.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://aihubmix.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'alibaba',
    name: 'Alibaba',
    description: 'Alibaba API',
    icon: AlibabaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'DASHSCOPE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'alibaba-cn',
    name: 'Alibaba (China)',
    description: 'Alibaba (China) API',
    icon: AlibabaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'DASHSCOPE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    description: 'Amazon Bedrock API',
    icon: AwsBedrockIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'AWS_ACCESS_KEY_ID' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic API',
    icon: ClaudeIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ANTHROPIC_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'azure',
    name: 'Azure',
    description: 'Azure API',
    icon: AzureIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'AZURE_RESOURCE_NAME' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'azure-cognitive-services',
    name: 'Azure Cognitive Services',
    description: 'Azure Cognitive Services API',
    icon: AzureCognitiveServicesIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'AZURE_COGNITIVE_SERVICES_RESOURCE_NAME' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'bailing',
    name: 'Bailing',
    description: 'Bailing API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'BAILING_API_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.tbox.cn/api/llm/v1/chat/completions', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.tbox.cn/api/llm/v1/chat/completions',
    },
    authType: 'apiKey',
  },
  {
    key: 'baseten',
    name: 'Baseten',
    description: 'Baseten API',
    icon: BasetenIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'BASETEN_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://inference.baseten.co/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://inference.baseten.co/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'berget',
    name: 'Berget.AI',
    description: 'Berget.AI API',
    icon: BergetIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'BERGET_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.berget.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.berget.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'cerebras',
    name: 'Cerebras',
    description: 'Cerebras API',
    icon: CerebrasIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'CEREBRAS_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.cerebras.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.cerebras.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'chutes',
    name: 'Chutes',
    description: 'Chutes API',
    icon: ChutesIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'CHUTES_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://llm.chutes.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://llm.chutes.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'cloudferro-sherlock',
    name: 'CloudFerro Sherlock',
    description: 'CloudFerro Sherlock API',
    icon: CloudFerroIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'CLOUDFERRO_SHERLOCK_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api-sherlock.cloudferro.com/openai/v1/', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api-sherlock.cloudferro.com/openai/v1/',
    },
    authType: 'apiKey',
  },
  {
    key: 'cloudflare-ai-gateway',
    name: 'Cloudflare AI Gateway',
    description: 'Cloudflare AI Gateway API',
    icon: CloudflareIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'CLOUDFLARE_API_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'cloudflare-workers-ai',
    name: 'Cloudflare Workers AI',
    description: 'Cloudflare Workers AI API',
    icon: CloudflareIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'CLOUDFLARE_ACCOUNT_ID' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'cohere',
    name: 'Cohere',
    description: 'Cohere API',
    icon: CohereIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'COHERE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.cohere.com', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.cohere.com',
    },
    authType: 'apiKey',
  },
  {
    key: 'cortecs',
    name: 'Cortecs',
    description: 'Cortecs API',
    icon: CortecsIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'CORTECS_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.cortecs.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.cortecs.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'deepinfra',
    name: 'Deep Infra',
    description: 'Deep Infra API',
    icon: DeepInfraIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'DEEPINFRA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.deepinfra.com/v1/openai', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.deepinfra.com/v1/openai',
    },
    authType: 'apiKey',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek API',
    icon: DeepSeekIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'DEEPSEEK_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.deepseek.com', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.deepseek.com',
    },
    authType: 'apiKey',
  },
  {
    key: 'evroc',
    name: 'evroc',
    description: 'evroc API',
    icon: EvrocIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'EVROC_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://models.think.evroc.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://models.think.evroc.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'fastrouter',
    name: 'FastRouter',
    description: 'FastRouter API',
    icon: FastRouterIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'FASTROUTER_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://go.fastrouter.ai/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://go.fastrouter.ai/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'fireworks-ai',
    name: 'Fireworks AI',
    description: 'Fireworks AI API',
    icon: FireworksAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'FIREWORKS_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.fireworks.ai/inference/v1/', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.fireworks.ai/inference/v1/',
    },
    authType: 'apiKey',
  },
  {
    key: 'firmware',
    name: 'Firmware',
    description: 'Firmware API',
    icon: FirmwareIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'FIRMWARE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://app.firmware.ai/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://app.firmware.ai/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'friendli',
    name: 'Friendli',
    description: 'Friendli API',
    icon: FriendliIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'FRIENDLI_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.friendli.ai/serverless/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.friendli.ai/serverless/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'github-copilot-api',
    name: 'GitHub Copilot (API)',
    description: 'GitHub Copilot (API) API',
    icon: GitHubCopilotIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GITHUB_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.githubcopilot.com', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.githubcopilot.com',
    },
    authType: 'apiKey',
  },
  {
    key: 'github-models',
    name: 'GitHub Models',
    description: 'GitHub Models API',
    icon: GitHubIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GITHUB_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://models.github.ai/inference', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://models.github.ai/inference',
    },
    authType: 'apiKey',
  },
  {
    key: 'gitlab',
    name: 'GitLab Duo',
    description: 'GitLab Duo API',
    icon: GitLabIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GITLAB_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'google',
    name: 'Google',
    description: 'Google API',
    icon: GeminiIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GOOGLE_GENERATIVE_AI_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'google-vertex',
    name: 'Vertex',
    description: 'Vertex API',
    icon: VertexAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GOOGLE_VERTEX_PROJECT' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'google-vertex-anthropic',
    name: 'Vertex (Anthropic)',
    description: 'Vertex (Anthropic) API',
    icon: VertexAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GOOGLE_VERTEX_PROJECT' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'groq',
    name: 'Groq',
    description: 'Groq API',
    icon: GroqIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'GROQ_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'helicone',
    name: 'Helicone',
    description: 'Helicone API',
    icon: HeliconeIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'HELICONE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://ai-gateway.helicone.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://ai-gateway.helicone.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'huggingface',
    name: 'Hugging Face',
    description: 'Hugging Face API',
    icon: HuggingFaceIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'HF_TOKEN' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://router.huggingface.co/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://router.huggingface.co/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'iflowcn',
    name: 'iFlow',
    description: 'iFlow API',
    icon: IFlowCNIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'IFLOW_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://apis.iflow.cn/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://apis.iflow.cn/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'inception',
    name: 'Inception',
    description: 'Inception API',
    icon: InceptionIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'INCEPTION_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.inceptionlabs.ai/v1/', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.inceptionlabs.ai/v1/',
    },
    authType: 'apiKey',
  },
  {
    key: 'inference',
    name: 'Inference',
    description: 'Inference API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'INFERENCE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://inference.net/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://inference.net/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'io-net',
    name: 'IO.NET',
    description: 'IO.NET API',
    icon: IONetIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'IOINTELLIGENCE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.intelligence.io.solutions/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.intelligence.io.solutions/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'jiekou',
    name: 'Jiekou.AI',
    description: 'Jiekou.AI API',
    icon: JieKouIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'JIEKOU_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.jiekou.ai/openai', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.jiekou.ai/openai',
    },
    authType: 'apiKey',
  },
  {
    key: 'kilo',
    name: 'Kilo Gateway',
    description: 'Kilo Gateway API',
    icon: KiloIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'KILO_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.kilo.ai/api/gateway', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.kilo.ai/api/gateway',
    },
    authType: 'apiKey',
  },
  {
    key: 'kimi-for-coding',
    name: 'Kimi For Coding',
    description: 'Kimi For Coding API',
    icon: KimiIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'KIMI_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.kimi.com/coding/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.kimi.com/coding/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'kuae-cloud-coding-plan',
    name: 'KUAE Cloud Coding Plan',
    description: 'KUAE Cloud Coding Plan API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'KUAE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://coding-plan-endpoint.kuaecloud.net/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://coding-plan-endpoint.kuaecloud.net/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'llama',
    name: 'Llama',
    description: 'Llama API',
    icon: LlamaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'LLAMA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.llama.com/compat/v1/', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.llama.com/compat/v1/',
    },
    authType: 'apiKey',
  },
  {
    key: 'lmstudio',
    name: 'LMStudio',
    description: 'LMStudio API',
    icon: LMStudioIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'LMSTUDIO_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'http://127.0.0.1:1234/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:1234/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'lucidquery',
    name: 'LucidQuery AI',
    description: 'LucidQuery AI API',
    icon: LucidQueryIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'LUCIDQUERY_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://lucidquery.com/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://lucidquery.com/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'meganova',
    name: 'Meganova',
    description: 'Meganova API',
    icon: MeganovaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MEGANOVA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.meganova.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.meganova.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'minimax',
    name: 'MiniMax (minimax.io)',
    description: 'MiniMax (minimax.io) API',
    icon: MiniMaxIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MINIMAX_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.minimax.io/anthropic/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.minimax.io/anthropic/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'minimax-cn',
    name: 'MiniMax (minimaxi.com)',
    description: 'MiniMax (minimaxi.com) API',
    icon: MiniMaxIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MINIMAX_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.minimaxi.com/anthropic/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'minimax-cn-coding-plan',
    name: 'MiniMax Coding Plan (minimaxi.com)',
    description: 'MiniMax Coding Plan (minimaxi.com) API',
    icon: MiniMaxIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MINIMAX_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.minimaxi.com/anthropic/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'minimax-coding-plan',
    name: 'MiniMax Coding Plan (minimax.io)',
    description: 'MiniMax Coding Plan (minimax.io) API',
    icon: MiniMaxIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MINIMAX_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.minimax.io/anthropic/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.minimax.io/anthropic/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'mistral',
    name: 'Mistral',
    description: 'Mistral API',
    icon: MistralIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MISTRAL_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.mistral.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.mistral.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'moark',
    name: 'Moark',
    description: 'Moark API',
    icon: MoarkIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MOARK_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://moark.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://moark.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'modelscope',
    name: 'ModelScope',
    description: 'ModelScope API',
    icon: ModelScopeIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MODELSCOPE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api-inference.modelscope.cn/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api-inference.modelscope.cn/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'moonshotai',
    name: 'Moonshot AI',
    description: 'Moonshot AI API',
    icon: MoonshotIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MOONSHOT_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.moonshot.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.moonshot.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'moonshotai-cn',
    name: 'Moonshot AI (China)',
    description: 'Moonshot AI (China) API',
    icon: MoonshotIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MOONSHOT_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.moonshot.cn/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.moonshot.cn/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'morph',
    name: 'Morph',
    description: 'Morph API',
    icon: MorphIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'MORPH_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.morphllm.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.morphllm.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'nano-gpt',
    name: 'NanoGPT',
    description: 'NanoGPT API',
    icon: NanoGPTIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'NANO_GPT_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://nano-gpt.com/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://nano-gpt.com/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'nebius',
    name: 'Nebius Token Factory',
    description: 'Nebius Token Factory API',
    icon: NebiusIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'NEBIUS_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.tokenfactory.nebius.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.tokenfactory.nebius.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'nova',
    name: 'Nova',
    description: 'Nova API',
    icon: NovaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'NOVA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.nova.amazon.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.nova.amazon.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'novita-ai',
    name: 'NovitaAI',
    description: 'NovitaAI API',
    icon: NovitaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'NOVITA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.novita.ai/openai', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.novita.ai/openai',
    },
    authType: 'apiKey',
  },
  {
    key: 'nvidia',
    name: 'Nvidia',
    description: 'Nvidia API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'NVIDIA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://integrate.api.nvidia.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'ollama-cloud',
    name: 'Ollama Cloud',
    description: 'Ollama Cloud API',
    icon: OllamaIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'OLLAMA_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://ollama.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://ollama.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    description: 'OpenAI API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'OPENAI_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'opencode',
    name: 'OpenCode Zen',
    description: 'OpenCode Zen API',
    icon: OpencodeIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'OPENCODE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://opencode.ai/zen/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://opencode.ai/zen/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'OpenRouter API',
    icon: OpenRouterIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'OPENROUTER_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://openrouter.ai/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'ovhcloud',
    name: 'OVHcloud AI Endpoints',
    description: 'OVHcloud AI Endpoints API',
    icon: OvhCloudIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'OVHCLOUD_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity API',
    icon: PerplexityIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'PERPLEXITY_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.perplexity.ai', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.perplexity.ai',
    },
    authType: 'apiKey',
  },
  {
    key: 'poe',
    name: 'Poe',
    description: 'Poe API',
    icon: PoeIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'POE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.poe.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.poe.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'privatemode-ai',
    name: 'Privatemode AI',
    description: 'Privatemode AI API',
    icon: PrivateModeAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'PRIVATEMODE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'http://localhost:8080/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'http://localhost:8080/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'qihang-ai',
    name: 'QiHang',
    description: 'QiHang API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'QIHANG_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.qhaigc.net/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.qhaigc.net/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'qiniu-ai',
    name: 'Qiniu',
    description: 'Qiniu API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'Qiniu_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.qnaigc.com.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.qnaigc.com.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'requesty',
    name: 'Requesty',
    description: 'Requesty API',
    icon: RequestyIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'REQUESTY_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://router.requesty.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://router.requesty.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'sap-ai-core',
    name: 'SAP AI Core',
    description: 'SAP AI Core API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'AICORE_SERVICE_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.example.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: undefined,
    },
    authType: 'apiKey',
  },
  {
    key: 'scaleway',
    name: 'Scaleway',
    description: 'Scaleway API',
    icon: ScalewayIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'SCALEWAY_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.scaleway.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.scaleway.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'siliconflow',
    name: 'SiliconFlow',
    description: 'SiliconFlow API',
    icon: SiliconFlowIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'SILICONFLOW_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.siliconflow.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.siliconflow.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'siliconflow-cn',
    name: 'SiliconFlow (China)',
    description: 'SiliconFlow (China) API',
    icon: SiliconFlowIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'SILICONFLOW_CN_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.siliconflow.cn/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.siliconflow.cn/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'stackit',
    name: 'STACKIT',
    description: 'STACKIT API',
    icon: StackitIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'STACKIT_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'stepfun',
    name: 'StepFun',
    description: 'StepFun API',
    icon: StepFunIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'STEPFUN_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.stepfun.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.stepfun.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'submodel',
    name: 'submodel',
    description: 'submodel API',
    icon: SubmodelIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'SUBMODEL_INSTAGEN_ACCESS_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://llm.submodel.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://llm.submodel.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'synthetic',
    name: 'Synthetic',
    description: 'Synthetic API',
    icon: SyntheticIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'SYNTHETIC_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.synthetic.new/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.synthetic.new/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'togetherai',
    name: 'Together AI',
    description: 'Together AI API',
    icon: TogetherAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'TOGETHER_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.together.xyz/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.together.xyz/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'upstage',
    name: 'Upstage',
    description: 'Upstage API',
    icon: UpstageAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'UPSTAGE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.upstage.ai/v1/solar', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.upstage.ai/v1/solar',
    },
    authType: 'apiKey',
  },
  {
    key: 'v0',
    name: 'v0',
    description: 'v0 API',
    icon: V0Icon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'V0_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.v0.dev/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.v0.dev/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'venice',
    name: 'Venice AI',
    description: 'Venice AI API',
    icon: VeniceIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'VENICE_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.venice.ai/api/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.venice.ai/api/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'vercel',
    name: 'Vercel AI Gateway',
    description: 'Vercel AI Gateway API',
    icon: VercelIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'AI_GATEWAY_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://gateway.ai.vercel.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://gateway.ai.vercel.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'vivgrid',
    name: 'Vivgrid',
    description: 'Vivgrid API',
    icon: VivgridIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'VIVGRID_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.vivgrid.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.vivgrid.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'vultr',
    name: 'Vultr',
    description: 'Vultr API',
    icon: VultrIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'VULTR_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.vultrinference.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.vultrinference.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'wandb',
    name: 'Weights & Biases',
    description: 'Weights & Biases API',
    icon: WandBIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'WANDB_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.inference.wandb.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.inference.wandb.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'xai',
    name: 'xAI',
    description: 'xAI API',
    icon: XAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'XAI_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.x.ai/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.x.ai/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'xiaomi',
    name: 'Xiaomi',
    description: 'Xiaomi API',
    icon: XiaomiIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'XIAOMI_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.xiaomimimo.com/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.xiaomimimo.com/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'zai',
    name: 'Z.AI',
    description: 'Z.AI API',
    icon: ZAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ZHIPU_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.z.ai/api/paas/v4', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.z.ai/api/paas/v4',
    },
    authType: 'apiKey',
  },
  {
    key: 'zai-coding-plan',
    name: 'Z.AI Coding Plan',
    description: 'Z.AI Coding Plan API',
    icon: ZAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ZHIPU_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.z.ai/api/coding/paas/v4', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    },
    authType: 'apiKey',
  },
  {
    key: 'zenmux',
    name: 'ZenMux',
    description: 'ZenMux API',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ZENMUX_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://zenmux.ai/api/anthropic/v1', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://zenmux.ai/api/anthropic/v1',
    },
    authType: 'apiKey',
  },
  {
    key: 'zhipuai',
    name: 'Zhipu AI',
    description: 'Zhipu AI API',
    icon: ZhipuAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ZHIPU_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://open.bigmodel.cn/api/paas/v4', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    },
    authType: 'apiKey',
  },
  {
    key: 'zhipuai-coding-plan',
    name: 'Zhipu AI Coding Plan',
    description: 'Zhipu AI Coding Plan API',
    icon: ZhipuAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'ZHIPU_API_KEY' },
      { id: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://open.bigmodel.cn/api/coding/paas/v4', required: false },
    ],
    defaults: {
      enabled: true,
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    },
    authType: 'apiKey',
  },
];

const EXTRA_PROVIDERS: ProviderDefinition[] = [
  {
    key: 'ollama',
    name: 'Ollama (Local)',
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
    name: 'vLLM (Local)',
    description: 'Local vLLM server (OpenAI compatible)',
    icon: VLLMIcon,
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://localhost:8000/v1' },
    ],
    defaults: { enabled: true, baseUrl: 'http://localhost:8000/v1' },
    authType: 'apiKey',
  },
  {
    key: 'openai_like',
    name: 'OpenAI Compatible (Custom)',
    description: 'Any OpenAI-like API endpoint',
    icon: OpenAIIcon,
    fields: [
      { id: 'apiKey', label: 'API Key / Token', type: 'password', placeholder: 'API_KEY' },
      { id: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.example.com/v1' },
    ],
    defaults: { enabled: true },
    authType: 'apiKey',
  },
  {
    key: 'anthropic_oauth',
    name: 'Claude OAuth',
    description: 'Claude Pro/Max via OAuth sign-in',
    icon: ClaudeIcon,
    fields: [],
    defaults: { enabled: true },
    authType: 'oauth',
    oauth: { variant: 'inline-code' },
  },
  {
    key: 'openai_codex',
    name: 'ChatGPT OAuth',
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
    description: 'Copilot models via OAuth device flow',
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

export const PROVIDERS: ProviderDefinition[] = [...API_PROVIDERS, ...EXTRA_PROVIDERS];

export const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((provider) => [provider.key, provider]));
