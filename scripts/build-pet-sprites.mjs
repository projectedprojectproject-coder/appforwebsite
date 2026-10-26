// 고양이 펫 스프라이트(SVG)와 캐릭터 시트를 만든다.
//   실행: node scripts/build-pet-sprites.mjs
//   결과: assets/pet/cat-*.svg (앱에서 쓰는 그림), design/character-sheet.html (캐릭터 시트)
// 모델: 흰 장모 고양이(랙돌) — 파란 눈, 짙은 회갈색 귀, 이마의 회색 무늬(가운데 흰 V), 회색 꼬리, 흰 앞발, 분홍 코.
// 그림 방식: 외곽선 없이 부드러운 바탕색 위에 털 한 올 한 올(수천 개의 짧은 곡선)을 털 방향·털 색에 맞춰 그린다.
// 털은 고정된 난수(seed)로 만들어, 다시 실행해도 같은 그림이 나온다.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// ── 색 ────────────────────────────────────────────────
const RGB = {
  white: [248, 245, 241],
  cream: [229, 221, 213],
  grey: [192, 186, 188],
  greyDark: [148, 141, 145],
  mask: [138, 130, 134],
  maskDark: [98, 91, 95],
  point: [74, 67, 71],
  tail: [166, 160, 165],
  tailDark: [118, 112, 117],
};
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const COLORS = {
  ...Object.fromEntries(Object.entries(RGB).map(([k, v]) => [k, hex(v)])),
  innerEar: "#D8AFB7",
  eye: "#6E9BE0",
  eyeLight: "#CFE3FF",
  eyeDark: "#2F4F8F",
  pupil: "#0E1420",
  rim: "#2A2226",
  nose: "#E6A1AE",
  noseDark: "#C98393",
  mouth: "#5A2E35",
  tongue: "#E58C9B",
  whisker: "#F4F1EE",
};
const C = COLORS;

// ── 도구 ──────────────────────────────────────────────
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => Math.round(n * 10) / 10;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const unit = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const mirror = (x) => 240 - x;

// 반지름 함수로 정의한 부드러운 덩어리(머리·몸)
function blob(cx, cy, RX, RY) {
  const point = (th) => [cx + RX(th) * Math.cos(th), cy + RY(th) * Math.sin(th)];
  const inside = (x, y) => {
    const th = Math.atan2((y - cy) / RY(0), (x - cx) / RX(0));
    return ((x - cx) / RX(th)) ** 2 + ((y - cy) / RY(th)) ** 2 <= 1;
  };
  const path = (n = 48) => {
    const p = Array.from({ length: n }, (_, i) => point((i / n) * Math.PI * 2));
    let d = `M${f(p[0][0])} ${f(p[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d + "Z";
  };
  return { cx, cy, point, inside, path };
}

// 털 한 올씩 모아서, 색·굵기별로 하나의 path 로 묶어 그린다(파일 크기 절약).
class Fur {
  constructor(seed) {
    this.r = rng(seed);
    this.buckets = new Map();
  }
  add(x, y, dir, len, width, rgb, curl = 0.25) {
    const r = this.r;
    const d = unit(dir);
    const ex = x + d[0] * len, ey = y + d[1] * len;
    const bend = (r() - 0.5) * 2 * curl * len;
    const qx = (x + ex) / 2 - d[1] * bend, qy = (y + ey) / 2 + d[0] * bend;
    const k = 1 + (r() - 0.5) * 0.1;
    const col = hex(rgb.map((v) => Math.round((v * k) / 5) * 5));
    const w = Math.round(width * 5) / 5;
    const key = `${col}|${w}`;
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(`M${f(x)} ${f(y)}Q${f(qx)} ${f(qy)} ${f(ex)} ${f(ey)}`);
  }
  render(opacity = 0.85) {
    return [...this.buckets]
      .map(([key, ds]) => {
        const [col, w] = key.split("|");
        return `<path d="${ds.join("")}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" opacity="${opacity}"/>`;
      })
      .join("");
  }
}

// 영역 안에서 무작위 점 뽑기
function scatter(r, count, box, inside, fn) {
  let made = 0, tries = 0;
  while (made < count && tries < count * 30) {
    tries++;
    const x = box[0] + r() * (box[2] - box[0]);
    const y = box[1] + r() * (box[3] - box[1]);
    if (!inside(x, y)) continue;
    if (fn(x, y) !== false) made++;
  }
}

const DEFS = `<defs>
  <filter id="b1" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="320"><feGaussianBlur stdDeviation="1.2"/></filter>
  <filter id="b3" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="320"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="b6" filterUnits="userSpaceOnUse" x="-20" y="-20" width="280" height="320"><feGaussianBlur stdDeviation="6"/></filter>
  <radialGradient id="g-head" cx=".5" cy=".62" r=".62"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="${C.white}"/><stop offset="1" stop-color="${C.cream}"/></radialGradient>
  <radialGradient id="g-body" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="${C.white}"/><stop offset=".55" stop-color="${C.cream}"/><stop offset="1" stop-color="${C.grey}"/></radialGradient>
  <radialGradient id="g-bodyback" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="${C.greyDark}"/><stop offset="1" stop-color="${C.grey}"/></radialGradient>
  <linearGradient id="g-mask" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.maskDark}"/><stop offset="1" stop-color="${C.mask}"/></linearGradient>
  <linearGradient id="g-ear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B3539"/><stop offset="1" stop-color="${C.point}"/></linearGradient>
  <linearGradient id="g-inner" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B98D97"/><stop offset="1" stop-color="${C.innerEar}"/></linearGradient>
  <linearGradient id="g-nose" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.nose}"/><stop offset="1" stop-color="${C.noseDark}"/></linearGradient>
  <radialGradient id="g-iris" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="${C.eyeLight}"/><stop offset=".45" stop-color="${C.eye}"/><stop offset="1" stop-color="${C.eyeDark}"/></radialGradient>
</defs>`;

// ── 몸의 형태 ─────────────────────────────────────────
// 머리: 볼이 넓은 랙돌 얼굴. 아래쪽 옆(볼)이 더 부풀어 있다.
const HEAD = blob(
  120,
  94,
  (th) => 56 * (1 + 0.14 * Math.pow(Math.max(0, Math.sin(th)), 0.6) * Math.pow(Math.abs(Math.cos(th)), 0.8)),
  (th) => (Math.sin(th) < 0 ? 48 : 46),
);
// 몸: 위는 좁고 아래는 넓은 서양배 모양
const BODY = blob(
  120,
  206,
  (th) => 60 * (Math.sin(th) < 0 ? 0.74 + 0.26 * (1 + Math.sin(th)) : 1),
  (th) => (Math.sin(th) < 0 ? 64 : 52),
);
const TAIL = [[178, 232], [218, 262], [150, 280], [80, 262]];
const tailW = (t) => 10 + 3 * Math.sin(Math.PI * t) - 2 * t;
const bez = (P, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]);
};

// 털 색 지도 — 위치마다 털 색을 정한다.
function headColor(x, y, back = false) {
  const u = (x - 120) / 56, v = (y - 94) / 48;
  if (back) return mix(RGB.mask, RGB.maskDark, clamp(-v * 0.8)).map((c, i) => c + (RGB.grey[i] - c) * smooth(0.2, 0.9, v));
  let m = smooth(-0.1, -0.55, v) + (v < 0 ? 0.35 * smooth(0.4, 0.9, Math.abs(u)) * smooth(0.1, -0.3, v) : 0);
  // 가운데 흰 V(이마에서 눈 사이로 넓어지는 흰 털)
  const half = 0.55 * (v + 0.78);
  if (half > 0) m *= smooth(half * 0.75, half * 1.25, Math.abs(u));
  const base = mix(RGB.white, RGB.cream, 0.35 * smooth(0.5, 1.1, Math.abs(u)) * smooth(-0.2, 0.6, v));
  return mix(base, mix(RGB.mask, RGB.maskDark, clamp(-v - 0.3)), clamp(m));
}
function bodyColor(x, y, back = false) {
  const u = (x - 120) / 60, v = (y - 206) / 60;
  if (back) return mix(RGB.grey, RGB.greyDark, clamp(1 - Math.abs(u) * 1.4) * smooth(0.6, -0.4, v));
  const g = smooth(0.35, 0.95, Math.abs(u)) + 0.25 * smooth(-0.2, -0.7, v) * smooth(0.2, 0.6, Math.abs(u));
  return mix(RGB.white, mix(RGB.grey, RGB.greyDark, 0.35), clamp(g));
}

// ── 부위 ──────────────────────────────────────────────
function shadow() {
  return `<ellipse cx="124" cy="266" rx="92" ry="10" fill="#000" opacity=".14" filter="url(#b3)"/>`;
}

function body(back = false) {
  const fur = new Fur(back ? 301 : 101);
  const edge = new Fur(back ? 302 : 102);
  const r = rng(back ? 303 : 103);
  scatter(r, 900, [55, 140, 185, 262], BODY.inside, (x, y) => {
    const u = (x - 120) / 60;
    fur.add(x, y, [u * 0.5, 1], 4 + r() * 6, 0.7 + r() * 0.5, bodyColor(x, y, back));
  });
  for (let i = 0; i < 160; i++) {
    const th = (i / 160) * Math.PI * 2 + r() * 0.03;
    if (Math.sin(th) > 0.85) continue; // 바닥 쪽은 생략
    const [x, y] = BODY.point(th);
    const out = [Math.cos(th), Math.sin(th) * 0.6 + 0.5];
    edge.add(x - Math.cos(th) * 3, y - Math.sin(th) * 3, out, 6 + r() * 7, 0.8 + r() * 0.4, mix(bodyColor(x, y, back), RGB.greyDark, 0.15));
  }
  return `<path d="${BODY.path()}" fill="url(#${back ? "g-bodyback" : "g-body"})" filter="url(#b1)"/>
    ${back ? "" : `<ellipse cx="120" cy="232" rx="7" ry="30" fill="${C.cream}" opacity=".8" filter="url(#b3)"/>`}
    ${fur.render(0.8)}${edge.render(0.9)}`;
}

// 앞다리(서 있는 다리). side: -1 왼쪽, 1 오른쪽
function leg(side) {
  const x = 120 + side * 17;
  const fur = new Fur(200 + side);
  const r = rng(210 + side);
  const inside = (px, py) => Math.abs(px - x) < 9.5 && py > 176 && py < 252;
  scatter(r, 170, [x - 10, 176, x + 10, 252], inside, (px, py) => {
    fur.add(px, py, [(px - x) * 0.04, 1], 3 + r() * 4, 0.7 + r() * 0.3, mix(RGB.white, RGB.cream, smooth(4, 10, Math.abs(px - x)) * 0.8));
  });
  for (let py = 180; py < 248; py += 3.5) {
    const ex = x + side * 9.5;
    fur.add(ex, py, [side * 0.5, 1], 5 + r() * 4, 0.8, RGB.cream);
  }
  return `<path d="M${x - 11} 186 V250 M${x + 11} 186 V250" stroke="${C.cream}" stroke-width="4" filter="url(#b3)"/>
    <path d="M${x - 10.5} 196 V250 M${x + 10.5} 196 V250" stroke="#CFC6C0" stroke-width="1.6" opacity=".8" filter="url(#b1)"/>
    <rect x="${x - 10}" y="176" width="20" height="78" rx="9" fill="${C.white}" filter="url(#b1)"/>
    ${fur.render(0.85)}${paw(x, 254, side)}`;
}

function paw(x, y, side) {
  const fur = new Fur(220 + x);
  const r = rng(230 + x);
  for (let i = 0; i < 40; i++) {
    const a = Math.PI + r() * Math.PI;
    fur.add(x + Math.cos(a) * 12, y + Math.sin(a) * 6, [Math.cos(a), Math.sin(a) + 0.4], 3 + r() * 3, 0.8, RGB.white);
  }
  return `<ellipse cx="${x}" cy="${y}" rx="14" ry="8" fill="${C.white}" filter="url(#b1)"/>
    <ellipse cx="${x}" cy="${y + 4}" rx="13" ry="3.5" fill="${C.cream}" opacity=".9" filter="url(#b1)"/>
    ${fur.render(0.9)}
    <path d="M${x - 5} ${y - 1} q.6 3.5 -.4 6.5 M${x + 0.5} ${y - 2} v7 M${x + 5.5} ${y - 1} q-.6 3.5 .4 6.5" fill="none" stroke="#B7ADA8" stroke-width="1" stroke-linecap="round"/>`;
}

// 들어 올린 앞다리: 어깨 → 발
function raisedLeg(sx, sy, px, py) {
  const fur = new Fur(sx * 7 + px);
  const r = rng(sx * 11 + py);
  const d = unit([px - sx, py - sy]);
  const n = [-d[1], d[0]];
  const len = Math.hypot(px - sx, py - sy);
  for (let i = 0; i < 150; i++) {
    const t = r(), o = (r() - 0.5) * 18;
    const x = sx + d[0] * len * t + n[0] * o, y = sy + d[1] * len * t + n[1] * o;
    fur.add(x, y, [d[0] + n[0] * o * 0.04, d[1] + n[1] * o * 0.04 + 0.4], 3 + r() * 5, 0.8, mix(RGB.white, RGB.cream, Math.abs(o) / 12));
  }
  for (let i = 0; i < 40; i++) {
    const t = r(), s = r() < 0.5 ? -1 : 1;
    const x = sx + d[0] * len * t + n[0] * s * 9, y = sy + d[1] * len * t + n[1] * s * 9;
    fur.add(x, y, [n[0] * s + 0.2 * d[0], n[1] * s + 0.6], 5 + r() * 5, 0.9, RGB.cream);
  }
  const ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  return `<path d="M${sx} ${sy} L${px} ${py}" stroke="#BDB3AE" stroke-width="23" stroke-linecap="round" opacity=".7" filter="url(#b3)" transform="translate(1.5 3)"/>
    <path d="M${sx} ${sy} L${px} ${py}" stroke="${C.white}" stroke-width="19" stroke-linecap="round" filter="url(#b1)"/>
    ${fur.render(0.85)}
    <g transform="rotate(${f(ang + 90)} ${px} ${py})">
      <ellipse cx="${px}" cy="${py}" rx="12.5" ry="10" fill="${C.white}" filter="url(#b1)"/>
      <path d="M${px - 5} ${py - 9} q.6 3 -.3 6 M${px} ${py - 10} v6 M${px + 5} ${py - 9} q-.6 3 .3 6" fill="none" stroke="#B7ADA8" stroke-width="1" stroke-linecap="round"/>
    </g>`;
}

function tail(back = false) {
  const P = back ? TAIL.map(([x, y]) => [mirror(x), y]) : TAIL;
  const fur = new Fur(back ? 401 : 400);
  const edge = new Fur(back ? 403 : 402);
  const r = rng(back ? 405 : 404);
  // 바탕 튜브
  let left = "", right = "";
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const t = i / N, c = bez(P, t);
    const a = bez(P, Math.max(0, t - 0.01)), b = bez(P, Math.min(1, t + 0.01));
    const tg = unit([b[0] - a[0], b[1] - a[1]]), n = [-tg[1], tg[0]], w = tailW(t);
    left += `${i ? "L" : "M"}${f(c[0] + n[0] * w)} ${f(c[1] + n[1] * w)}`;
    right = `L${f(c[0] - n[0] * w)} ${f(c[1] - n[1] * w)}` + right;
  }
  for (let i = 0; i < 520; i++) {
    const t = r(), c = bez(P, t);
    const a = bez(P, Math.max(0, t - 0.01)), b = bez(P, Math.min(1, t + 0.01));
    const tg = unit([b[0] - a[0], b[1] - a[1]]), n = [-tg[1], tg[0]];
    const o = (r() * 2 - 1) * tailW(t);
    const col = mix(RGB.tail, RGB.tailDark, 0.25 + 0.5 * t + 0.3 * Math.abs(o) / tailW(t));
    fur.add(c[0] + n[0] * o, c[1] + n[1] * o, [tg[0] + n[0] * o * 0.05, tg[1] + n[1] * o * 0.05], 6 + r() * 7, 0.8 + r() * 0.4, col);
    if (Math.abs(o) > tailW(t) * 0.7) {
      const s = Math.sign(o);
      edge.add(c[0] + n[0] * o, c[1] + n[1] * o, [tg[0] + n[0] * s * 1.2, tg[1] + n[1] * s * 1.2], 5 + r() * 6, 0.9, col);
    }
  }
  // 꼬리 끝 털
  const e = bez(P, 1), e0 = bez(P, 0.97), tg = unit([e[0] - e0[0], e[1] - e0[1]]);
  for (let i = 0; i < 30; i++) {
    const a = Math.atan2(tg[1], tg[0]) + (r() - 0.5) * 2.2;
    edge.add(e[0], e[1], [Math.cos(a), Math.sin(a)], 6 + r() * 8, 0.9, RGB.tailDark);
  }
  return `<path d="${left}${right}Z" fill="${C.tail}" filter="url(#b1)"/>${fur.render(0.85)}${edge.render(0.85)}`;
}

// 가슴 갈기(목 아래로 늘어진 긴 흰 털)
function ruff() {
  const fur = new Fur(501);
  const r = rng(502);
  scatter(r, 420, [64, 128, 176, 186], (x, y) => ((x - 120) / 54) ** 2 + ((y - 154) / 28) ** 2 <= 1, (x, y) => {
    const u = (x - 120) / 54;
    fur.add(x, y, [u * 0.7, 1], 9 + r() * 9, 0.9 + r() * 0.5, mix(RGB.white, RGB.cream, r() * 0.4 + smooth(0.6, 1, Math.abs(u)) * 0.4), 0.3);
  });
  return `<ellipse cx="120" cy="172" rx="46" ry="14" fill="${C.cream}" opacity=".7" filter="url(#b3)"/>
    <ellipse cx="120" cy="152" rx="52" ry="24" fill="${C.white}" filter="url(#b3)"/>
    ${fur.render(0.9)}`;
}

function ears(back = false) {
  const ear = (s) => {
    const X = (x) => (s < 0 ? x : mirror(x));
    const fur = new Fur(s < 0 ? 601 : 602);
    const r = rng(s < 0 ? 603 : 604);
    const outer = `M${X(66)} 76 Q${X(62)} 40 ${X(77)} 16 Q${X(81)} 14 ${X(86)} 19 Q${X(100)} 32 ${X(112)} 50 Z`;
    let inner = "";
    if (!back) {
      inner = `<path d="M${X(77)} 64 Q${X(74)} 40 ${X(80)} 26 Q${X(94)} 38 ${X(104)} 54 Z" fill="url(#g-inner)" filter="url(#b1)"/>`;
      // 귀 안쪽 흰 장식털
      for (let i = 0; i < 26; i++) {
        const bx = 82 + r() * 18, by = 52 + r() * 12;
        fur.add(X(bx), by, [X(80 + r() * 4) - X(bx), 26 - by], 9 + r() * 9, 0.8, RGB.white, 0.2);
      }
    }
    // 귀 가장자리 짧은 털
    for (let i = 0; i < 30; i++) {
      const t = r();
      const onLeft = r() < 0.5;
      const x = onLeft ? 66 + (77 - 66) * t - 2 * Math.sin(Math.PI * t) : 86 + (112 - 86) * t;
      const y = onLeft ? 76 + (16 - 76) * t : 19 + (50 - 19) * t;
      fur.add(X(x), y, [onLeft ? X(-1) - X(0) : X(1) - X(0), -0.3], 2 + r() * 3, 0.8, RGB.point);
    }
    return `<path d="${outer}" fill="url(#g-ear)"/>${inner}${fur.render(0.9)}`;
  };
  return ear(-1) + ear(1);
}

const EYES = [[98, 94], [142, 94]];
function nearFeature(x, y) {
  for (const [ex, ey] of EYES) if (((x - ex) / 17) ** 2 + ((y - ey) / 12.5) ** 2 < 1) return true;
  if (((x - 120) / 9) ** 2 + ((y - 115) / 7) ** 2 < 1) return true;
  if (((x - 120) / 11) ** 2 + ((y - 129) / 8) ** 2 < 1) return true;
  return false;
}

function head(back = false) {
  const fur = new Fur(back ? 701 : 700);
  const edge = new Fur(back ? 703 : 702);
  const r = rng(back ? 705 : 704);
  scatter(r, 1300, [58, 40, 182, 150], HEAD.inside, (x, y) => {
    if (!back && nearFeature(x, y)) return false;
    const o = back ? [120, 70] : [120, 112];
    const dist = Math.hypot((x - o[0]) / 60, (y - o[1]) / 50);
    const d = unit([x - o[0], y - o[1]]);
    const down = y > 94 ? 0.5 : 0.1;
    fur.add(x, y, [d[0], d[1] + down], 2.2 + dist * 5 + r() * 2, 0.6 + r() * 0.4, headColor(x, y, back));
  });
  for (let i = 0; i < 300; i++) {
    const th = (i / 300) * Math.PI * 2 + r() * 0.02;
    const [x, y] = HEAD.point(th);
    const s = Math.sin(th), cheek = Math.max(0, s) * Math.abs(Math.cos(th));
    const len = (s < 0 ? 3 : 6) + cheek * 14 + r() * 5;
    const dir = [Math.cos(th), Math.sin(th) + (s > 0 ? 0.7 : 0.1)];
    const col = headColor(x - Math.cos(th) * 4, y - Math.sin(th) * 4, back);
    edge.add(x - Math.cos(th) * 4, y - Math.sin(th) * 4, dir, len, 0.9 + r() * 0.4, mix(col, RGB.cream, 0.25), 0.3);
  }
  const mask = back
    ? `<path d="${HEAD.path()}" fill="url(#g-mask)" filter="url(#b3)" opacity=".9"/>
       <ellipse cx="120" cy="140" rx="50" ry="16" fill="${C.grey}" filter="url(#b6)"/>`
    : `<path d="M66 70 C 76 38, 164 38, 174 70 C 160 80, 140 72, 128 84 L120 66 L112 84 C 100 72, 80 80, 66 70 Z" fill="url(#g-mask)" filter="url(#b6)" opacity=".85"/>
       <ellipse cx="120" cy="134" rx="44" ry="12" fill="${C.cream}" opacity=".6" filter="url(#b6)"/>`;
  return `<ellipse cx="120" cy="146" rx="46" ry="10" fill="#000" opacity=".12" filter="url(#b6)"/>
    <path d="${HEAD.path()}" fill="url(#g-head)" filter="url(#b1)"/>
    <clipPath id="clip-head${back ? "-b" : ""}"><path d="${HEAD.path()}"/></clipPath>
    <g clip-path="url(#clip-head${back ? "-b" : ""})">${mask}</g>
    ${fur.render(0.85)}${edge.render(0.9)}`;
}

// 눈: kind = open | sleepy | blink | slow ; gaze = [dx, dy]
function eye(cx, cy, s, kind, gaze, id) {
  const inner = [cx - s * 12.5, cy + 2.5], outer = [cx + s * 14, cy - 3.5];
  const up = [cx + s * 1, cy - 14.5], low = [cx, cy + 11];
  const almond = `M${inner[0]} ${inner[1]} Q${up[0]} ${up[1]} ${outer[0]} ${outer[1]} Q${low[0]} ${low[1]} ${inner[0]} ${inner[1]} Z`;
  const socket = `<ellipse cx="${cx + s}" cy="${cy}" rx="18" ry="13" fill="#CFC6C2" opacity=".55" filter="url(#b3)"/>`;
  if (kind === "blink") {
    return `${socket}<path d="M${inner[0]} ${inner[1]} Q${cx} ${cy + 5} ${outer[0]} ${outer[1]}" fill="none" stroke="${C.rim}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M${inner[0] + s * 2} ${inner[1] + 2.5} Q${cx} ${cy + 7} ${outer[0] - s * 2} ${outer[1] + 2.5}" fill="none" stroke="#D9D1CC" stroke-width="1.2" stroke-linecap="round" opacity=".8"/>`;
  }
  const ix = cx + gaze[0], iy = cy - 0.5 + gaze[1];
  let rays = "";
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    rays += `M${f(ix + Math.cos(a) * 3.8)} ${f(iy + Math.sin(a) * 4.4)}L${f(ix + Math.cos(a) * 10.2)} ${f(iy + Math.sin(a) * 10.2)}`;
  }
  // 윗눈꺼풀이 내려온 정도: sleepy(사진 속 무심한 눈) / slow(천천히 눈 감기 = 고양이의 반가움)
  const lidY = kind === "sleepy" ? cy - 3 : kind === "slow" ? cy + 0.5 : null;
  const lid =
    lidY === null
      ? ""
      : `<path d="M${inner[0] - s * 2} ${cy - 16} H${outer[0] + s * 2} V${lidY - 1} Q${cx} ${lidY - 3} ${inner[0] - s * 2} ${lidY + 3} Z" fill="${C.white}"/>`;
  const lidLine =
    lidY === null
      ? ""
      : `<path d="M${inner[0]} ${inner[1]} Q${cx + s} ${lidY - 4} ${outer[0]} ${outer[1]}" fill="none" stroke="${C.rim}" stroke-width="2" stroke-linecap="round"/>`;
  return `${socket}
    <clipPath id="eye-${id}"><path d="${almond}"/></clipPath>
    <g clip-path="url(#eye-${id})">
      <rect x="${cx - 16}" y="${cy - 16}" width="32" height="32" fill="#E9EEF6"/>
      <circle cx="${ix}" cy="${iy}" r="11.2" fill="url(#g-iris)"/>
      <path d="${rays}" stroke="#E6F0FF" stroke-width=".5" opacity=".45"/>
      <circle cx="${ix}" cy="${iy}" r="11.2" fill="none" stroke="${C.eyeDark}" stroke-width="1.4"/>
      <ellipse cx="${ix}" cy="${iy}" rx="3.4" ry="8.2" fill="${C.pupil}"/>
      <path d="M${inner[0]} ${inner[1] - 2} Q${up[0]} ${up[1] - 1} ${outer[0]} ${outer[1] - 2}" fill="none" stroke="#14203A" stroke-width="5" opacity=".35" filter="url(#b1)"/>
      <ellipse cx="${ix - 3.2}" cy="${iy - 4.2}" rx="2.6" ry="2" fill="#fff" opacity=".95"/>
      <circle cx="${ix + 3.8}" cy="${iy + 3.6}" r="1" fill="#fff" opacity=".7"/>
      ${lid}
    </g>
    <path d="${almond}" fill="none" stroke="${C.rim}" stroke-width="1.7" stroke-linejoin="round"/>
    ${lidLine}
    <path d="M${inner[0]} ${inner[1]} l${-s * 2.5} 1.8" stroke="${C.rim}" stroke-width="1.4" stroke-linecap="round"/>`;
}

function face(pose, id) {
  const kind = pose.eyes === "open" || pose.eyes === "up" ? "open" : pose.eyes;
  const gaze = pose.gaze || [0, 0];
  const eyes = eye(EYES[0][0], EYES[0][1], -1, kind, gaze, id + "l") + eye(EYES[1][0], EYES[1][1], 1, kind, gaze, id + "r");
  const nose = `<path d="M120 100 Q119 108 120 110" stroke="#D3CBC6" stroke-width="3" fill="none" opacity=".7" filter="url(#b1)"/>
    <path d="M112.5 111 Q120 107.5 127.5 111 Q125.5 116 120 119.5 Q114.5 116 112.5 111 Z" fill="url(#g-nose)"/>
    <path d="M115 114.2 q1.6 -1 2.8 .6 M125 114.2 q-1.6 -1 -2.8 .6" stroke="${C.noseDark}" stroke-width="1.1" fill="none" stroke-linecap="round"/>
    <ellipse cx="118" cy="110.6" rx="2.6" ry="1" fill="#fff" opacity=".55"/>`;
  const pads = `<ellipse cx="112" cy="123" rx="8.5" ry="6" fill="#fff" filter="url(#b1)"/><ellipse cx="128" cy="123" rx="8.5" ry="6" fill="#fff" filter="url(#b1)"/>
    <g fill="#B9AFAB">${[[107, 121], [110, 124], [106, 125], [111, 120.5], [133, 121], [130, 124], [134, 125], [129, 120.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7"/>`).join("")}</g>`;
  const chin = `<ellipse cx="120" cy="133" rx="8" ry="4" fill="${C.cream}" opacity=".9" filter="url(#b1)"/>`;
  const lips = `<path d="M120 119.5 V123 Q116 127.5 110.5 126 M120 123 Q124 127.5 129.5 126" fill="none" stroke="#7A6266" stroke-width="1.2" stroke-linecap="round"/>`;
  let mouth;
  if (pose.mouth === "talk" || pose.mouth === "smile") {
    const h = pose.mouth === "talk" ? 13 : 8;
    mouth = `<path d="M111.5 125 Q120 122.5 128.5 125 Q126 ${125 + h} 120 ${126 + h} Q114 ${125 + h} 111.5 125 Z" fill="${C.mouth}"/>
      <ellipse cx="120" cy="${124 + h * 0.8}" rx="${pose.mouth === "talk" ? 4.6 : 3.4}" ry="${pose.mouth === "talk" ? 2.8 : 1.8}" fill="${C.tongue}"/>
      <path d="M113.5 125.4 l1 3 l1 -3 Z M126.5 125.4 l-1 3 l-1 -3 Z" fill="#fff"/>` + lips;
  } else mouth = lips;
  const whisk = (s) => {
    const X = (x) => (s < 0 ? x : mirror(x));
    const lines = [
      [106, 121, 60, 108, 18, 104],
      [106, 123.5, 58, 118, 16, 120],
      [107, 126, 60, 128, 22, 138],
      [108, 128, 66, 136, 34, 152],
    ]
      .map(([x1, y1, cx, cy, x2, y2]) => `M${X(x1)} ${y1}Q${X(cx)} ${cy} ${X(x2)} ${y2}`)
      .join("");
    const brow = `M${X(93)} 79 Q${X(87)} 70 ${X(80)} 64 M${X(98)} 78 Q${X(95)} 70 ${X(91)} 63`;
    return `<path d="${lines}${brow}" fill="none" stroke="#6F686B" stroke-width="1.3" opacity=".35" transform="translate(.4 .6)"/>
      <path d="${lines}${brow}" fill="none" stroke="${C.whisker}" stroke-width=".9" stroke-linecap="round"/>`;
  };
  return eyes + nose + pads + chin + mouth + whisk(-1) + whisk(1);
}

// ── 포즈 조합 ─────────────────────────────────────────
// pose: { eyes: open|sleepy|blink|slow|up, mouth: closed|talk|smile, gaze:[dx,dy], paw: down|point|lift }
function cat(id, pose) {
  const leftLeg =
    pose.paw === "point" ? "" : pose.paw === "lift" ? "" : leg(-1);
  const raised =
    pose.paw === "point" ? raisedLeg(106, 182, 60, 150) : pose.paw === "lift" ? raisedLeg(104, 186, 100, 170) : "";
  return svg(`
    ${shadow()}
    ${body()}
    ${tail()}
    ${leftLeg}${leg(1)}
    ${ruff()}
    ${ears()}
    ${head()}
    ${face(pose, id)}
    ${raised}
  `);
}

function catBack() {
  return svg(`
    ${shadow()}
    ${body(true)}
    ${ears(true)}
    ${head(true)}
    ${tail(true)}
  `);
}

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" width="480" height="560">${DEFS}${inner}</svg>\n`;

// 앱 상태와 연결되는 스프라이트 목록 (-talk 는 말하는 동안 번갈아 보여 주는 입 벌린 그림)
export const SPRITES = [
  { file: "cat-idle.svg", label: "기본 (대기)", use: "앱을 켰을 때, 안내를 기다릴 때", pose: { eyes: "open", mouth: "closed" } },
  { file: "cat-idle-talk.svg", label: "기본 · 말하기", use: "기본 자세로 말할 때 입 모양", pose: { eyes: "open", mouth: "talk" } },
  { file: "cat-blink.svg", label: "눈 깜빡임", use: "대기 중 가끔 한 프레임", pose: { eyes: "blink", mouth: "closed" } },
  { file: "cat-sleepy.svg", label: "무심한 눈 (원본 표정)", use: "오래 가만히 있을 때", pose: { eyes: "sleepy", mouth: "closed" } },
  { file: "cat-happy.svg", label: "반가움 (천천히 눈 감기)", use: "첫 인사, 마지막 인사", pose: { eyes: "slow", mouth: "smile" } },
  { file: "cat-happy-talk.svg", label: "반가움 · 말하기", use: "인사하며 말할 때 입 모양", pose: { eyes: "slow", mouth: "talk" } },
  { file: "cat-point.svg", label: "가리키기", use: "섹션을 소개할 때 (화면 쪽을 가리킴)", pose: { eyes: "open", mouth: "closed", gaze: [-3, -1], paw: "point" } },
  { file: "cat-point-talk.svg", label: "가리키기 · 말하기", use: "가리키며 말할 때 입 모양", pose: { eyes: "open", mouth: "talk", gaze: [-3, -1], paw: "point" } },
  { file: "cat-think.svg", label: "생각 중", use: "\"화면을 찾는 중…\" (섹션 로딩)", pose: { eyes: "up", mouth: "closed", gaze: [-2, -3.5], paw: "lift" } },
];

// ── 캐릭터 시트 ───────────────────────────────────────
function sheet(sprites) {
  const swatches = Object.entries({
    "흰 털": C.white,
    "크림 그림자": C.cream,
    "옆구리 회색": C.grey,
    "등 회색": C.greyDark,
    "이마 무늬": C.mask,
    "이마 무늬(짙은)": C.maskDark,
    "귀 포인트": C.point,
    "귀 안쪽": C.innerEar,
    "꼬리": C.tail,
    "꼬리(짙은)": C.tailDark,
    "눈(파랑)": C.eye,
    "눈 테두리": C.rim,
    "코": C.nose,
    "입 안": C.mouth,
  })
    .map(([n, c]) => `<div class="sw"><span style="background:${c}"></span><b>${n}</b><code>${c}</code></div>`)
    .join("");

  const cards = sprites
    .map((s) => `<figure class="card">${s.svg}<figcaption><b>${s.label}</b><span>${s.use}</span><code>${s.file}</code></figcaption></figure>`)
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>고양이 펫 캐릭터 시트</title>
<style>
  :root { --bg:#f4f1ec; --paper:#fff; --ink:#2b2528; --muted:#7a7175; --line:#e4ddd5; --stage:#dfe4ea; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#1d1a1c; --paper:#2a2629; --ink:#f3eeea; --muted:#b2a8ad; --line:#3d373a; --stage:#3a3f47; } }
  :root[data-theme="dark"] { --bg:#1d1a1c; --paper:#2a2629; --ink:#f3eeea; --muted:#b2a8ad; --line:#3d373a; --stage:#3a3f47; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif; line-height:1.55; }
  main { max-width:1100px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:28px; margin:0 0 4px; }
  h2 { font-size:18px; margin:40px 0 14px; padding-bottom:6px; border-bottom:2px solid var(--line); }
  .sub { color:var(--muted); margin:0; }
  .top { display:grid; grid-template-columns: 1fr 1.4fr; gap:20px; margin-top:24px; }
  .panel { background:var(--paper); border:1px solid var(--line); border-radius:16px; padding:16px; }
  .ref img { width:100%; border-radius:10px; display:block; }
  .ref p { font-size:12px; color:var(--muted); margin:8px 0 0; }
  .turn { display:grid; grid-template-columns:1fr 1fr; gap:12px; text-align:center; }
  .turn svg, .card svg { width:100%; height:auto; background:radial-gradient(circle at 50% 55%, var(--stage), transparent 75%); border-radius:12px; }
  .turn span { font-size:13px; color:var(--muted); }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; margin:0; font-size:14px; }
  dt { color:var(--muted); }
  dd { margin:0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:14px; }
  .card { margin:0; background:var(--paper); border:1px solid var(--line); border-radius:14px; padding:10px; }
  figcaption { display:flex; flex-direction:column; gap:2px; font-size:13px; margin-top:6px; }
  figcaption span { color:var(--muted); font-size:12px; }
  code { font-family:ui-monospace,Consolas,monospace; font-size:11px; color:var(--muted); }
  .palette { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
  .sw { display:grid; grid-template-columns:36px 1fr; grid-template-rows:auto auto; column-gap:10px; align-items:center; background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:8px; font-size:13px; }
  .sw span { grid-row:span 2; width:36px; height:36px; border-radius:8px; border:1px solid rgba(0,0,0,.15); }
  ul { margin:0; padding-left:20px; font-size:14px; }
  li { margin:4px 0; }
  @media (max-width:760px) { .top { grid-template-columns:1fr; } }
</style>
</head>
<body>
<main>
  <h1>고양이 펫 캐릭터 시트</h1>
  <p class="sub">포트폴리오 안내 펫 · 실제 고양이 사진을 바탕으로 한 사실적인 페인팅 스타일</p>

  <div class="top">
    <div class="panel ref">
      <img src="reference.jpg" alt="모델이 된 고양이 사진">
      <p>참고 사진 — 흰 장모, 파란 눈, 짙은 귀, 이마 무늬, 회색 꼬리</p>
    </div>
    <div class="panel">
      <div class="turn">
        <div>${sprites.find((s) => s.file === "cat-idle.svg").svg}<span>앞모습</span></div>
        <div>${catBack()}<span>뒷모습</span></div>
      </div>
    </div>
  </div>

  <h2>기본 정보</h2>
  <div class="panel">
    <dl>
      <dt>이름</dt><dd>(미정)</dd>
      <dt>역할</dt><dd>포트폴리오 사이트 안내 펫 — 화면 오른쪽 아래에 앉아 화면 쪽을 가리키며 주인의 목소리로 소개</dd>
      <dt>품종 느낌</dt><dd>랙돌(바이컬러) — 몸집이 크고 털이 길며 얼굴이 둥글고 볼 털이 풍성함</dd>
      <dt>비율</dt><dd>머리 : 몸 ≈ 1 : 1.6, 앉은 자세 · 기준 크기 240×280</dd>
      <dt>성격</dt><dd>평소엔 무심한 눈빛(원본 표정), 안내할 때는 천천히 눈을 감았다 뜨며 친근하게</dd>
    </dl>
  </div>

  <h2>표정 · 포즈 (앱 상태 연결)</h2>
  <div class="grid">${cards}</div>

  <h2>색상</h2>
  <div class="palette">${swatches}</div>

  <h2>그릴 때 지킬 특징</h2>
  <div class="panel">
    <ul>
      <li><b>외곽선 없음</b> — 형태는 털 한 올 한 올과 부드러운 음영으로만 표현.</li>
      <li><b>털 방향</b>: 얼굴은 코에서 바깥으로, 볼은 바깥·아래로 길게, 몸은 아래로, 꼬리는 꼬리 방향으로.</li>
      <li><b>귀</b>는 가장 짙은 색(회갈색 포인트), 안쪽은 탁한 분홍에 흰 장식털.</li>
      <li><b>이마 무늬</b>는 정수리와 귀 주변을 덮는 회색, 가운데로 흰 털이 <b>뒤집힌 V</b> 모양으로 내려옴. 경계는 흐리게.</li>
      <li><b>눈</b>은 아몬드 모양, 짙은 테두리, 파란 홍채에 결이 있고 동공은 세로로 긴 타원.</li>
      <li><b>코</b>는 연분홍 가죽에 콧구멍, 주둥이 양옆은 흰 수염 패드, 수염은 흰색으로 길게.</li>
      <li><b>가슴 갈기</b>는 길고 풍성하게, <b>앞발</b>은 흰 장갑, <b>꼬리</b>는 회색으로 앞발을 감싸듯 둘러짐.</li>
    </ul>
  </div>
</main>
</body>
</html>
`;
}

// ── 파일 쓰기 ─────────────────────────────────────────
const petDir = path.resolve("assets/pet");
const designDir = path.resolve("design");
await mkdir(petDir, { recursive: true });
await mkdir(designDir, { recursive: true });

const rendered = SPRITES.map((s) => ({ ...s, svg: cat(s.file.replace(/\W/g, ""), s.pose) }));
for (const s of rendered) await writeFile(path.join(petDir, s.file), s.svg);
// 뒷모습은 앱에서 쓰지 않으므로 파일로 만들지 않고 캐릭터 시트 안에만 넣는다
await writeFile(path.join(designDir, "character-sheet.html"), sheet(rendered));
console.log(`스프라이트 ${rendered.length}개 → assets/pet/, 캐릭터 시트(뒷모습 포함) → design/character-sheet.html`);
