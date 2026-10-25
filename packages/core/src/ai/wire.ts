/**
 * `AiCompletionRequest` over a JSON channel (VS Code `postMessage`, Tauri
 * `invoke`): image bytes travel as base64, the same way `savePastedImage`
 * sends pasted images.
 */

import { base64ToBytes, bytesToBase64 } from './requests';
import type { AiCompletionRequest, AiMessage } from './types';

export type AiWireMessagePart = { type: 'text'; text: string } | { type: 'image'; mime: string; dataBase64: string };

export interface AiWireMessage {
  role: AiMessage['role'];
  content: string | AiWireMessagePart[];
}

export type AiWireCompletionRequest = Omit<AiCompletionRequest, 'messages'> & { messages: AiWireMessage[] };

export function toWireCompletionRequest(req: AiCompletionRequest): AiWireCompletionRequest {
  return {
    ...req,
    messages: req.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p): AiWireMessagePart => (p.type === 'text' ? p : { type: 'image', mime: p.mime, dataBase64: bytesToBase64(p.bytes) })),
    })),
  };
}

export function fromWireCompletionRequest(wire: AiWireCompletionRequest): AiCompletionRequest {
  return {
    ...wire,
    messages: wire.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => (p.type === 'text' ? p : { type: 'image' as const, mime: p.mime, bytes: base64ToBytes(p.dataBase64) })),
    })),
  };
}
