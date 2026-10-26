// 영어·숫자를 한국어 발음으로 바꿔서 음성 합성에 보낸다. (자막은 원래 글자 그대로 보인다)
// 숫자: 기본은 한자어 수(2026년 → 이천이십육년), 세는 말 앞은 고유어 수(3개 → 세 개),
//       6월·10월 → 유월·시월, '시즌 2' → 시즌 투, 0으로 시작하는 번호는 한 자리씩(010 → 공일공).
// 사전에 없는 대문자 약어(예: PDF)는 알파벳을 하나씩 읽는다(피디에프).
// 사전에 없는 영어 단어는 그대로 두고 unknown 으로 알려 준다 → 아래 사전에 추가하면 된다.
export const PRONUNCIATION = {
  // 대본에 나오는 말
  AI: "에이아이",
  SF: "에스에프",
  Films: "필름스",
  Film: "필름",
  "Next Generation": "넥스트 제너레이션",
  ACA: "에이씨에이",
  "Advanced Low": "어드밴스드 로우",
  // 질문·답변에서 나올 만한 말
  YouTube: "유튜브",
  Figma: "피그마",
  Adobe: "어도비",
  Premiere: "프리미어",
  "After Effects": "애프터 이펙트",
  Photoshop: "포토샵",
  TOEIC: "토익",
  OPIc: "오픽",
  "D&D": "디앤디",
  Deadpool: "데드풀",
  Claude: "클로드",
  ChatGPT: "챗지피티",
  Sora: "소라",
  Midjourney: "미드저니",
  email: "이메일",
  "e-mail": "이메일",
};

const LETTERS = {
  A: "에이", B: "비", C: "씨", D: "디", E: "이", F: "에프", G: "지", H: "에이치", I: "아이", J: "제이",
  K: "케이", L: "엘", M: "엠", N: "엔", O: "오", P: "피", Q: "큐", R: "알", S: "에스", T: "티",
  U: "유", V: "브이", W: "더블유", X: "엑스", Y: "와이", Z: "제트",
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 긴 말부터 바꿔야 "Next Generation" 이 "Next" 보다 먼저 잡힌다
const ENTRIES = Object.entries(PRONUNCIATION).sort((a, b) => b[0].length - a[0].length);
const DICT_RE = new RegExp(`(?<![A-Za-z])(${ENTRIES.map(([k]) => escape(k)).join("|")})(?![A-Za-z])`, "gi");
const LOOKUP = new Map(ENTRIES.map(([k, v]) => [k.toLowerCase(), v]));

// ── 숫자 읽기 ─────────────────────────────────────────
const DIGIT = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];

// 한자어 수: 2026 → 이천이십육, 10000 → 만, 975 → 구백칠십오
function sino(n) {
  if (n === 0) return "영";
  const under10k = (v) =>
    [[1000, "천"], [100, "백"], [10, "십"], [1, ""]]
      .map(([u, name]) => {
        const d = Math.floor(v / u) % 10;
        if (!d) return "";
        return (d === 1 && name ? "" : DIGIT[d]) + name;
      })
      .join("");
  let out = "";
  ["", "만", "억", "조"].forEach((unit, i) => {
    const g = Math.floor(n / 10000 ** i) % 10000;
    if (g) out = (g === 1 && unit === "만" ? "" : under10k(g)) + unit + out;
  });
  return out;
}

// 고유어 수(1~99, 세는 말 앞): 3 → 세, 20 → 스무, 25 → 스물다섯
function native(n) {
  const tens = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
  const ones = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
  const t = Math.floor(n / 10), o = n % 10;
  return (t === 2 && o === 0 ? "스무" : tens[t]) + ones[o];
}

const ENGLISH_NUM = ["제로", "원", "투", "쓰리", "포", "파이브", "식스", "세븐", "에잇", "나인", "텐"];
// 고유어 수로 읽는 세는 말 (시: 시각 '3시에'는 고유어, '시즌·시작' 같은 말은 제외)
const NATIVE_COUNTER = /^\s?(?:개|명|살|마리|가지|권|군데|곳|잔|시간|번째|달|시(?=$|[\s,.!?]|에|부터|까지|쯤|반|가|는|를|도|와|로))/;
const NUMBER_RE = /(?<![A-Za-z\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![A-Za-z\d])/g;

const byDigit = (s) => [...s].map((d) => (d === "0" ? "공" : DIGIT[d])).join("");

function readNumbers(text) {
  return text
    // 전화번호는 묶음마다 한 자리씩: 010-1234-5678 → 공일공 일이삼사 오육칠팔
    .replace(/(?<!\d)0\d{1,2}-\d{3,4}-\d{4}(?!\d)/g, (m) => m.split("-").map(byDigit).join(" "))
    .replace(NUMBER_RE, (match, intPart, dec, offset, str) => {
      const digits = intPart.replace(/,/g, "");
      const before = str.slice(0, offset);
      const after = str.slice(offset + match.length);
      // 0으로 시작하는 번호(010 등)나 아주 긴 수는 한 자리씩: 공일공
      if ((digits.length > 1 && digits[0] === "0") || digits.length > 16)
        return byDigit(digits);
      const n = Number(digits);
      if (!dec) {
        if (/시즌\s?$/.test(before) && n <= 10) return ENGLISH_NUM[n]; // 시즌 2 → 시즌 투
        if (/^월/.test(after) && (n === 6 || n === 10)) return n === 6 ? "유" : "시"; // 유월·시월
        const counter = after.match(NATIVE_COUNTER);
        if (counter && n >= 1 && n <= 99) {
          const word = n === 1 && counter[0].trim() === "번째" ? "첫" : native(n);
          return word + (counter[0].startsWith(" ") ? "" : " ");
        }
      }
      return sino(n) + (dec ? "점" + [...dec].map((d) => DIGIT[d]).join("") : "");
    })
    .replace(/%/g, "퍼센트");
}

export function toSpoken(text) {
  let spoken = text.replace(DICT_RE, (m) => LOOKUP.get(m.toLowerCase()) ?? m);
  // 대문자 약어 2~5글자 → 알파벳 읽기
  spoken = spoken.replace(/(?<![A-Za-z])[A-Z]{2,5}(?![A-Za-z])/g, (m) => [...m].map((c) => LETTERS[c]).join(""));
  spoken = readNumbers(spoken);
  const unknown = [...new Set(spoken.match(/[A-Za-z][A-Za-z'-]*/g) || [])];
  return { spoken, unknown };
}
