import ollama from "ollama";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEFAULT_MAX_OUTPUT_TOKENS = 900;
// A 429 from Groq is a quota state, not a transient network failure. Retrying
// every career listing multiplies the delay and keeps the dashboard request
// pending even though the deterministic fallback matcher is available.
const DEFAULT_RETRY_ATTEMPTS = 0;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
let groqRateLimitedUntil = 0;

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

function createOllamaProvider(modelOverride) {
  return {
    name: "ollama",
    model: modelOverride || process.env.OLLAMA_MODEL || "qwen2.5:3b",
    async generateText({ system, user, jsonSchema }) {
      try {
        const response = await ollama.chat({
          model: modelOverride || process.env.OLLAMA_MODEL || "qwen2.5:3b",
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

function createGroqProvider(modelOverride) {
  return {
    name: "groq",
    model: modelOverride || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
    async generateText({ system, user, jsonSchema }) {
      if (!process.env.GROQ_API_KEY) throw new AIProviderError("GROQ_API_KEY is not configured.", { code: "AI_NOT_CONFIGURED" });
      if (Date.now() < groqRateLimitedUntil) {
        throw new AIProviderError("Groq rate limit is active; using the local fallback matcher.", { code: "AI_RATE_LIMITED", retryable: false });
      }
      const model = modelOverride || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
      const configuredRetries = process.env.AI_RETRY_ATTEMPTS;
      const retries = Math.max(0, Math.min(configuredRetries === undefined ? DEFAULT_RETRY_ATTEMPTS : Number(configuredRetries) || 0, 3));
      const maxOutputTokens = Math.max(256, Math.min(Number(process.env.AI_MAX_OUTPUT_TOKENS) || DEFAULT_MAX_OUTPUT_TOKENS, 1500));

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
        try {
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              temperature: 0.1,
              max_tokens: maxOutputTokens,
              messages: [{ role: "system", content: system }, { role: "user", content: user }],
              ...(jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "job_match_result", strict: true, schema: jsonSchema } } } : {}),
            }),
          });
          if (response.ok) {
            const data = await response.json();
            return data.choices?.[0]?.message?.content || "";
          }

          const detail = await response.text();
          if (response.status === 429) {
            const retryAfterHeader = Number(response.headers.get("retry-after"));
            const retryAfterMessage = Number(detail.match(/try again in ([0-9.]+)s/i)?.[1]);
            const cooldownMs = Math.min(
              10 * 60_000,
              Math.max(30_000, Math.ceil((retryAfterHeader || retryAfterMessage || DEFAULT_RATE_LIMIT_COOLDOWN_MS / 1000) * 1000)),
            );
            groqRateLimitedUntil = Date.now() + cooldownMs;
            console.warn(`Groq rate limit reached; disabling Groq calls for ${Math.ceil(cooldownMs / 60_000)} minute(s) and using fallback matching.`);
          }

          const message = response.status === 404
            ? `Groq model "${model}" was not found. Set GROQ_MODEL to a currently available model.`
            : `Groq request failed (${response.status}).`;
          console.error("Groq request failed:", { status: response.status, model, detail: detail.slice(0, 500) });
          throw new AIProviderError(message, { code: response.status === 429 ? "AI_RATE_LIMITED" : "AI_REQUEST_FAILED", retryable: response.status === 429 || response.status >= 500, cause: detail });
        } catch (error) {
          if (error instanceof AIProviderError) throw error;
          throw new AIProviderError("The hosted AI provider is unavailable.", { code: "AI_UNAVAILABLE", retryable: true, cause: error });
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new AIProviderError("The hosted AI provider rate limit was reached.", { code: "AI_RATE_LIMITED", retryable: true });
    },
  };
}

export function createAIProvider({ model } = {}) {
  return (process.env.AI_PROVIDER || "ollama").toLowerCase() === "groq" ? createGroqProvider(model) : createOllamaProvider(model);
}

export async function generateStructured(input, schema, transform = (value) => value) {
  const provider = createAIProvider({ model: input.model });
  const text = await provider.generateText(input);
  return { provider: provider.name, result: schema.parse(transform(parseJson(text))) };
}
