// AI 펫 투어 대본 — 여기만 고치면 말풍선 자막과 음성 대본이 함께 바뀐다.
//  - target : 스크롤해서 보여 줄 화면 요소(CSS 선택자). 그 요소가 없으면(예: 비어 있는 섹션) 그 단계는 건너뛴다.
//  - text   : 자막으로 보이고, 내 목소리 음성(mp3)을 만들 때 읽는 대본이다. 사이트에 있는 내용만 적는다.
//  - audio  : 내 목소리 파일 경로. 파일이 아직 없으면 자막만 보이고 시간이 지나면 자동으로 넘어간다.
// 음성 파일은 `npm run tour:voice`(scripts/generate-tour-voice.mjs)로 만들거나, 직접 만든 mp3를
// public/audio/tour/ 에 같은 이름으로 넣으면 된다.
export const tourSteps = [
  {
    id: "hero",
    target: ".hero",
    title: "인사",
    text: "안녕하세요, 성균관대학교 대학원 영상학과 석사과정에 재학 중인 이윤호입니다. 영상의 언어로 창작하고, AI의 시대를 탐구하고 있어요. 지금부터 제 포트폴리오를 한 바퀴 안내해 드릴게요.",
    audio: "/audio/tour/01-hero.mp3",
  },
  {
    id: "about",
    target: "#about",
    title: "소개",
    text: "여기는 소개입니다. 영상 연출과 편집 경험을 바탕으로 생성형 AI 영상 콘텐츠, 유사과학 담론, 유튜브 추천 환경을 연구하고 있어요. 클래퍼보드 모양 카드에 학과와 관심 주제, 재학 상태를 정리해 두었습니다.",
    audio: "/audio/tour/02-about.mp3",
  },
  {
    id: "featured",
    target: "#featured",
    title: "Films",
    text: "Films 섹션입니다. 제가 만든 영상 작업을 카드로 모았어요. 카드를 누르면 유튜브 영상으로 이동합니다.",
    audio: "/audio/tour/03-featured.mp3",
  },
  {
    id: "research",
    target: "#research",
    title: "연구",
    text: "연구 섹션이에요. 석사학위논문에서는 AI 슬롭과 유사과학 채널의 담론 구조, 그리고 유튜브 추천 알고리즘을 통한 노출과 확산을 비판적 담론분석으로 살펴보고 있습니다. 또 다른 주제는 데드풀 시리즈의 제4의 벽 파괴와 역설적 몰입입니다.",
    audio: "/audio/tour/04-research.mp3",
  },
  {
    id: "projects",
    target: "#projects",
    title: "프로젝트 & 창작",
    text: "프로젝트와 창작입니다. SF 창작 프로젝트 언캐니 밸리, 코미디 드라마 단편 코딱지, 시사교양 트립 어게인 시즌 2, 장애인 지원 광고, 뮤직비디오와 다큐멘터리까지 다양한 작업을 했어요.",
    audio: "/audio/tour/05-projects.mp3",
  },
  {
    id: "assignments",
    target: "#assignments",
    title: "과제",
    text: "과제 섹션에는 수업에서 만든 결과물을 올렸어요. 직접 플레이할 수 있는 커피 배달 게임, 시스템 프롬프트 문서, 디앤디 캠페인 기록, 피그마 작업, 그리고 영상 생성 숏폼과 비하인드 영상까지 있습니다.",
    audio: "/audio/tour/06-assignments.mp3",
  },
  {
    id: "publications",
    target: "#publications",
    title: "저서",
    text: "저서 섹션입니다. 만화로 배우는 AI 영화 만들기와, AI와 할리우드 공식으로 만드는 방구석 시네마틱을 출간했고, 다음 책도 준비하고 있어요.",
    audio: "/audio/tour/07-publications.mp3",
  },
  {
    id: "media",
    target: "#media",
    title: "미디어",
    text: "미디어 섹션에는 사진과 영상 자료를 모아 두었습니다.",
    audio: "/audio/tour/08-media.mp3",
  },
  {
    id: "awards",
    target: "#awards",
    title: "수상 · 자격증",
    text: "수상과 자격증입니다. 한국영상학회 2026년 봄 심포지엄에서 Next Generation 부문 우수논문상을 받았고, 어도비 ACA 자격증 세 가지와 토익 975점, 오픽 Advanced Low를 갖고 있어요.",
    audio: "/audio/tour/09-awards.mp3",
  },
  {
    id: "contact",
    target: "#contact",
    title: "연락처",
    text: "마지막으로 연락처입니다. 연구 협업, 강연, 원고 청탁 같은 문의는 아래 이메일로 보내 주세요. 끝까지 들어 주셔서 감사합니다.",
    audio: "/audio/tour/10-contact.mp3",
  },
];
