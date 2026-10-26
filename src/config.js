// 앱 설정 — 사이트 주소나 펫 모습을 바꿀 때는 이 파일만 고치면 된다.
export const CONFIG = {
  // 안내할 사이트
  siteUrl: "https://my-portfolio-wlq1.vercel.app/",
  // 안내 길이: "short" = 발표용 30초 안내(5단계, src/tour.js) / "full" = 사이트 대본 전체(10단계, 약 2분)
  tourMode: "short",
  // 펫 그림: 상태별로 assets/pet/ 의 파일 이름. null 이면 임시 펫을 그린다.
  // 고양이 그림은 `node scripts/build-pet-sprites.mjs` 로 다시 만들 수 있다.
  //  -talk 는 말하는 동안 입을 벌린 그림(없으면 그 상태에서는 입을 움직이지 않는다)
  petSprites: {
    idle: "cat-idle.svg",
    "idle-talk": "cat-idle-talk.svg",
    blink: "cat-blink.svg",
    sleepy: "cat-sleepy.svg",
    happy: "cat-happy.svg",
    "happy-talk": "cat-happy-talk.svg",
    point: "cat-point.svg",
    "point-talk": "cat-point-talk.svg",
    think: "cat-think.svg",
  },
  petName: "고양이 펫",
  // 음성 파일이 없을 때 자막을 보여 주는 시간: 글자당 ms (최소 3초)
  msPerChar: 90,
  // 안내를 하지 않고 이만큼(ms) 지나면 무심한 눈(sleepy)으로 바뀐다
  sleepyAfterMs: 20000,

  // 질문·답변: 마이크로 질문을 듣고(STT) AI가 답을 만들어 내 목소리로 말한다.
  // .env 에 ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ANTHROPIC_API_KEY 가 있어야 켜진다.
  qna: {
    enabled: true,
    autoStartAfterTour: true, // 안내가 끝나면 바로 질문 시간으로
    model: "claude-opus-5-5", // 답을 만드는 AI
    sttModel: "scribe_v1", // ElevenLabs 음성 인식
    ttsModel: "eleven_multilingual_v2", // 답을 읽는 목소리 (더 빠르게: "eleven_flash_v2_5")
    maxQuestions: 10, // 한 번의 질문 시간에 받을 최대 질문 수
    maxAnswerChars: 300, // 답 길이 상한(대략)
    waitForQuestionMs: 30000, // 이만큼 아무 말이 없으면 질문 시간을 마친다
    silenceMs: 1000, // 말을 멈추고 이만큼 조용하면 질문이 끝난 것으로 본다(짧을수록 빨리 답하지만 말 중간에 끊길 수 있음)
    maxQuestionMs: 20000, // 질문 하나의 최대 길이
    speechLevel: 0.035, // 이 크기 이상의 소리를 말소리로 본다(시끄러운 곳이면 높이기)
  },
};
