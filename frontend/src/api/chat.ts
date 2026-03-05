import client from "./client";
import type { ChatSession, ChatMessage } from "../types";

export const getChatSessions = () =>
  client.get<ChatSession[]>("/api/chat/sessions").then((r) => r.data);

export const getChatMessages = (sessionId: string) =>
  client.get<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`).then((r) => r.data);

export const deleteChatSession = (sessionId: string) =>
  client.delete(`/api/chat/sessions/${sessionId}`);

const API_BASE = import.meta.env.VITE_API_URL || "";

export function streamChatMessage(data: {
  message: string;
  session_id?: string;
  course_id?: string;
  knowledge_mode: string;
}): EventSource {
  // Use fetch-based SSE via POST — EventSource only supports GET
  // We return a custom object that mimics EventSource using fetch
  throw new Error("Use streamChatMessageFetch instead");
}

export async function* streamChatMessageFetch(data: {
  message: string;
  session_id?: string;
  course_id?: string;
  knowledge_mode: string;
}): AsyncGenerator<string> {
  const baseURL = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseURL}/api/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    // Parse SSE format: "data: ...\n\n"
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const chunk = line.slice(6);
        if (chunk !== "[DONE]") {
          yield chunk;
        }
      }
    }
  }
}
