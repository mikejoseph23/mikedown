/**
 * "Add engine" presets. A preset only fills the new engine's name, kind, base
 * URL and key variable; everything else is the user's.
 */

import type { AiEngineKind } from './types';

export interface AiEnginePreset {
  id: string;
  name: string;
  kind: AiEngineKind;
  baseUrl: string;
  apiKeyEnv?: string;
  /** Whether the endpoint expects a key at all (LM Studio accepts any). */
  needsKey: boolean;
}

export const AI_ENGINE_PRESETS: readonly AiEnginePreset[] = [
  { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'OMLX_API_KEY', needsKey: true },
  { id: 'lmstudio', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false },
  { id: 'ollama', name: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false },
  { id: 'llamacpp', name: 'llama.cpp server', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', needsKey: false },
  { id: 'vllm', name: 'vLLM', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'VLLM_API_KEY', needsKey: false },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', needsKey: true },
  { id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', needsKey: true },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    needsKey: true,
  },
  { id: 'mistral', name: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY', needsKey: true },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', needsKey: true },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', needsKey: true },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', needsKey: true },
  { id: 'custom', name: 'Custom OpenAI-compatible', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', needsKey: false },
];
