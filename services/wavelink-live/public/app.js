const $ = (id) => document.getElementById(id);
const loginPanel = $('login-panel');
const voicePanel = $('voice-panel');
const loginForm = $('login-form');
const loginError = $('login-error');
const transcript = $('transcript');
const startButton = $('start-button');
const stopButton = $('stop-button');
const statusTitle = $('status-title');
const statusCopy = $('status-copy');
const connectionPill = $('connection-pill');
const orb = $('voice-orb');
const remoteAudio = $('remote-audio');

let pc = null;
let dataChannel = null;
let localStream = null;
let responseStartedAt = null;
let toolStartedAt = null;
const activeDelegations = new Set();

function setStatus(title, copy, state = 'disconnected') {
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
  connectionPill.textContent = state.toUpperCase();
  connectionPill.classList.toggle('live', state === 'connected');
  orb.classList.toggle('active', state === 'connecting' || state === 'connected');
  if (state !== 'connected') orb.classList.remove('speaking');
}

function addMessage(role, text) {
  const empty = transcript.querySelector('.empty-state');
  if (empty) empty.remove();
  const node = document.createElement('div');
  node.className = `message ${role}`;
  const speaker = document.createElement('span');
  speaker.className = 'speaker';
  speaker.textContent = role === 'user' ? 'YOU' : 'WAVELINK LIVE';
  const content = document.createElement('span');
  content.textContent = String(text || '');
  node.append(speaker, content);
  transcript.append(node);
  transcript.scrollTop = transcript.scrollHeight;
}

function showMs(id, value) {
  $(id).textContent = Number.isFinite(value) ? `${Math.max(0, Math.round(value))} ms` : '—';
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function refreshAuth() {
  const status = await requestJson('/api/auth/status');
  loginPanel.hidden = status.authenticated;
  voicePanel.hidden = !status.authenticated;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await requestJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('password').value }),
    });
    $('password').value = '';
    await refreshAuth();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

$('logout-button').addEventListener('click', async () => {
  await stopSession();
  try { await requestJson('/api/auth/logout', { method: 'POST' }); } catch {}
  await refreshAuth();
});

function waitForIceGathering(peer, timeoutMs = 2500) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (peer.iceGatheringState === 'complete') {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', done);
      resolve();
    }, timeoutMs);
    peer.addEventListener('icegatheringstatechange', done);
  });
}

function sendEvent(event) {
  if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify(event));
}

async function runDelegation(event) {
  const delegationId = event.delegation?.id;
  if (!delegationId || activeDelegations.has(delegationId)) return;
  activeDelegations.add(delegationId);
  const started = performance.now();
  toolStartedAt = started;
  setStatus('Checking factory data', 'The voice connection stays live while the read-only lookup runs.', 'connected');

  try {
    const response = await requestJson('/api/tools/factory-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'get_factory_summary' }),
    });
    showMs('metric-tool', performance.now() - started);
    const r = response.result;
    const spoken = [
      `Verified AbayaTrack factory summary for ${r.factory_day || 'the current factory day'}.`,
      r.completed_today == null ? 'Completed units are unavailable.' : `${r.completed_today} units completed today.`,
      r.active_workers == null ? 'Active worker count is unavailable.' : `${r.active_workers} workers currently active.`,
      r.efficiency_today_pct == null ? 'Efficiency is unavailable.' : `Efficiency is ${r.efficiency_today_pct} percent.`,
      r.data_as_of ? `Data timestamp: ${r.data_as_of}.` : 'The source did not provide a data timestamp.',
      r.ingest_lag_ms != null && r.ingest_lag_ms > 300000 ? 'Warning: the source data may be stale.' : '',
    ].filter(Boolean).join(' ');
    responseStartedAt = performance.now();
    sendEvent({
      type: 'session.commentary.append',
      event_id: `factory-summary-${crypto.randomUUID()}`,
      delegation_id: delegationId,
      content: spoken,
    });
    setStatus('Factory summary ready', 'The verified read-only result has been returned to the voice assistant.', 'connected');
  } catch {
    showMs('metric-tool', performance.now() - started);
    responseStartedAt = performance.now();
    sendEvent({
      type: 'session.commentary.append',
      event_id: `factory-summary-error-${crypto.randomUUID()}`,
      delegation_id: delegationId,
      content: 'The factory summary could not be retrieved. Tell the user the data is unavailable and do not guess.',
    });
    setStatus('Data unavailable', 'No factory facts were invented or substituted.', 'connected');
  }
}

function onDataMessage(message) {
  let event;
  try { event = JSON.parse(message.data); } catch { return; }

  if (event.type === 'session.started') {
    setStatus('Listening', 'Ask: “Give me today’s factory summary.”', 'connected');
  }
  if (event.type === 'session.input_transcript.delta' && event.delta) {
    // Render deltas as temporary text only; no transcript is persisted.
    addTranscriptDelta('user', event.delta);
  }
  if (event.type === 'session.output_transcript.delta' && event.delta) {
    addTranscriptDelta('assistant', event.delta);
  }
  if (event.type === 'session.input_transcript.done' && event.transcript) {
    finalizeTranscript('user', event.transcript);
  }
  if (event.type === 'session.output_transcript.done' && event.transcript) {
    finalizeTranscript('assistant', event.transcript);
  }
  if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
    void runDelegation(event);
  }
  if (event.type === 'response.event' && event.event?.type === 'response.created') {
    if (responseStartedAt != null) {
      showMs('metric-response', performance.now() - responseStartedAt);
      responseStartedAt = null;
    }
  }
  if (event.type === 'session.output_audio.started') {
    if (responseStartedAt != null) {
      showMs('metric-response', performance.now() - responseStartedAt);
      responseStartedAt = null;
    }
    orb.classList.add('speaking');
    setStatus('Responding', 'You can interrupt the assistant at any time.', 'connected');
  }
  if (event.type === 'session.output_audio.stopped' || event.type === 'session.output_audio.done') {
    orb.classList.remove('speaking');
    setStatus('Listening', 'Go ahead — ask another question.', 'connected');
  }
  if (event.type === 'session.closed') {
    setStatus('Session closed', 'Start a new conversation when you are ready.', 'disconnected');
  }
  if (event.type === 'error') statusCopy.textContent = event.error?.message || 'The voice session reported an error.';
}

let transcriptDraft = { user: '', assistant: '' };
let transcriptNodes = { user: null, assistant: null };
function addTranscriptDelta(role, delta) {
  if (!transcriptNodes[role]) {
    const empty = transcript.querySelector('.empty-state');
    if (empty) empty.remove();
    const node = document.createElement('div');
    node.className = `message ${role}`;
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    speaker.textContent = role === 'user' ? 'YOU' : 'WAVELINK LIVE';
    const content = document.createElement('span');
    content.className = 'message-content';
    node.append(speaker, content);
    transcript.append(node);
    transcriptNodes[role] = content;
  }
  transcriptDraft[role] += delta;
  transcriptNodes[role].textContent = transcriptDraft[role];
  transcript.scrollTop = transcript.scrollHeight;
}
function finalizeTranscript(role, text) {
  if (transcriptNodes[role]) transcriptNodes[role].textContent = text;
  else addMessage(role, text);
  transcriptDraft[role] = '';
  transcriptNodes[role] = null;
}

async function startSession() {
  startButton.disabled = true;
  setStatus('Connecting…', 'Requesting microphone access and opening the live media path.', 'connecting');
  const startedAt = performance.now();
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    pc = new RTCPeerConnection();
    pc.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      void remoteAudio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected') {
        setStatus('Connection interrupted', 'Try ending the session and reconnecting.', 'disconnected');
      }
    };
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    dataChannel = pc.createDataChannel('oai-events');
    dataChannel.addEventListener('message', onDataMessage);
    dataChannel.addEventListener('open', () => {
      showMs('metric-start', performance.now() - startedAt);
      setStatus('Connected', 'Waiting for the live session to become ready…', 'connected');
      stopButton.disabled = false;
    });
    dataChannel.addEventListener('close', () => {
      if (pc) setStatus('Session closed', 'Start a new conversation when you are ready.', 'disconnected');
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    const response = await fetch('/api/live/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription.sdp,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Unable to create live session');
    await pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
  } catch (error) {
    await stopSession();
    setStatus('Could not start', error.message || 'Check microphone permissions and server configuration.', 'disconnected');
    startButton.disabled = false;
  }
}

async function stopSession() {
  startButton.disabled = false;
  stopButton.disabled = true;
  try { if (dataChannel?.readyState === 'open') sendEvent({ type: 'session.close' }); } catch {}
  try { dataChannel?.close(); } catch {}
  try { pc?.close(); } catch {}
  try { localStream?.getTracks().forEach((track) => track.stop()); } catch {}
  dataChannel = null;
  pc = null;
  localStream = null;
  remoteAudio.srcObject = null;
  orb.classList.remove('active', 'speaking');
  connectionPill.classList.remove('live');
  connectionPill.textContent = 'DISCONNECTED';
  transcriptDraft = { user: '', assistant: '' };
  transcriptNodes = { user: null, assistant: null };
  if (statusTitle.textContent !== 'Could not start') setStatus('Ready when you are', 'Start a session and ask about today’s production.', 'disconnected');
}

startButton.addEventListener('click', () => void startSession());
stopButton.addEventListener('click', () => void stopSession());

if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
  startButton.disabled = true;
  statusCopy.textContent = 'This browser does not support the required WebRTC microphone features.';
}

refreshAuth().catch(() => {
  loginPanel.hidden = false;
  voicePanel.hidden = true;
  loginError.textContent = 'Cannot reach the Wavelink Live server.';
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
