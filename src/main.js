// 메인 프로세스 — 펫 창과 사이트 창을 만들고, 펫의 요청을 받아 사이트 창을 조종한다.
import { app, BrowserWindow, ipcMain, screen, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.js";
import { tourSteps } from "./tour.js";
import { qnaLines } from "./qnaScript.js";
import * as qna from "./qna.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 키 찾는 순서: 이미 설정된 환경 변수 → 프로젝트 폴더 .env(개발) → %APPDATA%/Portfolio PET/.env
//   → 설치 파일에 들어 있는 키 묶음(src/embedded-config.js, npm run dist 때 만들어짐).
// 앞에서 찾은 값이 있으면 뒤의 값으로 덮어쓰지 않는다.
for (const dir of [ROOT, app.getPath("userData")]) {
  try {
    process.loadEnvFile(path.join(dir, ".env"));
  } catch {
    /* 없으면 넘어감 */
  }
}
try {
  const { embeddedEnv } = await import("./embedded-config.js");
  for (const [k, v] of Object.entries(embeddedEnv())) if (!process.env[k]) process.env[k] = v;
} catch {
  /* 개발 중이거나 키 없이 만든 설치 파일 */
}

let petWin = null;
let siteWin = null;

const PET_W = 380;
const PET_H = 350;

function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: workArea.x + workArea.width - PET_W - 16,
    y: workArea.y + workArea.height - PET_H - 16,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    title: CONFIG.petName,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWin.setAlwaysOnTop(true, "screen-saver");
  // 마이크는 펫 화면(질문 듣기)에만 허용하고, 사이트 창의 권한 요청은 모두 거절한다.
  const allow = (wc, permission) => permission === "media" && wc === petWin?.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allow(wc, permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allow(wc, permission));
  petWin.loadFile(path.join(ROOT, "renderer", "pet.html"));
  petWin.on("closed", () => {
    petWin = null;
    app.quit();
  });
}

// 펫 창을 전체화면 사이트 창보다 위로 올린다.
function raisePet() {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.setAlwaysOnTop(true, "screen-saver");
  petWin.moveTop();
}

// 사이트 창: 전체화면으로 연다. 이미 열려 있으면 다시 전체화면으로 앞에 가져온다.
// Esc 를 누르면 전체화면을 해제한다.
async function openSiteWindow() {
  if (siteWin && !siteWin.isDestroyed()) {
    siteWin.show();
    siteWin.setFullScreen(true);
    siteWin.focus();
    raisePet();
    return;
  }
  const { bounds } = screen.getPrimaryDisplay();
  siteWin = new BrowserWindow({
    ...bounds,
    fullscreen: true,
    title: "포트폴리오",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  siteWin.setMenuBarVisibility(false);
  siteWin.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && siteWin.isFullScreen()) siteWin.setFullScreen(false);
  });
  siteWin.on("enter-full-screen", raisePet);
  // 사이트 안의 외부 링크(유튜브 등)는 기본 브라우저로 연다.
  siteWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  siteWin.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== new URL(CONFIG.siteUrl).origin) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  siteWin.on("closed", () => {
    siteWin = null;
    petWin?.webContents.send("site-closed");
  });
  await siteWin.loadURL(CONFIG.siteUrl);
  raisePet();
}

// 사이트 창 안에서 실행할 코드: 요소를 기다렸다가 스크롤하고 테두리로 강조한다.
// 데이터(Supabase)를 늦게 불러오는 섹션이 있어 최대 timeoutMs 동안 기다린다.
// block: 섹션은 "start"(맨 위에 맞춤), 카드 하나는 "center"(화면 가운데).
function focusScript(selector, timeoutMs, block = "start") {
  return `(async () => {
    const sel = ${JSON.stringify(selector)};
    const until = Date.now() + ${timeoutMs};
    let el = document.querySelector(sel);
    while (!el && Date.now() < until) {
      await new Promise(r => setTimeout(r, 200));
      el = document.querySelector(sel);
    }
    document.querySelectorAll("[data-pet-focus]").forEach(n => {
      n.style.outline = n.dataset.petFocus; n.removeAttribute("data-pet-focus");
    });
    if (!el) return false;
    el.dataset.petFocus = el.style.outline || "";
    el.style.outline = "3px solid #ff9f1c";
    el.style.outlineOffset = "6px";
    el.scrollIntoView({ behavior: "smooth", block: ${JSON.stringify(block)} });
    return true;
  })()`;
}

// 질문 시간에 AI가 가리킬 수 있는 화면 위치 목록을 만든다.
// 섹션(안내 대본의 target)과 그 안의 카드·그림마다 data-pet-target="키" 를 달고 { key, label } 을 돌려준다.
function catalogScript(sections) {
  return `(() => {
    const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
    const out = [];
    for (const s of ${JSON.stringify(sections)}) {
      const sec = document.querySelector(s.target);
      if (!sec) continue;
      sec.setAttribute("data-pet-target", s.id);
      out.push({ key: s.id, label: s.title + " (섹션 전체)" });
      const items = [...sec.querySelectorAll("article, a.feature-card, figure")].filter((el) => !el.parentElement.closest("article, figure"));
      items.slice(0, 14).forEach((el, i) => {
        const title = clean(el.querySelector("h3, h4, figcaption")?.innerText)
          || clean(el.getAttribute("aria-label")) || clean(el.querySelector("img")?.alt) || clean(el.innerText);
        const detail = clean(el.innerText).slice(0, 60);
        const key = s.id + "-" + (i + 1);
        el.setAttribute("data-pet-target", key);
        out.push({ key, label: s.title + " › " + (title || "항목 " + (i + 1)).slice(0, 60) + (detail && !detail.startsWith(title) ? " — " + detail : "") });
      });
    }
    return out;
  })()`;
}
let catalogKeys = new Set();

const CLEAR_SCRIPT = `document.querySelectorAll("[data-pet-focus]").forEach(n => {
  n.style.outline = n.dataset.petFocus; n.removeAttribute("data-pet-focus");
}); true`;

ipcMain.handle("tour:steps", () => tourSteps);
ipcMain.handle("tour:config", () => ({
  petName: CONFIG.petName,
  petSprites: CONFIG.petSprites,
  msPerChar: CONFIG.msPerChar,
  sleepyAfterMs: CONFIG.sleepyAfterMs,
}));
ipcMain.handle("site:open", () => openSiteWindow());
ipcMain.handle("site:focus", async (_e, selector) => {
  if (!siteWin || siteWin.isDestroyed()) await openSiteWindow();
  try {
    return await siteWin.webContents.executeJavaScript(focusScript(String(selector), 6000));
  } catch {
    return false;
  }
});
ipcMain.handle("site:clear", async () => {
  if (siteWin && !siteWin.isDestroyed()) await siteWin.webContents.executeJavaScript(CLEAR_SCRIPT).catch(() => {});
});
ipcMain.on("app:quit", () => app.quit());

// ── 질문·답변 ─────────────────────────────────────────
ipcMain.handle("qna:info", () => ({
  enabled: CONFIG.qna.enabled,
  autoStartAfterTour: CONFIG.qna.autoStartAfterTour,
  missing: qna.missingKeys(),
  lines: Object.fromEntries(qnaLines.map((l) => [l.id, l])),
  listen: {
    waitForQuestionMs: CONFIG.qna.waitForQuestionMs,
    silenceMs: CONFIG.qna.silenceMs,
    maxQuestionMs: CONFIG.qna.maxQuestionMs,
    speechLevel: CONFIG.qna.speechLevel,
  },
  maxQuestions: CONFIG.qna.maxQuestions,
}));
// 질문 시간 시작: 사이트 창을 열고(닫혀 있으면), 글과 가리킬 수 있는 위치 목록을 읽어 AI에게 준다
ipcMain.handle("qna:start", async () => {
  if (!siteWin || siteWin.isDestroyed()) await openSiteWindow().catch(() => {});
  let siteText = "";
  let catalog = [];
  if (siteWin && !siteWin.isDestroyed()) {
    // 사이트가 글·카드를 늦게 불러오므로, 내용 길이가 0.8초 동안 그대로일 때까지(최대 8초) 기다린 뒤 읽는다
    await siteWin.webContents
      .executeJavaScript(`(async () => {
        let last = -1, stableSince = Date.now();
        const until = Date.now() + 8000;
        while (Date.now() < until) {
          const n = document.body.innerText.length + document.querySelectorAll("article, figure, a").length;
          if (n !== last) { last = n; stableSince = Date.now(); }
          else if (Date.now() - stableSince > 800) break;
          await new Promise((r) => setTimeout(r, 150));
        }
      })()`)
      .catch(() => {});
    siteText = await siteWin.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    siteText = siteText.replace(/\n{3,}/g, "\n\n").slice(0, 60000);
    catalog = await siteWin.webContents.executeJavaScript(catalogScript(tourSteps)).catch(() => []);
  }
  catalogKeys = new Set(catalog.map((c) => c.key));
  console.log(`[qna] 화면 위치 ${catalog.length}곳: ${catalog.map((c) => c.key).join(", ")}`);
  qna.startConversation(siteText, tourSteps.map((s) => `[${s.title}] ${s.text}`).join("\n"), catalog);
  return { siteChars: siteText.length, targets: catalog.length };
});

// AI가 고른 위치로 스크롤. 목록에 없는 키는 무시하고, 카드가 사라졌으면 그 섹션으로.
async function focusTarget(key) {
  if (!catalogKeys.has(key) || !siteWin || siteWin.isDestroyed()) return false;
  const section = key.split("-")[0];
  const card = key !== section;
  const wc = siteWin.webContents;
  const ok = await wc.executeJavaScript(focusScript(`[data-pet-target="${key}"]`, 500, card ? "center" : "start")).catch(() => false);
  if (ok || !card) return ok;
  const step = tourSteps.find((s) => s.id === section);
  return step ? wc.executeJavaScript(focusScript(step.target, 500)).catch(() => false) : false;
}
const safe = (fn) => async (...a) => {
  try {
    return { ok: true, value: await fn(...a) };
  } catch (e) {
    console.error("[qna]", e.message);
    return { ok: false, error: e.message };
  }
};
ipcMain.handle("qna:transcribe", safe((_e, bytes, mime) => qna.transcribe(bytes, mime)));
// 질문에 답하면서 바로 말하기: 답 글자와 소리 조각을 오는 대로 펫 화면에 넘긴다
let asking = null;
let askStartedAt = 0;
ipcMain.handle("qna:ask", async (e, id, question) => {
  askStartedAt = Date.now();
  asking?.abort();
  const ctrl = (asking = new AbortController());
  const send = (ch, ...a) => !e.sender.isDestroyed() && e.sender.send(ch, id, ...a);
  try {
    const result = await qna.ask(String(question).slice(0, 1000), {
      onText: (text) => send("qna:text", text),
      onChunk: (chunk) => send("qna:chunk", chunk),
      // AI가 고른 화면 위치: 소리 조각 사이에 '여기서 이동' 표시로 끼워 보낸다.
      // 펫 화면이 그 문장을 재생하기 시작할 때 qna:focus-target 으로 스크롤을 요청한다(말과 화면이 맞도록).
      onFocus: (key, seg, seconds) => {
        if (catalogKeys.has(key)) send("qna:focus", key, seg, seconds);
      },
      // n번째 문장 소리가 여기서부터 시작한다는 표시 (소리 조각과 같은 순서로 보낸다)
      onSegment: (seg) => send("qna:seg", seg),
      signal: ctrl.signal,
    });
    return { ok: true, value: result };
  } catch (err) {
    if (ctrl.signal.aborted) return { ok: false, error: "중단됨" };
    console.error("[qna]", err.message);
    return { ok: false, error: err.message };
  } finally {
    send("qna:chunk-end");
  }
});
ipcMain.handle("qna:stop-speaking", () => asking?.abort());
ipcMain.handle("qna:focus-target", (_e, key) => {
  console.log(`[qna] 화면 이동 ${key} (질문 후 ${Date.now() - askStartedAt}ms)`);
  return focusTarget(String(key));
});

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
