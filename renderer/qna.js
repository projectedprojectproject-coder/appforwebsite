// 질문·답변 시간 — 마이크로 질문을 듣고(말이 끝나면 자동으로 멈춤), AI 답을 내 목소리로 실시간 재생한다.
//   듣기 → (ElevenLabs 음성 인식) → 질문 글자 → (Claude) → 답 글자 → (ElevenLabs 스트리밍) → 재생
// pet.js 의 say·setPose·speak·finishTour 를 함께 쓴다. API 키는 메인 프로세스에만 있다.

let qnaInfo = null; // 메인에서 받은 설정·정해진 말·빠진 키
let qnaActive = false;
let qnaRun = 0; // 질문 시간이 새로 시작/종료될 때마다 올려서 늦게 온 응답을 무시
const qnaState = (s) => (document.body.dataset.qna = s); // off | intro | listening | thinking | speaking

const qnaReady = () => !!qnaInfo?.enabled && qnaInfo.missing.length === 0;

// ── 마이크 ───────────────────────────────────────────
// 소리를 직접(PCM) 받아 두었다가, 실제로 말한 부분(+앞뒤 0.3초)만 잘라 16kHz WAV 로 보낸다.
// 앞뒤의 긴 무음을 빼면 음성 인식이 없는 말을 지어내는 일이 줄고, 올리는 시간도 짧아진다.
let mic = null; // { stream, ctx, analyser, source }
async function openMic() {
  if (mic) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  mic = { stream, ctx, analyser, source };
}
function closeMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close();
  mic = null;
  showMic(false);
}
function micLevel() {
  const buf = new Uint8Array(mic.analyser.fftSize);
  mic.analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += ((v - 128) / 128) ** 2;
  return Math.sqrt(sum / buf.length);
}
function showMic(on, level = 0) {
  $("mic").hidden = !on;
  $("micLevel").style.width = `${Math.min(100, Math.round(level * 600))}%`;
}

// PCM(Float32) → 16kHz 16비트 모노 WAV
function toWav(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let o = 0;
  for (const c of chunks) pcm.set(c, (o += c.length) - c.length);
  const outRate = 16000, step = rate / outRate, n = Math.floor(total / step);
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (at, t) => [...t].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  str(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, outRate, true); view.setUint32(28, outRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, pcm[Math.floor(i * step)]));
    view.setInt16(44 + i * 2, v * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

// 질문 하나를 듣는다. 말소리가 시작되면 녹음을 이어 가다가 silenceMs 동안 조용하면 끝.
// waitForQuestionMs 동안 아무 말이 없거나 질문 시간이 끝나면 null.
function listenOnce(run) {
  const cfg = qnaInfo.listen;
  return new Promise((resolve) => {
    const rate = mic.ctx.sampleRate;
    const PAD = Math.round(rate * 0.3); // 말 앞뒤로 남길 길이
    const proc = mic.ctx.createScriptProcessor(2048, 1, 1);
    const pre = []; // 말 시작 전 0.3초 (앞부분이 잘리지 않게)
    const rec = [];
    let recording = false, recSamples = 0, voiceSample = 0;
    proc.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      if (recording) {
        rec.push(d);
        recSamples += d.length;
      } else {
        pre.push(d);
        while (pre.length > 1 && (pre.length - 1) * d.length > PAD) pre.shift();
      }
    };
    mic.source.connect(proc);
    proc.connect(mic.ctx.destination); // (출력은 무음) 연결해야 onaudioprocess 가 돈다

    const started = performance.now();
    let speechAt = 0, lastVoice = 0, loud = 0;
    const finish = (heard) => {
      clearInterval(timer);
      showMic(false);
      proc.disconnect();
      mic.source.disconnect(proc);
      if (!heard) return resolve(null);
      // 마지막 말소리 뒤 0.3초까지만 남기고 뒤쪽 무음은 버린다
      let keep = voiceSample + PAD, kept = [];
      for (const c of rec) {
        if (keep <= 0) break;
        kept.push(keep >= c.length ? c : c.subarray(0, keep));
        keep -= c.length;
      }
      resolve({ blob: toWav(kept, rate), mime: "audio/wav", ms: Math.round(lastVoice - speechAt) });
    };
    showMic(true);
    const timer = setInterval(() => {
      if (run !== qnaRun) return finish(false);
      const now = performance.now();
      const lv = micLevel();
      showMic(true, lv);
      if (!speechAt) {
        // 잡음에 반응하지 않도록 2번 연속(약 100ms) 큰 소리가 나야 말 시작으로 본다
        loud = lv > cfg.speechLevel ? loud + 1 : 0;
        if (loud >= 2) {
          speechAt = lastVoice = now;
          recording = true;
          rec.push(...pre);
          recSamples = pre.reduce((n, c) => n + c.length, 0);
          voiceSample = recSamples;
          document.body.dataset.heard = "1";
        } else if (now - started > cfg.waitForQuestionMs) finish(false);
      } else {
        if (lv > cfg.speechLevel * 0.6) {
          lastVoice = now;
          voiceSample = recSamples;
        }
        if (now - lastVoice > cfg.silenceMs || now - speechAt > cfg.maxQuestionMs) finish(true);
      }
    }, 50);
  });
}

// ── 말하기 ───────────────────────────────────────────
// 정해진 말(미리 만든 mp3)
function playLine(id, pose = "idle") {
  const line = qnaInfo.lines[id];
  setPose(pose);
  say(line.title, line.text);
  return new Promise((resolve) => (speech = speak(line, resolve)));
}

// AI 답(실시간 스트리밍): 소리 조각이 오는 대로 MediaSource 에 붙여 바로 재생한다.
const streams = new Map();
let streamId = 0;
window.pet.onChunk((id, chunk) => streams.get(id)?.push(chunk));
window.pet.onChunkEnd((id) => streams.get(id)?.end());

window.pet.onAnswerText((id, text) => streams.get(id)?.text(text));
window.pet.onAnswerFocus((id, key, seg, seconds) => streams.get(id)?.focus(key, seg, seconds));
window.pet.onAnswerSegment((id, seg) => streams.get(id)?.segment(seg));

// AI 답(실시간): AI가 쓰는 대로 자막을 늘리고, 문장마다 만들어지는 소리 조각을 이어 붙여 바로 재생한다.
// 소리 조각 사이에 '여기서 화면 이동' 표시가 끼어 오면, 그 지점의 재생 시각을 적어 두었다가
// 재생이 그 시각에 닿는 순간 사이트를 그 위치로 스크롤한다 → 말하는 문장과 화면이 맞는다.
// 결과 { ok, value: { text, end } | error } 를 소리가 다 끝난 뒤 돌려준다.
async function askAndSpeak(question) {
  const id = ++streamId;
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  const queue = []; // 소리 조각(Uint8Array) 또는 { mark: 키 }
  const marks = []; // { key, seg, offset } — seg 번째 문장 시작부터 offset 초에 화면 이동
  const segStart = []; // 문장 n 의 소리가 재생 몇 초부터 시작하는지
  const shown = [];
  let sb = null, ended = false, gotAudio = false, focused = false;
  delete document.body.dataset.focus;
  const appendedEnd = () => (sb && sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0);
  const pump = () => {
    if (sb && (sb.updating || ms.readyState !== "open")) return;
    // 표시는 소리를 붙이기 전에도 처리할 수 있다(지금까지 붙인 소리의 끝 = 그 문장이 시작되는 시각)
    while (queue.length && queue[0].seg !== undefined) segStart[queue.shift().seg] = appendedEnd();
    if (!sb) return;
    if (queue.length) sb.appendBuffer(queue.shift());
    else if (ended) ms.endOfStream();
  };
  ms.addEventListener("sourceopen", () => {
    sb = ms.addSourceBuffer("audio/mpeg");
    sb.mode = "sequence"; // 문장별 mp3 를 끊김 없이 이어 붙인다
    sb.addEventListener("updateend", pump);
    pump();
  });
  const go = (key) => {
    window.pet.focusTarget(key).then((ok) => {
      if (!ok) return;
      focused = true;
      shown.push(key);
      document.body.dataset.focus = shown.join(",");
      setPose("point");
    });
  };
  // 재생 위치를 지켜보다가 표시 시각이 되면 이동
  const watcher = setInterval(() => {
    const now = speech?.currentTime?.() ?? 0;
    for (let i = 0; i < marks.length; ) {
      const m = marks[i];
      const start = segStart[m.seg];
      if (start !== undefined && start + m.offset <= now + 0.05) {
        marks.splice(i, 1);
        go(m.key);
      } else i++;
    }
  }, 50);
  streams.set(id, {
    push: (c) => {
      if (!gotAudio) qnaState("speaking");
      gotAudio = true;
      queue.push(c);
      pump();
    },
    end: () => ((ended = true), pump()),
    text: (t) => {
      if (!t) return;
      if (!focused) setPose("idle");
      say("답변", t);
    },
    // 문장 시작 표시: 소리 조각과 같은 줄에 넣어, 붙일 차례가 되면 그때까지의 소리 길이를 시작 시각으로 적는다
    segment: (seg) => {
      queue.push({ seg });
      pump();
    },
    // 화면 이동 표시: 문장 시작부터 몇 초 뒤인지(글자별 시각으로 계산된 값)
    focus: (key, seg, offset) => marks.push({ key, seg, offset }),
  });
  const played = new Promise((res) => (speech = speak({ text: "답변을 준비하고 있어요", src: url }, res)));
  const result = await window.pet.ask(id, question);
  if (gotAudio) await played;
  else speech?.stop(); // 소리가 하나도 안 왔으면(오류) 기다리지 않는다
  clearInterval(watcher);
  streams.delete(id);
  URL.revokeObjectURL(url);
  return result;
}

// ── 질문 시간 ────────────────────────────────────────
async function startQna() {
  if (!qnaReady()) {
    const why = !qnaInfo?.enabled ? "설정(config.js)에서 꺼져 있어요." : `.env 에 ${qnaInfo.missing.join(", ")} 가 필요해요.`;
    say("질문 시간을 쓸 수 없어요", why);
    return;
  }
  if (qnaActive) return;
  speech?.stop();
  qnaActive = true;
  const run = ++qnaRun;
  const alive = () => run === qnaRun;
  index = -1;
  delete document.body.dataset.step;
  setTouring(true);
  for (const b of [el.prev, el.pause, el.next]) b.hidden = true; // 질문 시간에는 '끝내기'만
  qnaState("intro");

  await window.pet.qnaStart();
  try {
    await openMic();
  } catch {
    say("마이크를 쓸 수 없어요", "마이크가 연결되어 있는지, Windows 설정 → 개인정보 → 마이크에서 데스크톱 앱 접근이 켜져 있는지 확인해 주세요.");
    qnaActive = false;
    qnaRun++;
    qnaState("off");
    setTouring(false);
    return;
  }
  await playLine("qna-intro", "happy");

  let asked = 0;
  let misses = 0; // 연속으로 못 알아들은 횟수 (시끄러운 곳에서 끝없이 되묻지 않게)
  while (alive() && asked < qnaInfo.maxQuestions && misses < 3) {
    qnaState("listening");
    setPose("idle");
    say("질문해 주세요", "말씀이 끝나면 잠시 뒤 자동으로 대답할게요.");
    delete document.body.dataset.heard;
    const rec = await listenOnce(run);
    if (!alive()) return;
    if (!rec) break; // 한동안 질문이 없음

    qnaState("thinking");
    setPose("think");
    say("잠시만요", "질문을 듣고 있어요…");
    const heard = await window.pet.transcribe(await rec.blob.arrayBuffer(), rec.mime);
    if (!alive()) return;
    if (!heard.ok) {
      await playLine("qna-error");
      asked++;
      continue;
    }
    if (!heard.value) {
      misses++;
      if (misses < 3) await playLine("qna-sorry");
      continue;
    }
    misses = 0;
    document.body.dataset.question = heard.value;
    say("질문", heard.value);

    const reply = await askAndSpeak(heard.value);
    if (!alive()) return;
    asked++;
    if (!reply.ok || !reply.value?.text) {
      await playLine("qna-error");
      continue;
    }
    if (reply.value.end) return finishTour(); // AI가 이미 마무리 인사를 함
  }
  if (!alive()) return;
  await playLine("qna-outro", "happy");
  if (alive()) finishTour();
}

// 질문 시간 정리 (finishTour 가 부른다)
function stopQna() {
  if (!qnaActive) return;
  qnaActive = false;
  qnaRun++;
  speech?.stop();
  window.pet.stopSpeaking();
  closeMic();
  qnaState("off");
}
