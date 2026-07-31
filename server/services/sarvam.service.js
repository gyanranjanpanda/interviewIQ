import axios from "axios";

const SARVAM_API_URL = "https://api.sarvam.ai/text-to-speech";
const SARVAM_MODEL = "bulbul:v2";

// Maps gender to Sarvam speaker — natural Indian-English voices
const SPEAKERS = {
    female: "anushka",
    male: "aditya",
};

/**
 * Convert text to speech using Sarvam AI.
 * Returns base64-encoded WAV audio string.
 */
export const textToSpeech = async (text, gender = "female") => {
    const speaker = SPEAKERS[gender] ?? SPEAKERS.female;

    // Sarvam TTS accepts max ~500 chars per input string
    const chunks = splitIntoChunks(text, 450);

    const audioChunks = [];

    for (const chunk of chunks) {
        const response = await axios.post(
            SARVAM_API_URL,
            {
                inputs: [chunk],
                target_language_code: "en-IN",
                speaker,
                model: SARVAM_MODEL,
                pace: 1.0,
                loudness: 1.5,
                enable_preprocessing: true,
            },
            {
                headers: {
                    "api-subscription-key": process.env.SARVAM_API_KEY,
                    "Content-Type": "application/json",
                },
            }
        );

        const audio = response.data?.audios?.[0];
        if (audio) {
            audioChunks.push(audio);
        }
    }

    if (audioChunks.length === 0) {
        throw new Error("Sarvam AI returned no audio.");
    }

    // Return first chunk (single chunk for most questions)
    return audioChunks[0];
};

/**
 * Split long text into chunks so Sarvam doesn't reject oversized inputs.
 */
function splitIntoChunks(text, maxLength) {
    if (text.length <= maxLength) return [text];

    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let current = "";

    for (const sentence of sentences) {
        if ((current + " " + sentence).trim().length <= maxLength) {
            current = (current + " " + sentence).trim();
        } else {
            if (current) chunks.push(current);
            current = sentence;
        }
    }

    if (current) chunks.push(current);
    return chunks;
}
