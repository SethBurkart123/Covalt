import type { ComponentType } from 'react';

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

type ProviderIcon = ComponentType<{ size?: number; className?: string }>;

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ICON_MAP: Record<string, ProviderIcon> = {
  abacus: AbacusIcon,
  aihubmix: AIHubMixIcon,
  alibaba: AlibabaIcon,
  alibabacn: AlibabaIcon,
  anthropic: ClaudeIcon,
  amazonbedrock: AwsBedrockIcon,
  awsbedrock: AwsBedrockIcon,
  azure: AzureIcon,
  azurecognitiveservices: AzureCognitiveServicesIcon,
  baseten: BasetenIcon,
  berget: BergetIcon,
  cerebras: CerebrasIcon,
  chutes: ChutesIcon,
  claude: ClaudeIcon,
  cloudferro: CloudFerroIcon,
  cloudferrosherlock: CloudFerroIcon,
  cloudflare: CloudflareIcon,
  cloudflareaigateway: CloudflareIcon,
  cloudflareworkersai: CloudflareIcon,
  cohere: CohereIcon,
  cortecs: CortecsIcon,
  deepinfra: DeepInfraIcon,
  deepseek: DeepSeekIcon,
  evroc: EvrocIcon,
  fastrouter: FastRouterIcon,
  fireworksai: FireworksAIIcon,
  firmware: FirmwareIcon,
  friendli: FriendliIcon,
  gemini: GeminiIcon,
  googlegeminicli: GeminiCliIcon,
  github: GitHubIcon,
  githubcopilot: GitHubCopilotIcon,
  githubcopilotapi: GitHubCopilotIcon,
  githubmodels: GitHubIcon,
  gitlab: GitLabIcon,
  groq: GroqIcon,
  helicone: HeliconeIcon,
  huggingface: HuggingFaceIcon,
  iflowcn: IFlowCNIcon,
  google: GeminiIcon,
  inference: OpenAIIcon,
  inception: InceptionIcon,
  ionet: IONetIcon,
  jiekou: JieKouIcon,
  kilo: KiloIcon,
  kimi: KimiIcon,
  lmstudio: LMStudioIcon,
  llama: LlamaIcon,
  lucidquery: LucidQueryIcon,
  meganova: MeganovaIcon,
  minimax: MiniMaxIcon,
  mistral: MistralIcon,
  moark: MoarkIcon,
  modelscope: ModelScopeIcon,
  moonshot: MoonshotIcon,
  moonshotai: MoonshotIcon,
  moonshotaicn: MoonshotIcon,
  morph: MorphIcon,
  nanogpt: NanoGPTIcon,
  nebius: NebiusIcon,
  nova: NovaIcon,
  novita: NovitaIcon,
  novitaai: NovitaIcon,
  ollama: OllamaIcon,
  ollamacloud: OllamaIcon,
  openai: OpenAIIcon,
  openrouter: OpenRouterIcon,
  opencode: OpencodeIcon,
  ovhcloud: OvhCloudIcon,
  p302ai: P302AIIcon,
  '302ai': P302AIIcon,
  perplexity: PerplexityIcon,
  poe: PoeIcon,
  privatemodeai: PrivateModeAIIcon,
  qihangai: OpenAIIcon,
  qiniuai: OpenAIIcon,
  kuaecloudcodingplan: OpenAIIcon,
  bailing: OpenAIIcon,
  nvidia: OpenAIIcon,
  requesty: RequestyIcon,
  sapaicore: OpenAIIcon,
  scaleway: ScalewayIcon,
  siliconflow: SiliconFlowIcon,
  siliconflowcn: SiliconFlowIcon,
  stackit: StackitIcon,
  stepfun: StepFunIcon,
  submodel: SubmodelIcon,
  synthetic: SyntheticIcon,
  togetherai: TogetherAIIcon,
  upstage: UpstageAIIcon,
  v0: V0Icon,
  venice: VeniceIcon,
  vercel: VercelIcon,
  vertexai: VertexAIIcon,
  vivgrid: VivgridIcon,
  vllm: VLLMIcon,
  vultr: VultrIcon,
  wandb: WandBIcon,
  xai: XAIIcon,
  xiaomi: XiaomiIcon,
  zai: ZAIIcon,
  zaicodingplan: ZAIIcon,
  zhipuai: ZhipuAIIcon,
  zhipuaicodingplan: ZhipuAIIcon,
  zenmux: OpenAIIcon,
};

export const getProviderIcon = (iconKey?: string | null): ProviderIcon => {
  if (!iconKey) return OpenAIIcon;
  return ICON_MAP[normalize(iconKey)] || OpenAIIcon;
};
