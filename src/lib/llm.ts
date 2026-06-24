import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * Abstração de LLM (PRD §8.6). Provider via env LLM_PROVIDER ("anthropic" default
 * | "gemini"). Roda SÓ no servidor — chaves nunca vão ao browser.
 * Expõe completeJson: pede JSON estrito e devolve o objeto parseado.
 */

export type LlmProvider = "anthropic" | "gemini";

function provider(): LlmProvider {
  return (process.env.LLM_PROVIDER as LlmProvider) === "gemini"
    ? "gemini"
    : "anthropic";
}

export function llmConfigured(): boolean {
  return provider() === "gemini"
    ? !!process.env.GEMINI_API_KEY
    : !!process.env.ANTHROPIC_API_KEY;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return text.trim();
}

async function completeAnthropic(system: string, user: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

async function completeGemini(system: string, user: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    contents: `${user}`,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
    },
  });
  return (res.text ?? "").trim();
}

/** Completa pedindo JSON e devolve parseado. Lança em caso de JSON inválido. */
export async function completeJson<T>(args: {
  system: string;
  user: string;
}): Promise<T> {
  const { system, user } = args;
  const raw =
    provider() === "gemini"
      ? await completeGemini(system, user)
      : await completeAnthropic(system, user);
  try {
    return JSON.parse(extractJson(raw)) as T;
  } catch {
    throw new Error("LLM retornou JSON inválido.");
  }
}
