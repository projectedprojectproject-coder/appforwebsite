// 내 목소리(ElevenLabs 복제 음성)로 안내 음성 mp3를 만들어 앱에 바로 넣는다.
//   실행: npm run voice
//   결과: assets/audio/tour/01-hero.mp3 … (대본 src/tourScript.js)
//         assets/audio/qna/*.mp3          (질문 시간의 정해진 말 src/qnaScript.js)
//
// 준비 — API 키는 대화창·코드·깃허브에 적지 말고 아래 둘 중 한 가지로만 넣는다.
//   (1) PET 폴더에 .env 파일을 만들고 (.env.example 참고, .env 는 깃과 설치 파일에 들어가지 않음)
//         ELEVENLABS_API_KEY=내_API_키
//         ELEVENLABS_VOICE_ID=내_복제_음성_ID
//   (2) 또는 PowerShell 에서:  $env:ELEVENLABS_API_KEY = "..."; $env:ELEVENLABS_VOICE_ID = "..."
//
// 영어 발음: 대본의 영어는 src/pronunciation.js 사전대로 한국어 발음으로 바꿔서 보낸다(자막은 그대로).
// 바뀐 것만 다시 만들기: 각 파일을 만든 문장·목소리·설정을 voice-manifest.json 에 적어 두고,
//   대본이나 .env 의 음성 설정이 바뀐 파일만 다시 만든다. 그대로인 파일은 건너뛴다(크레딧 절약).
//
// 옵션
//   --force              전부 다시 만든다
//   --only=hero,about    이 단계만 (이미 있어도) 다시 만든다 (대본 id, 쉼표로 구분)
//   --dry-run            API 를 부르지 않고 무엇을 만들지·영어를 어떻게 읽을지 보여 준다 (키 없어도 됨)
//   --no-normalize       음량 맞추기를 하지 않는다
//   --root=폴더          assets 대신 이 폴더 아래 audio/… 에 저장 (시험용)
// 음성 설정(선택, .env 나 환경 변수): ELEVENLABS_MODEL(기본 eleven_multilingual_v2),
//   VOICE_STABILITY(0.5), VOICE_SIMILARITY(0.8), VOICE_STYLE(0)
// 음량 맞추기: ffmpeg 가 설치되어 있으면 모든 파일을 같은 크기(-16 LUFS)로 맞춘다. 없으면 건너뛴다.
// ※ API 주소·모델 이름은 ElevenLabs 문서 기준이다. 바뀌었으면 아래 값을 고친다.
import { mkdir, writeFile, readFile, rename, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* .env 가 없으면 환경 변수만 쓴다 */
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const force = flag("force");
const dryRun = flag("dry-run");
const normalize = !flag("no-normalize");
const only = option("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const assetsDir = path.resolve(ROOT, option("root") || "assets");
const manifestFile = path.join(assetsDir, "audio", "voice-manifest.json");

const API = (process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io").replace(/\/$/, "");
const key = process.env.ELEVENLABS_API_KEY;
const voice = process.env.ELEVENLABS_VOICE_ID;
const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const settings = {
  stability: num(process.env.VOICE_STABILITY, 0.5),
  similarity_boost: num(process.env.VOICE_SIMILARITY, 0.8),
  style: num(process.env.VOICE_STYLE, 0),
  use_speaker_boost: true,
};

const load = (f) => import(pathToFileURL(path.join(ROOT, "src", f)).href);
const { tourSteps } = await load("tour.js");
const { qnaLines } = await load("qnaScript.js");
const { toSpoken } = await load("pronunciation.js");

// 안내 단계는 앞뒤 문장을 함께 보내 억양을 잇는다. 질문 시간의 말은 따로따로.
const items = [
  ...tourSteps.map((s, i) => ({ ...s, prev: tourSteps[i - 1]?.text, next: tourSteps[i + 1]?.text })),
  ...qnaLines,
].map((s) => ({ ...s, ...toSpoken(s.text), file: path.join(assetsDir, ...s.audio.split("/").filter(Boolean)) }));

if (only) {
  const unknown = only.filter((id) => !items.some((s) => s.id === id));
  if (unknown.length) {
    console.error(`대본에 없는 단계: ${unknown.join(", ")}\n있는 단계: ${items.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
}

const exists = async (f) => access(f).then(() => true, () => false);
let manifest = {};
try {
  manifest = JSON.parse(await readFile(manifestFile, "utf8"));
} catch {
  /* 처음 실행 */
}
const rel = (f) => path.relative(assetsDir, f).split(path.sep).join("/");
// 이 파일을 만든 조건(읽은 문장·목소리·모델·설정). 하나라도 바뀌면 다시 만든다.
const fingerprint = (s) =>
  createHash("sha256")
    .update(JSON.stringify({ text: s.spoken, prev: s.prev, next: s.next, voice, model, settings }))
    .digest("hex")
    .slice(0, 16);

// 만들 목록 정하기
const todo = [];
for (const s of items) {
  if (only && !only.includes(s.id)) continue;
  const name = rel(s.file);
  let reason = only ? "지정함" : force ? "--force" : null;
  if (!reason) {
    if (!(await exists(s.file))) reason = "새 파일";
    else if (!manifest[name]) {
      // 기록이 생기기 전에 만든 파일: 영어 발음 변환이 필요 없던 문장이면 그대로 인정
      if (s.spoken === s.text) {
        manifest[name] = fingerprint(s);
        console.log(`건너뜀(그대로): ${name}`);
        continue;
      }
      reason = "영어 발음 적용";
    } else if (manifest[name] !== fingerprint(s)) reason = "대본·설정 바뀜";
  }
  if (!reason) {
    console.log(`건너뜀(그대로): ${name}`);
    continue;
  }
  todo.push({ ...s, name, reason });
}

const chars = todo.reduce((n, s) => n + s.spoken.length, 0);
console.log(`\n만들 파일 ${todo.length}개, ${chars}자 (ElevenLabs 는 보통 글자 수만큼 크레딧을 씀)`);
for (const s of todo) {
  const changed = s.spoken !== s.text ? `\n      읽는 문장: ${s.spoken}` : "";
  const warn = s.unknown.length ? `\n      ⚠ 사전에 없는 영어(그대로 읽음): ${s.unknown.join(", ")} → src/pronunciation.js 에 추가` : "";
  console.log(`  ${s.name}  (${s.reason})${changed}${warn}`);
}
const saveManifest = async () => {
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
};
if (!todo.length) {
  if (!dryRun) await saveManifest();
  console.log("만들 것이 없습니다. 다시 만들려면 --force 또는 --only=단계id");
  process.exit(0);
}
if (dryRun) {
  console.log("(--dry-run: API 를 부르지 않았습니다)");
  process.exit(0);
}
if (!key || !voice) {
  console.error(
    "\nELEVENLABS_API_KEY 와 ELEVENLABS_VOICE_ID 가 필요합니다.\n" +
      "PET 폴더에 .env 파일을 만들거나(.env.example 참고), PowerShell 환경 변수로 넣어 주세요.",
  );
  process.exit(1);
}

// 오류 메시지를 알아듣기 쉽게
function explain(status, body) {
  if (/missing_permissions/.test(body)) return "이 API 키에 필요한 권한이 없습니다. ElevenLabs → API Keys 에서 Text to Speech 권한을 켜 주세요.";
  if (status === 401) return "API 키가 틀렸거나 만료됐습니다. 키를 다시 확인하세요.";
  if (status === 403) return "이 키에 음성 생성(Text to Speech) 권한이 없습니다.";
  if (status === 404) return "Voice ID 를 찾을 수 없습니다. 복제 음성의 ID 를 다시 확인하세요.";
  if (status === 422) return "요청 형식 오류: " + body.slice(0, 200);
  if (/quota|credit/i.test(body)) return "크레딧(사용량)이 부족합니다. 요금제·남은 크레딧을 확인하세요.";
  return `HTTP ${status}: ${body.slice(0, 200)}`;
}

async function tts(s) {
  const prev = s.prev && toSpoken(s.prev).spoken;
  const next = s.next && toSpoken(s.next).spoken;
  const body = JSON.stringify({ text: s.spoken, model_id: model, voice_settings: settings, previous_text: prev, next_text: next });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body,
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error("받은 음성 파일이 너무 작습니다(빈 응답).");
      return buf;
    }
    const text = await res.text();
    // 너무 많이 요청함(429)·서버 오류(5xx)는 잠시 뒤 다시 시도
    if ((res.status === 429 || res.status >= 500) && attempt < 4 && !/quota|credit/i.test(text)) {
      const wait = 2000 * attempt;
      console.log(`  잠시 후 다시 시도 (${res.status}, ${wait / 1000}초)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(explain(res.status, text));
  }
}

// ffmpeg 가 있으면 음량을 -16 LUFS 로 맞춘다 (펫 입 움직임이 파일마다 비슷해짐)
let ffmpeg = null;
if (normalize) {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    ffmpeg = "ffmpeg";
  } catch {
    console.log("ffmpeg 가 없어 음량 맞추기는 건너뜁니다. (설치: winget install Gyan.FFmpeg)");
  }
}
function level(file) {
  const tmp = file + ".norm.mp3";
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", file, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-b:a", "128k", tmp]);
  return tmp;
}

let made = 0;
for (const s of todo) {
  process.stdout.write(`만드는 중: ${s.name} … `);
  try {
    await mkdir(path.dirname(s.file), { recursive: true });
    const audio = await tts(s);
    // 중간에 끊겨도 기존 파일이 망가지지 않게 임시 파일에 쓴 뒤 바꿔 넣는다
    const tmp = s.file + ".part";
    await writeFile(tmp, audio);
    let final = tmp;
    if (ffmpeg) {
      final = level(tmp);
      await rm(tmp, { force: true });
    }
    await rename(final, s.file);
    manifest[s.name] = fingerprint(s);
    await saveManifest();
    made++;
    console.log(`완료 (${Math.round(audio.length / 1024)}KB${ffmpeg ? ", 음량 맞춤" : ""})`);
  } catch (e) {
    console.log("실패");
    console.error(`\n${s.name}: ${e.message}`);
    console.error(`만든 파일 ${made}개. 문제를 고친 뒤 다시 실행하면 남은 것만 만듭니다.`);
    process.exit(1);
  }
}

console.log(`\n끝. ${made}개를 만들었습니다.`);
console.log("들어 보기: npm start → '안내 시작'   어색한 문장은 src/tourScript.js 를 고친 뒤 다시 npm run voice (바뀐 것만 만듦)");
