import axios from "axios"

const DEFAULT_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
const DEFAULT_MODEL = "llama-3.3-70b-versatile"

// Read env lazily, never at module scope: ES module imports are hoisted above
// dotenv.config() in index.js, so top-level reads would always see undefined.
const groqUrl = () => process.env.GROQ_BASE_URL || DEFAULT_GROQ_URL
const groqModel = () => process.env.GROQ_MODEL || DEFAULT_MODEL

/**
 * Calls Groq's chat completions endpoint.
 * Pass { json: true } to force a JSON-object response so callers can parse safely.
 */
export const askAi = async (messages, options = {}) => {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new Error("Messages array is empty.")
    }

    const apiKey = process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY
    if (!apiKey) {
        throw new Error("AI is not configured on the server (GROQ_API_KEY is missing).")
    }

    const body = {
        model: groqModel(),
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 1200,
    }

    // Groq supports OpenAI-style JSON mode. This stops the model from wrapping
    // its answer in ```json fences, which used to break JSON.parse downstream.
    if (options.json) {
        body.response_format = { type: "json_object" }
    }

    try {
        const response = await axios.post(groqUrl(), body, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: options.timeout ?? 60000,
        })

        const content = response?.data?.choices?.[0]?.message?.content

        if (!content || !content.trim()) {
            throw new Error("AI returned an empty response.")
        }

        return content
    } catch (error) {
        const upstream = error.response?.data?.error?.message
            || error.response?.data?.message
            || error.message

        console.error("Groq API Error:", error.response?.status || "", upstream)

        if (error.response?.status === 401) {
            throw new Error("AI rejected the server's API key.")
        }
        if (error.response?.status === 429) {
            throw new Error("AI rate limit reached. Please try again in a moment.")
        }
        throw new Error(`AI request failed: ${upstream}`)
    }
}
