const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const state = {
  context: null,
  sourceBus: null,
  inputStreams: new Map(),
  inputDevices: [],
  outputDevices: [],
  effects: { clean: false, reverb: true, delay: false },
  nodes: {},
  cdg: null,
  cdgTimer: null,
  cdgRenderedPackets: 0,
  songSource: null,
  microphoneReady: false,
  feedbackProtection: false,
  outputMuted: false,
};

const inputList = $("#inputList");
const songAudio = $("#songAudio");
const toast = $("#toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function makeImpulse(context, seconds = 1.4, decay = 2.7) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return impulse;
}

function createAudioGraph() {
  const context = new AudioContext({ latencyHint: "interactive" });
  const sourceBus = context.createGain();
  sourceBus.gain.value = 1;
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 100;
  highpass.Q.value = .7;
  const dry = context.createGain();
  const convolver = context.createConvolver();
  convolver.buffer = makeImpulse(context);
  const reverbGain = context.createGain();
  reverbGain.gain.value = 0;
  const delay = context.createDelay(.5);
  delay.delayTime.value = .115;
  const delayGain = context.createGain();
  delayGain.gain.value = 0;
  const feedback = context.createGain();
  feedback.gain.value = .16;
  const outputBus = context.createGain();
  outputBus.gain.value = state.outputMuted ? 0 : Number($("#outputGain").value) / 100;

  sourceBus.connect(highpass);
  highpass.connect(dry).connect(outputBus);
  highpass.connect(convolver).connect(reverbGain).connect(outputBus);
  highpass.connect(delay).connect(delayGain).connect(outputBus);
  delay.connect(feedback).connect(delay);
  outputBus.connect(context.destination);
  songAudio.volume = 1;
  const songSource = context.createMediaElementSource(songAudio);
  songSource.connect(outputBus);

  state.context = context;
  state.sourceBus = sourceBus;
  state.songSource = songSource;
  state.nodes = { sourceBus, highpass, dry, convolver, reverbGain, delay, delayGain, feedback, outputBus };
  syncEffectUi();
  updateEffectGraph();
}

function updateEffectGraph() {
  if (!state.context) return;
  const { highpass, reverbGain, delayGain } = state.nodes;
  highpass.frequency.value = state.effects.clean ? 100 : 20;
  reverbGain.gain.value = state.effects.reverb ? .1 : 0;
  delayGain.gain.value = state.effects.delay ? .1 : 0;
}

function syncEffectUi() {
  $$('.effect-card').forEach(card => {
    const name = card.dataset.effect;
    const enabled = state.effects[name];
    card.classList.toggle("active", enabled);
    $(".effect-toggle", card).setAttribute("aria-pressed", enabled);
    $(".effect-state", card).textContent = enabled ? "ON" : "OFF";
  });
  $("#allEffects").checked = Object.values(state.effects).every(Boolean);
}

async function startAudio() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Microphone access is not supported in this browser.");
    await updatePermissionStatuses();
    return false;
  }
  try {
    if (!state.context) createAudioGraph();
    await state.context.resume();
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false });
    permissionStream.getTracks().forEach(track => track.stop());
    state.microphoneReady = true;
    await refreshDevices();
    $("#engineStatus").textContent = "Audio live";
    $(".live-pill").classList.add("live");
    $("#latencyValue").textContent = `${Math.round((state.context.baseLatency + (state.context.outputLatency || 0)) * 1000)} ms`;
    $(".latency").classList.add("ready");
    await updatePermissionStatuses();
    return true;
  } catch (error) {
    showToast(error.name === "NotAllowedError" ? "Allow microphone access to start the studio." : "Could not start audio. Check your device settings.");
    await updatePermissionStatuses();
    return false;
  }
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.inputDevices = devices.filter(d => d.kind === "audioinput");
  state.outputDevices = devices.filter(d => d.kind === "audiooutput");
}

function deviceOptions(type, selected = "default") {
  const devices = type === "input" ? state.inputDevices : state.outputDevices;
  if (!devices.length) return `<option value="default">System default</option>`;
  return devices.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === selected ? "selected" : ""}>${d.label || `${type === "input" ? "Microphone" : "Speaker"} ${i + 1}`}</option>`).join("");
}

function updateDeviceCounters() {
  const ic = inputList.children.length;
  $("#addInput b").textContent = `${ic} / 2`;
  $("#addInput").disabled = ic >= 2;
}

function microphoneConstraints(deviceId) {
  return {
    deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
    echoCancellation: state.feedbackProtection,
    noiseSuppression: state.feedbackProtection,
    autoGainControl: state.feedbackProtection,
    latency: 0,
  };
}

function buildDeviceRow(type) {
  const row = document.createElement("div");
  row.className = "device-row";
  row.innerHTML = `<select aria-label="Select ${type} device">${deviceOptions(type)}</select><button aria-label="Remove ${type} device">×</button>${type === "input" ? `<div class="level">${"<i></i>".repeat(12)}</div><label class="mic-volume"><span>MIC VOLUME</span><input type="range" min="0" max="150" value="100" aria-label="Microphone volume"><output>100%</output></label>` : ""}`;
  row.querySelector("select").addEventListener("change", () => connectInput(row));
  row.querySelector("button").addEventListener("click", () => removeDeviceRow(row));
  const volume = row.querySelector(".mic-volume input");
  volume?.addEventListener("input", () => {
    const value = Number(volume.value);
    row.querySelector(".mic-volume output").value = `${value}%`;
    const entry = state.inputStreams.get(row);
    if (entry?.gain) entry.gain.gain.setTargetAtTime(value / 100, state.context.currentTime, .01);
  });
  return row;
}

async function addInputRow() {
  if (!state.context || !state.microphoneReady) {
    const ready = await startAudio();
    if (!ready) return;
  }
  if (inputList.children.length >= 2) return;
  const row = buildDeviceRow("input");
  inputList.append(row);
  updateDeviceCounters();
  await connectInput(row);
}

async function connectInput(row) {
  const previous = state.inputStreams.get(row);
  previous?.stream.getTracks().forEach(t => t.stop());
  if (previous?.raf) cancelAnimationFrame(previous.raf);
  try {
    const deviceId = row.querySelector("select").value;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId), video: false });
    const source = state.context.createMediaStreamSource(stream);
    const analyser = state.context.createAnalyser();
    const gain = state.context.createGain();
    gain.gain.value = Number(row.querySelector(".mic-volume input").value) / 100;
    analyser.fftSize = 64;
    source.connect(analyser).connect(gain).connect(state.sourceBus);
    const entry = { stream, source, analyser, gain, raf: null };
    state.inputStreams.set(row, entry);
    animateLevel(row, entry);
  } catch { showToast("That microphone could not be connected."); }
}

function animateLevel(row, entry) {
  const data = new Uint8Array(entry.analyser.frequencyBinCount);
  const bars = $$(".level i", row);
  const tick = () => {
    entry.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
    const active = Math.min(bars.length, Math.ceil(peak / 4));
    bars.forEach((bar, i) => bar.classList.toggle("on", i < active));
    entry.raf = requestAnimationFrame(tick);
  };
  tick();
}

function removeDeviceRow(row) {
  const entry = state.inputStreams.get(row);
  entry?.stream.getTracks().forEach(t => t.stop());
  if (entry?.raf) cancelAnimationFrame(entry.raf);
  state.inputStreams.delete(row);
  row.remove();
  updateDeviceCounters();
}

$$('.effect-card').forEach(card => {
  const name = card.dataset.effect;
  $(".effect-toggle", card).addEventListener("click", () => {
    state.effects[name] = !state.effects[name];
    syncEffectUi();
    updateEffectGraph();
  });
});

$("#allEffects").addEventListener("change", event => {
  for (const key of Object.keys(state.effects)) state.effects[key] = event.target.checked;
  syncEffectUi();
  updateEffectGraph();
});

$("#feedbackProtection").addEventListener("change", async event => {
  const enabled = event.target.checked;
  try {
    await Promise.all([...state.inputStreams.values()].map(entry => entry.stream.getAudioTracks()[0]?.applyConstraints({
      echoCancellation: enabled,
      noiseSuppression: enabled,
      autoGainControl: enabled,
    })));
    state.feedbackProtection = enabled;
    showToast(enabled ? "Feedback protection enabled." : "Feedback protection disabled.");
  } catch {
    event.target.checked = state.feedbackProtection;
    showToast("This browser could not update feedback protection.");
  }
});

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

function handleFiles(fileList) {
  const files = [...fileList];
  const mp3 = files.find(f => f.name.toLowerCase().endsWith(".mp3") || f.type === "audio/mpeg");
  const cdg = files.find(f => f.name.toLowerCase().endsWith(".cdg"));
  if (!mp3 && !cdg) { showToast("Choose an MP3 or an MP3 + CDG pair."); return; }
  if (mp3) {
    if (songAudio.src.startsWith("blob:")) URL.revokeObjectURL(songAudio.src);
    songAudio.src = URL.createObjectURL(mp3);
    const title = mp3.name.replace(/\.mp3$/i, "");
    $("#trackName").textContent = title;
    $("#stageTrack").textContent = title;
    $("#trackMeta").textContent = cdg ? "MP3 + CDG lyrics" : "MP3 audio";
    $("#playButton").disabled = false;
  }
  if (cdg) {
    cdg.arrayBuffer().then(buffer => {
      state.cdg = new Uint8Array(buffer);
      resetCdg();
      $("#lyricsButton").disabled = false;
      showToast(mp3 ? "Song and lyrics loaded." : "Lyrics loaded. Add the matching MP3.");
    });
  } else {
    state.cdg = null;
    $("#lyricsButton").disabled = true;
  }
}

const palette = Array.from({ length: 16 }, () => [0, 0, 0, 255]);
const pixels = new Uint8Array(300 * 216);
let borderColor = 0;
function resetCdg() {
  pixels.fill(0); palette.forEach((_, i) => palette[i] = [0, 0, 0, 255]); borderColor = 0; state.cdgRenderedPackets = 0; renderCdg();
}
function processCdgPacket(offset) {
  const data = state.cdg;
  if (!data || (data[offset] & 0x3f) !== 0x09) return;
  const instruction = data[offset + 1] & 0x3f;
  const d = data.subarray(offset + 4, offset + 20);
  if (instruction === 1) { pixels.fill(d[0] & 0x0f); }
  else if (instruction === 2) borderColor = d[0] & 0x0f;
  else if (instruction === 6 || instruction === 38) {
    const color0 = d[0] & 0x0f, color1 = d[1] & 0x0f, y = (d[2] & 0x1f) * 12, x = (d[3] & 0x3f) * 6;
    for (let row = 0; row < 12; row++) for (let col = 0; col < 6; col++) {
      const color = (d[4 + row] >> (5 - col)) & 1 ? color1 : color0;
      const pos = (y + row) * 300 + x + col;
      if (pos < pixels.length) pixels[pos] = instruction === 38 ? pixels[pos] ^ color : color;
    }
  } else if (instruction === 30 || instruction === 31) {
    const base = instruction === 30 ? 0 : 8;
    for (let i = 0; i < 8; i++) {
      const value = ((d[i * 2] & 0x3f) << 6) | (d[i * 2 + 1] & 0x3f);
      palette[base + i] = [((value >> 8) & 0x0f) * 17, ((value >> 4) & 0x0f) * 17, (value & 0x0f) * 17, 255];
    }
  }
}
function renderCdg() {
  const canvas = $("#cdgCanvas"), ctx = canvas.getContext("2d");
  const image = ctx.createImageData(300, 216);
  for (let i = 0; i < pixels.length; i++) image.data.set(palette[pixels[i]] || palette[borderColor], i * 4);
  ctx.putImageData(image, 0, 0);
}
function syncCdg() {
  if (!state.cdg) return;
  const targetPackets = Math.floor(songAudio.currentTime * 300);
  if (targetPackets < state.cdgRenderedPackets) resetCdg();
  const total = Math.floor(state.cdg.length / 24);
  while (state.cdgRenderedPackets < Math.min(targetPackets, total)) {
    processCdgPacket(state.cdgRenderedPackets * 24);
    state.cdgRenderedPackets++;
  }
  renderCdg();
}

function togglePlay() { if (!songAudio.src) return; songAudio.paused ? songAudio.play() : songAudio.pause(); }
songAudio.addEventListener("play", () => { $("#nowPlaying").classList.add("playing"); $("#stagePlay").textContent = "PAUSE"; });
songAudio.addEventListener("pause", () => { $("#nowPlaying").classList.remove("playing"); $("#stagePlay").textContent = "PLAY"; });
songAudio.addEventListener("loadedmetadata", () => $("#duration").textContent = formatTime(songAudio.duration));
songAudio.addEventListener("timeupdate", () => {
  $("#currentTime").textContent = formatTime(songAudio.currentTime);
  $("#seek").value = songAudio.duration ? songAudio.currentTime / songAudio.duration * 100 : 0;
  syncCdg();
});
$("#seek").addEventListener("input", e => { if (songAudio.duration) songAudio.currentTime = e.target.value / 100 * songAudio.duration; });
$("#playButton").addEventListener("click", togglePlay);
$("#stagePlay").addEventListener("click", togglePlay);

const dropZone = $("#dropZone");
$("#browseFiles").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", e => handleFiles(e.target.files));
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("dragging"); handleFiles(e.dataTransfer.files); });
$("#lyricsButton").addEventListener("click", () => {
  $("#lyricsStage").classList.add("open"); $("#lyricsStage").setAttribute("aria-hidden", "false");
  $("#cdgCanvas").style.display = state.cdg ? "block" : "none";
  $(".empty-lyrics").style.display = state.cdg ? "none" : "block";
});
$("#closeLyrics").addEventListener("click", () => { $("#lyricsStage").classList.remove("open"); $("#lyricsStage").setAttribute("aria-hidden", "true"); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") $("#closeLyrics").click();
  const editing = ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable;
  if (editing) return;
  if (e.key.toLowerCase() === "m" && !e.repeat) {
    e.preventDefault();
    $("#muteOutput").click();
  }
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  }
});

$("#addInput").addEventListener("click", addInputRow);
navigator.mediaDevices?.addEventListener("devicechange", async () => { await refreshDevices(); await updatePermissionStatuses(); showToast("Audio devices updated."); });
updateDeviceCounters();
syncEffectUi();

function setGainSlider(input, output, nodeName) {
  const update = () => {
    const value = Number(input.value);
    output.value = `${value}%`;
    if (state.nodes[nodeName]) {
      const gain = nodeName === "outputBus" && state.outputMuted ? 0 : value / 100;
      state.nodes[nodeName].gain.setTargetAtTime(gain, state.context.currentTime, .01);
    } else if (nodeName === "outputBus") songAudio.volume = value / 100;
  };
  input.addEventListener("input", update);
  update();
}

setGainSlider($("#outputGain"), $("#outputGainValue"), "outputBus");

$("#muteOutput").addEventListener("click", () => {
  state.outputMuted = !state.outputMuted;
  songAudio.muted = state.outputMuted;
  const button = $("#muteOutput");
  button.classList.toggle("muted", state.outputMuted);
  button.setAttribute("aria-pressed", state.outputMuted);
  $("b", button).textContent = state.outputMuted ? "Unmute" : "Mute";
  if (state.nodes.outputBus) {
    const gain = state.outputMuted ? 0 : Number($("#outputGain").value) / 100;
    state.nodes.outputBus.gain.setTargetAtTime(gain, state.context.currentTime, .01);
  }
});

function setPermissionStatus(id, text, tone = "waiting") {
  const label = $(id);
  label.textContent = text;
  const card = label.closest("article");
  card.classList.remove("good", "warn", "bad");
  card.classList.add(tone);
}

async function updatePermissionStatuses() {
  let microphoneState = state.microphoneReady ? "granted" : "prompt";
  try {
    const result = await navigator.permissions.query({ name: "microphone" });
    microphoneState = result.state;
  } catch { /* Permission query is not available in every browser. */ }
  const microphoneLabels = { granted: ["Allowed", "good"], denied: ["Blocked", "bad"], prompt: ["Not requested", "warn"] };
  const microphone = microphoneLabels[microphoneState] || microphoneLabels.prompt;
  setPermissionStatus("#microphoneStatus", microphone[0], microphone[1]);
}

$("#refreshPermissions").addEventListener("click", updatePermissionStatuses);
updatePermissionStatuses();
