"""Resolution check: does lowering the input video resolution change HPE results?

Inputs: the saved runs of data/resolution-check-data/poomsae-{360,480,720}reso.mp4 in
results/<model>/ (the newest run per video if a video was processed more than once).
Outputs (results/resolution-check/):
  resolution_summary.csv      one row per model x resolution (tracking, confidence, speed, agreement)
  keypoint_error.csv          one row per model x resolution x keypoint (error vs. 720p)
  fig1_overview.png           tracking, keypoint confidence/visibility, inference time
  fig2_agreement_vs_720p.png  how far 360p/480p keypoints are from the 720p ones
  fig3_keypoint_error.png     the same error per keypoint (heatmap)

Agreement vs. 720p: 720p is the reference. In each frame, people in the lower-resolution run
are matched to 720p people by box centre; keypoints are scaled to 720p pixels and the distance
is divided by the 720p person's box height. PCK@0.05 = share of keypoints within 5 % of box height.
This measures consistency with the 720p result, not accuracy (there is no ground truth).

Run: python analysis/resolution_check.py
"""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
OUT = RESULTS / "resolution-check"

MODELS = {  # results folder -> label, in the app's order
    "yolo11n-pose": "YOLO11n",
    "yolov8n-pose": "YOLOv8n",
    "yolo26n-pose": "YOLO26n",
    "rtmpose-m": "RTMPose-m",
    "vitpose-b": "ViTPose-B",
    "mediapipe-pose-full": "MediaPipe",
}
RESOLUTIONS = [360, 480, 720]
REFERENCE = 720
VIDEO = "poomsae-{}reso"
PCK_THRESHOLD = 0.05
MATCH_MAX_DIST = 0.1  # max box-centre distance (share of frame width) to call two detections the same person

# Ordinal one-hue ramp (light -> dark = low -> high resolution), validated with the dataviz validator.
RES_COLORS = {360: "#86b6ef", 480: "#2a78d6", 720: "#104281"}
INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e6e5e0", "#fcfcfb"


def load_runs(model: str, res: int) -> list[dict]:
    """All saved runs of this video for this model, oldest first."""
    runs = []
    for path in (RESULTS / model).glob(f"{VIDEO.format(res)}*-pose.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("source", "").startswith(VIDEO.format(res)):
            runs.append(data)
    return sorted(runs, key=lambda d: d["createdAt"])


def person_arrays(run: dict) -> dict[int, list[dict]]:
    """frame -> persons, with box centre (normalized), box height and keypoints in 720p pixels."""
    w, h = run["width"], run["height"]
    sx = REF_SIZE[0] / w
    sy = REF_SIZE[1] / h
    frames = {}
    for f in run["frames"]:
        persons = []
        for p in f["persons"]:
            x1, y1, x2, y2 = p["box"]
            kp = np.array([[k["x"] * sx, k["y"] * sy] for k in p["keypoints"]])
            persons.append({
                "centre": np.array([(x1 + x2) / 2 / w, (y1 + y2) / 2 / h]),
                "height": (y2 - y1) * sy,
                "kp": kp,
            })
        frames[f["frame"]] = persons
    return frames


def match(ref: list[dict], other: list[dict]) -> list[tuple[dict, dict]]:
    """Greedy nearest-centre matching of people between two runs in one frame."""
    pairs = sorted(
        ((np.linalg.norm(r["centre"] - o["centre"]), i, j) for i, r in enumerate(ref) for j, o in enumerate(other)),
        key=lambda t: t[0],
    )
    used_r, used_o, out = set(), set(), []
    for d, i, j in pairs:
        if d > MATCH_MAX_DIST or i in used_r or j in used_o:
            continue
        used_r.add(i)
        used_o.add(j)
        out.append((ref[i], other[j]))
    return out


def agreement(ref_run: dict, run: dict, names: list[str]) -> tuple[dict, pd.DataFrame]:
    ref_frames, frames = person_arrays(ref_run), person_arrays(run)
    errors = []  # one row of 17 normalized errors per matched person
    ref_people = matched = 0
    for frame, ref_persons in ref_frames.items():
        ref_people += len(ref_persons)
        for r, o in match(ref_persons, frames.get(frame, [])):
            if r["height"] <= 0 or len(r["kp"]) != len(names) or len(o["kp"]) != len(names):
                continue
            matched += 1
            errors.append(np.linalg.norm(r["kp"] - o["kp"], axis=1) / r["height"])
    e = np.array(errors) if errors else np.full((0, len(names)), np.nan)
    summary = {
        "matched_rate": matched / ref_people if ref_people else np.nan,
        "mean_error_pct_box": 100 * np.nanmean(e) if e.size else np.nan,
        "median_error_pct_box": 100 * np.nanmedian(e) if e.size else np.nan,
        "pck05_vs_720": 100 * np.mean(e < PCK_THRESHOLD) if e.size else np.nan,
    }
    per_kp = pd.DataFrame({
        "keypoint": names,
        "mean_error_pct_box": 100 * e.mean(axis=0) if e.size else np.nan,
        "pck05_vs_720": 100 * (e < PCK_THRESHOLD).mean(axis=0) if e.size else np.nan,
    })
    return summary, per_kp


def run_stats(run: dict) -> dict:
    confs = np.array([k["conf"] for f in run["frames"] for p in f["persons"] for k in p["keypoints"]])
    t, s = run["tracking"], run["summary"]
    return {
        "width": run["width"],
        "height": run["height"],
        "frames": s["n"],
        "device": run["device"],
        "all_tracked_pct": 100 * t["allTrackedRate"],
        "mean_tracked": t["meanTracked"],
        "frames_over_detected": t["framesOverDetected"],
        "mean_kp_conf": confs.mean() if confs.size else np.nan,
        "visible_kp_pct": 100 * (confs >= 0.5).mean() if confs.size else np.nan,
        "inference_ms": s["inf"],
        "total_ms": s["pre"] + s["inf"] + s["post"],
    }


# ---------- figures ----------

def style_axes(ax, title, ylabel):
    ax.set_title(title, loc="left", fontsize=11, color=INK, fontweight="bold", pad=10)
    ax.set_ylabel(ylabel, color=INK_2, fontsize=9)
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(INK_2)
    ax.tick_params(colors=INK_2, labelsize=9, length=0)


def grouped_bars(ax, df, column, resolutions, title, ylabel, ylim=None, fmt="{:.0f}", spread=None):
    labels = [MODELS[m] for m in MODELS if m in df["model"].values]
    x = np.arange(len(labels))
    width = 0.8 / len(resolutions)
    for i, res in enumerate(resolutions):
        sub = df[df["resolution"] == res].set_index("label").reindex(labels)
        bars = ax.bar(x + (i - (len(resolutions) - 1) / 2) * width, sub[column], width * 0.92,
                      color=RES_COLORS[res], label=f"{res}p", zorder=2)
        if spread:
            lo, hi = sub[spread[0]], sub[spread[1]]
            ax.vlines([b.get_x() + b.get_width() / 2 for b in bars], lo, hi, color=INK, linewidth=1.2, zorder=3)
        for b, v in zip(bars, sub[column]):
            if pd.notna(v):
                top = max(b.get_height(), sub[spread[1]].iloc[list(bars).index(b)]) if spread else b.get_height()
                ax.text(b.get_x() + b.get_width() / 2, top, fmt.format(v),
                        ha="center", va="bottom", fontsize=7, color=INK_2)
    ax.set_xticks(x, labels)
    if ylim:
        ax.set_ylim(*ylim)
    style_axes(ax, title, ylabel)


def figure_overview(df):
    fig, axes = plt.subplots(2, 3, figsize=(16, 8.5), facecolor=SURFACE)
    grouped_bars(axes[0, 0], df, "all_tracked_pct", RESOLUTIONS,
                 "Frames with all 3 people found", "% of frames", (0, 110))
    grouped_bars(axes[0, 1], df, "mean_tracked", RESOLUTIONS,
                 "People found per frame (mean, max 3)", "people", (0, 3.3), "{:.2f}")
    grouped_bars(axes[0, 2], df, "frames_over_detected", RESOLUTIONS,
                 "Frames with extra (false) detections", "frames")
    grouped_bars(axes[1, 0], df, "visible_kp_pct", RESOLUTIONS,
                 "Visible keypoints (conf ≥ 0.5)", "% of keypoints", (0, 110))
    grouped_bars(axes[1, 1], df, "mean_kp_conf", RESOLUTIONS,
                 "Mean keypoint confidence*", "confidence (0–1)", (0, 1.1), "{:.2f}")
    grouped_bars(axes[1, 2], df, "inference_ms", RESOLUTIONS,
                 "Inference time per frame**", "ms", None, "{:.0f}",
                 spread=("inference_ms_min", "inference_ms_max"))
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, title="Input resolution", loc="upper right", ncol=3, frameon=False, fontsize=9)
    fig.suptitle("Effect of input resolution on HPE (poomsae video, 3 people, 30 fps)", x=0.01, ha="left",
                 fontsize=13, fontweight="bold", color=INK)
    fig.text(0.01, 0.025, "* Confidence means something different per model; compare resolutions within a model, "
             "not models with each other.", fontsize=8, color=INK_2)
    fig.text(0.01, 0.005, "** Bar = newest run. Black line = min–max over repeated runs of the same video "
             "(YOLO11n: 3 runs, YOLOv8n: 2, RTMPose-m 360p: 2, others: 1). Top-down models include the person detector.",
             fontsize=8, color=INK_2)
    fig.tight_layout(rect=(0, 0.04, 1, 0.95))
    fig.savefig(OUT / "fig1_overview.png", dpi=200)
    plt.close(fig)


def figure_agreement(df):
    low = [r for r in RESOLUTIONS if r != REFERENCE]
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), facecolor=SURFACE)
    grouped_bars(axes[0], df, "pck05_vs_720", low,
                 "Keypoints within 5 % of box height of the 720p result", "PCK@0.05 vs 720p (%)", (0, 108))
    grouped_bars(axes[1], df, "mean_error_pct_box", low,
                 "Mean keypoint shift from the 720p result", "% of person box height", None, "{:.1f}")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, title="Input resolution", loc="upper right", ncol=2, frameon=False, fontsize=9)
    fig.suptitle("How much do lower resolutions change the keypoints? (reference: 720p)", x=0.01, ha="left",
                 fontsize=13, fontweight="bold", color=INK)
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    fig.savefig(OUT / "fig2_agreement_vs_720p.png", dpi=200)
    plt.close(fig)


def figure_keypoint_heatmap(kp):
    low = [r for r in RESOLUTIONS if r != REFERENCE]
    models = [m for m in MODELS if m in kp["model"].values]
    names = list(dict.fromkeys(kp["keypoint"]))
    vmax = np.nanpercentile(kp["mean_error_pct_box"], 98)
    fig, axes = plt.subplots(len(low), 1, figsize=(12, 1.5 + 0.5 * len(models) * len(low)), facecolor=SURFACE,
                             sharex=True, layout="constrained")
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list("blue_seq", ["#f4f8fd", "#9ec5f4", "#3987e5", "#1c5cab", "#0d366b"])
    for ax, res in zip(np.atleast_1d(axes), low):
        grid = (kp[kp["resolution"] == res].pivot(index="model", columns="keypoint", values="mean_error_pct_box")
                .reindex(index=models, columns=names))
        im = ax.imshow(grid.values, cmap=cmap, vmin=0, vmax=vmax, aspect="auto")
        for i in range(grid.shape[0]):
            for j in range(grid.shape[1]):
                v = grid.values[i, j]
                if np.isfinite(v):
                    ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=7,
                            color="white" if v > vmax * 0.55 else INK)
        ax.set_yticks(range(len(models)), [MODELS[m] for m in models], fontsize=9, color=INK_2)
        ax.set_xticks(range(len(names)), [n.replace("_", " ") for n in names], rotation=40, ha="right",
                      fontsize=8, color=INK_2)
        ax.tick_params(labelbottom=ax is np.atleast_1d(axes)[-1])
        ax.tick_params(length=0)
        for s in ax.spines.values():
            s.set_visible(False)
        ax.set_title(f"{res}p vs 720p", loc="left", fontsize=11, fontweight="bold", color=INK)
    cbar = fig.colorbar(im, ax=axes, shrink=0.8, pad=0.02)
    cbar.set_label("mean shift, % of box height", color=INK_2, fontsize=9)
    cbar.outline.set_visible(False)
    fig.suptitle("Keypoint shift from the 720p result, per keypoint", x=0.01, ha="left",
                 fontsize=13, fontweight="bold", color=INK)
    fig.savefig(OUT / "fig3_keypoint_error.png", dpi=200, bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    rows, kp_rows = [], []
    for model, label in MODELS.items():
        all_runs = {res: load_runs(model, res) for res in RESOLUTIONS}
        runs = {res: r[-1] if r else None for res, r in all_runs.items()}  # newest run per video
        if runs[REFERENCE] is None:
            print(f"skip {model}: no {REFERENCE}p run")
            continue
        REF_SIZE = (runs[REFERENCE]["width"], runs[REFERENCE]["height"])
        names = runs[REFERENCE]["keypointNames"]
        for res, run in runs.items():
            if run is None:
                print(f"missing {model} {res}p")
                continue
            row = {"model": model, "label": label, "resolution": res, **run_stats(run)}
            # Timing differs a little between repeated runs of the same video; keep the spread.
            inf_all = [r["summary"]["inf"] for r in all_runs[res]]
            row.update(runs_count=len(inf_all), inference_ms_min=min(inf_all), inference_ms_max=max(inf_all))
            if res != REFERENCE:
                summary, per_kp = agreement(runs[REFERENCE], run, names)
                row.update(summary)
                kp_rows.append(per_kp.assign(model=model, label=label, resolution=res))
            rows.append(row)

    df = pd.DataFrame(rows)
    kp = pd.concat(kp_rows, ignore_index=True)[["model", "label", "resolution", "keypoint",
                                                "mean_error_pct_box", "pck05_vs_720"]]
    df.round(3).to_csv(OUT / "resolution_summary.csv", index=False)
    kp.round(3).to_csv(OUT / "keypoint_error.csv", index=False)
    figure_overview(df)
    figure_agreement(df)
    figure_keypoint_heatmap(kp)
    cols = ["label", "resolution", "frames", "all_tracked_pct", "mean_tracked", "frames_over_detected",
            "visible_kp_pct", "mean_kp_conf", "inference_ms", "inference_ms_min", "inference_ms_max",
            "pck05_vs_720", "mean_error_pct_box"]
    print(df[cols].round(2).to_string(index=False))
    print(f"\nwrote {OUT.relative_to(ROOT)}")
