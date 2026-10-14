import ollama from "ollama";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

export class AIProviderError extends Error {
  constructor(message, { code = "AI_PROVIDER_ERROR", retryable = false } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

const parseJson = (text) => {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
    return JSON.parse(candidate);
  } catch {
    throw new AIProviderError("The AI provider returned invalid JSON.", { code: "INVALID_AI_RESPONSE" });
  }
};

function createOllamaProvider() {
  return {
    name: "ollama",
    async generateText({ system, user, jsonSchema }) {
      try {
        const response = await ollama.chat({
          model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(jsonSchema ? { format: jsonSchema } : {}),
        });
        return response.message?.content || "";
      } catch (error) {
        throw new AIProviderError("The local AI provider is unavailable.", { code: "AI_UNAVAILABLE", retryable: true, cause: error });
      }
    },
  };
}

function createGroqProvider() {
  return {
    name: "groq",
    async generateText({ system, user, jsonSchema }) {
      if (!process.env.GROQ_API_KEY) throw new AIProviderError("GROQ_API_KEY is not configured.", { code: "AI_NOT_CONFIGURED" });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
      const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0.1,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            ...(jsonSchema ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "job_match_result",
                  strict: true,
                  schema: jsonSchema,
                },
              },
            } : {}),
          }),
        });
        if (!response.ok) {
          const detail = await response.text();
          const message = response.status === 404
            ? `Groq model "${model}" was not found. Set GROQ_MODEL to a currently available model.`
            : `Groq request failed (${response.status}).`;
          console.error("Groq request failed:", { status: response.status, model, detail: detail.slice(0, 500) });
          throw new AIProviderError(message, { code: response.status === 429 ? "AI_RATE_LIMITED" : "AI_REQUEST_FAILED", retryable: response.status === 429 || response.status >= 500, cause: detail });
        }
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        throw new AIProviderError("The hosted AI provider is unavailable.", { code: "AI_UNAVAILABLE", retryable: true, cause: error });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createAIProvider() {
  return (process.env.AI_PROVIDER || "ollama").toLowerCase() === "groq" ? createGroqProvider() : createOllamaProvider();
}

export async function generateStructured(input, schema, transform = (value) => value) {
  const provider = createAIProvider();
  const text = await provider.generateText(input);
  return { provider: provider.name, result: schema.parse(transform(parseJson(text))) };
}
