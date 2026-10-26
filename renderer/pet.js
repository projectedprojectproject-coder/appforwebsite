// 펫 화면 — 대본 순서대로 사이트를 스크롤시키고, 내 목소리 mp3와 자막을 보여 준다.
// 펫 그림은 상태(pose)에 따라 바뀐다: 대기 idle · 깜빡임 blink · 무심한 눈 sleepy · 생각 think ·
// 가리키기 point · 반가움 happy. 말하는 동안에는 "<상태>-talk" 그림과 번갈아 보여 입을 움직인다.

// 임시 펫 그림 (config.js 의 petSprites 가 null 일 때)
const PLACEHOLDER_PET =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <ellipse cx="50" cy="58" rx="38" ry="34" fill="#ff9f1c"/>
  <circle cx="24" cy="26" r="10" fill="#ff9f1c"/><circle cx="76" cy="26" r="10" fill="#ff9f1c"/>
  <circle cx="37" cy="52" r="6" fill="#1d1d1f"/><circle cx="63" cy="52" r="6" fill="#1d1d1f"/>
  <circle cx="39" cy="50" r="2" fill="#fff"/><circle cx="65" cy="50" r="2" fill="#fff"/>
  <path d="M42 68 Q50 75 58 68" stroke="#1d1d1f" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`);

const $ = (id) => document.getElementById(id);
const el = {
  avatar: $("avatar"),
  bubble: $("bubble"),
  title: $("bubbleTitle"),
  text: $("bubbleText"),
  progress: $("bubbleProgress"),
  start: $("btnStart"),
  prev: $("btnPrev"),
  pause: $("btnPause"),
  next: $("btnNext"),
  stop: $("btnStop"),
  quit: $("btnQuit"),
  ask: $("btnAsk"),
};

let steps = [];
let config = { msPerChar: 90, sleepyAfterMs: 20000 };
let index = -1;
let runId = 0; // 단계가 바뀔 때마다 올려서, 이전 단계의 늦은 응답을 무시한다
let speech = null; // 지금 말하고 있는 음성(또는 타이머)
let paused = false;

// ── 펫 그림(상태) ─────────────────────────────────────
const sprites = new Map(); // 상태 이름 → <img>
let base = "idle"; // 지금 자세
let mouthOpen = false;
let blinking = false;

function loadSprites(map) {
  const entries = map ? Object.entries(map) : [["idle", null]];
  for (const [name, file] of entries) {
    const img = document.createElement("img");
    img.src = file ? "../assets/pet/" + file : PLACEHOLDER_PET;
    img.alt = "";
    img.draggable = false;
    img.dataset.pose = name;
    el.avatar.append(img);
    sprites.set(name, img);
  }
}

function render() {
  let name = base;
  if (blinking && sprites.has("blink")) name = "blink";
  else if (mouthOpen && sprites.has(base + "-talk")) name = base + "-talk";
  if (!sprites.has(name)) name = "idle";
  for (const [k, img] of sprites) img.classList.toggle("on", k === name);
  document.body.dataset.pose = name;
}
function setPose(name) {
  base = name;
  render();
}
function setMouth(open) {
  if (mouthOpen === open) return;
  mouthOpen = open;
  render();
}

// 대기 중 가끔 눈 깜빡이기 (눈을 뜬 기본 자세일 때만)
(function blinkLoop() {
  setTimeout(() => {
    if (base === "idle" && !mouthOpen) {
      blinking = true;
      render();
      setTimeout(() => {
        blinking = false;
        render();
      }, 150);
    }
    blinkLoop();
  }, 2500 + Math.random() * 3500);
})();

// 안내를 하지 않고 오래 있으면 무심한 눈
let sleepyTimer = null;
function wakeUp() {
  clearTimeout(sleepyTimer);
  if (index < 0 && !qnaActive) {
    if (base === "sleepy") setPose("idle");
    sleepyTimer = setTimeout(() => index < 0 && !qnaActive && setPose("sleepy"), config.sleepyAfterMs);
  }
}

// ── 입 움직임 ─────────────────────────────────────────
// 음성 파일이 있으면 소리 크기에 맞춰 입을 열고, 없으면 무작위로 뻐끔거린다.
let audioCtx = null;
function lipSyncAudio(audio) {
  try {
    audioCtx ??= new AudioContext();
    const src = audioCtx.createMediaElementSource(audio);
    const an = audioCtx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    an.connect(audioCtx.destination);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    let lastChange = 0;
    const tick = (now) => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      // 너무 빨리 깜빡이지 않도록 최소 70ms 유지, 열고 닫는 기준을 다르게(히스테리시스)
      if (now - lastChange > 70) {
        const open = mouthOpen ? rms > 0.025 : rms > 0.05;
        if (open !== mouthOpen) {
          setMouth(open);
          lastChange = now;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    return {
      start() {
        audioCtx.resume();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      },
      stop() {
        cancelAnimationFrame(raf);
        setMouth(false);
      },
    };
  } catch {
    return null;
  }
}
function lipSyncFake() {
  let t = 0;
  const flap = () => {
    setMouth(!mouthOpen);
    t = setTimeout(flap, mouthOpen ? 90 + Math.random() * 110 : 70 + Math.random() * 160);
  };
  return {
    start() {
      clearTimeout(t);
      flap();
    },
    stop() {
      clearTimeout(t);
      setMouth(false);
    },
  };
}

// 음성을 재생한다. mp3가 없거나 재생이 안 되면 글자 수만큼 기다리는 타이머로 대신한다.
// step.src 가 있으면 그 주소(실시간 스트리밍 음성)를, 없으면 assets 의 step.audio 를 재생한다.
// 끝나면 onEnd 를 부른다. pause/resume/stop 을 가진 객체를 돌려준다.
function speak(step, onEnd) {
  const fallbackMs = Math.max(3000, step.text.length * config.msPerChar);
  let timer = null;
  let remaining = fallbackMs;
  let startedAt = 0;
  let usingTimer = false;
  let done = false;
  let lips = null;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    lips?.stop();
    onEnd();
  };
  const startTimer = () => {
    if (done) return;
    usingTimer = true;
    document.body.dataset.voice = "timer";
    lips?.stop();
    lips = lipSyncFake();
    if (paused) return;
    startedAt = Date.now();
    timer = setTimeout(finish, remaining);
    lips.start();
  };

  const audio = new Audio(step.src || "../assets" + step.audio);
  audio.addEventListener("ended", finish);
  audio.addEventListener("error", () => !usingTimer && startTimer());
  audio.addEventListener("playing", () => {
    if (done || usingTimer) return;
    document.body.dataset.voice = step.src ? "stream" : "audio";
    lips ??= lipSyncAudio(audio) || lipSyncFake();
    lips.start();
  });
  audio.play().catch(() => !usingTimer && startTimer());

  return {
    // 지금 재생 위치(초) — 질문 시간에 문장마다 화면을 옮기는 시점을 맞출 때 쓴다
    currentTime: () => (usingTimer ? 0 : audio.currentTime),
    pause() {
      lips?.stop();
      if (usingTimer) {
        clearTimeout(timer);
        remaining -= Date.now() - startedAt;
      } else audio.pause();
    },
    resume() {
      if (usingTimer) {
        startedAt = Date.now();
        timer = setTimeout(finish, remaining);
        lips?.start();
      } else audio.play().catch(startTimer);
    },
    stop() {
      done = true;
      clearTimeout(timer);
      audio.pause();
      lips?.stop();
    },
  };
}

// ── 안내 진행 ─────────────────────────────────────────
function say(title, text, progress = "") {
  el.bubble.hidden = false;
  el.title.textContent = title;
  el.text.textContent = text;
  el.progress.textContent = progress;
  el.bubble.scrollTop = 0;
}

function setTouring(on) {
  el.start.hidden = on;
  for (const b of [el.prev, el.pause, el.next, el.stop]) b.hidden = !on;
  el.ask.hidden = on || !qnaReady();
}

async function goTo(i) {
  speech?.stop();
  speech = null;
  paused = false;
  el.pause.textContent = "❚❚";

  if (i < 0) i = 0;
  // 안내가 끝나면 질문 시간으로 (설정에서 끌 수 있음)
  if (i >= steps.length) return qnaReady() && qnaInfo.autoStartAfterTour ? startQna() : finishTour();
  index = i;
  document.body.dataset.step = String(i);
  const my = ++runId;
  const step = steps[i];

  setPose("think");
  say(step.title, "화면을 찾는 중…", `${i + 1} / ${steps.length}`);
  const found = await window.pet.focus(step.target);
  if (my !== runId) return; // 그사이 다른 단계로 넘어감
  if (!found) return goTo(i + 1); // 비어 있는 섹션은 건너뛴다

  // 첫 인사와 마지막 인사는 반가운 얼굴, 그 사이는 화면 쪽을 가리키며 설명
  setPose(i === 0 || i === steps.length - 1 ? "happy" : "point");
  say(step.title, step.text, `${i + 1} / ${steps.length}`);
  speech = speak(step, () => {
    if (my === runId) goTo(i + 1);
  });
}

function finishTour() {
  stopQna();
  runId++;
  speech?.stop();
  speech = null;
  index = -1;
  delete document.body.dataset.step;
  setTouring(false);
  window.pet.clear();
  setPose("happy");
  setTimeout(() => index < 0 && base === "happy" && setPose("idle"), 2500);
  say("안내 끝", "다시 들으려면 '안내 시작'을 눌러 주세요.");
  wakeUp();
}

async function startTour() {
  clearTimeout(sleepyTimer);
  setTouring(true);
  setPose("happy");
  say("준비 중", "포트폴리오 사이트를 여는 중이에요…");
  await window.pet.openSite();
  goTo(0);
}

el.start.addEventListener("click", startTour);
el.next.addEventListener("click", () => goTo(index + 1));
el.prev.addEventListener("click", () => goTo(index - 1));
el.stop.addEventListener("click", finishTour);
el.quit.addEventListener("click", () => window.pet.quit());
el.ask.addEventListener("click", startQna);
el.pause.addEventListener("click", () => {
  if (!speech) return;
  paused = !paused;
  if (paused) speech.pause();
  else speech.resume();
  el.pause.textContent = paused ? "▶︎ 계속" : "❚❚";
});
document.addEventListener("pointerdown", wakeUp);

window.pet.onSiteClosed(() => {
  if (index >= 0) finishTour();
});

(async () => {
  [steps, config, qnaInfo] = await Promise.all([window.pet.getSteps(), window.pet.getConfig(), window.pet.qnaInfo()]);
  el.ask.hidden = !qnaReady();
  loadSprites(config.petSprites);
  el.avatar.setAttribute("aria-label", config.petName);
  setPose("idle");
  wakeUp();
  say("안녕하세요!", "제 포트폴리오를 안내해 드릴게요. '안내 시작'을 눌러 주세요.");
  // 질문 시간에 쓸 마이크를 미리 확인 (잠깐 열었다 닫음) → 말풍선 아래에 상태 표시
  micPreflight();
  // 마이크를 새로 꽂거나 뺐을 때 다시 확인 (질문 시간 중이 아닐 때)
  navigator.mediaDevices.addEventListener("devicechange", () => !qnaActive && micPreflight());
})();
