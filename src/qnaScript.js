// 질문·답변 시간에 펫이 하는 정해진 말 — 미리 내 목소리 mp3로 만들어 두어 바로 재생된다(npm run voice).
// 답변 자체는 AI가 그때그때 만들어 실시간 음성으로 말한다.
export const qnaLines = [
  {
    id: "qna-intro",
    title: "질문 시간",
    text: "제 목소리를 본뜬 AI가 대답해 드릴게요. 말씀해 주세요.",
    audio: "/audio/qna/intro.mp3",
  },
  {
    id: "qna-sorry",
    title: "다시 한 번",
    text: "죄송해요, 잘 못 들었어요. 한 번 더 말씀해 주시겠어요?",
    audio: "/audio/qna/sorry.mp3",
  },
  {
    id: "qna-error",
    title: "잠시 문제가 있어요",
    text: "지금은 답변을 준비하지 못했어요. 궁금한 점은 사이트의 이메일로 보내 주세요.",
    audio: "/audio/qna/error.mp3",
  },
  {
    id: "qna-outro",
    title: "질문 시간 끝",
    text: "질문해 주셔서 감사합니다. 끝까지 들어 주셔서 고마워요!",
    audio: "/audio/qna/outro.mp3",
  },
];
