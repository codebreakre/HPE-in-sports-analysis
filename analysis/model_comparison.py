"""Model comparison: which of the HPE models suits multi-person pose estimation best?

Inputs: the newest completed run of data/resolution-check-data/poomsae-720reso.mp4 in each
results/<model>/ folder (its -metrics.csv, -keypoint-metrics.csv and -pose.json). A model with no
such run yet is left out (with a note). The script checks that every run used the same file
(same SHA-256) and the same processing FPS.
Outputs (results/model-comparison/):
  summary.csv              one row per model: the metrics used below + consensus agreement
  consensus_keypoints.csv  one row per model x keypoint: distance to the other models' consensus
  scorecard.csv            per-criterion values, ranks, normalized scores and the weighted total
  fig1_detection.png       are all 3 people found? (% of frames, people per frame over time)
  fig2_speed.png           time per frame (mean, p95) and per detected person
  fig3_keypoint_quality.png  consensus agreement, jitter, limb length consistency
  fig4_keypoint_heatmap.png  jitter and consensus error per keypoint
  fig5_tradeoff.png        speed vs. keypoint agreement
  fig6_scorecard.png       ranks per criterion and the weighted overall score
  mn/fig*.png              the same six figures with Mongolian text (for the thesis)

Consensus agreement (no ground truth exists): for each person a model finds, the same person is
looked up in all the other models (nearest torso centre); the per-keypoint median of those models
is the reference. Distance is divided by the reference box height; PCK@0.05 = share of keypoints
within 5 % of body height. This is agreement with the other models, not accuracy, and models
of one family (YOLO11/YOLOv8/YOLO26; RTMPose/ViTPose share a detector) tend to agree with each other.

Run: python analysis/model_comparison.py   (needs pandas + matplotlib)
"""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
OUT = RESULTS / "model-comparison"
VIDEO = "poomsae-720reso"

MODELS = {  # results folder -> label, in the app's order
    "yolo11n-pose": "YOLO11n",
    "yolov8n-pose": "YOLOv8n",
    "yolo26n-pose": "YOLO26n",
    "rtmpose-m": "RTMPose-m",
    "vitpose-b": "ViTPose-B",
    "mediapipe-pose-full": "MediaPipe",
}
# Categorical palette slots, fixed per model so a model keeps its color in every figure. YOLO26 takes
# violet (slot 7): green (slot 6) next to YOLOv8's orange fails the colorblind (protan) check.
# This order passes the dataviz validator.
MODEL_COLORS = {
    "yolo11n-pose": "#2a78d6",
    "yolov8n-pose": "#eb6834",
    "yolo26n-pose": "#6250d6",
    "rtmpose-m": "#1baf7a",
    "vitpose-b": "#eda100",
    "mediapipe-pose-full": "#e87ba4",
}
INK, INK_2, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e0", "#fcfcfb"
SEQ = LinearSegmentedColormap.from_list("seq", ["#eef4fc", "#86b6ef", "#2a78d6", "#104281"])

PCK_THRESHOLD = 0.05
MATCH_MAX_DIST = 0.1  # max torso-centre distance (share of frame width) to call two detections the same person
MIN_OTHERS = 2        # a consensus needs at least this many other models to have found the person
TORSO = ["left_shoulder", "right_shoulder", "left_hip", "right_hip"]

# Criteria for the scorecard: (column, higher_is_better, weight); labels are in TEXT[...]["criteria"].
# Weights favour multi-person reliability: finding every person matters most, then keypoint quality, then speed.
CRITERIA = [
    ("all_tracked_rate", True, 0.25),
    ("clean_frame_rate", True, 0.10),
    ("consensus_pck", True, 0.20),
    ("jitter_pct", False, 0.20),
    ("limb_cv_pct", False, 0.10),
    ("mean_total_ms", False, 0.15),
]


# ---------- loading ----------

def newest_run(model: str) -> Path | None:
    """The newest completed run of VIDEO that has a metrics file (its -metrics.csv), or None."""
    candidates = []
    for path in (RESULTS / model).glob(f"{VIDEO}*-metrics.csv"):
        if path.name.endswith("-keypoint-metrics.csv"):
            continue
        row = pd.read_csv(path).iloc[0]
        if row["source"] == f"{VIDEO}.mp4" and bool(row["completed"]):
            candidates.append((row["created_at"], path))
    return max(candidates)[1] if candidates else None


def load() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, dict]]:
    """Loads each model's run; models without one are dropped from MODELS for the rest of the script."""
    global MODELS
    metrics, keypoints, poses = [], [], {}
    for model in list(MODELS):
        path = newest_run(model)
        if path is None:
            print(f"{MODELS[model]:<10} skipped: no completed {VIDEO} run with metrics in results/{model}/")
            del MODELS[model]
            continue
        stem = path.name[: -len("-metrics.csv")]
        metrics.append(pd.read_csv(path).assign(run=stem))
        keypoints.append(pd.read_csv(path.with_name(f"{stem}-keypoint-metrics.csv")))
        poses[model] = json.loads(path.with_name(f"{stem}-pose.json").read_text(encoding="utf-8"))
        print(f"{MODELS[model]:<10} results/{model}/{stem}-*")
    if len(MODELS) < MIN_OTHERS + 1:
        raise SystemExit(f"Need runs from at least {MIN_OTHERS + 1} models to compare; process {VIDEO}.mp4 in the app.")
    df = pd.concat(metrics, ignore_index=True)
    for column in ["source_sha256", "fps", "frames"]:
        if df[column].nunique() != 1:
            raise SystemExit(f"Runs differ in {column}: {dict(zip(df['model'], df[column]))}; re-run so they match.")
    return df, pd.concat(keypoints, ignore_index=True), poses


# ---------- consensus agreement ----------

def frame_people(run: dict) -> dict[int, list[dict]]:
    """frame -> persons as arrays: keypoints (17, 2), torso centre and box height, in pixels."""
    names = run["keypointNames"]
    torso = [names.index(n) for n in TORSO]
    out = {}
    for frame in run["frames"]:
        people = []
        for p in frame["persons"]:
            kp = np.array([[k["x"], k["y"]] for k in p["keypoints"]], dtype=float)
            people.append({"kp": kp, "centre": kp[torso].mean(axis=0), "height": p["box"][3] - p["box"][1]})
        out[frame["frame"]] = people
    return out


def consensus(poses: dict[str, dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per model: PCK and mean error against the median of the other models (leave-one-out)."""
    people = {m: frame_people(run) for m, run in poses.items()}
    names = next(iter(poses.values()))["keypointNames"]
    max_dist = MATCH_MAX_DIST * next(iter(poses.values()))["width"]
    rows, kp_rows = [], []
    for model in MODELS:
        errors = []  # one (17,) array of normalized distances per matched person
        for frame, persons in people[model].items():
            for person in persons:
                matched = []
                for other in MODELS:
                    if other == model:
                        continue
                    candidates = people[other].get(frame, [])
                    if not candidates:
                        continue
                    dists = [np.linalg.norm(c["centre"] - person["centre"]) for c in candidates]
                    best = int(np.argmin(dists))
                    if dists[best] <= max_dist:
                        matched.append(candidates[best])
                if len(matched) < MIN_OTHERS:
                    continue
                ref = np.median([m["kp"] for m in matched], axis=0)
                height = np.median([m["height"] for m in matched])
                errors.append(np.linalg.norm(person["kp"] - ref, axis=1) / height)
        e = np.array(errors)
        rows.append({
            "model": model,
            "consensus_persons": len(e),
            "consensus_pck": (e <= PCK_THRESHOLD).mean() * 100,
            "consensus_pck_0.1": (e <= 0.1).mean() * 100,
            "consensus_error_pct": e.mean() * 100,
        })
        for k, name in enumerate(names):
            kp_rows.append({"model": model, "keypoint": name, "consensus_error_pct": e[:, k].mean() * 100,
                            "consensus_pck": (e[:, k] <= PCK_THRESHOLD).mean() * 100})
    return pd.DataFrame(rows), pd.DataFrame(kp_rows)


# ---------- scorecard ----------

def scorecard(df: pd.DataFrame) -> pd.DataFrame:
    """Rank 1 (best) - 5 per criterion, ratio-to-best score (1 = best), weighted total.

    Ratio scoring (value / best, or best / value when lower is better) keeps real proportions:
    min-max scaling would let one far-off model squeeze the differences between all the others.
    """
    rows = []
    for column, higher, weight in CRITERIA:
        values = df.set_index("model")[column]
        best = values.max() if higher else values.min()
        label = TEXT["en"]["criteria"][column].replace("\n", " ")
        for model, v in values.items():
            score = (v / best if higher else best / v) if v and best else float(v == best)
            rows.append({"criterion": column, "label": label, "weight": weight,
                         "model": model, "value": v,
                         "rank": int(values.rank(ascending=not higher, method="min")[model]),
                         "score": score})
    card = pd.DataFrame(rows)
    total = (card.assign(w=card["score"] * card["weight"]).groupby("model")["w"].sum()
             / sum(c[2] for c in CRITERIA))
    card["total"] = card["model"].map(total)
    return card


# ---------- figure text (English and Mongolian) ----------

KEYPOINTS_MN = {
    "nose": "хамар", "left_eye": "зүүн нүд", "right_eye": "баруун нүд", "left_ear": "зүүн чих",
    "right_ear": "баруун чих", "left_shoulder": "зүүн мөр", "right_shoulder": "баруун мөр",
    "left_elbow": "зүүн тохой", "right_elbow": "баруун тохой", "left_wrist": "зүүн бугуй",
    "right_wrist": "баруун бугуй", "left_hip": "зүүн ташаа", "right_hip": "баруун ташаа",
    "left_knee": "зүүн өвдөг", "right_knee": "баруун өвдөг", "left_ankle": "зүүн шагай",
    "right_ankle": "баруун шагай",
}

TEXT = {
    "en": {
        "dir": OUT,
        "keypoint": lambda name: name.replace("_", " "),
        "higher": "higher is better",
        "lower": "lower is better",
        "criteria": {
            "all_tracked_rate": "All 3 people found\n(% frames)",
            "clean_frame_rate": "Frames without\nfalse positives (%)",
            "consensus_pck": f"Agreement PCK@{PCK_THRESHOLD}\n(%)",
            "jitter_pct": "Jitter\n(% body height)",
            "limb_cv_pct": "Limb length CV\n(%)",
            "mean_total_ms": "Time per frame\n(ms)",
        },
        "det_title": "Multi-person detection",
        "det_bar": "Frames with all {n} people found",
        "det_bar_y": "% of frames",
        "det_line": "People detected per frame",
        "det_line_note": "dashed line = {n} people in the video",
        "det_x": "video time (s)",
        "speed_title": "Inference speed",
        "speed_frame": "Time per frame",
        "speed_frame_y": "ms (pre + inference + post)",
        "speed_frame_note": "bar = mean, whisker = 95th percentile · lower is better",
        "speed_person": "Time per detected person",
        "speed_person_y": "ms per person",
        "speed_person_note": "top-down models get slower with every extra person · lower is better",
        "speed_footer": "Measured in the browser. Devices: {devices}.",
        "quality_title": "Keypoint quality (no ground truth: proxy measures)",
        "agree": f"Agreement with other models (PCK@{PCK_THRESHOLD})",
        "agree_y": "% of keypoints",
        "agree_note": "within 5 % of body height of the others' median · higher is better",
        "jitter": "Keypoint jitter",
        "jitter_y": "% of body height per frame²",
        "jitter_note": "acceleration between consecutive frames · lower is steadier",
        "limb": "Limb length consistency",
        "limb_y": "coefficient of variation (%)",
        "limb_note": "arm and leg lengths over time · lower is more consistent",
        "heat_jitter": "Jitter per keypoint",
        "heat_jitter_unit": "% of body height per frame²",
        "heat_cons": "Distance to the other models' consensus per keypoint",
        "heat_cons_unit": "% of body height",
        "trade_title": "Speed vs. keypoint agreement",
        "trade_x": "time per frame (ms) · lower is better",
        "trade_y": f"agreement PCK@{PCK_THRESHOLD} (%) · higher is better",
        "trade_note": "best models sit top-left · y axis starts above 0 to separate the points\n"
                      "frames with all people found: {rates}",
        "card_title": "Model scorecard for multi-person pose estimation",
        "card_ranks": "Rank per criterion  (#1 = best, darker = better)",
        "card_weight": "weight",
        "card_total": "Weighted score (0-100)",
        "card_footer": "Score: each criterion as a ratio to the best model (value / best, or best / value when "
                       "lower is better; best = 1), then weighted. Weights are set in CRITERIA in "
                       "analysis/model_comparison.py.",
    },
    "mn": {
        "dir": OUT / "mn",
        "keypoint": lambda name: KEYPOINTS_MN[name],
        "higher": "их байх тусам сайн",
        "lower": "бага байх тусам сайн",
        "criteria": {
            "all_tracked_rate": "3 хүн бүгд илэрсэн\n(кадрын %)",
            "clean_frame_rate": "Худал илрүүлэлтгүй\nкадр (%)",
            "consensus_pck": f"Тохирол PCK@{PCK_THRESHOLD}\n(%)",
            "jitter_pct": "Чичиргээ (jitter)\n(биеийн өндрийн %)",
            "limb_cv_pct": "Мөчдийн уртын CV\n(%)",
            "mean_total_ms": "Нэг кадрын хугацаа\n(мс)",
        },
        "det_title": "Олон хүний илрүүлэлт",
        "det_bar": "{n} хүн бүгд илэрсэн кадр",
        "det_bar_y": "кадрын %",
        "det_line": "Кадр бүрт илэрсэн хүний тоо",
        "det_line_note": "тасархай шугам = бичлэг дэх {n} хүн",
        "det_x": "бичлэгийн хугацаа (с)",
        "speed_title": "Боловсруулалтын хурд",
        "speed_frame": "Нэг кадрын хугацаа",
        "speed_frame_y": "мс (pre + inference + post)",
        "speed_frame_note": "багана = дундаж, зураас = 95-р перцентиль · бага байх тусам сайн",
        "speed_person": "Илэрсэн нэг хүнд ногдох хугацаа",
        "speed_person_y": "мс / хүн",
        "speed_person_note": "top-down моделиуд хүн нэмэгдэх тусам удаашрана · бага байх тусам сайн",
        "speed_footer": "Браузер дотор хэмжсэн. Төхөөрөмж: {devices}.",
        "quality_title": "Keypoint-ийн чанар (ground truth байхгүй тул шууд бус үзүүлэлт)",
        "agree": f"Бусад моделиудтай тохирох байдал (PCK@{PCK_THRESHOLD})",
        "agree_y": "keypoint-ийн %",
        "agree_note": "бусдын медианаас биеийн өндрийн 5 %-д багтсан · их байх тусам сайн",
        "jitter": "Keypoint-ийн чичиргээ (jitter)",
        "jitter_y": "биеийн өндрийн % / кадр²",
        "jitter_note": "дараалсан кадрууд хоорондын хурдатгал · бага байх тусам тогтвортой",
        "limb": "Мөчдийн уртын тогтвортой байдал",
        "limb_y": "хэлбэлзлийн коэффициент (%)",
        "limb_note": "гар, хөлийн урт бичлэгийн туршид · бага байх тусам тогтвортой",
        "heat_jitter": "Keypoint тус бүрийн чичиргээ (jitter)",
        "heat_jitter_unit": "биеийн өндрийн % / кадр²",
        "heat_cons": "Бусад моделиудын консенсусаас зөрөх зай, keypoint тус бүрээр",
        "heat_cons_unit": "биеийн өндрийн %",
        "trade_title": "Хурд ба keypoint-ийн тохирол",
        "trade_x": "нэг кадрын хугацаа (мс) · бага байх тусам сайн",
        "trade_y": f"тохирол PCK@{PCK_THRESHOLD} (%) · их байх тусам сайн",
        "trade_note": "хамгийн сайн моделиуд зүүн дээд буланд · цэгүүдийг ялгахын тулд y тэнхлэг 0-ээс эхлээгүй\n"
                      "бүх хүн илэрсэн кадр: {rates}",
        "card_title": "Олон хүний pose estimation-д тохирох моделийн үнэлгээ",
        "card_ranks": "Шалгуур тус бүрийн байр  (#1 = хамгийн сайн, бараан = сайн)",
        "card_weight": "жин",
        "card_total": "Жинлэсэн оноо (0-100)",
        "card_footer": "Оноо: шалгуур бүрийг хамгийн сайн моделийн утгатай харьцуулж (утга / шилдэг, бага нь сайн "
                       "бол шилдэг / утга; шилдэг = 1), жингээр нэгтгэв. Жинг analysis/model_comparison.py-ийн "
                       "CRITERIA-д тохируулна.",
    },
}
T = TEXT["en"]  # the language being drawn; set by main()


# ---------- figures ----------

def style_axes(ax, title, ylabel=None, note=None):
    pad = 10 + 11 * (note.count("\n") + 1) if note else 10
    ax.set_title(title, loc="left", fontsize=11, color=INK, fontweight="bold", pad=pad)
    if note:
        ax.text(0, 1.02, note, transform=ax.transAxes, fontsize=8, color=INK_2, va="bottom")
    if ylabel:
        ax.set_ylabel(ylabel, color=INK_2, fontsize=9)
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ["top", "right", "left"]:
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(INK_2)
    ax.tick_params(colors=INK_2, labelsize=9, length=0)


def model_bars(ax, df, column, title, ylabel, fmt="{:.1f}", note=None, err_hi=None, ylim=None):
    """One bar per model, in app order, value written on top (identity is never color-only)."""
    models = list(MODELS)
    values = df.set_index("model").loc[models, column].to_numpy()
    x = np.arange(len(models))
    bars = ax.bar(x, values, width=0.62, color=[MODEL_COLORS[m] for m in models], zorder=2,
                  edgecolor=SURFACE, linewidth=2)
    tops = values
    if err_hi is not None:
        hi = df.set_index("model").loc[models, err_hi].to_numpy()
        ax.vlines(x, values, hi, color=INK, linewidth=1.2, zorder=3)
        ax.hlines(hi, x - 0.08, x + 0.08, color=INK, linewidth=1.2, zorder=3)
        tops = hi
    top = ylim[1] if ylim else max(tops) * 1.18
    for bar, value, t in zip(bars, values, tops):
        ax.text(bar.get_x() + bar.get_width() / 2, t + top * 0.015, fmt.format(value),
                ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(x, [MODELS[m] for m in models])
    ax.set_ylim(*(ylim or (0, top)))
    style_axes(ax, title, ylabel, note)


def save(fig, name):
    fig.savefig(T["dir"] / name, dpi=200, bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)


def figure_detection(df, poses):
    expected = int(df["expected_persons"].iloc[0])
    fig = plt.figure(figsize=(14, 6.2), facecolor=SURFACE)
    grid = fig.add_gridspec(len(MODELS), 2, width_ratios=[1, 1.6], wspace=0.18, hspace=0.25)
    ax = fig.add_subplot(grid[:, 0])
    model_bars(ax, df.assign(pct=df["all_tracked_rate"] * 100), "pct", T["det_bar"].format(n=expected),
               T["det_bar_y"], fmt="{:.0f}%", note=T["higher"], ylim=(0, 112))
    top = max(expected + 1, *(len(f["persons"]) for run in poses.values() for f in run["frames"]))
    for i, model in enumerate(MODELS):
        a = fig.add_subplot(grid[i, 1])
        frames = poses[model]["frames"]
        t = [f["time"] for f in frames]
        n = [len(f["persons"]) for f in frames]
        a.axhline(expected, color=MUTED, linewidth=1, linestyle=(0, (3, 3)), zorder=1)
        a.step(t, n, where="post", color=MODEL_COLORS[model], linewidth=2, zorder=2)
        a.set_ylim(-0.3, top + 0.4)
        a.set_yticks(sorted({0, expected, top}))
        a.set_xlim(t[0], t[-1])
        style_axes(a, T["det_line"] if i == 0 else "",
                   note=T["det_line_note"].format(n=expected) if i == 0 else None)
        a.set_ylabel(MODELS[model], rotation=0, ha="right", va="center", fontsize=9, color=INK,
                     fontweight="bold", labelpad=8)
        a.tick_params(labelsize=8)
        if i < len(MODELS) - 1:
            a.set_xticklabels([])
        else:
            a.set_xlabel(T["det_x"], color=INK_2, fontsize=9)
    fig.suptitle(T["det_title"], x=0.06, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.0)
    save(fig, "fig1_detection.png")


def figure_speed(df):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), facecolor=SURFACE)
    model_bars(axes[0], df, "mean_total_ms", T["speed_frame"], T["speed_frame_y"],
               fmt="{:.0f}", err_hi="p95_total_ms", note=T["speed_frame_note"])
    model_bars(axes[1], df, "ms_per_person", T["speed_person"], T["speed_person_y"],
               fmt="{:.0f}", note=T["speed_person_note"])
    devices = ", ".join(f"{MODELS[m]}: {d}" for m, d in zip(df["model"], df["device"]))
    fig.text(0.01, -0.04, T["speed_footer"].format(devices=devices), fontsize=8, color=INK_2)
    fig.suptitle(T["speed_title"], x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    fig.tight_layout()
    save(fig, "fig2_speed.png")


def figure_quality(df):
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.6), facecolor=SURFACE)
    model_bars(axes[0], df, "consensus_pck", T["agree"], T["agree_y"], fmt="{:.1f}%", note=T["agree_note"],
               ylim=(0, 112))
    model_bars(axes[1], df, "jitter_pct", T["jitter"], T["jitter_y"], fmt="{:.2f}", note=T["jitter_note"])
    model_bars(axes[2], df, "limb_cv_pct", T["limb"], T["limb_y"], fmt="{:.1f}", note=T["limb_note"])
    fig.suptitle(T["quality_title"], x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    fig.tight_layout()
    save(fig, "fig3_keypoint_quality.png")


def figure_keypoint_heatmap(kp, cons_kp):
    names = list(dict.fromkeys(kp["keypoint"]))
    models = list(MODELS)
    panels = [
        (kp.pivot(index="model", columns="keypoint", values="jitter_pct"), T["heat_jitter"], T["heat_jitter_unit"]),
        (cons_kp.pivot(index="model", columns="keypoint", values="consensus_error_pct"), T["heat_cons"],
         T["heat_cons_unit"]),
    ]
    fig, axes = plt.subplots(2, 1, figsize=(14, 6.8), facecolor=SURFACE)
    for ax, (table, title, unit) in zip(axes, panels):
        data = table.loc[models, names].to_numpy()
        im = ax.imshow(data, cmap=SEQ, aspect="auto", vmin=0, vmax=np.nanmax(data))
        for i in range(data.shape[0]):
            for j in range(data.shape[1]):
                ax.text(j, i, f"{data[i, j]:.1f}", ha="center", va="center", fontsize=7,
                        color="white" if data[i, j] > np.nanmax(data) * 0.55 else INK)
        ax.set_yticks(range(len(models)), [MODELS[m] for m in models], fontsize=9, color=INK_2)
        ax.set_xticks(range(len(names)), [T["keypoint"](n) for n in names], rotation=35, ha="right",
                      fontsize=8, color=INK_2)
        ax.tick_params(length=0)
        for side in ax.spines.values():
            side.set_visible(False)
        ax.set_title(f"{title} · {T['lower']}", loc="left", fontsize=11, fontweight="bold", color=INK)
        cbar = fig.colorbar(im, ax=ax, shrink=0.9, pad=0.01)
        cbar.set_label(unit, color=INK_2, fontsize=8)
        cbar.outline.set_visible(False)
        cbar.ax.tick_params(labelsize=8, colors=INK_2, length=0)
    fig.tight_layout()
    save(fig, "fig4_keypoint_heatmap.png")


def figure_tradeoff(df):
    fig, ax = plt.subplots(figsize=(8, 5.2), facecolor=SURFACE)
    d = df.set_index("model").loc[list(MODELS)]
    ax.scatter(d["mean_total_ms"], d["consensus_pck"], s=90, color=INK, edgecolor=SURFACE, linewidth=2, zorder=3)
    # Label on the left when the next (slower) model is close by, otherwise on the right,
    # so pairs of similar speed (YOLO11/YOLOv8, RTMPose/ViTPose) label outwards.
    times = d["mean_total_ms"].sort_values()
    for i, (model, ms) in enumerate(times.items()):
        left = i + 1 < len(times) and times.iloc[i + 1] - ms < 25
        ax.annotate(MODELS[model], (ms, d.loc[model, "consensus_pck"]), xytext=(-10 if left else 10, 0),
                    textcoords="offset points", ha="right" if left else "left", va="center", fontsize=8, color=INK)
    ax.set_xlim(0, d["mean_total_ms"].max() * 1.25)
    ax.set_ylim(np.floor(d["consensus_pck"].min() / 10) * 10 - 5, 100)
    ax.set_xlabel(T["trade_x"], color=INK_2, fontsize=9)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    rates = ", ".join(f"{MODELS[m]} {r * 100:.0f}%" for m, r in d["all_tracked_rate"].items())
    style_axes(ax, T["trade_title"], T["trade_y"], note=T["trade_note"].format(rates=rates))
    save(fig, "fig5_tradeoff.png")


def figure_scorecard(card):
    models = card.groupby("model")["total"].first().sort_values(ascending=False).index.tolist()
    criteria = [c[0] for c in CRITERIA]
    labels = [f"{T['criteria'][c]}\n{T['card_weight']} {w * 100:.0f}%" for c, _, w in CRITERIA]
    ranks = card.pivot(index="model", columns="criterion", values="rank").loc[models, criteria].to_numpy()
    values = card.pivot(index="model", columns="criterion", values="value").loc[models, criteria]
    fig = plt.figure(figsize=(15, 4.8), facecolor=SURFACE)
    grid = fig.add_gridspec(1, 2, width_ratios=[3.2, 1], wspace=0.08)
    ax = fig.add_subplot(grid[0])
    rank_cmap = LinearSegmentedColormap.from_list("rank", ["#104281", "#2a78d6", "#86b6ef", "#cfe1f8", "#eef4fc"])
    ax.imshow(ranks, cmap=rank_cmap, vmin=1, vmax=len(MODELS), aspect="auto")
    percent = {"all_tracked_rate", "clean_frame_rate"}
    for i, model in enumerate(models):
        for j, c in enumerate(criteria):
            v = values.loc[model, c]
            text = f"{v * 100:.1f}" if c in percent else f"{v:.1f}" if c != "mean_total_ms" else f"{v:.0f}"
            ax.text(j, i, f"#{ranks[i, j]}  ·  {text}", ha="center", va="center", fontsize=9,
                    color="white" if ranks[i, j] <= 2 else INK)
    ax.set_yticks(range(len(models)), [MODELS[m] for m in models], fontsize=10, color=INK)
    ax.set_xticks(range(len(criteria)), labels, fontsize=8, color=INK_2)
    ax.xaxis.tick_top()
    ax.tick_params(length=0)
    for side in ax.spines.values():
        side.set_visible(False)
    ax.set_title(T["card_ranks"], loc="left", fontsize=11, fontweight="bold", color=INK, pad=48)

    bx = fig.add_subplot(grid[1])
    totals = card.groupby("model")["total"].first().loc[models] * 100
    y = np.arange(len(models))
    bx.barh(y, totals, height=0.6, color=[MODEL_COLORS[m] for m in models], edgecolor=SURFACE, linewidth=2)
    for yi, v in zip(y, totals):
        bx.text(v + 1.5, yi, f"{v:.0f}", va="center", fontsize=9, color=INK)
    bx.set_ylim(len(models) - 0.5, -0.5)
    bx.set_yticks(y, [])
    bx.set_xlim(0, 110)
    bx.set_facecolor(SURFACE)
    bx.grid(axis="x", color=GRID, linewidth=0.8)
    bx.set_axisbelow(True)
    for side in ["top", "right", "left"]:
        bx.spines[side].set_visible(False)
    bx.spines["bottom"].set_color(INK_2)
    bx.tick_params(colors=INK_2, labelsize=8, length=0)
    bx.set_title(T["card_total"], loc="left", fontsize=11, fontweight="bold", color=INK, pad=48)
    fig.suptitle(T["card_title"], x=0.06, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.16)
    fig.text(0.06, -0.04, T["card_footer"], fontsize=8, color=INK_2, wrap=True)
    save(fig, "fig6_scorecard.png")


def main():
    global T
    OUT.mkdir(parents=True, exist_ok=True)
    df, kp, poses = load()
    cons, cons_kp = consensus(poses)
    df = df.merge(cons, on="model")
    df["clean_frame_rate"] = 1 - df["over_detected_rate"]
    card = scorecard(df)

    columns = ["model", "model_label", "device", "run", "source", "source_sha256", "source_frames", "source_fps",
               "frames", "expected_persons", "all_tracked_rate", "mean_tracked_rate", "missed_frame_rate",
               "over_detected_rate", "track_count", "long_track_count", "mean_total_ms", "p95_total_ms",
               "ms_per_person", "model_fps", "pipeline_fps", "jitter_pct", "jitter_median_pct", "limb_cv_pct",
               "consensus_persons", "consensus_pck", "consensus_pck_0.1", "consensus_error_pct",
               "mean_keypoint_conf", "visible_rate", "low_conf_rate"]
    df[columns].round(4).to_csv(OUT / "summary.csv", index=False)
    cons_kp.round(4).to_csv(OUT / "consensus_keypoints.csv", index=False)
    card.round(4).to_csv(OUT / "scorecard.csv", index=False)

    for lang in TEXT:
        T = TEXT[lang]
        T["dir"].mkdir(parents=True, exist_ok=True)
        figure_detection(df, poses)
        figure_speed(df)
        figure_quality(df)
        figure_keypoint_heatmap(kp, cons_kp)
        figure_tradeoff(df)
        figure_scorecard(card)

    totals = card.groupby("model")["total"].first().sort_values(ascending=False)
    print("\nWeighted score:", ", ".join(f"{MODELS[m]} {v * 100:.0f}" for m, v in totals.items()))
    print(f"Saved to {OUT.relative_to(ROOT)}/ (Mongolian figures in mn/)")


if __name__ == "__main__":
    main()
