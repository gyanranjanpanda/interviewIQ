import axios from "axios";

const DEFAULT_SARVAM_API_URL = "https://api.sarvam.ai/text-to-speech";

// Read env lazily, never at module scope: ES module imports are hoisted above
// dotenv.config(), so a top-level read would always see undefined.
const sarvamUrl = () => process.env.SARVAM_BASE_URL || DEFAULT_SARVAM_API_URL;
const DEFAULT_SARVAM_MODEL = "bulbul:v3";
const sarvamModel = () => process.env.SARVAM_MODEL || DEFAULT_SARVAM_MODEL;

// Maps gender to Sarvam speaker — natural Indian-English voices.
// Speaker names are model-specific and the API rejects unknown ones, so these
// must stay in sync with SARVAM_MODEL above (bulbul:v3).
const SPEAKERS = {
    female: "ritu",
    male: "aditya",
};

/**
 * Convert text to speech using Sarvam AI.
 * Returns base64-encoded WAV audio string.
 */
export const textToSpeech = async (text, gender = "female") => {
    const apiKey = process.env.SARVAM_API_KEY;

    if (!apiKey) {
        throw new Error("Text-to-speech is not configured on the server (SARVAM_API_KEY is missing).");
    }

    const speaker = SPEAKERS[gender] ?? SPEAKERS.female;

    // Sarvam TTS accepts max ~500 chars per input string
    const chunks = splitIntoChunks(text, 450);

    const audioChunks = [];

    for (const chunk of chunks) {
        let response;

        try {
            response = await axios.post(
                sarvamUrl(),
                {
                    inputs: [chunk],
                    target_language_code: "en-IN",
                    speaker,
                    model: sarvamModel(),
                    pace: 1.0,
                    loudness: 1.5,
                    enable_preprocessing: true,
                },
                {
                    headers: {
                        "api-subscription-key": apiKey,
                        "Content-Type": "application/json",
                    },
                    timeout: 30000,
                }
            );
        } catch (error) {
            const status = error.response?.status;
            const detail = error.response?.data?.error?.message
                || error.response?.data?.message
                || error.message;

            console.error("Sarvam TTS error:", status || "", detail);

            if (status === 401 || status === 403) {
                throw new Error("Sarvam rejected the server's API key.");
            }
            if (status === 429) {
                throw new Error("Sarvam rate limit reached. Please try again in a moment.");
            }
            throw new Error(`Sarvam TTS failed: ${detail}`);
        }

        const audio = response.data?.audios?.[0];
        if (audio) {
            audioChunks.push(audio);
        }
    }

    if (audioChunks.length === 0) {
        throw new Error("Sarvam AI returned no audio.");
    }

    // Join every chunk. Returning only the first used to silently cut long
    // questions off mid-sentence.
    return mergeWavBase64(audioChunks);
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
            // A single sentence can still exceed the limit; hard-split it.
            if (sentence.length > maxLength) {
                for (let i = 0; i < sentence.length; i += maxLength) {
                    chunks.push(sentence.slice(i, i + maxLength));
                }
                current = "";
            } else {
                current = sentence;
            }
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

/**
 * Locate a top-level RIFF subchunk (e.g. "fmt ", "data") and return its
 * header offset, or -1. Walking the chunk table is safer than assuming the
 * canonical 44-byte header, since encoders may insert LIST/fact chunks.
 */
function findChunk(buffer, id) {
    let offset = 12; // skip "RIFF" + size + "WAVE"

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === id) return offset;

        // Chunks are word-aligned.
        offset += 8 + chunkSize + (chunkSize % 2);
    }

    return -1;
}

/**
 * Concatenate several base64 WAV files into one.
 *
 * Raw base64 concatenation does not work: every chunk carries its own RIFF
 * header, so players stop at the first one. This keeps the first file's
 * format chunk and splices together the PCM payloads.
 */
function mergeWavBase64(base64Chunks) {
    if (base64Chunks.length === 1) return base64Chunks[0];

    const buffers = base64Chunks.map((b64) => Buffer.from(b64, "base64"));

    const fmtOffset = findChunk(buffers[0], "fmt ");
    if (fmtOffset === -1) {
        // Not a shape we recognise — fall back rather than emit a broken file.
        return base64Chunks[0];
    }

    const fmtSize = buffers[0].readUInt32LE(fmtOffset + 4);
    const fmtChunk = buffers[0].subarray(fmtOffset, fmtOffset + 8 + fmtSize);

    const dataParts = [];
    for (const buf of buffers) {
        const dataOffset = findChunk(buf, "data");
        if (dataOffset === -1) continue;

        const dataSize = buf.readUInt32LE(dataOffset + 4);
        dataParts.push(buf.subarray(dataOffset + 8, dataOffset + 8 + dataSize));
    }

    if (dataParts.length === 0) return base64Chunks[0];

    const pcm = Buffer.concat(dataParts);

    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(4 + fmtChunk.length + 8 + pcm.length, 4);
    header.write("WAVE", 8, "ascii");

    const dataHeader = Buffer.alloc(8);
    dataHeader.write("data", 0, "ascii");
    dataHeader.writeUInt32LE(pcm.length, 4);

    return Buffer.concat([header, fmtChunk, dataHeader, pcm]).toString("base64");
}
