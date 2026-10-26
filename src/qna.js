// 질문·답변(메인 프로세스 전용) — 키는 여기서만 쓰고 펫 화면에는 절대 넘기지 않는다.
//   듣기(STT)  : ElevenLabs Speech to Text — 방문자 질문 녹음을 글자로
//   답하기     : Claude — 사이트 내용만 근거로 짧게, 말하듯이
//   말하기(TTS): ElevenLabs 스트리밍 — 내 복제 음성으로, 만들어지는 대로 조각조각 보냄
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";
import { toSpoken } from "./pronunciation.js";

const ELEVEN = () => (process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io").replace(/\/$/, "");
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

// 무엇이 빠졌는지 알려 준다(빠진 게 없으면 빈 배열)
export function missingKeys() {
  const missing = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!process.env.ELEVENLABS_VOICE_ID) missing.push("ELEVENLABS_VOICE_ID");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) missing.push("ANTHROPIC_API_KEY");
  return missing;
}

// ── 듣기 ─────────────────────────────────────────────
export async function transcribe(bytes, mime) {
  const t0 = Date.now();
  const fd = new FormData();
  const ext = /wav/.test(mime) ? "wav" : "webm";
  fd.append("file", new Blob([bytes], { type: mime || "audio/webm" }), `question.${ext}`);
  fd.append("model_id", CONFIG.qna.sttModel);
  fd.append("language_code", "ko");
  fd.append("tag_audio_events", "false");
  const res = await fetch(`${ELEVEN()}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: fd,
  });
  if (!res.ok) throw new Error(`음성 인식 실패 (HTTP ${res.status}) ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();
  log(`음성 인식 ${Date.now() - t0}ms: ${json.text}`);
  return (json.text || "").trim();
}

// ── 답하기 ───────────────────────────────────────────
const END_MARK = "[끝]";

const FOCUS_RE = /^\s*\[보기:([^\]\s]+)\s*\]\s*/; // 답 맨 앞의 화면 위치 표시
const scrub = (t) => t.replace(/\[보기:[^\]]*\]/g, "").replaceAll(END_MARK, "").replace(/ {2,}/g, " ");

function systemPrompt(siteText, tourText, catalog = []) {
  const places = catalog.length
    ? `
- 화면 가리키기: 어떤 카드나 섹션 이야기를 꺼낼 때 그 말 바로 앞에 [보기:키] 를 붙이세요(키는 <화면_위치> 목록에서). 그 말을 하는 순간 화면이 그곳으로 넘어갑니다.
  미리 계획하지 말고, 답을 말해 나가면서 해당 작품·섹션 이름 앞에 바로 붙이면 됩니다. 답의 맨 앞에도 하나 붙이고, 관련된 곳이 없으면 맨 앞에 [보기:없음].
  예: [보기:research-1] 석사 논문은 … 연구예요. 책은 [보기:publications-1] 만화로 배우는 AI 영화만들기와 [보기:publications-2] 방구석 시네마틱을 냈어요.
  이 표시는 소리 내어 읽히지 않으니 문장 안에서 언급하지 마세요.`
    : "";
  const placeList = catalog.length
    ? `

<화면_위치>
${catalog.map((c) => `${c.key} | ${c.label}`).join("\n")}
</화면_위치>`
    : "";
  return systemPromptBody(siteText, tourText, places, placeList);
}

function systemPromptBody(siteText, tourText, places, placeList) {
  return `당신은 이윤호의 포트폴리오 사이트를 안내하는 데스크톱 펫입니다. 발표가 끝난 뒤 청중의 질문에 이윤호의 목소리(복제 음성)로 대답합니다.
청중은 이것이 이윤호의 목소리를 본뜬 AI라는 안내를 이미 들었습니다.

답변 규칙
- 이윤호 본인의 입장에서 1인칭("저", "제")으로, 친근하고 차분한 존댓말로 말하세요.
- 근거는 아래 <사이트_내용>과 <안내_대본>뿐입니다. 거기에 없는 사실(경력, 수치, 일정, 개인 정보, 의견)은 지어내지 말고 "그 부분은 사이트에 없어서 정확히 말씀드리기 어려워요. 사이트의 이메일로 물어봐 주세요."처럼 솔직하게 말하세요.
- 소리 내어 읽힐 답입니다. ${CONFIG.qna.maxAnswerChars}자 이내, 두세 문장으로 짧게 말하세요. 목록·기호·이모지·마크다운·괄호 설명은 쓰지 마세요.
- 첫 문장은 질문의 핵심 답만 담아 20자 안팎으로 아주 짧게 시작하세요. 자세한 내용은 그다음 문장에서 이어 가세요.
- 포트폴리오와 관계없는 요청(다른 사람에 대한 질문, 코드 작성, 민감한 주제 등)은 한 문장으로 정중히 사양하고 포트폴리오 이야기로 돌아오세요.
- 질문이 잘 안 들렸거나 뜻이 모호하면 짧게 다시 물어보세요.
- 질문하는 사람이 "없어요", "감사합니다", "끝" 처럼 질문을 마치겠다는 뜻을 보이면, 짧게 감사 인사를 하고 답의 맨 끝에 ${END_MARK} 를 붙이세요. 그 밖의 경우에는 ${END_MARK} 를 쓰지 마세요.${places}

<안내_대본>
${tourText}
</안내_대본>

<사이트_내용>
${siteText || "(사이트 창이 열려 있지 않아 안내 대본만 참고합니다)"}
</사이트_내용>${placeList}`;
}

let client = null;
let history = [];
let system = "";

const llmParams = () => ({
  model: CONFIG.qna.model,
  // 짧은 대화형 답이라 생각을 깊게 할 필요가 없다 → 빠른 응답
  output_config: { effort: "low" },
  // 안전 분류기가 거절하면 서버가 다른 모델로 자동으로 다시 시도한다
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  // 사이트 내용(긴 고정 부분)은 캐시해 두 번째 질문부터 빠르고 싸게
  system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
});

export function startConversation(siteText, tourText, catalog = []) {
  history = [];
  system = systemPrompt(siteText, tourText, catalog);
  // 캐시 미리 데우기: 첫 질문 전에 사이트 내용을 AI 쪽 캐시에 올려 두어 첫 답도 빨라진다.
  // max_tokens 0 → 답은 만들지 않고 캐시만 쓴다(출력 비용 없음). 실패해도 질문 시간에는 지장 없음.
  client ??= new Anthropic();
  const t0 = Date.now();
  client.beta.messages
    .create({ ...llmParams(), max_tokens: 0, messages: [{ role: "user", content: "warmup" }] })
    .then((r) => log(`캐시 데우기 ${Date.now() - t0}ms (캐시에 쓴 토큰 ${r.usage?.cache_creation_input_tokens ?? 0})`))
    .catch((e) => log(`캐시 데우기 실패: ${e.message}`));
}

const log = (msg) => console.log(`[qna] ${msg}`);

// 문장 끝: . ! ? … 뒤에 공백(또는 글 끝). 너무 짧은 조각은 다음 문장과 합친다.
const SENTENCE_END = /[.!?…。]+["'”’)]?(\s+)/;
// first: 답의 맨 처음 조각이면, 문장이 끝나기 전이라도 쉼표에서 끊어 먼저 말하기 시작한다(첫 소리를 앞당김).
function takeSentences(buffer, final, first = false) {
  const out = [];
  let rest = buffer;
  if (first && !final && !SENTENCE_END.test(rest)) {
    const comma = rest.search(/[,，]\s/);
    const lead = rest.match(FOCUS_RE)?.[0].length || 0; // 맨 앞 [보기:키] 길이는 빼고 센다
    if (comma - lead >= 12) {
      out.push(rest.slice(0, comma + 1).trim());
      rest = rest.slice(comma + 1);
    }
  }
  for (;;) {
    const m = rest.match(SENTENCE_END);
    if (!m) break;
    const cut = m.index + m[0].length;
    const piece = rest.slice(0, cut).trim();
    if (scrub(piece).trim().length < 8 && !final) {
      // 짧으면 다음 문장까지 기다렸다가 합친다
      const next = rest.slice(cut).match(SENTENCE_END);
      if (!next) break;
      const cut2 = cut + next.index + next[0].length;
      out.push(rest.slice(0, cut2).trim());
      rest = rest.slice(cut2);
      continue;
    }
    out.push(piece);
    rest = rest.slice(cut);
  }
  if (final && rest.trim()) {
    out.push(rest.trim());
    rest = "";
  }
  return { sentences: out.map((s) => s.replaceAll(END_MARK, "").trim()).filter(Boolean), rest };
}

// 질문에 답하면서 바로 말하기:
//   AI가 답을 쓰는 동안 문장이 하나 완성될 때마다 그 문장을 곧바로 내 목소리로 만들기 시작한다.
//   onText(지금까지의 답 글자), onChunk(소리 조각)를 부른다. 다 끝나면 { text, end } 를 돌려준다.
export async function ask(question, { onText, onChunk, onFocus, onSegment, signal }) {
  client ??= new Anthropic();
  const t0 = Date.now();
  const mark = (what) => log(`${what} ${Date.now() - t0}ms`);
  history.push({ role: "user", content: question });

  // 말할 문장 줄: AI가 채우고, 음성 쪽이 순서대로 꺼내 쓴다
  const queue = [];
  let llmDone = false;
  let wake = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const spoken = [];
  let firstAudio = true;
  let segIndex = 0;
  const voice = (async () => {
    for (;;) {
      if (signal.aborted) return;
      if (queue.length) {
        const { text, speech, marks } = queue.shift();
        const seg = segIndex++;
        // 이 문장 소리가 시작되는 자리 표시 → 펫 화면이 '이 문장은 재생 n초부터'를 알 수 있다
        onSegment?.(seg);
        await speakStream(speech, (c) => {
          if (firstAudio) mark("첫 소리 조각");
          firstAudio = false;
          onChunk(c);
        }, signal, spoken.join(" "), {
          marks,
          // 표시한 글자를 말하기 시작하는 시각(문장 시작부터 초) → 그때 화면 이동
          onMark: (key, seconds) => onFocus?.(key, seg, seconds),
        });
        spoken.push(text);
        continue;
      }
      if (llmDone) return;
      await new Promise((r) => (wake = r));
    }
  })();

  // 문장 안의 [보기:키] 를 모두 떼어 내고, 각 표시가 읽을 글의 몇 번째 글자 앞에 있었는지 기억한다.
  // 영어·숫자 발음 바꾸기는 표시 사이 조각마다 따로 해서 위치가 어긋나지 않게 한다.
  const toItems = (sentences) =>
    sentences
      .map((raw) => {
        const parts = raw.split(/\[보기:([^\]\s]*)\s*\]/); // [글, 키, 글, 키, 글 …]
        let speech = "";
        const marks = [];
        for (let i = 0; i < parts.length; i++) {
          if (i % 2) {
            const key = parts[i];
            if (key && key !== "없음") {
              marks.push({ key, at: -1 }); // 다음 글자가 나올 때 위치를 정한다
              mark(`화면 위치 ${key}`);
            }
            continue;
          }
          let piece = toSpoken(parts[i].replaceAll(END_MARK, "")).spoken;
          if (!speech || speech.endsWith(" ")) piece = piece.replace(/^\s+/, "");
          for (const m of marks) if (m.at < 0) m.at = speech.length;
          speech += piece;
        }
        speech = speech.replace(/ {2,}/g, " ").trim();
        for (const m of marks) m.at = Math.min(Math.max(m.at, 0), speech.length);
        return { text: scrub(raw).trim(), speech, marks };
      })
      .filter((i) => i.speech);

  let full = "";
  let buffer = "";
  try {
    const stream = client.beta.messages.stream({ ...llmParams(), max_tokens: 16000, messages: history }, { signal });
    let firstText = true;
    let firstSentence = false;
    stream.on("text", (delta) => {
      if (firstText) mark("AI 첫 글자");
      firstText = false;
      full += delta;
      buffer += delta;
      onText(scrub(full).replace(/\[[^\]]*$/, "").trim());
      const { sentences, rest } = takeSentences(buffer, false, !spoken.length && !queue.length && firstAudio);
      buffer = rest;
      const items = toItems(sentences);
      if (items.length) {
        if (!firstSentence) mark("첫 문장 완성");
        firstSentence = true;
        queue.push(...items);
        notify();
      }
    });
    const message = await stream.finalMessage();
    const u = message.usage || {};
    mark(`AI 답 완료 (캐시 읽음 ${u.cache_read_input_tokens ?? 0} / 새로 읽음 ${u.input_tokens ?? 0} 토큰)`);
    const { sentences } = takeSentences(buffer, true);
    queue.push(...toItems(sentences));
    llmDone = true;
    notify();

    if (message.stop_reason === "refusal") {
      history.pop();
      await voice;
      return { text: null, end: false, reason: "refusal" };
    }
    history.push({ role: "assistant", content: message.content });
    await voice;
    mark("음성 받기 완료");
    const text = scrub(full).trim();
    return { text, end: full.includes(END_MARK) };
  } catch (e) {
    llmDone = true;
    queue.length = 0;
    notify();
    await voice.catch(() => {});
    if (history.at(-1)?.role === "user") history.pop();
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic API 키가 틀렸습니다(.env 의 ANTHROPIC_API_KEY).");
    if (e instanceof Anthropic.RateLimitError) throw new Error("AI 요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.");
    if (e instanceof Anthropic.APIError) throw new Error(`AI 응답 실패 (HTTP ${e.status}) ${e.message.slice(0, 160)}`);
    throw e;
  }
}

// ── 말하기 (스트리밍) ─────────────────────────────────
// onChunk(Uint8Array) 를 소리 조각이 도착할 때마다 부른다. signal 로 중간에 멈출 수 있다.
// previousText: 앞에서 이미 말한 문장 — 문장을 나눠 만들어도 억양이 이어지게 한다.
// marks [{ key, at }]: 읽을 글의 at 번째 글자를 말하기 시작하는 시각을 onMark(key, 초) 로 알려 준다.
//   (ElevenLabs with-timestamps: 소리와 함께 글자마다 시작 시각이 온다)
// text 는 이미 한국어 발음으로 바꾼 글이어야 한다(toSpoken 적용 후).
export async function speakStream(text, onChunk, signal, previousText = "", { marks = [], onMark } = {}) {
  const res = await fetch(
    `${ELEVEN()}/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}/stream/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal,
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: CONFIG.qna.ttsModel,
        previous_text: previousText ? toSpoken(previousText).spoken : undefined,
        voice_settings: {
          stability: num(process.env.VOICE_STABILITY, 0.5),
          similarity_boost: num(process.env.VOICE_SIMILARITY, 0.8),
          style: num(process.env.VOICE_STYLE, 0),
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`음성 생성 실패 (HTTP ${res.status}) ${(await res.text()).slice(0, 160)}`);

  const pending = marks.filter((m) => m.at >= 0).sort((a, b) => a.at - b.at);
  // 맨 앞 표시는 소리를 기다릴 필요 없이 바로(문장 시작 = 0초)
  while (pending.length && pending[0].at === 0) onMark?.(pending.shift().key, 0);
  let charsSeen = 0;
  let lastTime = 0;
  const handle = (line) => {
    if (!line.trim()) return;
    const j = JSON.parse(line);
    if (j.audio_base64) onChunk(Buffer.from(j.audio_base64, "base64"));
    const a = j.alignment;
    if (a?.characters?.length) {
      for (let i = 0; i < a.characters.length; i++) {
        const idx = charsSeen + i;
        lastTime = a.character_start_times_seconds[i];
        while (pending.length && pending[0].at <= idx) onMark?.(pending.shift().key, lastTime);
      }
      charsSeen += a.characters.length;
    }
  };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  handle(buf);
  // 글자 시각을 못 받은 표시(드묾)는 마지막 시각에
  for (const m of pending) onMark?.(m.key, lastTime);
}
