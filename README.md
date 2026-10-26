# Portfolio PET

포트폴리오 사이트(https://my-portfolio-wlq1.vercel.app/)를 **내 목소리로 안내하는 데스크톱 고양이 펫**입니다.

1. **안내**: 펫이 사이트를 전체화면으로 열고, 대본 순서대로 섹션을 스크롤·강조하면서 내 목소리(mp3)와 자막으로 소개합니다.
2. **질문 시간**: 안내가 끝나면 바로 마이크로 청중의 질문을 듣고, AI(Claude)가 사이트 내용만 근거로 답을 만들어 내 목소리로 실시간 대답합니다.
3. **화면 가리키기**: 답하는 동안 이야기하는 작품·섹션으로 사이트가 스크롤되고, 펫이 그곳을 가리킵니다. 여러 작품을 말하면 **이름을 말하는 순간마다** 차례로 넘어갑니다.

## 실행 환경

| 구분 | 요구 사항 |
|---|---|
| 운영체제 | **Windows 10 / 11 (64비트)** — 설치 파일은 Windows x64 용. macOS·Linux 는 확인하지 않음 |
| Node.js | **22.12 이상** (Electron 45 의 요구 사항). 개발·검증 환경: Node 24.21.0, npm 11.19.0 |
| Git | 저장소를 받을 때 (검증: 2.54) |
| 인터넷 | 사이트(`my-portfolio-wlq1.vercel.app`, `*.supabase.co`)와 질문 시간(`api.elevenlabs.io`, `api.anthropic.com`)에 접속 |
| 장치 | 스피커, (질문 시간) 마이크 — Windows 설정 → 개인정보 → 마이크 → "데스크톱 앱의 마이크 접근" 켜기 |
| 외부 서비스 계정 | ElevenLabs (복제 음성·음성 인식·음성 합성), Anthropic (AI 답변) — 질문 시간과 음성 만들기에만 필요 |

화면·메모리·네트워크 등 자세한 권장 사양은 아래 [환경 요건](#환경-요건)을 보세요.

## 의존성 (필요 라이브러리)

`npm install` 한 번으로 모두 설치됩니다. 정확한 버전은 `package-lock.json` 에 고정되어 있습니다.

| 패키지 | 버전 | 종류 | 쓰는 곳 |
|---|---|---|---|
| [`electron`](https://www.electronjs.org/) | 45.0.0 (`^45.0.0`) | 개발 | 앱 실행 엔진 (Chromium 156, Node 24 내장). 첫 실행 때 실행 파일(약 100MB)을 내려받음 |
| [`electron-builder`](https://www.electron.build/) | 26.15.3 (`^26.15.3`) | 개발 | Windows 설치 파일(.exe, NSIS) 만들기 |
| [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) | 1.3.0 (`^1.3.0`) | 실행 | 질문 시간의 AI 답변 (Claude, 스트리밍) — 설치 파일에 함께 들어감 |

npm 패키지가 아닌 외부 도구·서비스:

| 이름 | 필수 여부 | 쓰는 곳 |
|---|---|---|
| **ffmpeg** | 선택 | `npm run voice` 가 만든 음성의 음량을 -16 LUFS 로 맞춤. 없으면 건너뜀. 설치: `winget install Gyan.FFmpeg` |
| **ElevenLabs API** | 질문 시간·음성 만들기 | 복제 음성 합성(`eleven_multilingual_v2`, 스트리밍·글자별 시각), 음성 인식(`scribe_v1`) |
| **Anthropic API** | 질문 시간 | Claude Opus 5.5 (`claude-opus-5-5`) |

앱 코드(펫 화면·스크립트)는 위 패키지 외의 라이브러리를 쓰지 않습니다(브라우저·Node 기본 기능만 사용).

## 설치 및 실행

### 설치 파일로 (사용자)

1. [Releases](https://github.com/projectedprojectproject-coder/appforwebsite/releases) 에서 `PortfolioPET-Setup-<버전>.exe` 를 받아 실행합니다.
2. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** (코드 서명이 없는 설치 파일).
3. 바탕화면·시작 메뉴의 **Portfolio PET** 으로 실행합니다. 배포한 설치 파일에는 키가 들어 있어 **따로 설정하지 않아도 질문 시간까지 바로 됩니다** (아래 [설치 파일에 들어가는 키](#설치-파일에-들어가는-키)).

### 소스에서 (개발)

```powershell
git clone https://github.com/projectedprojectproject-coder/appforwebsite.git
cd appforwebsite
npm install                       # 의존성 설치
Copy-Item .env.example .env       # 환경 변수 파일 만들기 → 메모장으로 열어 값 채우기
npm start                         # 앱 실행 (첫 실행 때 Electron 실행 파일을 내려받음)
```

| 명령 | 하는 일 |
|---|---|
| `npm start` | 앱 실행 |
| `npm test` | 실제 앱을 켜서 자동 확인 (약 1분 30초, 가짜 서버·가짜 마이크라 비용 없음) |
| `npm test -- --full` | 위 + 안내 10단계 끝까지 → 질문 시간까지 (약 4분) |
| `npm run voice` | 내 목소리 mp3 만들기 (바뀐 것만). `-- --dry-run` 으로 미리 보기 |
| `npm run sync` | 포트폴리오 레포의 최신 대본 + 사이트에 올라간 mp3 받기 |
| `npm run sprites` | 고양이 그림·캐릭터 시트 다시 그리기 |
| `npm run dist` | `dist/PortfolioPET-Setup-<버전>.exe` 설치 파일 만들기 (`.env` 의 키를 함께 넣음) |

`npm run dist` 중 `EPERM: operation not permitted, rename …nsis…` 오류가 나면(백신이 내려받은 도구를 검사하는 중) 한 번 더 실행하면 됩니다.

## 환경 변수 설정

키는 **`.env` 파일**에 적습니다. 앱과 `npm run voice` 가 시작할 때 읽습니다.

| 실행 방법 | `.env` 위치 |
|---|---|
| 소스에서 (`npm start`, `npm run voice`) | 프로젝트 폴더 (`package.json` 옆) |
| 설치한 앱 | `%APPDATA%\Portfolio PET\.env` (탐색기 주소창에 `%APPDATA%\Portfolio PET` 입력) |

`.env.example` 을 복사해서 만들면 됩니다. 형식은 `이름=값` 한 줄씩, 따옴표 없이:

```dotenv
ELEVENLABS_API_KEY=여기에_ElevenLabs_키
ELEVENLABS_VOICE_ID=여기에_복제_음성_ID
ANTHROPIC_API_KEY=여기에_Anthropic_키
VOICE_STABILITY=0.7
VOICE_SIMILARITY=0.95
VOICE_STYLE=
```

| 변수 | 필수 | 어디서 받나 / 뜻 | 쓰는 곳 |
|---|---|---|---|
| `ELEVENLABS_API_KEY` | 질문 시간·음성 만들기 | ElevenLabs → Profile → API Keys (Text to Speech · Speech to Text 권한) | 음성 합성·인식 |
| `ELEVENLABS_VOICE_ID` | 질문 시간·음성 만들기 | ElevenLabs → Voices → 내 복제 음성 → Voice ID | 내 목소리 |
| `ANTHROPIC_API_KEY` | 질문 시간 | [console.anthropic.com](https://console.anthropic.com) → API Keys | AI 답변 |
| `VOICE_STABILITY` | 선택 (기본 0.5) | 0~1. 높을수록 억양이 안정적 | 음성 합성 |
| `VOICE_SIMILARITY` | 선택 (기본 0.8) | 0~1. 높을수록 원래 목소리에 가까움 | 음성 합성 |
| `VOICE_STYLE` | 선택 (기본 0) | 0~1. 말투 과장 | 음성 합성 |
| `ELEVENLABS_MODEL` | 선택 (기본 `eleven_multilingual_v2`) | `npm run voice` 가 쓰는 음성 모델 | 음성 만들기 |
| `ANTHROPIC_AUTH_TOKEN` | 선택 | `ANTHROPIC_API_KEY` 대신 쓰는 토큰 | AI 답변 |
| `ELEVENLABS_API_URL` · `ANTHROPIC_BASE_URL` | 테스트용 | API 주소를 바꿈. `npm test` 가 가짜 서버로 돌릴 때 씀 — 평소에는 비워 둠 | 테스트 |

- 세 개의 키(`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ANTHROPIC_API_KEY`) 중 하나라도 없으면 질문 시간이 꺼지고, 펫이 빠진 키 이름을 알려 줍니다. **안내는 키 없이도** 됩니다(미리 만든 mp3). 배포한 설치 파일은 키를 품고 있어 이 설정이 필요 없습니다.
- `.env` 대신 PowerShell 환경 변수로도 됩니다. 이미 설정된 환경 변수가 `.env` 보다 우선합니다.
  ```powershell
  $env:ANTHROPIC_API_KEY = "..."; npm start
  ```
- `.env` 파일 자체는 `.gitignore` 로 깃에서 빠지고, 설치 파일(.exe)에도 들어가지 않습니다.

### 설치 파일에 들어가는 키

`npm run dist` 는 빌드 직전에 `scripts/embed-keys.mjs` 로 `.env` 의 키(`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ANTHROPIC_API_KEY`, `VOICE_*`)를 **`src/embedded-config.js` 에 난독화해서 넣고**, 이 파일이 설치 파일 안에 함께 들어갑니다. 그래서 다른 PC에 설치해도 `.env` 없이 질문 시간이 바로 켜집니다.

- 앱이 키를 찾는 순서: **환경 변수 → 프로젝트 폴더 `.env` → `%APPDATA%\Portfolio PET\.env` → 설치 파일 안의 키 묶음**. 앞에 있는 값이 우선하므로, 특정 PC에서만 다른 키를 쓰려면 그 PC의 `.env` 에 넣으면 됩니다.
- `src/embedded-config.js` 는 `.gitignore` 로 **저장소에는 올라가지 않습니다.**
- 난독화는 키 모양이 그대로 보이지 않게 할 뿐이라, 설치 파일을 받은 사람이 마음먹으면 키를 꺼낼 수 있습니다. 설치 파일을 공개 배포하는 경우 Anthropic·ElevenLabs 콘솔에서 **사용 한도(월 사용량·크레딧 상한)** 를 걸어 두는 것을 권장합니다.
- 키 없는 설치 파일을 만들려면: `node scripts/embed-keys.mjs --clear` 후 `npx electron-builder --win` (이 경우 질문 시간은 각 PC의 `.env` 가 있어야 켜짐).
- 질문 시간의 동작(모델, 대기·침묵 시간 등)은 환경 변수가 아니라 `src/config.js` 의 `qna` 에서 바꿉니다 → [설정](#설정-srcconfigjs-의-qna).

## 사용법

1. 펫의 **안내 시작** → 안내 10단계 → 자동으로 질문 시간 → 🎤 표시가 뜨면 질문.
2. 안내 없이 바로 질문만 받으려면 **질문 받기** 버튼.
3. 발표하는 사람을 위한 자세한 안내는 [`사용가이드.md`](사용가이드.md).

| 버튼 | 뜻 |
|---|---|
| 안내 시작 | 사이트를 전체화면으로 열고 안내 시작 |
| 질문 받기 | 질문 시간만 바로 시작 (키가 모두 있을 때만 보임) |
| ◀ ❚❚ ▶ | 안내 중 이전 / 일시정지 / 다음 |
| ■ | 안내·질문 시간 끝내기 |
| ✕ | 앱 종료 |

펫을 잡고 끌면 위치를 옮길 수 있고, 사이트 창은 **Esc** 로 전체화면을 해제합니다.

## 내 목소리 만들기

ElevenLabs 에서 내 목소리를 복제(Instant Voice Clone)한 뒤 PET 폴더에서 만듭니다.

```powershell
npm run voice -- --dry-run    # 무엇을 만들지·어떻게 읽을지 미리 보기 (API 를 부르지 않음)
npm run voice                 # 바뀐 것만 만들기
```

만들어지는 파일:

| 위치 | 내용 |
|---|---|
| `assets/audio/tour/01-hero.mp3` … `09-awards.mp3`, `10-contact-qna.mp3` | 안내 10단계 |
| `assets/audio/qna/intro·sorry·error·outro.mp3` | 질문 시간의 정해진 말 (시작·되묻기·오류·마무리) |
| `assets/audio/voice-manifest.json` | 각 파일을 만든 문장·설정 기록 (바뀐 것 찾기용) |

| 옵션 | 뜻 |
|---|---|
| `--dry-run` | 만들 파일과 읽을 문장만 보기 |
| `--only=id,id` | 이 단계만 (이미 있어도) 다시 만들기. 예: `--only=awards,qna-intro` |
| `--force` | 전부 다시 만들기 |
| `--no-normalize` | 음량 맞추기 안 함 |

- **바뀐 것만 다시 만듭니다.** 대본이나 `.env` 음성 설정이 바뀐 파일만 골라 크레딧을 아낍니다.
- 앞뒤 단계 문장을 함께 보내 단계가 이어질 때 억양이 자연스럽습니다.
- **ffmpeg** 가 있으면 모든 파일 음량을 -16 LUFS 로 맞춥니다 (`winget install Gyan.FFmpeg`). 없으면 건너뜁니다.
- 음성이 없는 단계는 자막만 나오고 글자 수만큼 기다렸다 넘어갑니다.

### 영어·숫자 읽기

음성에만 한국어 발음으로 바꿔서 보내고, 자막은 원래 글자 그대로입니다 (`src/pronunciation.js`). 질문 시간의 AI 답변에도 똑같이 적용됩니다.

| 경우 | 예 |
|---|---|
| 사전에 있는 영어 | AI → 에이아이, Films → 필름스, Next Generation → 넥스트 제너레이션 |
| 사전에 없는 대문자 약어 | PDF → 피디에프 |
| 숫자 (기본) | 2026년 → 이천이십육년, 975점 → 구백칠십오점, 제4의 → 제사의 |
| 세는 말 앞 | 3개 → 세 개, 20명 → 스무 명, 1번째 → 첫 번째, 오후 3시에 → 세 시에 |
| 그 밖 | 6월·10월 → 유월·시월, 12% → 십이퍼센트, 010-1234-5678 → 공일공 일이삼사 오육칠팔, 시즌 2 → 시즌 투 |

사전에 없는 영어 단어는 그대로 읽히며 `--dry-run` 에서 ⚠ 로 알려 줍니다. `PRONUNCIATION` 에 추가하면 됩니다.

### 대본 고치기

- `src/tourScript.js`: 사이트와 같은 대본. `npm run sync` 를 하면 포트폴리오 레포 버전으로 **덮어써집니다**.
- `src/tour.js`: **앱에서만** 바꾸는 부분. 지금은 마지막 단계(연락처)의 끝 문장을 "감사합니다" 대신 "궁금한 점이 있으면 편하게 물어봐 주세요"로 바꿔 질문 시간으로 이어지게 합니다(`10-contact-qna.mp3`). 질문 시간을 끄면 원래 문장으로 돌아갑니다.
- `src/qnaScript.js`: 질문 시간의 정해진 말.

고친 뒤 `npm run voice` 를 실행하면 바뀐 단계만 다시 만듭니다.

## 질문 시간

**흐름**: 시작 멘트 → 🎤 듣는 중 → 말이 끝나면(1초 조용) 인식 → AI가 답을 쓰면서 바로 내 목소리로 말하기 → 다시 듣기

**끝나는 때**: "없어요·감사합니다" 같은 말을 하면 AI가 마무리 인사 / 30초 동안 질문 없음 / 질문 10개 / 3번 연속 못 알아들음 / ■ 버튼

| 단계 | 쓰는 것 | 실제 측정 (질문을 마친 뒤부터) |
|---|---|---|
| 음성 인식 | ElevenLabs Speech to Text (`scribe_v1`), 말한 부분만 잘라 16kHz WAV 로 | 0.6~1.0초 |
| 답 만들기 | Claude Opus 5.5 (effort low), 사이트 글은 캐시 | AI 첫 글자 1~2초 |
| 내 목소리 | ElevenLabs 스트리밍 + 글자별 시각 (`eleven_multilingual_v2`) | **답 첫 소리 3~4초** |

- **근거**: AI는 사이트 글(질문 시간 시작 때 읽음)과 안내 대본만 근거로, 이윤호 1인칭으로 두세 문장 답합니다. 사이트에 없는 내용은 지어내지 않고 이메일로 안내합니다. 관계없는 요청은 정중히 사양합니다.
- **빨리 말하기**: 답을 다 쓰기 전에 첫 문장(또는 첫 쉼표)부터 음성으로 만들고, 나머지 문장은 앞 문장이 재생되는 동안 만듭니다. 질문 시간이 시작될 때 사이트 내용을 AI 캐시에 미리 올려 둡니다.
- **화면 가리키기**: 질문 시간이 시작되면 사이트의 섹션과 카드(Films·논문·프로젝트·과제·저서·미디어 등 약 44곳)에 이름표를 붙여 AI에게 알려 줍니다. AI는 작품·섹션 이름 앞에 위치 표시를 붙이고, 앱은 ElevenLabs 가 알려 주는 **글자별 말하는 시각**으로 그 이름을 말하는 순간을 계산해 스크롤합니다. 한 문장 안에서 여러 작품을 나열해도 이름마다 차례로 넘어가고, 펫은 그동안 화면 쪽을 가리킵니다. 관련 없는 질문이면 화면을 움직이지 않습니다.
- **안전**: Anthropic 안전 분류기가 답을 거절하면 서버가 다른 모델로 자동 재시도합니다(서버 측 fallback).
- **비용**: 질문마다 음성 인식(질문 길이) + AI(첫 질문은 사이트 글 약 1만 토큰을 캐시에 쓰고, 이후는 캐시 읽기로 저렴) + 음성(답 글자 수).

### 설정 (`src/config.js` 의 `qna`)

| 항목 | 지금 값 | 뜻 |
|---|---|---|
| `enabled` | `true` | 질문 시간 켜기 |
| `autoStartAfterTour` | `true` | 안내가 끝나면 바로 질문 시간 |
| `model` | `claude-opus-5-5` | 답을 만드는 AI |
| `ttsModel` | `eleven_multilingual_v2` | 답을 읽는 목소리. `eleven_flash_v2_5` 로 바꾸면 첫 소리가 약 0.5초 빨라지지만 음질이 조금 다름 |
| `maxQuestions` | `10` | 한 번에 받을 최대 질문 수 |
| `maxAnswerChars` | `300` | 답 길이 상한(대략) |
| `waitForQuestionMs` | `30000` | 이만큼 질문이 없으면 마침 |
| `silenceMs` | `1000` | 이만큼 조용하면 질문이 끝난 것으로 봄 (말 중간에 끊기면 늘리기) |
| `maxQuestionMs` | `20000` | 질문 하나의 최대 길이 |
| `speechLevel` | `0.035` | 이 크기 이상을 말소리로 봄 (시끄러운 곳이면 높이기) |

## 펫

고양이 그림은 `scripts/build-pet-sprites.mjs` 가 SVG 로 그립니다 (`npm run sprites`, 캐릭터 시트: `design/character-sheet.html`).

🎬 **홍보 영상**: [`design/promo-video.mp4`](design/promo-video.mp4) — 모델 고양이가 거대해져 도시에 나타나는 15초 세로 영상 (AI 생성, OpenArt · 768×1344)

| 상태 | 언제 |
|---|---|
| 대기 · 눈 깜빡임 | 앱을 켰을 때, 질문을 들을 때 |
| 무심한 눈 | 20초 동안 아무것도 안 할 때 (클릭하면 깸) |
| 생각 중 | 안내할 섹션을 찾을 때, 질문을 인식·답을 준비할 때 |
| 반가움 | 첫 인사·마지막 인사·질문 시간 시작·마무리 |
| 가리키기 | 안내 중 섹션 소개, 질문 시간에 화면 위치를 보여 줄 때 |

말하는 동안 입이 움직입니다. 음성이 있으면 소리 크기에 맞춰, 없으면 자막 시간 동안 뻐끔거립니다.

## 환경 요건

**필수**를 못 맞추면 실행이 안 되거나 안내가 멈추고, **권장**을 못 맞추면 실행은 되지만 보기·듣기 품질이 떨어집니다.

### 앱을 쓰는 PC

| 항목 | 필수 | 권장 | 이유 |
|---|---|---|---|
| 운영체제 | Windows 10 / 11 **64비트** | Windows 11 최신 업데이트 | Electron 45(Chromium 156)는 Windows 10 이상만 지원 |
| 저장 공간 | 400MB 여유 | 1GB 여유 | 설치 후 약 360MB (실행 엔진 357MB + 그림·음성 약 5MB) |
| 메모리(RAM) | 4GB | 8GB 이상 | 펫 창 + 전체화면 사이트 창 약 300~500MB |
| 그래픽 | DirectX 11 지원 GPU(내장 가능) | 하드웨어 가속 켜짐 | 고양이 그림은 털 수천 가닥 + 흐림 효과 |
| 화면 | 1280×720 이상 | **1920×1080**, 배율 100~150% | 사이트는 전체화면, 펫(약 380×350)은 오른쪽 아래 |
| 모니터 | — | **주 모니터**에서 사용 | 펫과 사이트 모두 주 모니터에 열림. 발표용 모니터를 "주 디스플레이"로 지정 |
| 소리 | 스피커 또는 이어폰 | 음량 50% 이상 | Windows **기본 출력 장치**로 재생 |
| 마이크 | 마이크 1개 (질문 시간) | 청중 쪽을 향한 USB·회의용 마이크 | Windows **기본 입력 장치**를 먼저 쓰고, 그 장치가 완전 무음(꺼짐·음소거)이면 소리가 들어오는 다른 마이크로 자동 전환(스테레오 믹스 등 가상 장치 제외). 앱을 켤 때 미리 확인해 말풍선 아래에 장치 이름 표시. 권한이 꺼져 있으면 [마이크 설정 열기]로 안내하고, 켜지면 자동 재연결 |
| 인터넷 | 연결 필수 | 유선 또는 안정적인 Wi-Fi, 10Mbps 이상 | 사이트·질문 시간 모두 실시간. 섹션이 6초 안에 안 뜨면 그 단계를 건너뜀 |
| 글꼴 | — | [Pretendard](https://github.com/orioncactus/pretendard) | 말풍선 글꼴. 없으면 맑은 고딕 |

### 네트워크 (방화벽·프록시)

| 주소 | 용도 | 필요한 때 |
|---|---|---|
| `my-portfolio-wlq1.vercel.app` | 포트폴리오 사이트 | 항상 |
| `*.supabase.co` | 사이트의 글·사진·영상 목록 | 항상 (막히면 섹션이 비어 건너뜀) |
| `api.elevenlabs.io` | 내 목소리 생성, 질문 인식, 답변 음성 | 음성 만들 때, 질문 시간 |
| `api.anthropic.com` | AI 답변 | 질문 시간 |
| `www.youtube.com` 등 | 사이트에서 카드를 눌렀을 때 (기본 브라우저로 열림) | 선택 |
| `raw.githubusercontent.com` | `npm run sync` | 개발할 때만 |

### 발표·시연할 때

- **사이트는 앱 안에서 엽니다.** 펫이 조종하는 것은 앱이 연 창뿐이라, 따로 띄운 브라우저는 움직이지 않습니다.
- 화상회의로 공유할 때는 **"전체 화면" 공유**와 **"컴퓨터 소리 공유"** 를 함께 켜세요.
- **원격 데스크톱·가상 머신**에서는 투명 창이 검게 보일 수 있습니다. 실제 PC를 권장합니다.
- **방해 금지 모드**를 켜 알림 팝업을 막고, 노트북은 **전원 연결·고성능 모드**를 권장합니다.
- **질문 시간**: 마이크를 스피커에서 떨어뜨리세요(펫은 자기가 말하는 동안에는 듣지 않습니다). 청중의 목소리는 ElevenLabs(음성 인식)로, 질문 글은 Anthropic(AI 답변)으로 전송되니 필요하면 미리 알려 주세요. 시작 멘트에서 "제 목소리를 본뜬 AI가 대답한다"고 안내합니다.

### 개발·빌드하는 PC

| 항목 | 요건 |
|---|---|
| Node.js | **22.12 이상** (24 LTS 권장) |
| 처음 실행 | 첫 `npm start` 때 Electron 실행 파일(약 100MB)을 내려받음 |
| ffmpeg (선택) | 음성 음량 맞추기 (`winget install Gyan.FFmpeg`) |
| 테스트 | 포트 **9333** 이 비어 있어야 함. 테스트 중 사이트 창이 전체화면으로 열리니 마우스·키보드를 건드리지 않기 |
| 코드 서명 (선택) | 공개 배포라면 인증서. 없으면 SmartScreen "알 수 없는 게시자" 경고 |

## 테스트

명령은 [설치 및 실행](#설치-및-실행)의 표를 보세요. 테스트는 실제 앱을 DevTools 프로토콜로 조작합니다. 질문 시간은 **가짜 서버(ElevenLabs·Claude 흉내)와 가짜 마이크(소리 파일)** 로 시험하므로 비용이 들지 않습니다. 확인하는 것: 그림 9장, 눈 깜빡임, 전체화면 사이트·섹션 강조·스크롤, 입 움직임(소리 크기 기준), 일시정지, 질문 녹음 → 인식 → AI 답 → 실시간 음성, 말하는 시점에 맞춘 화면 이동(문장 사이·문장 안), 대화 이어 가기·마무리, 스크립트 오류.

## 폴더

| 위치 | 내용 |
|---|---|
| `src/main.js` | 창 만들기, 사이트 창 조종(스크롤·강조), 질문 시간 위치 목록 |
| `src/qna.js` | 질문 시간: 음성 인식·AI 답변·실시간 음성 (키는 여기서만 사용) |
| `src/config.js` | 사이트 주소, 펫 그림, 질문 시간 설정 |
| `src/tour.js` · `src/tourScript.js` | 안내 대본 (앱 전용 변경 · 사이트 대본) |
| `src/qnaScript.js` | 질문 시간의 정해진 말 |
| `src/pronunciation.js` | 영어·숫자 → 한국어 발음 |
| `src/preload.cjs` | 펫 화면에 열어 주는 기능 목록 |
| `renderer/pet.js` · `pet.html` · `pet.css` | 펫 화면: 말풍선, 버튼, 안내 진행, 음성 재생, 입 움직임 |
| `renderer/qna.js` | 질문 시간 화면: 마이크 듣기, 말 끝 감지, 실시간 재생, 말에 맞춘 화면 이동 |
| `assets/pet/` | 고양이 그림 (상태별 SVG) |
| `assets/audio/` | 내 목소리 mp3 (`tour/`, `qna/`) |
| `scripts/` | `generate-voice.mjs`(음성), `sync-tour.mjs`(대본 받기), `build-pet-sprites.mjs`(그림) |
| `design/` | 캐릭터 시트, 참고 사진, 홍보 영상(`promo-video.mp4`) |
| `tests/app.test.mjs` | 앱 자동 테스트 (스크린샷: `tests/screenshots/`) |
| `.env.example` | 키 설정 견본 |

## 문제가 생겼을 때

| 증상 | 확인할 것 |
|---|---|
| 펫 뒤가 검게 보임 | 원격 데스크톱·가상 머신이 아닌지, 그래픽 드라이버 |
| 단계가 계속 건너뛰어짐 | 인터넷, 방화벽에서 `*.supabase.co` |
| 소리가 안 남 | `assets/audio/` 에 mp3가 있는지, Windows 기본 출력 장치·음량 |
| 입이 거의 안 움직임 | mp3 음량이 너무 작지 않은지 (`npm run voice` 는 자동으로 맞춤) |
| '질문 받기' 버튼이 없음 | `.env` 의 키 세 개 (펫이 빠진 키 이름을 알려 줌) |
| "마이크 사용이 꺼져 있어요" | [마이크 설정 열기] → 마이크 액세스·데스크톱 앱 허용 켜기 (켜면 3초 안에 자동 재연결) |
| "마이크를 찾지 못했어요" / "다른 프로그램이 사용 중" | 마이크를 꽂거나 줌·팀즈를 닫으면 자동 재연결 |
| 엉뚱한 마이크가 잡힘 | 말풍선 아래 🎤 이름 확인 → Windows 소리 설정에서 기본 입력 장치 변경 → [다시 시도] |
| 질문을 못 알아들음 | 마이크 기본 장치·거리, 시끄러우면 `qna.speechLevel` 높이기 |
| 말이 끝나기 전에 끊김 | `qna.silenceMs` 를 1500 정도로 늘리기 |
| 답이 늦게 시작됨 | 인터넷 속도. 더 빠르게는 `qna.ttsModel` 을 Flash 로 |
| 화면이 안 움직임 | 사이트 창이 열려 있는지(질문 시간 시작 때 자동으로 열림), 관련 없는 질문이면 원래 안 움직임 |
| 영어·숫자 발음이 이상함 | `src/pronunciation.js` 사전에 추가 후 `npm run voice` |
| 펫이 다른 모니터에 뜸 | 원하는 모니터를 "주 디스플레이"로 |
| 사이트가 전체화면이 아님 | Esc 를 눌렀다면 "안내 시작"을 다시 |
