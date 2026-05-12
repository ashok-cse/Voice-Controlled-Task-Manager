import Groq from 'groq-sdk';

if (!process.env.GROQ_API_KEY) {
  console.warn('[groq] GROQ_API_KEY is not set — LLM / STT / TTS calls will fail.');
}

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? '' });

export const MODELS = {
  llm: process.env.GROQ_LLM_MODEL ?? 'llama-3.3-70b-versatile',
  stt: process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo',
  tts: process.env.GROQ_TTS_MODEL ?? 'canopylabs/orpheus-v1-english',
  ttsVoice: process.env.GROQ_TTS_VOICE ?? 'hannah'
};
