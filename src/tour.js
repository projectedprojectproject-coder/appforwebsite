// 앱에서 쓰는 안내 대본.
//   - "short"(기본): 발표용 30초 안내 — 이 파일의 SHORT_TOUR. 5단계, 음성은 assets/audio/tour-short/
//   - "full": 사이트 대본(tourScript.js) 10단계 약 2분. tourScript.js 는 npm run sync 로 사이트 버전에 덮어써지므로
//             앱 전용 변경(마지막 인사 등)은 여기에서 덧씌운다.
// 어느 쪽을 쓸지는 src/config.js 의 tourMode. 대본을 고친 뒤 npm run voice 를 하면 바뀐 단계만 다시 만든다.
import { tourSteps as siteSteps } from "./tourScript.js";
import { CONFIG } from "./config.js";

const withQna = CONFIG.qna.enabled && CONFIG.qna.autoStartAfterTour;

// ── 발표용 짧은 안내 (30초 이내) ──────────────────────
// 한 단계에 한 문장, 전체 약 160자(음성 약 21초) + 스크롤 시간. 말로 읽히므로 문장마다 끝을 맺는다.
const SHORT_TOUR = [
  {
    id: "hero",
    target: ".hero",
    title: "인사",
    text: "안녕하세요, 성균관대 대학원에서 영상과 AI를 연구하는 이윤호입니다.",
    audio: "/audio/tour-short/01-hero.mp3",
  },
  {
    id: "research",
    target: "#research",
    title: "연구",
    text: "그중에서도 유튜브 추천을 타고 퍼지는 AI 유사과학 영상을 파고들고 있어요.",
    audio: "/audio/tour-short/02-research.mp3",
  },
  {
    id: "projects",
    target: "#projects",
    title: "작품",
    text: "SF 단편부터 다큐, 광고까지 직접 만들었고요.",
    audio: "/audio/tour-short/03-projects.mp3",
  },
  {
    id: "publications",
    target: "#publications",
    title: "저서 · 수상",
    text: "책도 두 권 냈고, 우수논문상도 받았어요.",
    audio: "/audio/tour-short/04-publications.mp3",
  },
  withQna
    ? {
        id: "contact",
        target: "#contact",
        title: "질문",
        text: "궁금한 점 있으시면 편하게 물어봐 주세요.",
        audio: "/audio/tour-short/05-contact-qna.mp3",
      }
    : {
        id: "contact",
        target: "#contact",
        title: "연락처",
        text: "문의는 아래 이메일로 주세요. 감사합니다.",
        audio: "/audio/tour-short/05-contact.mp3",
      },
];

// ── 사이트 대본 전체 (약 2분) ─────────────────────────
// 안내가 끝나면 바로 질문 시간으로 이어질 때: 마지막 인사 대신 질문을 청한다
const QNA_OVERRIDES = {
  contact: {
    text: "마지막으로 연락처입니다. 연구 협업, 강연, 원고 청탁 같은 문의는 아래 이메일로 보내 주세요. 이제 궁금한 점이 있으면 편하게 물어봐 주세요.",
    audio: "/audio/tour/10-contact-qna.mp3",
  },
};
const FULL_TOUR = siteSteps.map((s) => ({ ...s, ...(withQna ? QNA_OVERRIDES[s.id] : null) }));

export const tourSteps = CONFIG.tourMode === "full" ? FULL_TOUR : SHORT_TOUR;
