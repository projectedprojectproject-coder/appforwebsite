// 앱에서 쓰는 안내 대본 = 사이트 대본(tourScript.js) + 앱에서만 바꾸는 부분.
// tourScript.js 는 npm run sync 로 사이트 버전에 덮어써지므로, 앱 전용 변경은 여기에 둔다.
// 바꾼 단계는 음성 파일 이름도 따로 써서(…-qna.mp3) 사이트 음성과 섞이지 않게 한다.
import { tourSteps as siteSteps } from "./tourScript.js";
import { CONFIG } from "./config.js";

// 안내가 끝나면 바로 질문 시간으로 이어질 때: 마지막 인사 대신 질문을 청한다
const QNA_OVERRIDES = {
  contact: {
    text: "마지막으로 연락처입니다. 연구 협업, 강연, 원고 청탁 같은 문의는 아래 이메일로 보내 주세요. 이제 궁금한 점이 있으면 편하게 물어봐 주세요.",
    audio: "/audio/tour/10-contact-qna.mp3",
  },
};

const overrides = CONFIG.qna.enabled && CONFIG.qna.autoStartAfterTour ? QNA_OVERRIDES : {};
export const tourSteps = siteSteps.map((s) => ({ ...s, ...overrides[s.id] }));
