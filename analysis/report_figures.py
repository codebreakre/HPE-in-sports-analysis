"""Figures for the progress report (chapter 4 results), in the style of model_comparison.py.

    python analysis/report_figures.py

Reads results/ and writes results/report-figures/:
  fig7_browser_vs_server.png   time per frame and keypoint distance, browser (run6) vs. server (run5)
  fig8_sync_timeline.png       group and pair synchronization scores over time (algorithm v2, run6)
  fig9_lag_confidence.png      S_lag variants: discrimination and browser/server stability
Needs pandas, numpy, matplotlib.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
OUT = RESULTS / "report-figures"
RUN_BROWSER = RESULTS / "rtmpose-m" / "poomsae-720reso_run6"
RUN_SERVER = RESULTS / "rtmpose-m" / "poomsae-720reso_run5"
LAG_TEST = RESULTS / "lag-confidence-test" / "poomsae-720reso_run5"

# Same palette and surfaces as model_comparison.py (validated there); slots in fixed order.
SLOTS = ["#2a78d6", "#eb6834", "#6250d6", "#1baf7a"]
INK, INK_2, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e0", "#fcfcfb"


def style_axes(ax, title, ylabel=None, note=None, grid_axis="y"):
    pad = 10 + 11 * (note.count("\n") + 1) if note else 10
    ax.set_title(title, loc="left", fontsize=11, color=INK, fontweight="bold", pad=pad)
    if note:
        ax.text(0, 1.02, note, transform=ax.transAxes, fontsize=8, color=INK_2, va="bottom")
    if ylabel:
        ax.set_ylabel(ylabel, color=INK_2, fontsize=9)
    ax.set_facecolor(SURFACE)
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ["top", "right", "left"]:
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(INK_2)
    ax.tick_params(colors=INK_2, labelsize=9, length=0)


def save(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / name, dpi=200, bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)
    print(f"wrote {OUT / name}")


def load_frames(stem: Path) -> list[dict]:
    return json.loads((stem.parent / f"{stem.name}-pose.json").read_text(encoding="utf-8"))["frames"]


def iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def keypoint_distances(fa, fb):
    """Distances (px) between matched people's keypoints, frame by frame (box IoU >= 0.5)."""
    out = []
    for a, b in zip(fa, fb):
        used = set()
        for p in a["persons"]:
            best, bi = 0.0, -1
            for i, q in enumerate(b["persons"]):
                if i not in used and (v := iou(p["box"], q["box"])) > best:
                    best, bi = v, i
            if best < 0.5:
                continue
            used.add(bi)
            q = b["persons"][bi]
            out += [np.hypot(k["x"] - m["x"], k["y"] - m["y"]) for k, m in zip(p["keypoints"], q["keypoints"])]
    return np.array(out)


def fig_browser_vs_server():
    fb, fs = load_frames(RUN_BROWSER), load_frames(RUN_SERVER)
    ms = lambda frames: np.array([f["speed"]["preprocess"] + f["speed"]["inference"] + f["speed"]["postprocess"] for f in frames])
    tb, ts = ms(fb), ms(fs)
    d = keypoint_distances(fb, fs)

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), facecolor=SURFACE)
    ax = axes[0]
    labels = ["Browser\n(WebGPU)", "Server\n(CUDA, RTX 2060)"]
    means, p95 = [tb.mean(), ts.mean()], [np.percentile(tb, 95), np.percentile(ts, 95)]
    x = np.arange(2)
    ax.bar(x, means, width=0.55, color=SLOTS[:2], edgecolor=SURFACE, linewidth=2, zorder=2)
    ax.vlines(x, means, p95, color=INK, linewidth=1.2, zorder=3)
    ax.hlines(p95, x - 0.07, x + 0.07, color=INK, linewidth=1.2, zorder=3)
    for xi, m, hi in zip(x, means, p95):
        ax.text(xi, hi + 3, f"{m:.0f}", ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(x, labels)
    ax.set_ylim(0, max(p95) * 1.25)
    style_axes(ax, "Time per frame", "ms (pre + inference + post)", "bar = mean, whisker = 95th percentile · lower is better")

    ax = axes[1]
    clipped = np.clip(d, 0, 10)
    ax.hist(clipped, bins=np.arange(0, 10.25, 0.25), color=SLOTS[0], edgecolor=SURFACE, linewidth=0.6, zorder=2)
    med = np.median(d)
    ax.axvline(med, color=INK, linewidth=1.2, linestyle=(0, (3, 3)), zorder=3)
    ax.text(med + 0.15, ax.get_ylim()[1] * 0.92, f"median {med:.2f} px", fontsize=8, color=INK)
    ax.set_xlabel("distance between the two runs' keypoints (px, last bar = 10 px or more)", color=INK_2, fontsize=9)
    style_axes(ax, "Keypoint difference, browser vs. server", "keypoints",
               f"{len(d):,} keypoints of matched people · 95th percentile {np.percentile(d, 95):.2f} px")
    fig.text(0.01, -0.04, "poomsae-720reso.mp4, RTMPose-m, 856 frames: browser run6 vs. server run5 (same frames, same ONNX files).",
             fontsize=8, color=INK_2)
    fig.suptitle("Browser and server processing", x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    save(fig, "fig7_browser_vs_server.png")


def fig_sync_timeline():
    df = pd.read_csv(RUN_BROWSER.parent / f"{RUN_BROWSER.name}-sync-frames.csv")
    pairs = [c[:-len("_score")] for c in df.columns if c.startswith("pair_") and c.endswith("_score")]
    fig, ax = plt.subplots(figsize=(12, 4.2), facecolor=SURFACE)
    for i, p in enumerate(pairs):
        a, b = p.split("_")[1:3]
        ax.plot(df["time_s"], df[f"{p}_score"], color=SLOTS[i], linewidth=1.4, label=f"Pair {a}–{b}", zorder=2)
    ax.plot(df["time_s"], df["group"], color=INK, linewidth=2.2, label="Group", zorder=3)
    ax.set_ylim(0, 100)
    ax.set_xlim(0, df["time_s"].max())
    ax.set_xlabel("time (s)", color=INK_2, fontsize=9)
    ax.legend(loc="lower left", fontsize=8, frameon=False, ncol=len(pairs) + 1)
    style_axes(ax, "Synchronization score over time", "score (0–100)",
               "algorithm v2: one 2 s window centred on every frame · poomsae-720reso, RTMPose-m (browser run6)")
    save(fig, "fig8_sync_timeline.png")


def fig_lag_confidence():
    disc = pd.read_csv(LAG_TEST.parent / f"{LAG_TEST.name}-discrimination.csv")
    stab = pd.read_csv(LAG_TEST.parent / f"{LAG_TEST.name}-stability.csv")
    variants = list(stab["variant"])
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8), facecolor=SURFACE, gridspec_kw={"width_ratios": [1.35, 1]})

    ax = axes[0]
    short = {"in step (original)": "in step", "delayed 0.12 s": "0.12 s", "delayed 0.2 s": "0.2 s", "delayed 0.4 s": "0.4 s",
             "delayed 0.8 s": "0.8 s", "different motion (7 s away)": "different\n(7 s)", "different motion (13 s away)": "different\n(13 s)"}
    x = np.arange(len(disc))
    cols = [c for c in disc.columns if c != "condition"]
    for i, (c, v) in enumerate(zip(cols, variants)):
        ax.plot(x, disc[c], color=SLOTS[i], linewidth=2, marker="o", markersize=5, label=v, zorder=2)
    ax.set_xticks(x, [short.get(c, c) for c in disc["condition"]])
    ax.set_ylim(40, 95)
    ax.legend(fontsize=8, frameon=False, loc="upper right")
    style_axes(ax, "Discrimination: pair 1–2 score", "score (0–100)",
               "person 2 delayed, or given their own motion from elsewhere · should fall left to right")

    ax = axes[1]
    xb = np.arange(len(stab))
    ax.bar(xb, stab["frame_diff_mean"], width=0.6, color=SLOTS[:len(stab)], edgecolor=SURFACE, linewidth=2, zorder=2)
    ax.vlines(xb, stab["frame_diff_mean"], stab["frame_diff_p95"], color=INK, linewidth=1.2, zorder=3)
    ax.hlines(stab["frame_diff_p95"], xb - 0.07, xb + 0.07, color=INK, linewidth=1.2, zorder=3)
    for xi, m, hi, gap in zip(xb, stab["frame_diff_mean"], stab["frame_diff_p95"], stab["group_gap"]):
        ax.text(xi, hi + 0.3, f"{m:.1f}\n(video {gap:.2f})", ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(xb, variants)
    ax.set_ylim(0, stab["frame_diff_p95"].max() * 1.35)
    style_axes(ax, "Stability: browser vs. server", "|group score difference|",
               "per frame: bar = mean, whisker = 95th percentile · lower is better")
    fig.suptitle("S_lag around ρmin: hard threshold vs. ramp vs. drop", x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    save(fig, "fig9_lag_confidence.png")


if __name__ == "__main__":
    fig_browser_vs_server()
    fig_sync_timeline()
    fig_lag_confidence()
