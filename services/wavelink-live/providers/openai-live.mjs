const LIVE_SESSIONS_URL = 'https://api.openai.com/v1/live/sessions';

export async function createAnswer({ sdp, instructions, env = process.env }) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Voice provider is not configured');
    error.statusCode = 503;
    throw error;
  }

  // GPT-Live unified WebRTC setup: SDP + session configuration stay server-side.
  const response = await fetch(LIVE_SESSIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        model: env.LIVE_VOICE_MODEL || 'gpt-live-1',
        instructions,
        delegation: { type: 'client' },
        audio: { output: { voice: env.LIVE_VOICE_NAME || 'marin' } },
        store: false,
      },
      transport: { type: 'webrtc', sdp },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const error = new Error('Voice session initialization failed');
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }

  const payload = await response.json();
  const answer = payload?.transport?.sdp;
  const sessionId = payload?.session?.id;
  if (typeof answer !== 'string' || !answer.trim() || typeof sessionId !== 'string') {
    const error = new Error('Voice provider returned an invalid session answer');
    error.statusCode = 502;
    throw error;
  }

  return { sdp: answer, sessionId };
}
