# Төслийг хэрхэн ажиллуулах вэ

"Спортын шинжилгээнд хүний байрлалын тооцооллыг ашиглах нь" бакалаврын судалгааны ажлын код. Видеоноос хүмүүсийн
биеийн гол цэгийг (RTMPose-m) илрүүлж, тэдний хөдөлгөөний синхрончлолыг 0–100 оноогоор үнэлнэ.

Төсөл хоёр хэсэгтэй:

| Хэсэг | Хавтас | Үүрэг |
|---|---|---|
| Вэб апп | `apps/web` | Хөтөч дээр HPE, синхрончлол, үр дүн харах, хадгалах |
| HPE сервер (заавал биш) | `apps/server` | Видеог GPU (CUDA) дээр боловсруулах Python сервер |

Бүх командыг **төслийн үндсэн хавтаснаас** ажиллуулна.

---

## 1. Шаардлагатай программууд

| Программ | Хувилбар | Хэзээ хэрэгтэй |
|---|---|---|
| [Node.js](https://nodejs.org) | 24 (22.18-аас дээш) | Үргэлж |
| Chrome эсвэл Edge | Сүүлийн хувилбар (WebGPU) | Үргэлж |
| [Python](https://www.python.org) | 3.11-ээс дээш (3.14 дээр туршсан) | Сервер, шинжилгээний график |
| NVIDIA GPU + драйвер | — | Серверийг хурдан ажиллуулах (байхгүй бол CPU) |
| [FFmpeg](https://ffmpeg.org) | 7.x | Зөвхөн туршилтын видео үүсгэхэд |

Node.js 22.18-аас доош хувилбар `.ts` скриптүүдийг шууд ажиллуулж чадахгүй тул `node --version`-оор шалгаарай.

---

## 2. Анх удаа тохируулах

```bash
git clone https://github.com/codebreakre/HPE-in-sports-analysis.git
cd HPE-in-sports-analysis
npm install
npm run models
```

`npm run models` нь RTMPose-m болон YOLO11n загварын жинг (`apps/web/public/models/`) татна. Нэг л удаа хийнэ.
Жингийн файлууд том тул git-д ороогүй.

---

## 3. Вэб аппыг ажиллуулах

```bash
npm run dev
```

Chrome эсвэл Edge дээр **http://localhost:5173** хаягийг нээнэ. Анх ачаалахад интернет хэрэгтэй (ONNX Runtime-ийн
файлууд татагдана).

1. Видеогоо `data/` хавтсанд хийнэ (дэд хавтас болно, жишээ нь `data/dance/`). `data/` git-д ордоггүй.
2. Хуудасны зүүн талд **From data/ folder**-оос видеог сонгоно (шинэ файл нэмсэн бол **Refresh list**).
3. **Process videos on**: **This browser** (хөтөч дээр) эсвэл **Server** (доорх 4-р алхам).
4. **Process video** дарна. Дууссаны дараа араг яс зурагдсан видео, синхрончлолын оноо, график гарна.
5. Үр дүн `results/rtmpose-m/` хавтсанд автоматаар хадгалагдана (дахин ажиллуулахад `_run2`, `_run3` …, хуучныг дарж
   бичихгүй). **Saved results** цэснээс өмнөх бүх үр дүнг харж болно.

---

## 4. HPE серверийг ажиллуулах (заавал биш)

Видеог GPU дээр ~2 дахин хурдан боловсруулна. Хоёр дахь терминалд:

```bash
npm run server:setup
npm run server
```

- `npm run server:setup` нь `apps/server/.venv` дотор Python орчин үүсгэж, сангуудыг (onnxruntime-gpu, CUDA-ийн DLL
  гэх мэт, ~2 GB) суулгана. **Нэг л удаа** хийнэ.
- `npm run server` нь серверийг **http://127.0.0.1:8000** дээр асаана. API-ийн баримт: http://127.0.0.1:8000/docs
- Вэб аппын **Process videos on → Server** сонгоход "Server ready · … · cuda" гэж гарвал бэлэн.
- NVIDIA GPU байхгүй эсвэл CUDA ажиллахгүй бол сервер автоматаар CPU ашиглана. Заавал CPU ашиглах бол
  `HPE_DEVICE=cpu npm run server`.

---

## 5. Синхрончлолыг тушаалын мөрөөс тооцоолох

Хадгалсан гол цэгийн файл дээр синхрончлолын алгоритмыг дахин ажиллуулна (тохиргоог өөрчилж туршихад):

```bash
npm run sync -- results/rtmpose-m/poomsae-720reso_run6-pose.json --out C:/temp/sync-test
```

Тохиргоо өөрчлөх жишээ: `--set jointWeightPreset=ballet`, `--set windowSec=3`, `--late 0.3`.

---

## 6. Тайлангийн туршилтуудыг давтах

Тайлангийн 4-р бүлгийн хяналттай туршилтуудыг (хоцрогдол, толин тусгал, өөр хөдөлгөөн, камерын зай, нягтаршил,
кадрын давтамж, хүний тоо, бодит бичлэг) нэг командаар давтана.

1. FFmpeg-ийг `tools/ffmpeg/ffmpeg.exe` байрлалд тавих, эсвэл PATH-д нэмэх, эсвэл `FFMPEG` орчны хувьсагчаар заах.
2. Эх бичлэг `data/latency-0.mp4` (балетчин) болон бодит бичлэгүүд `data/personCount3_test*.mp4` байх ёстой.
3. Серверийг асаана (`npm run server`), дараа нь:

```bash
npm run experiments
```

Нэг туршилт ажиллуулах бол: `npm run experiments -- lag`. Үр дүн `results/experiments/*.csv`-д хадгалагдана.

---

## 7. Тайлангийн графикуудыг гаргах

```bash
python -m pip install pandas numpy matplotlib
python analysis/model_comparison.py
python analysis/resolution_check.py
python analysis/report_figures.py
python analysis/experiment_figures.py
```

Графикууд `results/model-comparison/`, `results/resolution-check/`, `results/report-figures/` хавтсуудад гарна.

---

## 8. Тайлангийн PDF-ийг эмхэтгэх

Тайлангийн LaTeX эх файлууд болон эмхэтгэсэн PDF `report/` хавтсанд байна (`report/thesis-final.pdf`).
Дахин эмхэтгэх бол **XeLaTeX** хэрэгтэй (`main.tex` нь `fontspec` ашигладаг):

- **Overleaf:** `report/` хавтсыг zip болгож оруулаад Compiler-ийг **XeLaTeX** болгоно.
- **Компьютер дээр:** [Tectonic](https://tectonic-typesetting.github.io)-ийг татаад `report/` хавтсанд
  `tectonic -X compile main.tex`. Компьютер дээр DejaVu Sans Mono фонт байхгүй бол `main.tex` дахь
  `\setmonofont[Scale=0.85]{DejaVu Sans Mono}`-г `{DejaVuSansMono.ttf}` болгоно.

---

## Түгээмэл асуудлууд

| Асуудал | Шийдэл |
|---|---|
| `... not found. Run "npm run models"` | `npm run models`-ийг ажиллуулна |
| Загвар CPU дээр удаан ажиллаж байна | Chrome/Edge-ийн WebGPU асаалттай эсэхийг шалгах (chrome://gpu) |
| "Server not reachable: start it with `npm run server`" | Серверийг өөр терминалд асаах |
| "No Python environment yet" | `npm run server:setup`-ийг эхлээд ажиллуулах |
| Сервер `cpu` гэж гарч байна | NVIDIA драйвераа шинэчлэх; ажиллахгүй бол CPU-гээр үргэлжилнэ |
| Үр дүн хадгалагдахгүй байна | Аппыг `npm run dev`-ээр ажиллуулах ёстой (хадгалалт dev серверээр дамждаг) |

Илүү дэлгэрэнгүй (гаралтын файлын баганууд, бүтэц): [README.md](README.md).
