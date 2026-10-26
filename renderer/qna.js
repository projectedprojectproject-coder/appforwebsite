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
let mic = null; // { stream, ctx, analyser, source, label }

// 다른 PC에서도 바로 쓸 수 있게:
//  1) Windows 기본 마이크를 먼저 열고,
//  2) 그 마이크가 완전히 무음(꺼짐·음소거·빠진 헤드셋)이면 소리가 들어오는 다른 마이크로 바꾸고,
//  3) 실패하면 이유를 알기 쉬운 말로 알려 준다(권한 꺼짐 / 마이크 없음 / 다른 프로그램이 사용 중).
const PROCESSING = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const LOOPBACK = /stereo mix|스테레오 믹스|what u hear|loopback|wave out/i; // 스피커 소리를 되받는 가상 장치는 제외

async function getStream(deviceId) {
  const audio = deviceId ? { ...PROCESSING, deviceId: { exact: deviceId } } : PROCESSING;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (e) {
    // 일부 장치는 음향 처리 옵션을 못 받는다 → 옵션 없이 한 번 더
    if (e.name === "OverconstrainedError" || e.name === "NotReadableError")
      return navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
    throw e;
  }
}
function attach(stream) {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  return { stream, ctx, analyser, source, label: stream.getAudioTracks()[0]?.label || "기본 마이크" };
}
function release(m) {
  m.stream.getTracks().forEach((t) => t.stop());
  m.ctx.close();
}
// 0.6초 동안 소리 값이 완전히 0이면 '죽은' 마이크(꺼짐·음소거)로 본다. 조용한 방도 미세한 잡음은 있다.
async function isDead(m) {
  const buf = new Float32Array(m.analyser.fftSize);
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 100));
    m.analyser.getFloatTimeDomainData(buf);
    if (buf.some((v) => Math.abs(v) > 1e-6)) return false;
  }
  return true;
}

async function openMic() {
  if (mic) return mic;
  const first = attach(await getStream(null)); // 권한·장치 문제는 여기서 오류로 나온다
  if (!(await isDead(first))) return (mic = first);
  // 기본 마이크가 무음 → 다른 마이크를 차례로 시험 (권한을 얻은 뒤라 장치 목록이 보인다)
  const firstId = first.stream.getAudioTracks()[0]?.getSettings().deviceId;
  const others = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput" && d.deviceId && !["default", "communications", firstId].includes(d.deviceId) && !LOOPBACK.test(d.label),
  );
  for (const d of others) {
    let m;
    try {
      m = attach(await getStream(d.deviceId));
    } catch {
      continue;
    }
    if (!(await isDead(m))) {
      release(first);
      return (mic = m);
    }
    release(m);
  }
  return (mic = first); // 모두 무음이면 기본 마이크 그대로 (말하면 소리가 들어올 수도 있으니)
}
function closeMic() {
  if (!mic) return;
  release(mic);
  mic = null;
  showMic(false);
}

// 마이크 오류 → 이유와 해결 방법
async function micProblem(e) {
  const access = await window.pet.micAccess().catch(() => "unknown");
  if (e?.name === "NotAllowedError" || e?.name === "SecurityError" || access === "denied" || access === "restricted")
    return {
      kind: "denied",
      text: "Windows에서 이 앱의 마이크 사용이 꺼져 있어요. [마이크 설정 열기] → '마이크 액세스'와 '데스크톱 앱이 마이크에 액세스하도록 허용'을 켜 주세요. 켜면 자동으로 다시 연결해요.",
    };
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError")
    return { kind: "none", text: "연결된 마이크를 찾지 못했어요. 마이크를 꽂으면 자동으로 다시 연결해요." };
  if (e?.name === "NotReadableError" || e?.name === "AbortError")
    return { kind: "busy", text: "다른 프로그램(줌·팀즈 등)이 마이크를 쓰고 있어요. 그 프로그램을 닫으면 자동으로 다시 연결해요." };
  return { kind: "error", text: `마이크를 열지 못했어요 (${e?.name || "알 수 없는 오류"}). [다시 시도]를 눌러 주세요.` };
}

// 말풍선 아래 마이크 상태 줄
function setMicStatus(state, text = "") {
  const box = $("micStatus");
  box.hidden = !state;
  box.dataset.state = state || "";
  $("micStatusText").textContent = text;
  $("btnMicSettings").hidden = state !== "denied";
  $("btnMicRetry").hidden = !state || state === "ok";
  document.body.dataset.mic = state || "";
}

// 앱을 켤 때 마이크를 잠깐 열어 확인하고 바로 닫는다 → 발표 전에 문제를 미리 알 수 있다
async function micPreflight() {
  if (!qnaReady() || qnaActive) return;
  try {
    const m = await openMic();
    document.body.dataset.micDevice = m.label;
    setMicStatus("ok", `🎤 ${m.label}`);
  } catch (e) {
    const p = await micProblem(e);
    setMicStatus(p.kind, p.text);
  } finally {
    if (!qnaActive) closeMic();
  }
}

// 질문 시간용: 마이크가 열릴 때까지 안내하며 기다린다(3초마다, 마이크를 꽂을 때, [다시 시도] 때 재시도).
// 질문 시간이 끝나면 false.
async function ensureMic(alive) {
  for (;;) {
    try {
      const m = await openMic();
      document.body.dataset.micDevice = m.label;
      setMicStatus("ok", `🎤 ${m.label}`);
      return true;
    } catch (e) {
      const p = await micProblem(e);
      qnaState("mic-error");
      setPose("think");
      say("마이크 연결이 필요해요", p.text);
      setMicStatus(p.kind, "");
    }
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        navigator.mediaDevices.removeEventListener("devicechange", done);
        micRetryNow = null;
        resolve();
      };
      const t = setTimeout(done, 3000);
      navigator.mediaDevices.addEventListener("devicechange", done);
      micRetryNow = done;
    });
    if (!alive()) return false;
  }
}
let micRetryNow = null;
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
  // 마이크가 안 열리면 포기하지 않고 이유를 알려 주며 기다린다 (설정을 켜거나 마이크를 꽂으면 바로 이어짐)
  if (!(await ensureMic(alive))) return;
  qnaState("intro"); // (마이크를 기다렸다면 'mic-error' 에서 되돌림)
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
  micRetryNow?.();
  if (document.body.dataset.mic !== "ok") setMicStatus(null);
  qnaState("off");
}

// 마이크 상태 줄의 버튼 (qna.js 는 pet.js 보다 먼저 읽히므로 $ 대신 getElementById)
document.getElementById("btnMicSettings").addEventListener("click", () => window.pet.openMicSettings());
document.getElementById("btnMicRetry").addEventListener("click", () => (qnaActive ? micRetryNow?.() : micPreflight()));
