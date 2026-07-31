import axios from "axios"

export const askAi = async (messages) => {
    try {
        if(!messages || !Array.isArray(messages) || messages.length === 0) {
            throw new Error("Messages array is empty.");
        }
        const apiKey = process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY;
        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: messages

            },
            {
            headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },});

        const content = response?.data?.choices?.[0]?.message?.content;

        if (!content || !content.trim()) {
      throw new Error("AI returned empty response.");
    }

    return content
    } catch (error) {
            console.error("Groq API Error:", error.response?.data || error.message);
    throw new Error("Groq API Error");

    }
}