"""Figures for the controlled video experiments (results/experiments/*.csv, made by `npm run experiments`).

    python analysis/experiment_figures.py

Writes results/report-figures/:
  fig11_lag.png          found vs. true lag, and the pair score and its parts vs. lag
  fig12_conditions.png   pair score per condition: in step, lagged, mirrored, smaller copy, different motion
  fig13_robustness.png   resolution, frame rate and camera distance vs. score and lag error
  fig14_people.png       per-person score S_i with 2-4 people (the late one marked) and time per frame
Style and palette as model_comparison.py / report_figures.py.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "results" / "experiments"
OUT = ROOT / "results" / "report-figures"
SLOTS = ["#2a78d6", "#eb6834", "#6250d6", "#1baf7a"]
INK, INK_2, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e0", "#fcfcfb"


def style_axes(ax, title, ylabel=None, note=None, xlabel=None):
    pad = 10 + 11 * (note.count("\n") + 1) if note else 10
    ax.set_title(title, loc="left", fontsize=11, color=INK, fontweight="bold", pad=pad)
    if note:
        ax.text(0, 1.02, note, transform=ax.transAxes, fontsize=8, color=INK_2, va="bottom")
    if ylabel:
        ax.set_ylabel(ylabel, color=INK_2, fontsize=9)
    if xlabel:
        ax.set_xlabel(xlabel, color=INK_2, fontsize=9)
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
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


def read(name):
    return pd.read_csv(EXP / f"{name}.csv")


def fig_lag():
    d = read("lag")
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), facecolor=SURFACE)
    ax = axes[0]
    lim = d["true_lag_sec"].max() * 1.1
    ax.plot([0, lim], [0, lim], color=MUTED, linewidth=1, linestyle=(0, (3, 3)), zorder=1, label="found = true")
    ax.plot(d["true_lag_sec"], d["lag_sec"], color=SLOTS[0], marker="o", markersize=7, linewidth=0, zorder=3, label="found lag")
    for _, r in d.iterrows():
        ax.text(r["true_lag_sec"] + lim * 0.015, r["lag_sec"] - lim * 0.05, f"{int(r['lag_frames'])} fr", fontsize=7, color=INK_2)
    ax.set_xlim(-lim * 0.03, lim)
    ax.set_ylim(-lim * 0.03, lim)
    ax.legend(fontsize=8, frameon=False, loc="upper left")
    style_axes(ax, "Found vs. true lag", "found lag (s)", "whole-video cross-correlation, pair 1–2 · 25 fps (1 frame = 0.04 s)",
               "true lag of the copy (s)")
    ax = axes[1]
    for i, (col, label) in enumerate([("pose", "S_pose"), ("corr", "S_corr"), ("lag_score", "S_lag")]):
        ax.plot(d["true_lag_sec"], d[col] * 100, color=SLOTS[i], linewidth=1.6, marker="o", markersize=4, label=label, zorder=2)
    ax.plot(d["true_lag_sec"], d["pair12"], color=INK, linewidth=2.4, marker="o", markersize=5, label="score S", zorder=3)
    ax.set_ylim(0, 105)
    ax.legend(fontsize=8, frameon=False, loc="lower left", ncol=4)
    style_axes(ax, "Score and its parts vs. lag", "0–100", "pair 1–2, mean over all windows", "true lag of the copy (s)")
    fig.suptitle("Video-level lag test (source + delayed copy)", x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    save(fig, "fig11_lag.png")


def fig_conditions():
    lag, mir, dif, dist = read("lag"), read("mirror"), read("different"), read("distance")
    rows = [("in step", lag.loc[lag.lag_frames == 0, "pair12"].iloc[0], 0)]
    rows += [(f"lag {f} fr", lag.loc[lag.lag_frames == f, "pair12"].iloc[0], 1) for f in (5, 12, 25)]
    rows += [("mirrored", mir.loc[mir.lag_frames == 0, "pair12"].iloc[0], 2),
             ("mirrored,\nlag 8 fr", mir.loc[mir.lag_frames == 8, "pair12"].iloc[0], 2)]
    rows += [(f"copy at\n{int(s)} %", dist.loc[(dist.size_pct == s) & (dist.lag_frames == 0), "pair12"].iloc[0], 0) for s in (75, 50)]
    # 25 %: the automatic person count failed; the score with the count given as 2 (hatched, marked *).
    rows += [("copy at\n25 % *", read("forced-count").set_index("video").loc["distance-25-00f", "pair12"], 0)]
    rows += [(f"different\n({int(o)} s)", r, 3) for o, r in zip(dif.offset_sec, dif.pair12)]
    names = ["in step / same motion", "lagged", "mirrored", "different motion"]
    fig, ax = plt.subplots(figsize=(13, 4.6), facecolor=SURFACE)
    x = np.arange(len(rows))
    bars = ax.bar(x, [r[1] for r in rows], width=0.62, color=[SLOTS[r[2]] for r in rows], edgecolor=SURFACE, linewidth=2, zorder=2)
    for bar, r in zip(bars, rows):
        if r[0].endswith("*"):
            bar.set_hatch("///")
            bar.set_edgecolor(SURFACE)
    for xi, r in zip(x, rows):
        ax.text(xi, r[1] + 1.2, f"{r[1]:.1f}", ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(x, [r[0] for r in rows])
    ax.set_ylim(0, 110)
    handles = [plt.Rectangle((0, 0), 1, 1, color=SLOTS[i]) for i in range(4)]
    ax.legend(handles, names, fontsize=8, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.17), ncol=4)
    style_axes(ax, "Pair score by condition", "pair 1–2 score (0–100)",
               "should fall: in step > lagged > different motion · * person count given as 2 (automatic count failed)")
    save(fig, "fig12_conditions.png")


def fig_robustness():
    res, fps, dist = read("resolution"), read("fps"), read("distance")
    # Where the automatic person count failed (no pair score), use the re-score with the count given as 2
    # (experiments-forced.ts) and draw it hollow.
    forced = read("forced-count").set_index("video")
    def fill(df, video_of):
        df = df.copy()
        df["forced"] = df["pair12"].isna()
        for i, r in df[df["forced"]].iterrows():
            f = forced.loc[video_of(r)]
            df.loc[i, ["pair12", "lag_sec", "lag_error_ms"]] = [f["pair12"], f["lag_sec"], f["lag_error_ms"]]
        return df
    res = fill(res, lambda r: f"resolution-{int(r['height_px'])}p-08f")
    dist = fill(dist, lambda r: f"distance-{int(r['size_pct'])}-{int(r['lag_frames']):02d}f")

    def hollow(ax, xs, ys, color):
        ax.plot(xs, ys, linestyle="none", marker="o", markersize=9, markerfacecolor=SURFACE, markeredgecolor=color, markeredgewidth=2, zorder=4)

    fig, axes = plt.subplots(1, 3, figsize=(16, 4.6), facecolor=SURFACE)
    ax = axes[0]
    ax.plot(res["height_px"], res["pair12"], color=SLOTS[0], marker="o", linewidth=2, label="score (lag 8 fr)")
    hollow(ax, res.loc[res.forced, "height_px"], res.loc[res.forced, "pair12"], SLOTS[0])
    ax.plot(res["height_px"], res["pck05_vs_1080"], color=SLOTS[1], marker="o", linewidth=2, label="PCK@0.05 vs 1080p (%)")
    for _, r in res.iterrows():
        ax.text(r["height_px"], r["pair12"] - 6, f"err {int(r['lag_error_ms'])} ms", ha="center", fontsize=7, color=INK_2)
    ax.set_xticks(res["height_px"], [f"{h}p" for h in res["height_px"]])
    ax.invert_xaxis()
    ax.set_ylim(0, 105)
    ax.legend(fontsize=8, frameon=False, loc="lower left")
    style_axes(ax, "Resolution", "0–100", "pair video downscaled · copy 0.32 s late", "video height")
    ax = axes[1]
    ax.plot(fps["video_fps"], fps["pair12"], color=SLOTS[0], marker="o", linewidth=2, label="score (lag 0.3 s)")
    for _, r in fps.iterrows():
        ax.text(r["video_fps"], r["pair12"] + 3, f"found {r['lag_sec']:.2f} s", ha="center", fontsize=7, color=INK_2)
    ax.set_xticks(fps["video_fps"])
    ax.invert_xaxis()
    ax.set_ylim(0, 105)
    ax.legend(fontsize=8, frameon=False, loc="lower left")
    style_axes(ax, "Frame rate", "0–100", "pair video resampled · copy 0.3 s late", "frames per second")
    ax = axes[2]
    for i, lagf in enumerate([0, 8]):
        sub = dist[dist.lag_frames == lagf].sort_values("size_pct", ascending=False)
        ax.plot(sub["size_pct"], sub["pair12"], color=SLOTS[i], marker="o", linewidth=2, label="in step" if lagf == 0 else "lag 8 fr")
        hollow(ax, sub.loc[sub.forced, "size_pct"], sub.loc[sub.forced, "pair12"], SLOTS[i])
    ax.set_xticks([100, 75, 50, 25], ["100 %", "75 %", "50 %", "25 %"])
    ax.invert_xaxis()
    ax.set_ylim(0, 105)
    ax.legend(fontsize=8, frameon=False, loc="lower left")
    style_axes(ax, "Camera distance", "pair 1–2 score", "copy shrunk to a share of its size", "copy size")
    fig.text(0.01, -0.05, "Hollow points: the automatic person count failed (25 % copy: person found in 36 % of frames; 240p: small "
             "false detections), so the pair was re-scored with the count given as 2.", fontsize=8, color=INK_2)
    fig.suptitle("Robustness to the input video", x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    save(fig, "fig13_robustness.png")


def fig_people():
    d = read("people")
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), facecolor=SURFACE, gridspec_kw={"width_ratios": [1.6, 1]})
    ax = axes[0]
    xs, labels, colors, values = [], [], [], []
    pos = 0
    for _, r in d.iterrows():
        scores = [float(s) for s in str(r["person_scores"]).split()]
        for i, s in enumerate(scores):
            xs.append(pos); values.append(s)
            colors.append(SLOTS[1] if i == len(scores) - 1 else SLOTS[0])
            labels.append(f"P{i + 1}")
            pos += 1
        pos += 1
    ax.bar(xs, values, width=0.8, color=colors, edgecolor=SURFACE, linewidth=2, zorder=2)
    for x, v in zip(xs, values):
        ax.text(x, v + 1.2, f"{v:.1f}", ha="center", fontsize=7, color=INK)
    ax.set_xticks(xs, labels)
    starts = np.cumsum([0] + [int(r["people"]) + 1 for _, r in d.iterrows()][:-1])
    for s0, (_, r) in zip(starts, d.iterrows()):
        ax.text(s0 + (r["people"] - 1) / 2, -14, f"{int(r['people'])} people", ha="center", fontsize=8, color=INK, fontweight="bold")
    ax.set_ylim(0, 110)
    handles = [plt.Rectangle((0, 0), 1, 1, color=SLOTS[0]), plt.Rectangle((0, 0), 1, 1, color=SLOTS[1])]
    ax.legend(handles, ["in step", "8 frames late"], fontsize=8, frameon=False, loc="upper right", ncol=2)
    style_axes(ax, "Per-person score S_i", "S_i (0–100)", "the late person should have the lowest S_i")
    ax = axes[1]
    ax.bar(np.arange(len(d)), d["ms_per_frame"], width=0.6, color=SLOTS[2], edgecolor=SURFACE, linewidth=2, zorder=2)
    for i, v in enumerate(d["ms_per_frame"]):
        ax.text(i, v + 2, f"{v:.0f}", ha="center", fontsize=8, color=INK)
    ax.set_xticks(np.arange(len(d)), [f"{int(n)} people" for n in d["people"]])
    ax.set_ylim(0, d["ms_per_frame"].max() * 1.25)
    style_axes(ax, "Time per frame (server)", "ms", "top-down: one pose run per person")
    fig.suptitle("Number of people", x=0.01, ha="left", fontsize=13, fontweight="bold", color=INK, y=1.03)
    save(fig, "fig14_people.png")


if __name__ == "__main__":
    fig_lag()
    fig_conditions()
    fig_robustness()
    fig_people()
