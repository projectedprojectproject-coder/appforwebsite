// 포트폴리오 레포의 최신 대본(tourScript.js)과 배포된 사이트의 내 목소리 mp3를 앱으로 가져온다.
//   실행: npm run sync
//   - src/tourScript.js        ← GitHub 레포의 src/tour/tourScript.js
//   - assets/audio/tour/*.mp3  ← 사이트에 올라가 있는 /audio/tour/*.mp3 (없는 파일은 건너뜀)
// 이미 있는 mp3는 건너뛴다. 다시 받으려면: npm run sync -- --force
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_RAW = "https://raw.githubusercontent.com/projectedprojectproject-coder/my-portfolio/main/";
const SITE = "https://my-portfolio-wlq1.vercel.app";
const force = process.argv.includes("--force");

const scriptFile = path.resolve("src/tourScript.js");
const res = await fetch(REPO_RAW + "src/tour/tourScript.js");
if (!res.ok) {
  console.error("대본을 받지 못했습니다:", res.status);
  process.exit(1);
}
await writeFile(scriptFile, await res.text());
console.log("대본 갱신:", path.relative(process.cwd(), scriptFile));

const { tourSteps } = await import(pathToFileURL(scriptFile).href + "?t=" + Date.now());
const outDir = path.resolve("assets/audio/tour");
await mkdir(outDir, { recursive: true });

for (const s of tourSteps) {
  const name = path.basename(s.audio);
  const file = path.join(outDir, name);
  if (!force) {
    try {
      await access(file);
      console.log("건너뜀(이미 있음):", name);
      continue;
    } catch {
      /* 없으면 받는다 */
    }
  }
  const r = await fetch(SITE + s.audio);
  const type = r.headers.get("content-type") || "";
  // Vercel SPA는 없는 파일에도 index.html을 돌려줄 수 있어 형식을 확인한다.
  if (!r.ok || !type.startsWith("audio/")) {
    console.log("사이트에 없음:", name);
    continue;
  }
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  console.log("받음:", name);
}
console.log("끝. 음성이 없는 단계는 자막만 나오고 자동으로 넘어갑니다.");
