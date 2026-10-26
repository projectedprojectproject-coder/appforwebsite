// 앱 자동 테스트 — 실제 앱을 켜서 버튼을 누르고, 펫 상태·사이트 스크롤·입 움직임·질문 시간을 확인한다.
// 질문 시간(마이크→음성 인식→AI 답→실시간 음성)은 가짜 서버와 가짜 마이크(소리 파일)로 시험한다 → 실제 API·비용 없음.
//   실행: npm test   (테스트 동안 사이트 창이 전체화면으로 잠깐 열린다)
//   결과: 항목별 통과/실패, 스크린샷은 tests/screenshots/
// 원리: Electron을 DevTools 포트를 연 채로 켜고(Chrome DevTools Protocol), 펫 화면과 사이트 창에 접속해 조작·확인한다.
// 음성 테스트: 03-featured.mp3 가 없으면 말소리 비슷한 시험용 소리를 잠깐 만들어 쓰고 끝나면 지운다(내 녹음은 건드리지 않음).
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "tests", "screenshots");
const PORT = 9333;
const FULL = process.argv.includes("--full"); // npm test -- --full : 안내 전체(10단계)를 끝까지 들어 본다
const TEST_AUDIO = path.join(ROOT, "assets", "audio", "tour", "03-featured.mp3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 아주 작은 DevTools 프로토콜 클라이언트 ─────────────
class Cdp {
  static async connect(url) {
    const c = new Cdp();
    c.ws = new WebSocket(url);
    c.id = 0;
    c.pending = new Map();
    c.handlers = [];
    c.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const { ok, fail } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? fail(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) c.handlers.forEach((h) => h(m));
    };
    await new Promise((ok, fail) => {
      c.ws.onopen = ok;
      c.ws.onerror = fail;
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval 실패");
    return r.result.value;
  }
  async shot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(SHOTS, file), Buffer.from(data, "base64"));
  }
  close() {
    this.ws.close();
  }
}

async function findTarget(match, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((t) => t.type === "page" && match(t.url));
      if (t) return t;
    } catch {
      /* 아직 안 켜짐 */
    }
    await sleep(250);
  }
  throw new Error("창을 찾지 못함");
}

async function waitFor(fn, timeout, label) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(50);
  }
  throw new Error(`시간 초과: ${label}`);
}

// ms 동안 펫 상태를 기록한다
async function samplePoses(pet, ms) {
  const seen = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const p = await pet.eval("document.body.dataset.pose");
    if (seen[seen.length - 1] !== p) seen.push(p);
    await sleep(30);
  }
  return seen;
}

// 말소리처럼 끊어지는 시험용 소리(WAV, 2.4초). Chromium은 확장자가 아니라 내용으로 형식을 알아낸다.
function speechLikeWav({ lead = 0, speech = 2.4, tail = 0 } = {}) {
  const rate = 22050, secs = lead + speech + tail, n = Math.floor(rate * secs);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate - lead;
    if (t < 0 || t > speech) {
      // 앞뒤: 실제 마이크처럼 아주 작은 잡음(말소리 기준보다 훨씬 작음). 완전한 0은 '꺼진 마이크'로 판단되므로
      data.writeInt16LE(Math.round((Math.random() - 0.5) * 0.004 * 32767), i * 2);
      continue;
    }
    const syl = (t % 0.3) / 0.3; // 0.3초마다 한 음절: 앞 60%는 소리, 뒤 40%는 쉼
    const env = syl < 0.6 ? Math.sin((Math.PI * syl) / 0.6) : 0;
    const v = env * 0.6 * (Math.sin(2 * Math.PI * 180 * t) * 0.6 + Math.sin(2 * Math.PI * 360 * t) * 0.3 + (Math.random() - 0.5) * 0.2);
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ── 테스트 ────────────────────────────────────────────
const results = [];
async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`  ✔ ${name}${note ? ` — ${note}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message });
    console.log(`  ✘ ${name} — ${e.message}`);
  }
}

await mkdir(SHOTS, { recursive: true });
let madeTestAudio = false;
try {
  await access(TEST_AUDIO);
} catch {
  await writeFile(TEST_AUDIO, speechLikeWav());
  madeTestAudio = true;
}

// ── 가짜 서버: ElevenLabs(음성 인식·스트리밍 음성) + Claude ─────────────
const QUESTIONS = ["연구 주제가 뭐예요?", "없어요, 감사합니다."];
const ANSWERS = [
  "[보기:research-1] 제 석사 논문은 AI 슬롭과 유사과학 채널의 담론 구조를 살펴보는 연구예요. 책은 [보기:publications-1] 만화로 배우는 AI 영화만들기와 [보기:publications-2] 방구석 시네마틱을 냈어요.",
  "[보기:없음] 질문해 주셔서 감사합니다. 좋은 하루 보내세요! [끝]",
];
const calls = { stt: [], llm: [], tts: [], warm: [] };
const ttsAudio = await readFile(path.join(ROOT, "assets", "audio", "tour", "08-media.mp3")).catch(() => speechLikeWav());
const mock = http.createServer((req, res) => {
  const body = [];
  req.on("data", (c) => body.push(c));
  req.on("end", async () => {
    const buf = Buffer.concat(body);
    if (req.url.startsWith("/v1/speech-to-text")) {
      calls.stt.push({ bytes: buf.length, type: req.headers["content-type"] || "" });
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text: QUESTIONS[calls.stt.length - 1] ?? "" }));
    }
    if (req.url.startsWith("/v1/messages")) {
      const json = JSON.parse(buf.toString());
      const usage = { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      if (json.max_tokens === 0) {
        // 캐시 데우기 요청: 답 없이 바로 돌려준다
        calls.warm.push({ json, at: Date.now() });
        return res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ id: "msg_warm", type: "message", role: "assistant", model: json.model, content: [], stop_reason: "max_tokens", stop_sequence: null, usage }),
        );
      }
      const call = { json, beta: req.headers["anthropic-beta"] || "", at: Date.now(), endAt: 0 };
      calls.llm.push(call);
      const text = ANSWERS[calls.llm.length - 1] ?? "네.";
      // 실제 API처럼 SSE 로 몇 글자씩 천천히 보낸다
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ev = (type, data) => res.write(`event: ${type}
data: ${JSON.stringify({ type, ...data })}

`);
      ev("message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: json.model, content: [], stop_reason: null, stop_sequence: null, usage } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      for (let i = 0; i < text.length; i += 6) {
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + 6) } });
        await sleep(80);
      }
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
      ev("message_stop", {});
      call.endAt = Date.now();
      return res.end();
    }
    if (req.url.includes("/stream")) {
      const body = JSON.parse(buf.toString());
      calls.tts.push({ ...body, at: Date.now() });
      // with-timestamps: 한 줄에 JSON 하나(소리 base64 + 첫 줄에 글자별 시작 시각).
      // 시험용 소리(4.2초)에 글자를 고르게 나눠 시각을 붙인다.
      res.writeHead(200, { "Content-Type": "application/json" });
      const chars = [...body.text];
      const dur = 4.2;
      for (let i = 0, n = 0; i < ttsAudio.length; i += 8192, n++) {
        const line = { audio_base64: ttsAudio.subarray(i, i + 8192).toString("base64") };
        if (n === 0)
          line.alignment = {
            characters: chars,
            character_start_times_seconds: chars.map((_, k) => +((k / chars.length) * dur).toFixed(3)),
            character_end_times_seconds: chars.map((_, k) => +(((k + 1) / chars.length) * dur).toFixed(3)),
          };
        res.write(JSON.stringify(line) + "\n");
        await sleep(60);
      }
      return res.end();
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;
// 가짜 마이크: 1.5초 조용 → 2.4초 말소리 → 6초 조용 (반복 재생됨)
const FAKE_MIC = path.join(os.tmpdir(), `pet-fake-mic-${process.pid}.wav`);
await writeFile(FAKE_MIC, speechLikeWav({ lead: 1.5, speech: 2.4, tail: 6 }));

const electronExe = path.join(ROOT, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const app = spawn(
  electronExe,
  [".", `--remote-debugging-port=${PORT}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE_MIC}`],
  {
    cwd: ROOT,
    stdio: "ignore",
    // 환경 변수가 .env 보다 우선 → 실제 키 대신 가짜 서버를 쓴다
    env: { ...process.env, ELEVENLABS_API_URL: MOCK, ELEVENLABS_API_KEY: "test", ELEVENLABS_VOICE_ID: "test-voice", ANTHROPIC_BASE_URL: MOCK, ANTHROPIC_API_KEY: "test" },
  },
);
let pet, site;
const errors = [];
const missingAudio = new Set();

try {
  console.log("앱 테스트 시작");
  pet = await Cdp.connect((await findTarget((u) => u.endsWith("pet.html"))).webSocketDebuggerUrl);
  pet.handlers.push((m) => {
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || "예외");
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value).join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      // 아직 녹음하지 않은 음성 파일은 없어도 정상(자막만 나오고 넘어감)이라 따로 센다
      if (/\/audio\/tour\/[^/]+\.mp3$/.test(m.params.entry.url || "")) missingAudio.add(path.basename(m.params.entry.url));
      else errors.push(`${m.params.entry.text} ${m.params.entry.url || ""}`.trim());
    }
  });
  await pet.send("Runtime.enable");
  await pet.send("Log.enable");
  await pet.send("Page.enable");
  await waitFor(() => pet.eval("!!document.body.dataset.pose"), 10000, "펫 화면 준비");
  // 아주 짧게 지나가는 상태도 놓치지 않도록 페이지 안에서 상태 변화를 모두 기록
  await pet.eval("window.__poses = []; new MutationObserver(() => __poses.push(document.body.dataset.pose)).observe(document.body, { attributes: true, attributeFilter: ['data-pose'] }); true");

  await check("펫 그림 9장이 모두 불러와짐", async () => {
    await waitFor(() => pet.eval("[...document.querySelectorAll('.avatar img')].every(i => i.complete)"), 10000, "그림 로딩");
    const imgs = await pet.eval("[...document.querySelectorAll('.avatar img')].map(i => [i.dataset.pose, i.naturalWidth > 0])");
    const bad = imgs.filter(([, ok]) => !ok).map(([p]) => p);
    if (imgs.length !== 9) throw new Error(`그림 수 ${imgs.length}`);
    if (bad.length) throw new Error("안 불러와진 그림: " + bad.join(", "));
    return imgs.map(([p]) => p).join(", ");
  });

  await check("앱을 켜면 마이크를 미리 확인하고 장치 이름을 보여 줌", async () => {
    await waitFor(() => pet.eval("!!document.body.dataset.mic"), 10000, "마이크 확인");
    const s = await pet.eval("({ mic: document.body.dataset.mic, device: document.body.dataset.micDevice, text: document.getElementById('micStatusText').textContent, shown: !document.getElementById('micStatus').hidden })");
    if (s.mic !== "ok" || !s.shown) throw new Error(JSON.stringify(s));
    return s.text;
  });

  await check("대기 중 눈을 깜빡이고 다시 뜸", async () => {
    await pet.shot("01-idle.png");
    const seen = await samplePoses(pet, 7000);
    if (!seen.includes("blink")) throw new Error("깜빡임 없음: " + seen.join("→"));
    if (seen[seen.length - 1] !== "idle") throw new Error("마지막 상태 " + seen[seen.length - 1]);
    return seen.join("→");
  });

  await check("안내 시작: 사이트가 전체화면으로 열리고 첫 섹션을 강조", async () => {
    await pet.eval("document.getElementById('btnStart').click()");
    site = await Cdp.connect((await findTarget((u) => u.startsWith("https://my-portfolio"))).webSocketDebuggerUrl);
    await site.send("Runtime.enable");
    await waitFor(() => site.eval("!!document.querySelector('[data-pet-focus]')"), 20000, "첫 섹션 강조");
    const s = await site.eval("({ cls: document.querySelector('[data-pet-focus]').className, full: innerWidth === screen.width && innerHeight === screen.height })");
    if (!s.cls.includes("hero")) throw new Error("강조된 요소 " + s.cls);
    if (!s.full) throw new Error("전체화면 아님");
    return `강조: .${s.cls.split(" ")[0]}, 전체화면`;
  });

  await check("첫 인사: 반가운 얼굴로 입을 움직임", async () => {
    const seen = await samplePoses(pet, 2500);
    if (!seen.includes("happy-talk") || !seen.includes("happy")) throw new Error(seen.join("→"));
    const voice = await pet.eval("document.body.dataset.voice");
    await waitFor(() => pet.eval("document.body.dataset.pose === 'happy-talk'"), 2000, "입 벌린 순간");
    await pet.shot("02-happy-talk.png");
    return `${seen.length}번 바뀜, 음성=${voice}`;
  });

  await check("다음: 생각 중 → 가리키기, 사이트가 #about 으로 스크롤", async () => {
    await pet.eval("__poses.length = 0; document.getElementById('btnNext').click()");
    await waitFor(() => pet.eval("document.body.dataset.pose.startsWith('point')"), 8000, "가리키기");
    const seen = (await pet.eval("__poses")).filter((p, i, a) => p !== a[i - 1]);
    if (seen[0] !== "think") throw new Error("생각 중 상태 없음: " + seen.join("→"));
    await waitFor(() => site.eval("document.querySelector('[data-pet-focus]')?.id === 'about'"), 5000, "#about 강조");
    await sleep(900); // 부드러운 스크롤이 끝날 때까지
    const y = await site.eval("Math.round(scrollY)");
    if (y <= 0) throw new Error("스크롤 안 됨");
    await waitFor(() => pet.eval("document.body.dataset.pose === 'point'"), 2000, "입 닫힌 순간");
    await pet.shot("03-point.png");
    return `${seen.join("→")}…, scrollY=${y}`;
  });

  await check("일시정지 중에는 입을 다물고, 계속하면 다시 말함", async () => {
    await pet.eval("document.getElementById('btnPause').click()");
    const paused = await samplePoses(pet, 1200);
    if (paused.some((p) => p.endsWith("-talk"))) throw new Error("멈췄는데 입이 움직임: " + paused.join("→"));
    await pet.eval("document.getElementById('btnPause').click()");
    const resumed = await samplePoses(pet, 1200);
    if (!resumed.includes("point-talk")) throw new Error("다시 말하지 않음: " + resumed.join("→"));
    return `멈춤 ${paused.join("→")} / 계속 ${resumed.length}번 바뀜`;
  });

  await check("음성이 있는 단계: 소리 크기에 맞춰 입을 움직이고, 소리가 끝나면 다음 단계로", async () => {
    await pet.eval("document.getElementById('btnNext').click()");
    await waitFor(() => pet.eval("document.body.dataset.step === '2' && document.body.dataset.voice === 'audio'"), 10000, "음성 재생");
    const t0 = Date.now();
    const seen = await samplePoses(pet, 1800);
    const opens = seen.filter((p) => p === "point-talk").length;
    if (opens < 3) throw new Error("입 움직임 부족: " + seen.join("→"));
    await waitFor(() => pet.eval("document.body.dataset.step === '3'"), madeTestAudio ? 6000 : 30000, "다음 단계로 자동 이동");
    const secs = (Date.now() - t0) / 1000;
    // 시험용 소리는 2.4초, 자막 타이머라면 5초가 넘으므로 소리가 끝나서 넘어갔는지 구분된다
    if (madeTestAudio && secs > 4) throw new Error(`${secs.toFixed(1)}초 — 소리 끝이 아니라 타이머로 넘어감`);
    return `입 ${opens}번 벌림, ${secs.toFixed(1)}초 뒤 다음 단계${madeTestAudio ? " (2.4초짜리 시험용 소리)" : ""}`;
  });

  await check("안내 끝내기: 반가운 얼굴 → 대기, 사이트 강조 해제", async () => {
    await pet.eval("document.getElementById('btnStop').click()");
    await waitFor(() => pet.eval("document.body.dataset.pose === 'happy'"), 2000, "반가운 얼굴");
    await pet.shot("04-end-happy.png");
    await waitFor(() => site.eval("!document.querySelector('[data-pet-focus]')"), 3000, "강조 해제");
    await waitFor(() => pet.eval("['idle','blink'].includes(document.body.dataset.pose)"), 4000, "대기로 돌아감");
    return "happy → idle";
  });

  await check("기본 마이크가 꺼져(무음) 있으면 소리가 들어오는 다른 마이크로 바꿈 (스테레오 믹스 제외)", async () => {
    // 장치 목록과 마이크 열기를 흉내 낸다: 기본·헤드셋은 완전 무음, 스테레오 믹스는 쓰면 안 됨, good-mic 만 진짜 소리
    const r = await pet.eval(`(async () => {
      const md = navigator.mediaDevices;
      const realGUM = md.getUserMedia.bind(md), realEnum = md.enumerateDevices.bind(md);
      const asked = [];
      const silent = () => { const ac = new AudioContext(); return ac.createMediaStreamDestination().stream; };
      md.enumerateDevices = async () => [
        { kind: "audioinput", deviceId: "default", label: "기본값" },
        { kind: "audioinput", deviceId: "dead-headset", label: "꺼진 헤드셋" },
        { kind: "audioinput", deviceId: "stereo", label: "스테레오 믹스(Realtek Audio)" },
        { kind: "audioinput", deviceId: "good-mic", label: "Good Mic" },
      ];
      md.getUserMedia = async (c) => {
        const id = c?.audio?.deviceId?.exact || "default";
        asked.push(id);
        return id === "good-mic" ? realGUM({ audio: true }) : silent();
      };
      try { await micPreflight(); } finally { md.getUserMedia = realGUM; md.enumerateDevices = realEnum; }
      return { asked, device: document.body.dataset.micDevice, mic: document.body.dataset.mic };
    })()`);
    if (r.asked.includes("stereo")) throw new Error("스테레오 믹스를 열어 봄: " + r.asked.join(","));
    if (r.asked.at(-1) !== "good-mic" || r.mic !== "ok" || /기본 마이크/.test(r.device)) throw new Error(JSON.stringify(r));
    await pet.eval("micPreflight()"); // 원래 장치로 되돌림
    return `시험한 순서 ${r.asked.join(" → ")}, 고른 마이크: ${r.device}`;
  });

  await check("마이크 권한이 꺼져 있으면 이유와 설정 버튼을 보여 주고, 켜지면 자동으로 이어짐", async () => {
    await pet.eval("window.__realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; true");
    await pet.eval("document.getElementById('btnAsk').click()");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'mic-error'"), 10000, "마이크 오류 안내");
    const s = await pet.eval("({ text: document.getElementById('bubbleText').textContent, settings: !document.getElementById('btnMicSettings').hidden, retry: !document.getElementById('btnMicRetry').hidden })");
    if (!/마이크 사용이 꺼져/.test(s.text) || !s.settings || !s.retry) throw new Error(JSON.stringify(s));
    await pet.shot("05a-mic-denied.png");
    // 사용자가 Windows 설정에서 켰다고 치고(권한 복구) 기다리면 3초 안에 저절로 이어져야 한다
    const t0 = Date.now();
    await pet.eval("navigator.mediaDevices.getUserMedia = window.__realGUM; true");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'intro'"), 6000, "권한이 돌아오면 자동 연결");
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    await pet.eval("document.getElementById('btnStop').click()");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'off'"), 5000, "질문 시간 끝내기");
    return `안내: "${s.text.slice(0, 30)}…" + [마이크 설정 열기][다시 시도], 권한이 돌아오고 ${secs}초 만에 자동 연결`;
  });

  await check("질문 시간: 마이크로 질문을 듣고 → 음성 인식 → AI 답 → 내 목소리로 실시간 재생", async () => {
    if (await pet.eval("document.getElementById('btnAsk').hidden")) throw new Error("'질문 받기' 버튼이 안 보임");
    // 사이트에서 강조되는 위치가 바뀔 때마다 [위치, 시각] 기록
    await site.eval("window.__focusLog = []; new MutationObserver((ms) => ms.forEach((m) => m.target.dataset.petFocus !== undefined && __focusLog.push([m.target.dataset.petTarget, Math.round(performance.now())]))).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-pet-focus'] }); true");
    await pet.eval("document.getElementById('btnAsk').click()");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'listening'"), 30000, "안내 멘트 후 듣기 시작");
    await waitFor(() => pet.eval("document.body.dataset.heard === '1'"), 15000, "말소리 감지");
    await pet.shot("05-qna-listening.png");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'thinking'"), 15000, "말이 끝난 것을 감지");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'speaking'"), 15000, "답변 시작");
    const st = calls.stt[0];
    if (!st || st.bytes < 2000 || !st.type.startsWith("multipart/form-data")) throw new Error("음성 인식 요청 이상: " + JSON.stringify(st));
    const q = await pet.eval("document.body.dataset.question");
    if (q !== QUESTIONS[0]) throw new Error("질문 표시 " + q);
    const llm = calls.llm[0].json;
    const sys = llm.system?.[0]?.text || "";
    if (llm.model !== "claude-opus-5-5") throw new Error("모델 " + llm.model);
    if (!sys.includes("Films") || !sys.includes("<안내_대본>")) throw new Error("사이트 내용이 AI에 전달되지 않음");
    if (llm.messages.at(-1).content !== QUESTIONS[0]) throw new Error("질문이 AI에 전달되지 않음");
    const seen = await samplePoses(pet, 1500);
    if (!seen.includes("point-talk")) throw new Error("답변 중 화면을 가리키며 말하지 않음: " + seen.join("→"));
    // AI가 고른 위치(석사논문 카드)로 사이트가 스크롤·강조됐는지
    const places = sys.slice(sys.lastIndexOf("<화면_위치>"));
    if (!places.includes("research-1 | 연구 › AI 슬롭")) throw new Error("화면 위치 목록에 논문 카드가 없음");
    await waitFor(() => site.eval("document.querySelector('[data-pet-focus]')?.dataset.petTarget === 'research-1'"), 3000, "논문 카드 강조");
    // 부드러운 스크롤이 끝나면 카드 가운데가 화면 안에 있어야 한다
    const cardJs = "(() => { const el = document.querySelector('[data-pet-focus]'); const r = el.getBoundingClientRect(); const c = (r.top + r.bottom) / 2; return { title: el.querySelector('h3')?.innerText || '', inView: c > 0 && c < innerHeight, top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight }; })()";
    await waitFor(() => site.eval(cardJs + ".inView"), 2500, "논문 카드가 화면 안으로");
    const card = await site.eval(cardJs);
    const bubble = await pet.eval("document.getElementById('bubbleText').textContent");
    if (bubble.includes("[보기")) throw new Error("자막에 위치 표시가 보임: " + bubble);
    if (calls.tts.some((t) => t.text.includes("보기"))) throw new Error("위치 표시를 소리 내어 읽음");
    // 두 번째 문장을 말하기 시작할 때 저서 섹션으로 넘어가야 한다(첫 문장 소리 4.2초 뒤)
    // 두 번째 문장 안에서 책 이름을 말하는 순간마다 저서 카드 1 → 2 로 넘어가야 한다
    await waitFor(() => site.eval("__focusLog.some(([k]) => k === 'publications-2')"), 20000, "같은 문장 안의 두 번째 책 카드로 이동");
    const flog = (await site.eval("__focusLog")).filter(([k], i, a) => k !== a[i - 1]?.[0]);
    const order = flog.map(([k]) => k).join("→");
    if (order !== "research-1→publications-1→publications-2") throw new Error("이동 순서 " + order);
    const gap = flog[1][1] - flog[0][1]; // 문장 사이: 첫 문장 소리(4.2초) + '책은 ' 만큼
    const gapIn = flog[2][1] - flog[1][1]; // 같은 문장 안: 첫 책 이름 → 둘째 책 이름
    if (gap < 4000) throw new Error(`두 번째 이동이 너무 빠름(${gap}ms) — 말보다 화면이 앞서감`);
    // 둘째 문장 글자 수 기준으로 두 책 이름 사이는 약 1.8초(4.2초 × 20/46)
    if (gapIn < 1200 || gapIn > 2600) throw new Error(`같은 문장 안 이동 시점이 어긋남(${gapIn}ms)`);
    await waitFor(() => pet.eval("document.body.dataset.focus === 'research-1,publications-1,publications-2'"), 3000, "펫이 세 곳을 차례로 가리킴");
    const voice = await pet.eval("document.body.dataset.voice");
    if (voice !== "stream") throw new Error("실시간 음성이 아님: " + voice);
    if (!calls.tts[0]?.text.includes("에이아이 슬롭")) throw new Error("영어 발음 변환 안 됨: " + calls.tts[0]?.text);
    // 빨리 말하기: AI가 답을 다 쓰기 전에 첫 문장 음성을 이미 요청했어야 한다
    const early = calls.llm[0].endAt - calls.tts[0].at;
    if (!(early > 0)) throw new Error(`첫 문장 음성이 AI 답이 끝난 뒤에야 시작됨 (${early}ms)`);
    if (!calls.warm.length || calls.warm[0].at > calls.llm[0].at) throw new Error("캐시 데우기 요청이 첫 질문보다 먼저 가지 않음");
    await waitFor(() => calls.tts.length >= 2, 15000, "두 번째 문장 음성");
    if (!calls.tts[1].previous_text?.includes("에이아이 슬롭")) throw new Error("두 번째 문장에 앞 문장 이어 주기(previous_text) 없음");
    await pet.shot("06-qna-answer.png");
    return `질문 녹음 ${Math.round(st.bytes / 1024)}KB → "${q}" → 말하는 문장에 맞춰 논문 카드("${card.title.slice(0, 20)}…") → ${(gap / 1000).toFixed(1)}초 뒤 첫 책 카드 → 같은 문장 안에서 ${(gapIn / 1000).toFixed(1)}초 뒤 둘째 책 카드로 말에 맞춰 이동, 첫 문장 음성은 AI 답 끝나기 ${early}ms 전에 시작, 화면 위치 ${places.split(String.fromCharCode(10)).length - 2}곳 제공`;
  });

  await check("질문 시간: 다시 듣고, '없어요'라고 하면 AI가 마무리하고 끝냄", async () => {
    await waitFor(() => pet.eval("document.body.dataset.qna === 'listening'"), 30000, "다시 듣기");
    await waitFor(() => pet.eval("document.body.dataset.qna === 'off'"), 40000, "질문 시간 종료");
    const text = await pet.eval("document.getElementById('bubbleText').textContent");
    if (calls.llm.length !== 2) throw new Error("AI 호출 " + calls.llm.length + "번");
    if (calls.llm[1].json.messages.length !== 3) throw new Error("이전 대화가 이어지지 않음");
    if (!(await pet.eval("document.getElementById('mic').hidden"))) throw new Error("마이크 표시가 남아 있음");
    return `AI 호출 2번(대화 이어짐), 끝 표시 '[끝]' 은 자막에서 제거, 마지막 말풍선: "${text.slice(0, 30)}…"`;
  });

  if (FULL)
    await check("전체 안내: 모든 단계가 내 목소리로 재생되고 입이 움직이며 끝까지 자동 진행 → 질문 시간으로", async () => {
      await pet.eval("document.getElementById('btnStart').click()");
      const t0 = Date.now();
      const log = new Map(); // 단계 → { voice, talked }
      let ended = false;
      while (Date.now() - t0 < 300000) {
        const s = await pet.eval("({ step: document.body.dataset.step, voice: document.body.dataset.voice, pose: document.body.dataset.pose, start: !document.getElementById('btnStart').hidden, qna: document.body.dataset.qna })");
        if (s.step !== undefined) {
          const e = log.get(s.step) || { voice: null, talked: false };
          if (s.pose.endsWith("-talk")) e.talked = true;
          if (s.pose.endsWith("-talk") || s.pose === "point" || s.pose === "happy") e.voice = s.voice;
          log.set(s.step, e);
        } else if (log.size && (s.start || (s.qna && s.qna !== "off"))) {
          ended = s.qna && s.qna !== "off" ? "질문 시간 자동 시작" : "안내 끝";
          break;
        }
        await sleep(40);
      }
      if (!ended) throw new Error("5분 안에 끝나지 않음");
      const steps = [...log.keys()].map(Number).sort((a, b) => a - b);
      const bad = [...log].filter(([, e]) => e.voice !== "audio" || !e.talked).map(([k, e]) => `${+k + 1}단계(${e.voice}, 입${e.talked ? "O" : "X"})`);
      if (steps.length !== 10) throw new Error(`거친 단계 ${steps.length}개: ${steps.map((n) => n + 1).join(",")}`);
      if (bad.length) throw new Error("문제 단계: " + bad.join(", "));
      const took = ((Date.now() - t0) / 1000).toFixed(0);
      if (ended !== "질문 시간 자동 시작") throw new Error("안내 뒤 질문 시간이 시작되지 않음");
      await pet.eval("document.getElementById('btnStop').click()");
      await waitFor(() => pet.eval("document.body.dataset.qna === 'off' && !document.getElementById('btnStart').hidden"), 5000, "질문 시간 끝내기");
      return `10단계 모두 음성 재생·입 움직임, ${took}초 뒤 질문 시간 자동 시작 → '끝내기'로 종료`;
    });

  await check("오류 없음 (스크립트 예외·콘솔 오류·보안 정책 위반)", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
    return missingAudio.size ? `아직 없는 음성 파일(정상): ${[...missingAudio].join(", ")}` : "";
  });
} catch (e) {
  results.push({ name: "테스트 진행", ok: false, note: e.message });
  console.log("  ✘ 테스트 진행 중단 — " + e.message);
} finally {
  try {
    await pet?.eval("window.pet.quit()");
  } catch {
    /* 이미 꺼짐 */
  }
  pet?.close();
  site?.close();
  await sleep(500);
  if (app.exitCode === null) app.kill();
  if (madeTestAudio) await rm(TEST_AUDIO, { force: true });
  await rm(FAKE_MIC, { force: true });
  mock.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과. 스크린샷: tests/screenshots/`);
process.exit(failed ? 1 : 0);
