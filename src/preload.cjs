// 펫 화면(renderer)이 쓸 수 있는 기능만 골라서 열어 준다. API 키는 여기로 넘어오지 않는다.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pet", {
  getSteps: () => ipcRenderer.invoke("tour:steps"),
  getConfig: () => ipcRenderer.invoke("tour:config"),
  openSite: () => ipcRenderer.invoke("site:open"),
  focus: (selector) => ipcRenderer.invoke("site:focus", selector),
  clear: () => ipcRenderer.invoke("site:clear"),
  quit: () => ipcRenderer.send("app:quit"),
  onSiteClosed: (fn) => ipcRenderer.on("site-closed", () => fn()),

  // 질문·답변
  qnaInfo: () => ipcRenderer.invoke("qna:info"),
  qnaStart: () => ipcRenderer.invoke("qna:start"),
  transcribe: (bytes, mime) => ipcRenderer.invoke("qna:transcribe", bytes, mime),
  ask: (id, question) => ipcRenderer.invoke("qna:ask", id, question),
  stopSpeaking: () => ipcRenderer.invoke("qna:stop-speaking"),
  onChunk: (fn) => ipcRenderer.on("qna:chunk", (_e, id, chunk) => fn(id, chunk)),
  onChunkEnd: (fn) => ipcRenderer.on("qna:chunk-end", (_e, id) => fn(id)),
  onAnswerText: (fn) => ipcRenderer.on("qna:text", (_e, id, text) => fn(id, text)),
  onAnswerFocus: (fn) => ipcRenderer.on("qna:focus", (_e, id, key, seg, seconds) => fn(id, key, seg, seconds)),
  onAnswerSegment: (fn) => ipcRenderer.on("qna:seg", (_e, id, seg) => fn(id, seg)),
  focusTarget: (key) => ipcRenderer.invoke("qna:focus-target", key),
  micAccess: () => ipcRenderer.invoke("mic:access"),
  openMicSettings: () => ipcRenderer.invoke("mic:open-settings"),
});
