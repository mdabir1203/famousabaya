const OPENAI_LIVE_URL = 'https://api.openai.com/v1/live/sessions';

export async function createAnswer({ sdp, instructions, tools, env = process.env }) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Voice provider is not configured');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(OPENAI_LIVE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        model: env.LIVE_VOICE_MODEL || 'gpt-live-1',
        instructions,
        tools,
        tool_choice: 'auto',
      },
      transport: { type: 'webrtc', sdp },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    // Never relay provider response bodies: they may contain internal details.
    const error = new Error('Voice session initialization failed');
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }

  const payload = await response.json();
  const answer = payload?.transport?.sdp;
  if (typeof answer !== 'string' || !answer.trim()) {
    const error = new Error('Voice provider returned an invalid session answer');
    error.statusCode = 502;
    throw error;
  }

  return {
    sdp: answer,
    sessionId: typeof payload?.session?.id === 'string' ? payload.session.id : null,
  };
}
