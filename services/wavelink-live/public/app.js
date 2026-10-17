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
const handledCalls = new Set();

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

async function runToolCall(item) {
  const callId = item.call_id;
  if (!callId || handledCalls.has(callId)) return;
  handledCalls.add(callId);
  const started = performance.now();
  statusCopy.textContent = 'Checking the latest factory data…';
  try {
    const response = await requestJson('/api/tools/factory-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: item.name }),
    });
    showMs('metric-tool', performance.now() - started);
    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(response.result),
      },
    });
    responseStartedAt = performance.now();
    sendEvent({ type: 'response.create' });
  } catch (error) {
    showMs('metric-tool', performance.now() - started);
    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({ ok: false, error: 'Factory summary unavailable. Do not guess.' }),
      },
    });
    responseStartedAt = performance.now();
    sendEvent({ type: 'response.create' });
  }
}

function onDataMessage(message) {
  let event;
  try { event = JSON.parse(message.data); } catch { return; }

  if (event.type === 'session.started' || event.type === 'session.created') {
    setStatus('Listening', 'Ask about today’s production, active work, or factory efficiency.', 'connected');
  }
  if (event.type === 'input_audio_buffer.speech_started') {
    setStatus('Listening to you', 'You can interrupt the assistant at any time.', 'connected');
    orb.classList.remove('speaking');
  }
  if (event.type === 'response.created') {
    if (responseStartedAt != null) {
      showMs('metric-response', performance.now() - responseStartedAt);
      responseStartedAt = null;
    }
    orb.classList.add('speaking');
    setStatus('Responding', 'The live audio path remains active while the assistant speaks.', 'connected');
  }
  if (event.type === 'response.done' || event.type === 'output_audio_buffer.stopped') {
    orb.classList.remove('speaking');
    setStatus('Listening', 'Go ahead — ask another question.', 'connected');
  }
  if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
    addMessage('user', event.transcript);
  }
  if (event.type === 'response.output_audio_transcript.done' && event.transcript) {
    addMessage('assistant', event.transcript);
  }
  if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
    void runToolCall(event.item);
  }
  if (event.type === 'response.function_call_arguments.done') {
    void runToolCall({
      call_id: event.call_id,
      name: event.name,
      arguments: event.arguments,
    });
  }
  if (event.type === 'error') {
    statusCopy.textContent = event.error?.message || 'The voice session reported an error.';
  }
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
      setStatus('Listening', 'Ask: “Give me today’s factory summary.”', 'connected');
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
