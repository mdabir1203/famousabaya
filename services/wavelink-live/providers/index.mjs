import { createAnswer as createOpenAILiveAnswer } from './openai-live.mjs';

/**
 * Provider-neutral session adapter contract:
 * createAnswer({ sdp, instructions, env }) -> { sdp, sessionId }
 * New providers must implement this exact interface and must never receive
 * application secrets other than their own provider credentials.
 */
export function getVoiceProvider(name = process.env.LIVE_VOICE_PROVIDER || 'openai-live') {
  if (name === 'openai-live') {
    return { name, createAnswer: createOpenAILiveAnswer };
  }
  const error = new Error('Configured voice provider adapter is not available');
  error.statusCode = 503;
  throw error;
}
