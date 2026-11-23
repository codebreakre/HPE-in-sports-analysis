// Thesis defense deck (Mongolian) for "Спортын шинжилгээнд хүний байрлалын тооцооллыг ашиглах нь".
// Numbers come from the thesis (report/) and results/. Build: node build.js <out.pptx>
const path = require("path");
const pptxgen = require("pptxgenjs");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const OUT = process.argv[2] || "defense.pptx";
const IMG = (f) => path.join(__dirname, f);

const THEME = {
  name: "HPE Sync",
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  colors: {
    dk1: "14213D", lt1: "FFFFFF", dk2: "3D4A63", lt2: "EEF2F7",
    accent1: "E76F51", accent2: "2A9D8F", accent3: "F4A261", accent4: "264653", accent5: "8D99AE", accent6: "E9C46A",
    hlink: "2A9D8F", folHlink: "264653",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "Спортын шинжилгээнд хүний байрлалын тооцооллыг ашиглах нь";
pres.author = "Б.Түвшинжаргал";
const C = pres.SchemeColor;

// ---------- layouts ----------
pres.defineSlideMaster({
  title: "TITLE_DARK",
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.25, w: 5.6, h: 1.7, fontSize: 30, bold: true, color: C.background1, valign: "bottom", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 3.1, w: 5.6, h: 1.6, fontSize: 14, color: "CADCFC", valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 28, bold: true, color: C.text1, valign: "middle", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 9.1, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
});
pres.defineSlideMaster({
  title: "SECTION_DARK",
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 28, bold: true, color: C.background1, valign: "middle", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 9.1, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
});

// ---------- helpers ----------
let shapeId = 0;
const name = (n) => `${n}-${++shapeId}`;

function card(slide, x, y, w, h, fill = C.background2) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { type: "none" }, rectRadius: 0.08, objectName: name("card") });
}
function text(slide, t, o) {
  slide.addText(t, { isTextBox: true, margin: 0, fontSize: 14, color: C.text1, valign: "top", objectName: name("text"), ...o });
}
function bullets(slide, items, o) {
  const runs = items.map((it, i) => ({
    text: it, options: { bullet: { indent: 14 }, breakLine: i < items.length - 1, paraSpaceAfter: 6 },
  }));
  slide.addText(runs, { isTextBox: true, margin: 0, fontSize: 14, color: C.text1, valign: "top", objectName: name("list"), ...o });
}
function numberDot(slide, n, x, y, fill = C.accent1, d = 0.42) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: "none" }, objectName: name("dot") });
  slide.addText(String(n), { isTextBox: true, x, y, w: d, h: d, margin: 0, align: "center", valign: "middle", fontSize: 14, bold: true, color: C.background1, objectName: name("dotnum") });
}
function stat(slide, value, label, x, y, w, color = C.accent1, size = 40) {
  text(slide, value, { x, y, w, h: 0.75, fontSize: size, bold: true, color, valign: "bottom" });
  text(slide, label, { x, y: y + 0.8, w, h: 0.6, fontSize: 12, color: C.text2 });
}
function line(slide, x1, y1, x2, y2, color, width = 3) {
  slide.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
    flipH: x2 < x1 !== y2 < y1 ? true : false, line: { color, width }, objectName: name("bone"),
  });
}
/** A stick figure from COCO-like keypoints (the deck's motif); cx, cy = hip centre, s = scale (inches). */
function skeleton(slide, cx, cy, s, boneColor, dotColor, pose = "arms-up") {
  const P = {
    head: [0, -1.55], neck: [0, -1.15], ls: [-0.32, -1.1], rs: [0.32, -1.1], lh: [-0.2, 0], rh: [0.2, 0],
    le: pose === "arms-up" ? [-0.62, -1.5] : [-0.6, -0.75], re: pose === "arms-up" ? [0.6, -1.55] : [0.62, -0.7],
    lw: pose === "arms-up" ? [-0.75, -1.95] : [-0.75, -0.35], rw: pose === "arms-up" ? [0.95, -1.75] : [0.9, -0.45],
    lk: [-0.3, 0.75], rk: [0.45, 0.6], la: [-0.35, 1.5], ra: [0.85, 1.15],
  };
  const pt = (k) => [cx + P[k][0] * s, cy + P[k][1] * s];
  const bones = [["ls", "rs"], ["ls", "le"], ["le", "lw"], ["rs", "re"], ["re", "rw"], ["ls", "lh"], ["rs", "rh"], ["lh", "rh"], ["lh", "lk"], ["lk", "la"], ["rh", "rk"], ["rk", "ra"]];
  for (const [a, b] of bones) line(slide, ...pt(a), ...pt(b), boneColor, 3);
  const [hx, hy] = pt("head");
  slide.addShape(pres.shapes.OVAL, { x: hx - 0.22 * s, y: hy - 0.22 * s, w: 0.44 * s, h: 0.44 * s, fill: { color: boneColor }, line: { type: "none" }, objectName: name("head") });
  for (const k of ["ls", "rs", "le", "re", "lw", "rw", "lh", "rh", "lk", "rk", "la", "ra"]) {
    const [x, y] = pt(k);
    const d = 0.13 * s;
    slide.addShape(pres.shapes.OVAL, { x: x - d / 2, y: y - d / 2, w: d, h: d, fill: { color: dotColor }, line: { type: "none" }, objectName: name("kp") });
  }
}
const chartBase = () => ({
  catAxisLabelColor: HEX.dk2, valAxisLabelColor: HEX.dk2, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
  catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontFace: "+mn-lt", dataLabelFontSize: 11, dataLabelColor: HEX.dk1,
  valGridLine: { color: "DCE2EA", size: 0.5 }, catGridLine: { style: "none" }, titleFontFace: "+mn-lt", titleColor: HEX.dk1, titleFontSize: 13,
  legendFontFace: "+mn-lt", legendFontSize: 11, legendColor: HEX.dk2,
});

// Category labels only at whole seconds (or every 0.4 s for τ), blank elsewhere, so the axis stays readable.
const secLabels = (n, t0, fps) => Array.from({ length: n }, (_, i) => (i % fps === 0 ? `${t0 + i / fps}` : ""));
const tauLabels = (tau) => tau.map((t) => (Math.abs(Math.round(t * 100) % 40) === 0 ? t.toFixed(1) : ""));
const lineOpts = (extra) => ({
  ...chartBase(), lineSize: 2, lineDataSymbol: "none", showLegend: true, legendPos: "b",
  catAxisLabelFrequency: 1, catAxisMajorTickMark: "none", valAxisLabelFormatCode: "0", ...extra,
});

// ================= Удиртгал =================
pres.addSection({ title: "Удиртгал" });

// 1. Title
{
  const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Удиртгал" });
  s.addText("Спортын шинжилгээнд хүний байрлалын тооцооллыг ашиглах нь", { placeholder: "title" });
  s.addText([
    { text: "Олон хүний хөдөлгөөний синхрончлолыг энгийн видеоноос үнэлэх нь", options: { breakLine: true, italic: true } },
    { text: " ", options: { breakLine: true, fontSize: 8 } },
    { text: "Б.Түвшинжаргал  ·  Удирдагч: Дэд профессор Б.Наранчимэг", options: { breakLine: true, color: "FFFFFF" } },
    { text: "МУИС, МТЭС, Мэдээлэл, компьютерын ухааны тэнхим  ·  2026", options: {} },
  ], { placeholder: "body" });
  skeleton(s, 7.35, 3.15, 0.95, HEX.accent1, HEX.lt1, "arms-up");
  skeleton(s, 8.75, 3.25, 0.8, HEX.accent2, HEX.lt1, "arms-up");
  s.addNotes("Сайн байцгаана уу. Миний дипломын ажлын сэдэв бол спортын шинжилгээнд хүний байрлалын тооцооллыг ашиглах нь. Тодруулбал, энгийн камерын бичлэгээс хоёр болон түүнээс дээш хүний хөдөлгөөн хэр синхрон байгааг тоогоор үнэлэх систем боловсруулсан.");
}

// 2. Problem
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Удиртгал" });
  s.addText("Синхрончлолыг нүдээр биш, тоогоор үнэлэх", { placeholder: "title" });
  card(s, 0.5, 1.3, 4.1, 3.6);
  text(s, "Одоогийн байдал", { x: 0.8, y: 1.55, w: 3.5, h: 0.4, fontSize: 18, bold: true, color: C.text2 });
  bullets(s, [
    "Шүүгч, дасгалжуулагч нүдээр үнэлдэг",
    "Субъектив, тоон хэмжүүргүй, давтагдах боломж муу",
    "Хөдөлгөөн бүртгэх (motion capture) төхөөрөмж үнэтэй, биед мэдрэгч зүүнэ",
  ], { x: 0.8, y: 2.1, w: 3.55, h: 2.6 });
  s.addShape(pres.shapes.RIGHT_ARROW, { x: 4.75, y: 2.85, w: 0.5, h: 0.5, fill: { color: C.accent1 }, line: { type: "none" }, objectName: name("arrow") });
  card(s, 5.4, 1.3, 4.1, 3.6, C.text1);
  text(s, "Энэ ажлын шийдэл", { x: 5.7, y: 1.55, w: 3.5, h: 0.4, fontSize: 18, bold: true, color: C.accent3 });
  bullets(s, [
    "Энгийн нэг камерын видео бичлэг",
    "HPE загвараар хүн бүрийн биеийн 17 гол цэг",
    "Синхрончлолыг 0–100 оноогоор: хэн, хэзээ, биеийн аль хэсгээрээ зөрсөн",
  ], { x: 5.7, y: 2.1, w: 3.55, h: 2.6, color: C.background1 });
  s.addNotes("Хос бүжиг, бүлгийн бүжиг, тулааны урлагийн пүмсэ зэрэгт хүмүүс хэр зэрэг хөдөлж байгаа нь гүйцэтгэлийн чухал үзүүлэлт. Үүнийг одоо шүүгч нүдээр үнэлдэг тул субъектив. Motion capture үнэтэй. Иймд энгийн камер болон хүний байрлал тодорхойлох технологиор синхрончлолыг тоогоор үнэлэх зорилго тавьсан.");
}

// 3. Goal and objectives
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Удиртгал" });
  s.addText("Зорилго ба зорилтууд", { placeholder: "title" });
  card(s, 0.5, 1.15, 9, 0.95, C.text1);
  text(s, [
    { text: "Зорилго: ", options: { bold: true, color: HEX.accent3 } },
    { text: "HPE загвараар гол цэгүүдийг тодорхойлж, үений өнцөгт үндэслэн 2+ хүний хөдөлгөөний синхрончлолыг тоогоор үнэлэх алгоритм боловсруулж, мэдэгдэж буй бичлэгүүд дээр туршиж үнэлэх", options: { color: HEX.lt1 } },
  ], { x: 0.75, y: 1.25, w: 8.5, h: 0.75, fontSize: 14, valign: "middle" });
  const goals = [
    "HPE технологи, синхрончлолын аргуудыг судлах",
    "HPE загваруудыг харьцуулж, загвар сонгох",
    "2+ хүнтэй туршилтын өгөгдөл бэлтгэх",
    "Дутуу утгыг нөхөх, шуугиан арилгах",
    "Хос ба бүлгийн синхрончлолын алгоритм",
    "Хяналттай ба бодит бичлэг дээр туршиж үнэлэх",
    "Нягтаршил, кадрын давтамжийн нөлөө, хязгаарлалт",
  ];
  goals.forEach((g, i) => {
    const col = i < 4 ? 0 : 1, row = i < 4 ? i : i - 4;
    const x = 0.5 + col * 4.6, y = 2.35 + row * 0.72;
    numberDot(s, i + 1, x, y + 0.02, i < 4 ? C.accent1 : C.accent2);
    text(s, g, { x: x + 0.55, y, w: 3.9, h: 0.48, fontSize: 14, valign: "middle" });
  });
  s.addNotes("Зорилгодоо хүрэхийн тулд долоон зорилт дэвшүүлсэн. Эхний дөрөв нь судалгаа, загвар сонголт, өгөгдөл, урьдчилсан боловсруулалт. Сүүлийн гурав нь алгоритм, түүний туршилт, аргын хязгаарлалтыг тодорхойлох.");
}

// 3b. Theory (thesis chapter 2)
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Удиртгал" });
  s.addText("Онолын судалгаа", { placeholder: "title" });
  const cols = [
    ["Хүний байрлал тодорхойлох (HPE)", C.accent1, [
      "Дээрээс доош: эхлээд хүнийг, дараа нь гол цэгийг илрүүлнэ (нарийвчлал өндөр)",
      "Доороос дээш: бүх цэгийг илрүүлээд хүнээр бүлэглэнэ",
    ]],
    ["Гол цэгийн формат", C.accent2, [
      "COCO: 17 цэг, бие ба нүүр",
      "MediaPipe: 33, WholeBody: 133 цэг",
      "Биеийн хөдөлгөөнд 17 цэг хангалттай",
    ]],
    ["Синхрончлолын хэмжүүр", C.accent4, [
      "Өнцгийн зөрүү: байрлал",
      "Пирсоны корреляц: хэмнэл",
      "Хөндлөн корреляц: хоцрогдол",
    ]],
  ];
  cols.forEach(([h, col, items], i) => {
    const x = 0.5 + i * 3.05;
    card(s, x, 1.15, 2.85, 3.95);
    s.addShape(pres.shapes.OVAL, { x: x + 0.25, y: 1.35, w: 0.3, h: 0.3, fill: { color: col }, line: { type: "none" }, objectName: name("dot") });
    text(s, h, { x: x + 0.7, y: 1.28, w: 2.0, h: 0.75, fontSize: 15, bold: true });
    bullets(s, items, { x: x + 0.25, y: 2.15, w: 2.4, h: 2.8, fontSize: 13, color: C.text2 });
  });
  s.addNotes("Онолын хэсэгт хүний байрлал тодорхойлох аргуудыг судалсан. Дээрээс доош аргууд эхлээд хүнийг илрүүлж, дараа нь гол цэгийг тодорхойлдог тул нарийвчлал өндөр. Гол цэгийн форматуудаас биеийн хөдөлгөөнд COCO-ийн 17 цэг хангалттай. Синхрончлолыг үнэлэхэд өнцгийн зөрүү, Пирсоны корреляц, хөндлөн корреляцыг хослуулан ашигласан.");
}

// ---------- theory: the three similarity measures, each on its own slide (illustrative synthetic signals) ----------
const TH = (() => {
  const fps = 25, n = 100; // 4 s
  const t = Array.from({ length: n }, (_, i) => i / fps);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const r1 = (v) => Math.round(v * 10) / 10;
  const base = (x) => 110 + 40 * Math.sin(2 * Math.PI * 0.5 * x) + 12 * Math.sin(2 * Math.PI * 1.1 * x + 0.6);
  const pear = (x, y) => {
    const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
    let a = 0, b = 0, c = 0;
    x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; });
    return a / Math.sqrt(b * c);
  };
  // 1. angle difference
  const A = t.map(base), B = t.map((x) => base(x) + 9 * Math.sin(2 * Math.PI * 0.8 * x + 1) + 6);
  const step = 5; // a bar every 0.2 s
  const gapIdx = t.map((_, i) => i).filter((i) => i % step === 0);
  const gaps = gapIdx.map((i) => r1(Math.abs(A[i] - B[i])));
  const meanGap = A.reduce((s, v, i) => s + Math.abs(v - B[i]), 0) / n;
  // 2. Pearson scatter: same rhythm, same rhythm with smaller amplitude, unrelated
  const xs = Array.from({ length: 60 }, (_, i) => base(i / 15) + 4 * rnd());
  const ySame = xs.map((x) => x + 10 * rnd());
  const yAmp = xs.map((x) => 0.4 * x + 70 + 5 * rnd());
  const yNone = xs.map(() => 110 + 45 * Math.sin(rnd() * 6.28) + 6 * rnd());
  // 3. cross-correlation: y = x delayed by 0.4 s
  const lag = 0.4;
  const X = t.map(base), Y = t.map((x) => base(x - lag));
  const vx = X.slice(1).map((v, i) => v - X[i]), vy = Y.slice(1).map((v, i) => v - Y[i]);
  const tauMax = 25, tau = [], rho = [];
  for (let k = -tauMax; k <= tauMax; k++) {
    const a = [], b = [];
    for (let i = 0; i < vx.length; i++) { const j = i + k; if (j >= 0 && j < vy.length) { a.push(vx[i]); b.push(vy[j]); } }
    tau.push(k / fps); rho.push(Math.round(pear(a, b) * 1000) / 1000);
  }
  const best = rho.indexOf(Math.max(...rho));
  return {
    fps, t, A: A.map(r1), B: B.map(r1), gapIdx, gaps, meanGap,
    xs: xs.map(r1), ySame: ySame.map(r1), yAmp: yAmp.map(r1), yNone: yNone.map(r1),
    rSame: pear(xs, ySame), rAmp: pear(xs, yAmp), rNone: pear(xs, yNone),
    X: X.map(r1), Y: Y.map(r1), tau, rho, bestTau: tau[best], bestRho: rho[best], lag,
  };
})();

// T1. Angle difference
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Удиртгал" });
  s.addText("Үений өнцгийн зөрүү: байрлалын ялгаа", { placeholder: "title" });
  const lbl = secLabels(TH.t.length, 0, TH.fps);
  s.addChart(pres.charts.LINE, [
    { name: "А хүн", labels: lbl, values: TH.A },
    { name: "Б хүн", labels: lbl, values: TH.B },
  ], {
    x: 0.5, y: 1.1, w: 5.9, h: 2.25, ...lineOpts({ chartColors: [HEX.accent2, HEX.accent1] }), legendPos: "r",
    valAxisMinVal: 40, valAxisMaxVal: 180, valAxisMajorUnit: 40, showTitle: true, title: "Тохойн өнцөг (°), цаг (с)", objectName: name("chart"),
  });
  s.addChart(pres.charts.BAR, [{ name: "|θA − θB|", labels: TH.gapIdx.map((i) => (i % TH.fps === 0 ? `${i / TH.fps}` : "")), values: TH.gaps }], {
    x: 0.5, y: 3.4, w: 5.9, h: 1.75, barDir: "col", ...chartBase(), chartColors: [HEX.accent3], showLegend: false, barGapWidthPct: 40,
    valAxisMinVal: 0, valAxisMajorUnit: 10, valAxisLabelFormatCode: "0", catAxisMajorTickMark: "none",
    showTitle: true, title: "Мөч бүрийн зөрүү |θA − θB| (°)", objectName: name("chart"),
  });
  card(s, 6.7, 1.1, 2.8, 4.05);
  text(s, "Томьёо", { x: 6.95, y: 1.25, w: 2.35, h: 0.35, fontSize: 14, bold: true, color: C.accent1 });
  text(s, "D = (1/T) Σ |θA(t) − θB(t)|", { x: 6.95, y: 1.65, w: 2.4, h: 0.4, fontSize: 13, bold: true });
  text(s, "Мөч бүрт хоёр хүний өнцгийн ялгааг аваад дундажлана.", { x: 6.95, y: 2.1, w: 2.35, h: 0.75, fontSize: 12, color: C.text2 });
  stat(s, `${TH.meanGap.toFixed(1)}°`, "Энэ жишээний дундаж зөрүү", 6.95, 2.85, 2.35, C.accent3, 30);
  text(s, `Давуу тал: шууд ойлгогдоно («тохой дунджаар ${TH.meanGap.toFixed(1)}°-аар зөрүүтэй»)`, { x: 6.95, y: 4.3, w: 2.35, h: 0.75, fontSize: 12, color: C.text2 });
  s.addNotes("Эхний хэмжүүр бол үений өнцгийн зөрүү. Хоёр хүний ижил үеийн өнцгийг мөч бүрт харьцуулж, ялгааг нь аваад дундажлана. Дээд графикт хоёр хүний тохойн өнцөг, доод графикт мөч бүрийн зөрүү байна. Энэ хэмжүүрийн давуу тал нь шууд ойлгогдоход оршино: жишээ нь тохой дунджаар 7.5 градусаар зөрүүтэй гэж хэлж болно. Энэ нь тухайн агшны байрлал хэр ижил байгааг хэмждэг.");
}

// T2. Pearson correlation
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Удиртгал" });
  s.addText("Пирсоны корреляц: хэмнэлийн уялдаа", { placeholder: "title" });
  const scatter = (ys, x, title, col) => s.addChart(pres.charts.SCATTER, [
    { name: "А хүн", values: TH.xs }, { name: "Б хүн", values: ys },
  ], {
    x, y: 1.1, w: 2.9, h: 2.75, ...chartBase(), chartColors: [col], lineSize: 0, lineDataSymbol: "circle", lineDataSymbolSize: 6,
    showLegend: false, valAxisMinVal: 40, valAxisMaxVal: 180, valAxisMajorUnit: 40, catAxisMinVal: 40, catAxisMaxVal: 180,
    valAxisLabelFormatCode: "0", catAxisLabelFormatCode: "0", catAxisMajorUnit: 40,
    showValAxisTitle: true, valAxisTitle: "Б хүн (°)", valAxisTitleFontSize: 10, valAxisTitleColor: HEX.dk2,
    showCatAxisTitle: true, catAxisTitle: "А хүн (°)", catAxisTitleFontSize: 10, catAxisTitleColor: HEX.dk2,
    showTitle: true, title, objectName: name("chart"),
  });
  scatter(TH.ySame, 0.5, `Хамт өөрчлөгдөнө: r = ${TH.rSame.toFixed(2)}`, HEX.accent2);
  scatter(TH.yAmp, 3.55, `Далайц бага: r = ${TH.rAmp.toFixed(2)}`, HEX.accent4);
  scatter(TH.yNone, 6.6, `Хамааралгүй: r = ${TH.rNone.toFixed(2)}`, HEX.accent1);
  card(s, 0.5, 4.0, 9, 1.1);
  text(s, [
    { text: "r = Σ(x − x̄)(y − ȳ) / √(Σ(x − x̄)² · Σ(y − ȳ)²)", options: { bold: true, breakLine: true } },
    { text: "−1 … 1: цэгүүд шулуун дагуу байвал 1-д ойр. Нэг хүн их, нөгөө нь бага нугалсан ч хамт өөрчлөгдвөл r өндөр (дунд график).", options: { color: HEX.dk2 } },
  ], { x: 0.75, y: 4.05, w: 8.5, h: 1.0, fontSize: 12, valign: "middle" });
  s.addNotes("Хоёр дахь хэмжүүр бол Пирсоны корреляц. Цэг бүр нэг мөчийг илэрхийлнэ: хэвтээ тэнхлэгт А хүний өнцөг, босоо тэнхлэгт Б хүнийх. Зүүн графикт хоёр хүн хамт хөдөлж байгаа тул цэгүүд шулуун дагуу байрлаж, r нь 1-д ойр. Дунд графикт Б хүн бага далайцтай хөдөлж байгаа ч хамт хөдөлж байгаа тул r мөн 1-д ойр. Энэ нь корреляц хэмнэлийг хэмжиж, далайцын ялгааг үл тоодгийг харуулна. Баруун графикт хөдөлгөөн хамааралгүй тул цэгүүд тархаж, r нь 0-д ойр.");
}

// T3. Cross-correlation and lag
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Удиртгал" });
  s.addText("Хөндлөн корреляц: цагийн хоцрогдол", { placeholder: "title" });
  const lbl = secLabels(TH.t.length, 0, TH.fps);
  s.addChart(pres.charts.LINE, [
    { name: "А хүн", labels: lbl, values: TH.X },
    { name: `Б хүн (${TH.lag} с хоцорсон)`, labels: lbl, values: TH.Y },
  ], {
    x: 0.5, y: 1.1, w: 4.5, h: 2.85, ...lineOpts({ chartColors: [HEX.accent2, HEX.accent1] }),
    valAxisMinVal: 40, valAxisMaxVal: 180, valAxisMajorUnit: 40, showTitle: true, title: "Б хүний муруй баруун тийш шилжсэн", objectName: name("chart"),
  });
  s.addChart(pres.charts.LINE, [{ name: "ρ(τ)", labels: tauLabels(TH.tau), values: TH.rho }], {
    x: 5.2, y: 1.1, w: 4.3, h: 2.85, ...lineOpts({ chartColors: [HEX.accent4], valAxisLabelFormatCode: "0.0" }), lineSize: 3, showLegend: false,
    valAxisMinVal: -1, valAxisMaxVal: 1, valAxisMajorUnit: 0.5,
    showTitle: true, title: `ρ(τ): оргил τ* = ${TH.bestTau.toFixed(2)} с, ρ = ${TH.bestRho.toFixed(2)}`, objectName: name("chart"),
  });
  card(s, 0.5, 4.1, 9, 1.0);
  text(s, [
    { text: "ρ(τ) = corr(x(t), y(t + τ)),   τ* = argmax ρ(τ)", options: { bold: true, breakLine: true } },
    { text: "Б хүний муруйг τ-гаар шилжүүлж корреляцыг тооцно. Хамгийн их корреляц өгсөн шилжилт τ* нь хоцрогдол, ρ_max нь олдсон хоцрогдолд итгэх эсэхийг заана.", options: { color: HEX.dk2 } },
  ], { x: 0.75, y: 4.15, w: 8.5, h: 0.9, fontSize: 12, valign: "middle" });
  s.addNotes("Гурав дахь хэмжүүр бол хөндлөн корреляц. Зүүн графикт Б хүн А хүнээс 0.4 секунд хоцорч байна, түүний муруй баруун тийш шилжсэн. Б хүний муруйг цаг хугацааны дагуу шилжүүлж, шилжилт бүрт корреляцыг тооцвол баруун талын муруй гарна. Хамгийн өндөр цэг нь 0.4 секундэд байгаа нь хоцрогдол юм. Оргилын өндөр нь хоёр хөдөлгөөн хэр сайн таарч байгааг харуулдаг тул олдсон хоцрогдолд итгэх эсэхийг шийдэхэд ашиглана.");
}

// ================= Арга зүй =================
pres.addSection({ title: "Арга зүй" });

// 4. System pipeline
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Системийн бүтэц", { placeholder: "title" });
  const steps = [
    ["Видео", "Кадр бүрийг алгасахгүй унших"],
    ["Гол цэг", "RTMPose-m, 17 COCO цэг"],
    ["Хүн хуваарилах", "Гуяны x-ээр зүүнээс баруун 1..N"],
    ["Цэвэрлэх", "Итгэлцэл < 0.3 → нөхөх, Савицкий-Голей"],
    ["Үений өнцөг", "8 өнцөг: тохой, мөр, гуя, өвдөг"],
    ["Синхрончлол", "Хос, бүлгийн оноо, зөрсөн мөч"],
  ];
  steps.forEach(([h, d], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.5 + col * 3.1, y = 1.25 + row * 1.55;
    card(s, x, y, 2.75, 1.3);
    numberDot(s, i + 1, x + 0.2, y + 0.2, row === 0 ? C.accent1 : C.accent2, 0.4);
    text(s, h, { x: x + 0.75, y: y + 0.2, w: 1.9, h: 0.4, fontSize: 16, bold: true, valign: "middle" });
    text(s, d, { x: x + 0.2, y: y + 0.72, w: 2.4, h: 0.5, fontSize: 12, color: C.text2 });
    if (col < 2) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + 2.8, y: y + 0.5, w: 0.25, h: 0.3, fill: { color: C.accent5 }, line: { type: "none" }, objectName: name("arrow") });
  });
  card(s, 0.5, 4.4, 9, 0.75, C.text1);
  text(s, [
    { text: "Хоёр горим: ", options: { bold: true, color: HEX.accent3 } },
    { text: "вэб хөтөч (WebGPU)  ·  Python сервер (CUDA).  ", options: { color: HEX.lt1 } },
    { text: "Гаралт: ", options: { bold: true, color: HEX.accent3 } },
    { text: "араг яс зурагдсан видео, JSON/CSV, кадр бүрийн оноо", options: { color: HEX.lt1 } },
  ], { x: 0.75, y: 4.45, w: 8.5, h: 0.65, fontSize: 13, valign: "middle" });
  s.addNotes("Систем зургаан алхамтай. Видеог кадр бүрээр уншиж, RTMPose-m загвараар 17 гол цэг гаргана. Хүмүүсийг зүүнээс баруун тийш дугаарлаж, итгэлцэл багатай цэгийг нөхөж тэгшитгэнэ. Дараа нь найман үений өнцөг тооцоолж, хос бүрийн синхрончлолыг үнэлнэ. Боловсруулалтыг хөтөч дээр эсвэл GPU-тэй сервер дээр хийж болно.");
}

// 4b. Keypoint formats and counts (report 2.2, table 2.1)
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Гол цэгийн тоо: хэд нь хэрэгтэй вэ", { placeholder: "title" });
  const fmts = [
    ["LSP", 14], ["MPII", 16], ["COCO", 17], ["OpenPose BODY_25", 25], ["MediaPipe Pose", 33],
    ["COCO-WholeBody", 133], ["Halpe", 136], ["MediaPipe Holistic", 543],
  ];
  s.addChart(pres.charts.BAR, [{ name: "Гол цэг", labels: fmts.map((f) => f[0]).reverse(), values: fmts.map((f) => f[1]).reverse() }], {
    x: 0.5, y: 1.1, w: 5.6, h: 4.0, barDir: "bar", ...chartBase(), chartColors: [HEX.accent5], showLegend: false,
    showValue: true, dataLabelPosition: "outEnd", valAxisLogScaleBase: 10, valAxisMinVal: 10, valAxisMaxVal: 1000,
    valAxisLabelFormatCode: "0", barGapWidthPct: 45,
    showTitle: true, title: "Форматын гол цэгийн тоо (логарифм хуваарь)", objectName: name("chart"),
  });
  card(s, 6.4, 1.1, 3.1, 1.55, C.text1);
  text(s, "17 цэг (COCO)", { x: 6.6, y: 1.2, w: 2.7, h: 0.45, fontSize: 18, bold: true, color: C.accent3 });
  text(s, "Бие ба нүүрний 5 цэг. Бүх загварын гаралтыг энэ форматаар харьцуулсан (MediaPipe-ийн 33 цэгийг 17 болгосон).", { x: 6.6, y: 1.7, w: 2.7, h: 0.85, fontSize: 12, color: C.background1 });
  bullets(s, [
    "Синхрончлолд мөр, тохой, бугуй, гуя, өвдөг, шагай хэрэгтэй: 8 өнцөгт 17 цэг хангалттай",
    "Цэг олон байх тусам тооцоолол удаан",
    "Хуруу, нүүрний жижиг цэгүүд бага нягтаршилд алдаа ихтэй",
  ], { x: 6.4, y: 2.85, w: 3.1, h: 2.25, fontSize: 12, color: C.text2 });
  s.addNotes("HPE загварууд сургалтын өгөгдлийн сангаас хамааран өөр өөр тооны гол цэг гаргадаг: 14-өөс 543 хүртэл. Цэг их байх нь үргэлж давуу тал биш. Тооцоолол удааширдаг, хуруу, нүүрний жижиг цэгүүд бага нягтаршилтай бичлэгт алдаа ихтэй гардаг. Синхрончлолыг үнэлэхэд мөр, тохой, бугуй, гуя, өвдөг, шагайн цэгүүд хангалттай тул COCO форматын 17 цэгийг ашигласан. Бүх загварын гаралтыг энэ форматаар авч, MediaPipe-ийн 33 цэгийг COCO-ийн 17 цэг рүү хөрвүүлсэн тул үр дүнг шууд харьцуулах боломжтой.");
}

// 5. Model selection
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Загвар сонголт: 5 загварыг харьцуулав", { placeholder: "title" });
  s.addChart(pres.charts.BAR, [{ name: "Жинлэсэн оноо", labels: ["YOLOv8n", "YOLO11n", "RTMPose-m", "ViTPose-B", "MediaPipe"], values: [91, 90, 89, 84, 59] }], {
    x: 0.5, y: 1.15, w: 5.2, h: 3.9, barDir: "col", ...chartBase(), chartColors: [HEX.accent5],
    showValue: true, dataLabelPosition: "outEnd", showLegend: false, valAxisMinVal: 0, valAxisMaxVal: 100,
    showTitle: true, title: "Жинлэсэн нийт оноо (0–100)", objectName: name("chart"),
  });
  card(s, 6.0, 1.15, 3.5, 3.9);
  text(s, "Сонгосон: RTMPose-m", { x: 6.25, y: 1.3, w: 3.1, h: 0.4, fontSize: 16, bold: true, color: C.accent1 });
  stat(s, "93.4%", "Бусад загвартай тохирол (PCK@0.05), хамгийн өндөр", 6.25, 1.65, 3.1, C.text1, 32);
  stat(s, "1.49", "Чичиргээ, хамгийн бага (MediaPipe 9.02)", 6.25, 2.85, 3.1, C.text1, 32);
  text(s, "Шүүгч, дасгалжуулагчид хурднаас нарийвчлал чухал тул гол цэгийн чанарыг сонгосон", { x: 6.25, y: 4.1, w: 3.1, h: 0.85, fontSize: 12, color: C.text2 });
  s.addNotes("Таван загварыг нэг бичлэг дээр илрүүлэлт, гол цэгийн тохирол, чичиргээ, хурдаар харьцуулсан. MediaPipe гурван хүнийг кадрын 30 хувьд л илрүүлсэн тул тохиромжгүй. Жинлэсэн оноогоор YOLOv8n бага зөрүүгээр тэргүүлсэн ч энэ нь хурдны жингээс болсон. Гол цэгийн чанар хамгийн сайн RTMPose-m-ийг сонгосон.");
}

// 6. Joint angles and weights
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Байрлалыг үений өнцгөөр дүрслэх", { placeholder: "title" });
  card(s, 0.5, 1.15, 2.6, 3.95, C.text1);
  skeleton(s, 1.8, 3.1, 0.82, HEX.lt1, HEX.accent1, "arms-down");
  text(s, "θ = arccos((a−b)·(c−b) / |a−b||c−b|)", { x: 3.4, y: 1.2, w: 6.1, h: 0.45, fontSize: 15, bold: true, color: C.accent4 });
  text(s, "Хүний кадр дахь байрлал, хэмжээ, камераас зайнаас хамаардаггүй тул нормчлол шаардлагагүй", { x: 3.4, y: 1.7, w: 6.1, h: 0.55, fontSize: 13, color: C.text2 });
  s.addTable([
    [{ text: "Биеийн хэсэг", options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } },
      { text: "Үе (8)", options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } },
      { text: "Жин", options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }],
    ["Гар", "Тохой ×2, мөр ×2", "50%"],
    ["Хөл", "Өвдөг ×2", "25%"],
    ["Их бие", "Гуя ×2", "25%"],
  ], { x: 3.4, y: 2.45, w: 6.1, colW: [1.9, 2.6, 1.6], fontSize: 13, fontFace: "Arial", color: HEX.dk1, border: { type: "solid", pt: 0.5, color: "DCE2EA" }, rowH: 0.42, valign: "middle", objectName: name("table") });
  text(s, "Оноог биеийн хэсгээр жигнэнэ: хэсгийн жинг үеүдэд нь тэнцүү хуваана (α_k)", { x: 3.4, y: 4.4, w: 6.1, h: 0.5, fontSize: 13, color: C.text2 });
  s.addNotes("Хүмүүс камераас өөр зайд, кадрын өөр хэсэгт зогсдог тул координатыг шууд харьцуулах боломжгүй. Иймд байрлалыг найман үений өнцгөөр дүрсэлсэн. Өнцөг нь хэмжээ, байрлалаас хамаардаггүй. Мөн бүх үеийг тэнцүү тооцохын оронд биеийн хэсгээр жигнэсэн: гар 50, хөл 25, их бие 25 хувь. Хэсгийн жинг үеүдэд нь тэнцүү хуваадаг.");
}

// 7. Sync score
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Синхрончлолын оноо: гурван бүрэлдэхүүн", { placeholder: "title" });
  const parts = [
    ["S_pose", "Байрлал", "Үений өнцгийн жигнэсэн зөрүү: 1 − Σ α_k |θA − θB| / 180°", C.accent1],
    ["S_corr", "Хэмнэл", "Үе бүрийн өнцгийн цувааны Пирсоны корреляц", C.accent2],
    ["S_lag", "Хоцрогдол", "Өнцгийн хурдны хөндлөн корреляц, ρ_max ≥ 0.3 бол итгэнэ", C.accent4],
  ];
  parts.forEach(([sym, h, d, col], i) => {
    const x = 0.5 + i * 3.05;
    card(s, x, 1.15, 2.85, 2.35);
    text(s, sym, { x: x + 0.25, y: 1.3, w: 2.4, h: 0.55, fontSize: 26, bold: true, color: col, valign: "middle" });
    text(s, h, { x: x + 0.25, y: 1.9, w: 2.4, h: 0.35, fontSize: 16, bold: true });
    text(s, d, { x: x + 0.25, y: 2.35, w: 2.4, h: 1.05, fontSize: 12, color: C.text2 });
  });
  card(s, 0.5, 3.7, 9, 1.45, C.text1);
  text(s, "S = 100 · (S_pose + S_corr + S_lag) / 3", { x: 0.8, y: 3.8, w: 8.4, h: 0.5, fontSize: 20, bold: true, color: C.background1, valign: "middle" });
  bullets(s, [
    "Кадр бүрт тухайн кадрыг голдоо агуулсан 2 секундийн цонх",
    "Толин тусгал горим: 5 оноогоор илүү бол л солино  ·  Бүлгийн оноо = хосуудын дундаж, S_i = хүн тус бүр",
  ], { x: 0.8, y: 4.35, w: 8.4, h: 0.75, fontSize: 12, color: "CADCFC" });
  s.addNotes("Оноо гурван хэсэгтэй. Байрлал: тухайн мөчид өнцгүүд хэр ойр. Хэмнэл: өнцгүүд хамт өөрчлөгдөж байна уу. Хоцрогдол: нэг хүн нөгөөгөөсөө хэдэн секундээр хоцорч байна. Хоцрогдлыг корреляц 0.3-аас дээш үед л итгэнэ. Кадр бүрт 2 секундийн цонх авч тооцоолдог тул видеог тоглуулахад тухайн мөчийн оноо харагдана.");
}

// ---------- explanatory slides with real data (controlled ballet videos, right elbow angle) ----------
const RD = require("./realdata.json");

// 8a. Every person becomes an angle curve
{
  const d = RD["lag-08f"];
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Хүн бүр өнцгийн муруй болно", { placeholder: "title" });
  s.addChart(pres.charts.LINE, [
    { name: "1-р хүн", labels: secLabels(d.a.length, d.t0, d.fps), values: d.a },
    { name: "2-р хүн (0.32 с хоцорсон)", labels: secLabels(d.b.length, d.t0, d.fps), values: d.b },
  ], {
    x: 0.5, y: 1.15, w: 6.0, h: 3.95, ...lineOpts({ chartColors: [HEX.accent2, HEX.accent1] }),
    showTitle: true, title: "Баруун тохойн өнцөг (°), цаг хугацаа (с)", objectName: name("chart"),
  });
  card(s, 6.8, 1.15, 2.7, 3.95);
  text(s, "Кадр бүрт", { x: 7.05, y: 1.3, w: 2.3, h: 0.35, fontSize: 15, bold: true, color: C.accent2 });
  text(s, "8 үеийн өнцгийг хэмжинэ. Цагийн дагуу зурвал хүн бүрт 8 муруй гарна.", { x: 7.05, y: 1.7, w: 2.3, h: 1.1, fontSize: 13, color: C.text2 });
  text(s, "Синхрончлол", { x: 7.05, y: 2.95, w: 2.3, h: 0.35, fontSize: 15, bold: true, color: C.accent1 });
  text(s, "= хоёр хүний муруй хэр ижил вэ. Энд 2-р хүний муруй баруун тийш шилжсэн: тэр хоцорч байна.", { x: 7.05, y: 3.35, w: 2.3, h: 1.6, fontSize: 13, color: C.text2 });
  s.addNotes("Камер кадр бүрт хүн бүрийн найман үений өнцгийг хэмжинэ. Үүнийг цаг хугацааны дагуу зурвал муруй гарна. Энд нэг балетчны баруун тохойн өнцгийг харуулж байна. Цэнхэр нь эх бичлэг, улбар шар нь 0.32 секундээр хоцроосон хуулбар. Хэлбэр нь яг ижил, гэхдээ улбар шар муруй баруун тийш шилжсэн. Синхрончлолыг үнэлэх гэдэг нь эдгээр хоёр муруйг харьцуулах юм.");
}

// 8b. S_pose
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("S_pose: яг одоо ижил байрлалтай юу", { placeholder: "title" });
  card(s, 0.5, 1.15, 4.3, 3.95, C.text1);
  text(s, "Тооцоолол", { x: 0.8, y: 1.3, w: 3.8, h: 0.35, fontSize: 15, bold: true, color: C.accent3 });
  const steps = [
    "Кадр бүрт хоёр өнцгийн зөрүүг авна: |θA − θB|",
    "Жишээ: 120° ба 100° → зөрүү 20°",
    "Цонхонд дундажлаад 180°-д харьцуулна",
    "S_pose = 1 − дундаж зөрүү / 180°",
  ];
  steps.forEach((st, i) => {
    numberDot(s, i + 1, 0.8, 1.8 + i * 0.75, C.accent1, 0.36);
    text(s, st, { x: 1.3, y: 1.78 + i * 0.75, w: 3.3, h: 0.6, fontSize: 13, color: C.background1, valign: "middle" });
  });
  text(s, "0° зөрүү → 1,  180° зөрүү → 0", { x: 5.1, y: 1.2, w: 4.4, h: 0.5, fontSize: 14, bold: true });
  s.addChart(pres.charts.BAR, [{ name: "S_pose", labels: ["Синхрон", "0.32 с хоцорсон", "Өөр хөдөлгөөн"], values: [RD["lag-00f"].pose, RD["lag-08f"].pose, RD["different-7s"].pose] }], {
    x: 5.1, y: 1.75, w: 4.4, h: 2.75, barDir: "col", ...chartBase(), chartColors: [HEX.accent1], showValue: true, dataLabelPosition: "outEnd",
    dataLabelFormatCode: "0.00", showLegend: false, valAxisMinVal: 0, valAxisMaxVal: 1.1, valAxisMajorUnit: 0.2, valAxisLabelFormatCode: "0.0", objectName: name("chart"),
  });
  text(s, "Сул тал: бага зэрэг хоцорсон ч өнцгүүд ойролцоо тул S_pose өндөр хэвээр (0.84)", { x: 5.1, y: 4.55, w: 4.4, h: 0.55, fontSize: 12, color: C.text2 });
  s.addNotes("Эхний оноо S_pose. Энэ нь тухайн мөчид хоёр хүний өнцөг хэр ойр байгааг хэмждэг. Кадр бүрт өнцгийн зөрүүг аваад дундажлана, тэгээд 180 градуст харьцуулна. Зөрүү байхгүй бол 1, хамгийн их зөрүүтэй бол 0. Графикаас харахад синхрон үед 1-д ойр, хоцорсон болон өөр хөдөлгөөнтэй үед буурч байна. Гэхдээ зөвхөн энэ оноо хангалтгүй, учир нь бага хоцрогдолд өнцгүүд ойролцоо хэвээр байдаг.");
}

// 8c. S_corr
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("S_corr: ижил хэмнэлээр хөдөлж байна уу", { placeholder: "title" });
  const panel = (d, x, title, colorB) => s.addChart(pres.charts.LINE, [
    { name: "1-р хүн", labels: secLabels(d.a.length, d.t0, d.fps), values: d.a },
    { name: "2-р хүн", labels: secLabels(d.b.length, d.t0, d.fps), values: d.b },
  ], { x, y: 1.15, w: 4.4, h: 2.85, ...lineOpts({ chartColors: [HEX.accent2, colorB] }), showTitle: true, title, objectName: name("chart") });
  panel(RD["lag-00f"], 0.5, `Ижил хөдөлгөөн: S_corr = ${RD["lag-00f"].corr.toFixed(2)}`, HEX.accent5);
  panel(RD["different-7s"], 5.1, `Өөр хөдөлгөөн: S_corr = ${RD["different-7s"].corr.toFixed(2)}`, HEX.accent1);
  card(s, 0.5, 4.15, 9, 0.95);
  text(s, [
    { text: "Пирсоны корреляц r: ", options: { bold: true } },
    { text: "нэг хүн өвдгөө нугалахад нөгөө нь бас нугалж байна уу. Далайц өөр байсан ч хамт өөрчлөгдвөл r ≈ 1. ", options: {} },
    { text: "S_corr = (r + 1) / 2", options: { bold: true, color: HEX.accent1 } },
  ], { x: 0.75, y: 4.2, w: 8.5, h: 0.85, fontSize: 13, valign: "middle" });
  s.addNotes("Хоёр дахь оноо S_corr нь хэмнэлийг хэмждэг. Пирсоны корреляц нь хоёр муруй хамт өсч, хамт буурч байна уу гэдгийг -1-ээс 1 хүртэл утгаар илэрхийлнэ. Зүүн талд ижил хөдөлгөөн: муруйнууд давхцаж, оноо бараг 1. Баруун талд өөр хөдөлгөөн: муруйнууд хамааралгүй, оноо 0.46. Нэг хүн их, нөгөө нь бага нугалсан ч хамт хөдөлж байвал корреляц өндөр гардаг нь S_pose-оос ялгаатай тал юм.");
}

// 8d. S_lag
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("S_lag: нэг нь нөгөөгөөсөө хоцорч байна уу", { placeholder: "title" });
  const dl = RD["lag-08f"], dd = RD["different-7s"];
  const labels = tauLabels(dl.tau);
  s.addChart(pres.charts.LINE, [
    { name: "0.32 с хоцорсон", labels, values: dl.rho },
    { name: "Өөр хөдөлгөөн", labels, values: dd.rho },
    { name: "ρ_min = 0.3", labels, values: dl.tau.map(() => 0.3) },
  ], {
    x: 0.5, y: 1.15, w: 5.6, h: 3.95, ...lineOpts({ chartColors: [HEX.accent1, HEX.accent2, HEX.accent5], valAxisLabelFormatCode: "0.0" }),
    valAxisMinVal: -0.4, valAxisMaxVal: 1.0, valAxisMajorUnit: 0.2, showTitle: true, title: "Корреляц ρ ба 2-р хүний шилжилт τ (с)", objectName: name("chart"),
  });
  const st = [
    "2-р хүний муруйг τ секундээр шилжүүлнэ (−1.5 … +1.5 с)",
    "Шилжилт бүрт хоёр муруй хэр таарахыг ρ-гаар хэмжинэ",
    "Оргил = хоцрогдол τ*: энд 0.32 с, ρ = 0.99",
    "ρ_max < 0.3 бол итгэхгүй: өөр хөдөлгөөнд 0.12",
  ];
  st.forEach((t, i) => {
    numberDot(s, i + 1, 6.4, 1.2 + i * 0.72, i < 3 ? C.accent1 : C.accent2, 0.36);
    text(s, t, { x: 6.9, y: 1.15 + i * 0.72, w: 2.6, h: 0.65, fontSize: 12, valign: "middle" });
  });
  card(s, 6.4, 4.15, 3.1, 0.95, C.text1);
  text(s, "S_lag = 1 − |τ*| / 1.5 с", { x: 6.55, y: 4.2, w: 2.85, h: 0.85, fontSize: 15, bold: true, color: C.background1, valign: "middle", align: "center" });
  s.addNotes("Гурав дахь оноо S_lag хоцрогдлыг олдог. Хоёр дахь хүний муруйг цаг хугацааны дагуу бага багаар шилжүүлж, шилжилт бүрт хоёр муруй хэр таарч байгааг корреляцаар хэмжинэ. Улбар шар муруй 0.32 секундэд оргилдоо хүрч байна, корреляц 0.99. Энэ нь хоцрогдол 0.32 секунд гэсэн үг бөгөөд бидний оруулсан хоцрогдолтой яг таарч байна. Харин огт өөр хөдөлгөөн хийсэн үед ногоон муруй хаана ч 0.3-аас дээш гарахгүй. Тиймээс тэр үед олдсон хоцрогдолд итгэхгүй. Хоцрогдол бага байх тусам оноо 1-д ойр.");
}

// 8e. Sliding window
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Кадр бүрт 2 секундийн гулсах цонх", { placeholder: "title" });
  // timeline
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.55, w: 9, h: 0.5, fill: { color: C.background2 }, line: { type: "none" }, rectRadius: 0.08, objectName: name("timeline") });
  for (let k = 0; k <= 10; k++) {
    text(s, `${k * 3} с`, { x: 0.5 + k * 0.9 - 0.25, y: 2.25, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5, align: "center" });
  }
  [[2.2, C.accent1], [4.6, C.accent2], [7.0, C.accent4]].forEach(([x, col], i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.45, w: 0.6, h: 0.7, fill: { color: col, transparency: 15 }, line: { type: "none" }, rectRadius: 0.06, objectName: name("window") });
    s.addShape(pres.shapes.LINE, { x: x + 0.3, y: 1.35, w: 0, h: 0.9, line: { color: C.text1, width: 2, dashType: "dash" }, objectName: name("frame") });
    text(s, `t${i + 1}`, { x: x + 0.05, y: 1.05, w: 0.5, h: 0.3, fontSize: 11, bold: true, align: "center" });
  });
  text(s, "Тасархай шугам: тухайн кадр t  ·  Өнгөт хайрцаг: t − 1 с … t + 1 с цонх", { x: 0.5, y: 2.58, w: 9, h: 0.35, fontSize: 12, color: C.text2 });
  const why = [
    ["Яагаад цонх?", "Корреляц ба хоцрогдлыг нэг кадраар тооцох боломжгүй: хөдөлгөөний хэсэг хэрэгтэй"],
    ["Яагаад кадр бүрт?", "Видеог тоглуулахад тухайн мөчийн оноо харагдана, зөрсөн мөчийг цагаар нь олно"],
    ["Яагаад 2 секунд?", "Нэг хөдөлгөөн (0.5–2 с) багтана, 25 кадр/с-д 50 кадр. Богино бол шуугиантай, урт бол богино зөрүү дундажлагдана"],
  ];
  why.forEach(([h, d], i) => {
    const x = 0.5 + i * 3.05;
    card(s, x, 3.0, 2.85, 2.1);
    text(s, h, { x: x + 0.2, y: 3.15, w: 2.45, h: 0.35, fontSize: 14, bold: true, color: C.accent1 });
    text(s, d, { x: x + 0.2, y: 3.55, w: 2.45, h: 1.45, fontSize: 12, color: C.text2 });
  });
  s.addNotes("Гурван оноог бүх бичлэгт нэг удаа биш, кадр бүрт тооцдог. Кадр бүрийн хувьд тухайн кадрыг голдоо агуулсан 2 секундийн цонх авна, өөрөөр хэлбэл нэг секунд өмнөх ба нэг секунд дараах хэсэг. Цонх хэрэгтэй шалтгаан нь корреляц ба хоцрогдлыг ганц кадраар тооцох боломжгүй. Хоёр секунд гэдэг нь нэг хөдөлгөөнийг багтаах хангалттай урт, гэхдээ хэзээ зөрснийг ялгах хангалттай богино хэмжээ юм.");
}

// 8e2. Inside one 2 s window (real numbers, 0.32 s lag video, window centred on frame 150 = 6.0 s)
{
  const W = require("./window.json");
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Нэг цонх доторх тооцоолол", { placeholder: "title" });
  const X0 = 2.6, SEC = 2.45, T0 = 4.9; // x of 4.9 s, inches per second
  const xs = (t) => X0 + (t - T0) * SEC;
  const bar = (y, t1, t2, color, label) => {
    s.addShape(pres.shapes.RECTANGLE, { x: xs(t1), y, w: (t2 - t1) * SEC, h: 0.34, fill: { color }, line: { type: "none" }, objectName: name("bar") });
    text(s, label, { x: 0.5, y, w: 2.3, h: 0.34, fontSize: 11, bold: true, valign: "middle" });
  };
  bar(1.2, 5.0, 7.0, C.accent2, "1-р хүн");
  bar(1.65, 5.0, 7.0, C.accent1, "2-р хүн, ижил кадр");
  bar(2.1, 5.32, 7.0, C.accent1, "2-р хүн, +0.32 с хойш");
  s.addShape(pres.shapes.RECTANGLE, { x: xs(7.0), y: 2.1, w: 0.32 * SEC, h: 0.34, fill: { color: C.accent3 }, line: { type: "none" }, objectName: name("bar-out") });
  for (const t of [5.0, 7.0]) s.addShape(pres.shapes.LINE, { x: xs(t), y: 1.05, w: 0, h: 1.55, line: { color: C.text1, width: 1.5, dashType: "dash" }, objectName: name("edge") });
  text(s, "5.00 с", { x: xs(5.0) - 0.4, y: 2.55, w: 0.8, h: 0.25, fontSize: 10, color: C.text2, align: "center" });
  text(s, "6.96 с", { x: xs(7.0) - 0.4, y: 2.55, w: 0.8, h: 0.25, fontSize: 10, color: C.text2, align: "center" });
  text(s, "S_pose, S_corr", { x: xs(7.0) + 0.1, y: 1.65, w: 1.3, h: 0.34, fontSize: 10, color: C.text2, valign: "middle" });
  text(s, "S_lag", { x: xs(7.32) + 0.1, y: 2.1, w: 0.7, h: 0.34, fontSize: 10, color: C.text2, valign: "middle" });
  text(s, "цонхноос гадуур 0.32 с", { x: xs(7.0) + 0.3, y: 2.55, w: 1.6, h: 0.25, fontSize: 10, bold: true, color: C.accent3 });
  const head = (t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } });
  s.addTable([
    [head("Кадр"), head("Цаг"), head("1-р хүн θA(t)"), head("2-р хүн θB(t)"), head("θB(t + 0.32 с)")],
    ...W.rows.filter((r) => [125, 150, 174].includes(r[0])).map((r) => [String(r[0]), `${r[1]} с`, `${r[2]}°`, `${r[3]}°`, { text: `${r[4]}°`, options: { bold: true, color: HEX.accent2 } }]),
  ], { x: 0.5, y: 2.9, w: 5.4, colW: [0.7, 0.85, 1.25, 1.25, 1.35], fontSize: 12, fontFace: "Arial", color: HEX.dk1, border: { type: "solid", pt: 0.5, color: "DCE2EA" }, rowH: 0.32, valign: "middle", objectName: name("table") });
  card(s, 6.2, 2.9, 3.3, 1.5);
  text(s, [
    { text: `S_pose = ${W.pose.toFixed(2)}   S_corr = ${W.corr.toFixed(2)}`, options: { breakLine: true } },
    { text: `τ* = ${W.lagSec} с (${W.lagFrames} кадр), ρ = ${W.rhoMax.toFixed(2)}`, options: { breakLine: true } },
    { text: `S_lag = 1 − 0.32/1.5 = ${W.lag.toFixed(2)}`, options: { breakLine: true } },
    { text: `S = ${W.score.toFixed(1)}`, options: { bold: true, color: HEX.accent1 } },
  ], { x: 6.4, y: 3.0, w: 3.0, h: 1.3, fontSize: 12, valign: "middle", paraSpaceAfter: 3 });
  card(s, 0.5, 4.5, 9, 0.62, C.text1);
  text(s, "Зөвхөн цонх доторх кадруудыг авбал давхцал 2 − 0.32 = 1.68 с. Алгоритм 2-р хүнийг цонхноос гадуур 0.32 с уншдаг тул бүтэн 2 с хөдөлгөөн харьцуулагдана.", { x: 0.7, y: 4.52, w: 8.6, h: 0.58, fontSize: 12, color: C.background1, valign: "middle" });
  s.addNotes("Нэг цонх доторх тооцооллыг бодит тоогоор харуулъя. Энэ нь 0.32 секунд хоцроосон бичлэгийн 6 дахь секунд дээрх цонх, 5.00-аас 6.96 секунд буюу 50 кадр. S_pose ба S_corr нь хоёр хүний ижил кадруудыг харьцуулна. Жишээ нь 150-р кадрт 1-р хүний тохой 166 градус, 2-р хүнийх 82 градус: хоцорсон тул байрлал зөрж байна. S_lag нь 2-р хүнийг 0.32 секунд хойш харж харьцуулна: тэр үед 2-р хүний тохой 166.5 градус буюу бараг яг таарч байна. Энэ үед корреляц 0.98 болж, хоцрогдол 0.32 секунд гэж олдоно. Зөвхөн цонх доторх кадрыг ашигласан бол давхцах хэсэг 1.68 секунд болох байсан. Гэхдээ алгоритм 2-р хүний өгөгдлийг цонхноос гадуур 0.32 секунд уншдаг тул бүтэн 2 секундийн хөдөлгөөн харьцуулагдана.");
}

// 8f. Three scores in three cases
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Гурван оноо гурван нөхцөлд", { placeholder: "title" });
  const cases = [["Синхрон", RD["lag-00f"]], ["0.32 с хоцорсон", RD["lag-08f"]], ["Өөр хөдөлгөөн", RD["different-7s"]]];
  const head = (t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } });
  s.addTable([
    [head("Нөхцөл"), head("S_pose"), head("S_corr"), head("S_lag"), head("Нийт S")],
    ...cases.map(([n, d]) => [n, d.pose.toFixed(2), d.corr.toFixed(2), d.lag.toFixed(2), { text: d.score.toFixed(1), options: { bold: true } }]),
  ], { x: 0.5, y: 1.2, w: 5.6, colW: [1.8, 0.95, 0.95, 0.95, 0.95], fontSize: 14, fontFace: "Arial", color: HEX.dk1, border: { type: "solid", pt: 0.5, color: "DCE2EA" }, rowH: 0.5, valign: "middle", objectName: name("table") });
  text(s, "Хяналттай балетын бичлэг, 1–2 хос, бүх цонхны дундаж", { x: 0.5, y: 3.35, w: 5.6, h: 0.35, fontSize: 11, color: C.text2 });
  const notes = [
    ["S_pose", "аажуухан буурна: ойролцоо байрлалыг ч өндөр үнэлнэ", C.accent1],
    ["S_corr", "хамгийн мэдрэмтгий: хоцрогдол, өөр хөдөлгөөнд огцом буурна", C.accent2],
    ["S_lag", "хэдэн секундээр хоцорсныг тоогоор хэлнэ", C.accent4],
  ];
  notes.forEach(([h, d, col], i) => {
    card(s, 6.4, 1.2 + i * 1.3, 3.1, 1.15);
    text(s, h, { x: 6.6, y: 1.3 + i * 1.3, w: 2.7, h: 0.35, fontSize: 15, bold: true, color: col });
    text(s, d, { x: 6.6, y: 1.65 + i * 1.3, w: 2.7, h: 0.65, fontSize: 12, color: C.text2 });
  });
  card(s, 0.5, 3.85, 5.6, 1.25, C.text1);
  text(s, "S = 100 · (S_pose + S_corr + S_lag) / 3", { x: 0.75, y: 3.95, w: 5.1, h: 0.45, fontSize: 16, bold: true, color: C.background1, valign: "middle" });
  text(s, "Гурвыг хослуулснаар нэг нь алдсаныг нөгөө нь нөхнө", { x: 0.75, y: 4.45, w: 5.1, h: 0.5, fontSize: 13, color: C.accent3, valign: "middle" });
  s.addNotes("Энэ хүснэгт гурван оноо гурван өөр нөхцөлд хэрхэн ажилладгийг харуулж байна. Синхрон үед гурвуулаа 1-д ойр, нийт оноо 99.8. Хоцорсон үед S_corr хамгийн их буурч, S_lag хоцрогдлын хэмжээг хэлж өгнө. Өөр хөдөлгөөнд бүгд буурч, нийт оноо 53.7. Ганц оноо хангалтгүй: S_pose ойролцоо байрлалыг өндөр үнэлдэг, S_corr далайцыг үл тоодог. Гурвыг хослуулснаар илүү найдвартай үнэлгээ гарна.");
}

// 8. Out-of-sync moments
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Арга зүй" });
  s.addText("Хэн, хэзээ, биеийн аль хэсгээрээ зөрсөн бэ", { placeholder: "title" });
  bullets(s, [
    "Цонхны оноо тухайн хосын ердийн түвшнээс мэдэгдэхүйц буурах",
    "Бүх бие 0.2 с-ээс илүү найдвартай хоцрох",
    "Нэг мөч (гар, хөл) хоцрох: тэр мөчийг τ-гаар шилжүүлэхэд өнцгийн зөрүү багасах",
    "1 секундээс урт үргэлжилбэл «зөрсөн мөч» болно",
  ], { x: 0.5, y: 1.25, w: 4.9, h: 3.0, fontSize: 15 });
  card(s, 5.7, 1.2, 3.8, 1.85, C.text1);
  text(s, "Жишээ гаралт", { x: 5.95, y: 1.35, w: 3.3, h: 0.35, fontSize: 13, bold: true, color: C.accent3 });
  text(s, "2.1–3.9 с  ·  Хос 1–2\n2-р хүний баруун гар 0.24 с хоцорсон", { x: 5.95, y: 1.75, w: 3.3, h: 1.2, fontSize: 15, color: C.background1 });
  stat(s, "18 / 20", "Хоцроосон тохиолдолд хүн ба мөчийг зөв илрүүлсэн (гол цэгийн түвшний туршилт)", 5.75, 3.25, 3.7, C.accent1, 36);
  s.addNotes("Нэг нийт оноо нь хэзээ, хэн зөрснийг хэлдэггүй. Иймд синхрончлол алдагдсан мөчүүдийг тусад нь илрүүлдэг. Жишээлбэл, хоёрдугаар хүний баруун гар 0.24 секунд хоцорсон гэж гаргана. Гол цэгийн түвшинд хоцрогдол оруулсан 20 тохиолдлын 18-д нь хүн, мөчийг зөв олсон.");
}

// ================= Туршилт =================
pres.addSection({ title: "Туршилт" });

// 9. Controlled data
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Хяналттай өгөгдөл", { placeholder: "title" });
  s.addImage({ path: IMG("pair.jpg"), x: 0.5, y: 1.2, w: 5.0, h: 2.8125, objectName: name("img"), altText: "Эх бичлэг ба хоцроосон хуулбар зэрэгцээ" });
  text(s, "Зүүн: эх бичлэг  ·  Баруун: 8 кадраар (0.32 с) хоцроосон хуулбар", { x: 0.5, y: 4.1, w: 5.0, h: 0.4, fontSize: 11, color: C.text2 });
  stat(s, "32", "FFmpeg-ээр автоматаар үүсгэсэн бичлэг", 5.85, 1.1, 3.6, C.accent1, 40);
  bullets(s, [
    "Хоцрогдол: 0–25 кадр",
    "Толин тусгал, өөр хөдөлгөөн",
    "Камерын зай, нягтаршил, кадрын давтамж",
    "Хүний тоо: 2, 3, 4",
  ], { x: 5.85, y: 2.65, w: 3.6, h: 1.7, fontSize: 14 });
  text(s, "+ 5 бодит бичлэг (тулааны урлаг, бүжиг)", { x: 5.85, y: 4.35, w: 3.6, h: 0.4, fontSize: 13, bold: true, color: C.accent2 });
  s.addNotes("Бодит бичлэгт синхрончлолын жинхэнэ түвшин мэдэгддэггүй. Иймд нэг балетчны бичлэгийг хуулбарлаж, хуулбарыг нь хоцроох, эргүүлэх, жижигрүүлэх зэргээр өөрчилсөн 32 бичлэг автоматаар үүсгэсэн. Ингэснээр зөв хариу нь мэдэгдэж байна. Мөн таван бодит бичлэг дээр туршсан.");
}

// 10. Lag test
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Хоцрогдлыг яг зөв олсон", { placeholder: "title" });
  s.addChart(pres.charts.LINE, [{ name: "Оноо", labels: ["0", "0.04", "0.08", "0.12", "0.20", "0.32", "0.48", "1.00"], values: [99.8, 97.1, 93.1, 89.0, 80.9, 71.8, 64.4, 54.3] }], {
    x: 0.5, y: 1.15, w: 5.6, h: 3.95, ...chartBase(), chartColors: [HEX.accent1], lineSize: 3, lineDataSymbol: "circle", lineDataSymbolSize: 8,
    showValue: true, dataLabelPosition: "t", showLegend: false, valAxisMinVal: 40, valAxisMaxVal: 105, valAxisMajorUnit: 20,
    showTitle: true, title: "Хосын оноо ба тогтоосон хоцрогдол (секунд)", objectName: name("chart"),
  });
  stat(s, "8 / 8", "Хоцрогдлыг яг зөв олсон (0–1 с)", 6.5, 1.15, 3.0, C.accent1, 40);
  stat(s, "0 мс", "Хоцрогдлын алдаа", 6.5, 2.5, 3.0, C.accent2, 40);
  text(s, "Хоцрогдол нэмэгдэх тусам оноо жигд буурсан", { x: 6.5, y: 3.95, w: 3.0, h: 0.8, fontSize: 13, color: C.text2 });
  s.addNotes("Хуулбарыг 0-ээс 25 кадр буюу 1 секунд хүртэл хоцроосон найман бичлэг дээр алгоритм хоцрогдлыг бүгдийг нь яг зөв, алдаагүй олсон. Оноо нь 99.8-аас 54.3 хүртэл жигд буурсан.");
}

// 11. Conditions
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Синхрон > хоцрогдолтой > өөр хөдөлгөөн", { placeholder: "title" });
  s.addChart(pres.charts.BAR, [{ name: "Оноо", labels: ["Синхрон", "Толин тусгал", "0.2 с", "0.48 с", "1 с", "Өөр (4 с)", "Өөр (7 с)", "Өөр (10 с)"], values: [99.8, 99.3, 80.9, 64.4, 54.3, 62.0, 53.7, 45.4] }], {
    x: 0.5, y: 1.15, w: 6.2, h: 3.95, barDir: "col", ...chartBase(), chartColors: [HEX.accent2],
    showValue: true, dataLabelPosition: "outEnd", showLegend: false, valAxisMinVal: 0, valAxisMaxVal: 110, valAxisMajorUnit: 20,
    showTitle: true, title: "1–2 хосын оноо нөхцөл бүрээр", objectName: name("chart"),
  });
  card(s, 7.0, 1.15, 2.5, 3.95);
  text(s, "Толин тусгал", { x: 7.2, y: 1.3, w: 2.1, h: 0.35, fontSize: 14, bold: true, color: C.accent1 });
  text(s, "Цонхнуудын 100%-д толин тусгал горим сонгогдож 99.3 оноо", { x: 7.2, y: 1.7, w: 2.1, h: 0.9, fontSize: 12, color: C.text2 });
  text(s, "Анхааруулга", { x: 7.2, y: 2.75, w: 2.1, h: 0.35, fontSize: 14, bold: true, color: C.accent1 });
  text(s, "1 с хоцрогдол (54.3) өөр хөдөлгөөнтэй ойролцоо. Ялгах нь ρ_max: 0.95 ба ≤ 0.22", { x: 7.2, y: 3.15, w: 2.1, h: 1.8, fontSize: 12, color: C.text2 });
  s.addNotes("Нөхцлүүд хүлээгдэж буй дарааллаар ялгарсан: синхрон хамгийн өндөр, хоцрогдолтой нь дунд, өөр хөдөлгөөн хамгийн бага. Толин тусгал хөдөлгөөнийг зөв таньсан. Харин 1 секундийн хоцрогдол өөр хөдөлгөөнтэй ойролцоо оноо авсан тул тэдгээрийг корреляцын утгаар ялгах шаардлагатай.");
}

// 12. Robustness
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Оролтын бичлэгийн чанарын нөлөө", { placeholder: "title" });
  const cards = [
    ["Камерын зай", "50%", "Хүнийг хагас хүртэл жижигрүүлэхэд оноо 99.8 → 99.3"],
    ["Нягтаршил", "360p", "Гол цэгийн 99.4% нь 1080p-тэй таарсан, хоцрогдлын алдаа 0 мс"],
    ["Кадрын давтамж", "10 fps", "0.3 с хоцрогдлын алдаа 0–33 мс (1 кадраас бага)"],
  ];
  cards.forEach(([h, v, d], i) => {
    const x = 0.5 + i * 3.05;
    card(s, x, 1.15, 2.85, 2.55);
    text(s, h, { x: x + 0.25, y: 1.3, w: 2.4, h: 0.35, fontSize: 15, bold: true, color: C.text2 });
    text(s, v, { x: x + 0.25, y: 1.7, w: 2.4, h: 0.75, fontSize: 40, bold: true, color: C.accent2, valign: "middle" });
    text(s, d, { x: x + 0.25, y: 2.55, w: 2.4, h: 1.05, fontSize: 12, color: C.text2 });
  });
  card(s, 0.5, 3.95, 9, 1.15, C.text1);
  text(s, [
    { text: "Хязгаар: ", options: { bold: true, color: HEX.accent1 } },
    { text: "хүний өндөр ~140 пикселээс бага эсвэл 240p үед хүний тоо буруу тоологдсон. Хүний тоог гараар өгөхөд хоцрогдол дахин зөв олдсон.", options: { color: HEX.lt1 } },
  ], { x: 0.8, y: 4.05, w: 8.4, h: 0.95, fontSize: 14, valign: "middle" });
  s.addNotes("Хүнийг хагас хүртэл жижигрүүлэх, 360p хүртэл нягтаршил бууруулах, секундэд 10 кадр болгоход үр дүн бараг өөрчлөгдөөгүй. Харин хүн маш жижиг, ойролцоогоор 140 пикселээс бага үед хүн илрүүлэгч алдаж, хүний тоо буруу тоологдсон. Энэ нь аргын гол хязгаарлалт.");
}

// 13. People count
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Олон хүнд хоцорсон хүнийг олсон", { placeholder: "title" });
  s.addChart(pres.charts.BAR, [
    { name: "Синхрон хүмүүс", labels: ["2 хүн", "3 хүн", "4 хүн"], values: [71.8, 85.7, 90.4] },
    { name: "Хоцорсон хүн (0.32 с)", labels: ["2 хүн", "3 хүн", "4 хүн"], values: [71.8, 71.7, 71.6] },
  ], {
    x: 0.5, y: 1.15, w: 5.8, h: 3.95, barDir: "col", barGrouping: "clustered", ...chartBase(), chartColors: [HEX.accent2, HEX.accent1],
    showValue: true, dataLabelPosition: "outEnd", showLegend: true, legendPos: "b", valAxisMinVal: 0, valAxisMaxVal: 100, valAxisMajorUnit: 20,
    showTitle: true, title: "Хүн тус бүрийн оноо S_i", objectName: name("chart"),
  });
  stat(s, "3 / 3", "Хоцорсон хүн хамгийн бага S_i-тэй", 6.7, 1.15, 2.8, C.accent1, 40);
  stat(s, "+17 мс", "Нэг хүн нэмэгдэх бүрт нэг кадрын хугацаа (58 → 74 → 91 мс)", 6.7, 2.55, 2.8, C.accent2, 36);
  text(s, "Бүлгийн оноонд нэг хүний зөрүү шингэдэг тул S_i-г харах хэрэгтэй", { x: 6.7, y: 4.05, w: 2.8, h: 0.9, fontSize: 12, color: C.text2 });
  s.addNotes("Хоёр, гурав, дөрвөн хуулбартай бичлэгт сүүлийн хүнийг 0.32 секунд хоцроосон. Бүх тохиолдолд хоцорсон хүн хамгийн бага оноо авсан. Хүний тоо нэмэгдэхэд бүлгийн оноо өсдөг тул хүн тус бүрийн оноог харах нь чухал.");
}

// 14. Real recordings
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Бодит бичлэг дээрх үр дүн", { placeholder: "title" });
  s.addImage({ path: IMG("real.jpg"), x: 0.5, y: 1.2, w: 3.6, h: 2.7, objectName: name("img"), altText: "Гурван бүжигчин хамтдаа бүжиглэж буй бичлэгийн кадр" });
  text(s, "Гурван бүжигчин, 59.94 кадр/с, 31–43 с", { x: 0.5, y: 4.0, w: 3.6, h: 0.4, fontSize: 11, color: C.text2 });
  s.addTable([
    [{ text: "Бичлэг", options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } },
      { text: "Бүлгийн оноо", options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } },
      { text: "Гурвуулаа илэрсэн", options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }],
    ["Тулааны урлаг (пүмсэ)", "82.6", "100%"],
    ["Бүжиг 1", "69.4", "93.1%"],
    ["Бүжиг 2", "67.0", "86.0%"],
    ["Бүжиг 3", "71.2", "86.4%"],
    ["Бүжиг 4", "79.1", "98.3%"],
  ], { x: 4.4, y: 1.2, w: 5.1, colW: [2.2, 1.35, 1.55], fontSize: 13, fontFace: "Arial", color: HEX.dk1, border: { type: "solid", pt: 0.5, color: "DCE2EA" }, rowH: 0.42, valign: "middle", objectName: name("table") });
  text(s, "Хуулбартай синхрон (99.8) ба өөр хөдөлгөөн (45–62)-ий хооронд: хүмүүсийн хөдөлгөөний байгалийн зөрүү", { x: 4.4, y: 3.95, w: 5.1, h: 0.85, fontSize: 13, color: C.text2 });
  s.addNotes("Бодит бүжигчдийн оноо 67-79 гарсан. Энэ нь ижил хуулбараас бага, харин огт өөр хөдөлгөөнөөс их. Учир нь ижил бүжиг хийсэн ч хүмүүсийн хөдөлгөөнд байгалийн зөрүү бий. Бодит бичлэгийн синхрончлолын жинхэнэ түвшин тэмдэглэгдээгүй тул эдгээр оноог шүүгчийн үнэлгээтэй харьцуулаагүй, энэ нь аргын хязгаарлалт.");
}

// 15. Browser vs server
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Туршилт" });
  s.addText("Вэб хөтөч ба сервер", { placeholder: "title" });
  s.addChart(pres.charts.BAR, [{ name: "мс", labels: ["Вэб хөтөч (WebGPU)", "Сервер (CUDA)"], values: [113.8, 50.8] }], {
    x: 0.5, y: 1.15, w: 4.6, h: 3.95, barDir: "bar", ...chartBase(), chartColors: [HEX.accent4],
    showValue: true, dataLabelPosition: "outEnd", showLegend: false, valAxisMinVal: 0, valAxisMaxVal: 140, valAxisMajorUnit: 20,
    showTitle: true, title: "Нэг кадрын хугацаа (мс), RTMPose-m", objectName: name("chart"),
  });
  stat(s, "2.2×", "Сервер хурдан (NVIDIA RTX 2060)", 5.5, 1.15, 1.9, C.accent1, 40);
  stat(s, "0.61 px", "Хоёр горимын гол цэгийн медиан зөрүү", 7.5, 1.15, 2.0, C.accent2, 34);
  card(s, 5.5, 2.95, 4.0, 2.15);
  text(s, "Кадр бүрийг нарийн унших", { x: 5.75, y: 3.1, w: 3.5, h: 0.35, fontSize: 14, bold: true });
  text(s, "Хөтөч видеоны кадр бүрийн голд шилжиж уншдаг тул нэг ч кадр давхардахгүй, алгасагдахгүй. Хоёр горим яг ижил кадруудыг боловсруулна.", { x: 5.75, y: 3.5, w: 3.5, h: 1.5, fontSize: 12, color: C.text2 });
  s.addNotes("Системийг хөтөч дээр болон GPU-тэй сервер дээр ажиллуулж болно. Сервер 2.2 дахин хурдан, хоёр горимын гол цэг дунджаар нэг пикселээс бага зөрүүтэй. Хөтөч кадр бүрийн голд шилжиж уншдаг тул хоёр горим яг ижил кадруудыг боловсруулдаг.");
}

// ================= Дүгнэлт =================
pres.addSection({ title: "Дүгнэлт" });

// 16. Limitations
{
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Дүгнэлт" });
  s.addText("Аргын хязгаарлалт", { placeholder: "title" });
  const lim = [
    ["Жижиг хүн", "~140 px-ээс бага эсвэл 240p бол хүний тоо буруу тоологдоно"],
    ["Их хоцрогдол", "~1 с хоцрогдол оноогоороо өөр хөдөлгөөнтэй ойролцоо"],
    ["2D өнцөг", "Хүмүүс камерт ойролцоо ижил чиглэлд харсан байх шаардлагатай"],
    ["Хоцрогдлын оноо", "ρ_min босгын орчимд тогтворгүй: налуу хувилбарыг санал болгосон"],
  ];
  lim.forEach(([h, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 4.6, y = 1.2 + row * 1.95;
    card(s, x, y, 4.4, 1.75);
    numberDot(s, i + 1, x + 0.25, y + 0.25, C.accent1, 0.42);
    text(s, h, { x: x + 0.85, y: y + 0.25, w: 3.3, h: 0.42, fontSize: 16, bold: true, valign: "middle" });
    text(s, d, { x: x + 0.85, y: y + 0.8, w: 3.3, h: 0.85, fontSize: 13, color: C.text2 });
  });
  s.addNotes("Аргын хязгаарлалтууд: маш жижиг хүнийг илрүүлэхгүй, 1 секунд орчим хоцрогдлыг өөр хөдөлгөөнөөс корреляцаар ялгах хэрэгтэй, хоёр хэмжээст өнцөг тул хүмүүс нэг чиглэлд харсан байх ёстой, хоцрогдлын оноо босгын орчимд тогтворгүй.");
}

// 17. Conclusion
{
  const s = pres.addSlide({ masterName: "SECTION_DARK", sectionTitle: "Дүгнэлт" });
  s.addText("Дүгнэлт", { placeholder: "title" });
  const res = [
    ["RTMPose-m", "5 загвараас гол цэгийн чанараар сонгосон"],
    ["0 мс", "0–1 с хоцрогдлыг бүгдийг яг зөв олсон"],
    ["18 / 20", "Хоцорсон хүн, мөчийг зөв илрүүлсэн"],
    ["2 горим", "Вэб хөтөч ба GPU сервер дээр ажилладаг систем"],
  ];
  res.forEach(([v, d], i) => {
    const x = 0.5 + i * 2.3;
    text(s, v, { x, y: 1.2, w: 2.2, h: 0.7, fontSize: 24, bold: true, color: i % 2 ? C.accent2 : C.accent1, valign: "bottom" });
    text(s, d, { x, y: 1.95, w: 2.1, h: 0.8, fontSize: 13, color: "CADCFC" });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 3.1, w: 9, h: 1.85, fill: { color: "1F3155" }, line: { type: "none" }, rectRadius: 0.08, objectName: name("card") });
  text(s, "Энгийн нэг камераар авсан бичлэгээс олон хүний хөдөлгөөний синхрончлолыг тоон, давтагдах боломжтой хэлбэрээр үнэлж, хэн, хэзээ, биеийн аль хэсгээрээ хэр хэмжээгээр зөрж байгааг тодорхойлох боломжтой.", { x: 0.8, y: 3.25, w: 8.4, h: 1.55, fontSize: 17, color: C.background1, valign: "middle" });
  s.addNotes("Дүгнэвэл, энгийн нэг камераар авсан бичлэгээс олон хүний хөдөлгөөний синхрончлолыг тоон, давтагдах боломжтой хэлбэрээр үнэлж, хэн, хэзээ, биеийн аль хэсгээрээ хэр хэмжээгээр зөрж байгааг тодорхойлох систем боловсрууллаа. RTMPose-m загварыг сонгож, хяналттай туршилтад 0-1 секундийн хоцрогдлыг алдаагүй олж, хоцорсон хүн ба мөчийг 20 тохиолдлын 18-д зөв илрүүлсэн. Систем вэб хөтөч болон GPU сервер дээр ажилладаг.");
}

// 18. Thanks
{
  const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Дүгнэлт" });
  s.addText("Анхаарал хандуулсанд баярлалаа", { placeholder: "title" });
  s.addText([
    { text: "Асуулт, санал хүлээн авна", options: { breakLine: true } },
    { text: " ", options: { breakLine: true, fontSize: 8 } },
    { text: "github.com/codebreakre/HPE-in-sports-analysis", options: { color: "FFFFFF" } },
  ], { placeholder: "body" });
  skeleton(s, 7.35, 3.15, 0.95, HEX.accent1, HEX.lt1, "arms-up");
  skeleton(s, 8.75, 3.25, 0.8, HEX.accent2, HEX.lt1, "arms-up");
  s.addNotes("Анхаарал хандуулсанд баярлалаа. Асуулт байвал хариулъя.");
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
