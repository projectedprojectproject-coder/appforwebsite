// 설치 파일에 넣을 키 묶음을 만든다 (npm run dist 가 빌드 직전에 실행).
//   .env 의 키를 읽어 src/embedded-config.js 에 감춰서(난독화) 적는다.
//   - 이 파일은 .gitignore 로 깃에 올라가지 않는다. 설치 파일(.exe) 안에만 들어간다.
//   - 난독화는 키 모양이 그대로 보이지 않게 할 뿐, 마음먹고 꺼내는 것까지 막지는 못한다.
//   - 앱은 환경 변수 → %APPDATA%\Portfolio PET\.env → 프로젝트 .env → 이 묶음 순서로 키를 찾는다.
//   --clear: 키 없이 빈 묶음으로 만든다 (키 없는 설치 파일을 만들 때).
import { writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "src", "embedded-config.js");
const NAMES = ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ANTHROPIC_API_KEY", "VOICE_STABILITY", "VOICE_SIMILARITY", "VOICE_STYLE"];

const values = {};
if (!process.argv.includes("--clear")) {
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
  } catch {
    /* .env 가 없으면 빈 묶음 */
  }
  for (const n of NAMES) if (process.env[n]) values[n] = process.env[n];
}

// XOR + base64 (src/embedded-config.js 의 풀기 코드와 짝)
const SALT = "portfolio-pet::" + Math.random().toString(36).slice(2);
const xor = (buf) => Buffer.from(buf.map((b, i) => b ^ SALT.charCodeAt(i % SALT.length)));
const blob = xor(Buffer.from(JSON.stringify(values), "utf8")).toString("base64");

await writeFile(
  OUT,
  `// 자동 생성 파일 (scripts/embed-keys.mjs) — 깃에 올리지 않는다. 직접 고치지 말 것.
const SALT = ${JSON.stringify(SALT)};
const BLOB = ${JSON.stringify(blob)};
export function embeddedEnv() {
  const raw = Buffer.from(BLOB, "base64");
  const out = Buffer.from(raw.map((b, i) => b ^ SALT.charCodeAt(i % SALT.length)));
  return JSON.parse(out.toString("utf8"));
}
`,
);
const keys = Object.keys(values);
console.log(`설치 파일용 키 묶음: ${keys.length ? keys.join(", ") : "(비어 있음 — 질문 시간은 각 PC의 .env 가 있어야 켜짐)"}`);
