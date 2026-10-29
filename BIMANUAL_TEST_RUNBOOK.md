# Company-PC bimanual SO-101 test runbook

This fork contains an **isolated development test**. It does not add true multi-follower execution. For synchronized two-arm recording, use the existing logical `BimanualSO101_Follower` / `BimanualSO101_Leader` types.

## Install once

```bash
cd ~/git
git clone --branch test/bimanual-so101 --single-branch https://github.com/myoungjelee/physical-ai-studio.git physical-ai-studio-fork
cd physical-ai-studio-fork
scripts/bimanual-test.sh config
scripts/bimanual-test.sh build
```

Verify the output names: `physical-ai-studio-bimanual-test`, host port `7861`, volume `pai-bimanual-test_physical-ai-studio-storage`.

**Before any hardware access**, stop the **existing** container that currently owns the SO-101 USB and camera devices. Do not delete its volumes. Ensure nothing else is recording or training on the same devices.

```bash
scripts/bimanual-test.sh up
docker ps --filter name=physical-ai-studio-bimanual-test
```

Open <http://localhost:7861>. `scripts/bimanual-test.sh down` stops the test stack without deleting its named volume. Avoid `down -v`.

## Registration and recording

1. Register and calibrate two individual SO-101 Leaders and two individual SO-101 Followers. Each needs a distinct USB identity/serial number.
2. In the robot catalog, create `BimanualSO101_Leader` by selecting the two registered leaders, left and right.
3. Create `BimanualSO101_Follower` by selecting the two calibrated followers, left and right.
4. Create an Environment containing **one logical Bimanual Follower** and selecting the logical Bimanual Leader as teleoperator, plus the cameras. Do **not** add two individual follower rows.
5. Begin with unobstructed arm travel, low speed and readily available power cutoff. Verify left/right leader-to-follower movement before recording.
6. Record one short, low-risk test episode, and export it in LeRobot v3 format. Verify that both arm positions and actions, as well as every expected camera, are represented in one episode.
7. Check dimensions, left/right prefixes, missing values, timestamps/relative synchronization, and camera feature names before any model training.

## What is implemented vs unknown

The runtime recording callback translates **all exposed joint names** to `<joint>.pos` observation and action features, and records camera images in the same frame. But the exact driver-provided joint names, axis order, LeRobot Parquet schema and whether actions are correctly aligned for both arms **must be validated from an actual episode**. Studio's configured runtime FPS is 30; this is not proof of zero timestamp skew or a sustained 30 real frames/sec.

Use `BIMANUAL_SO101_INVESTIGATION.md` for source references. If test fails, capture the error logs and exported dataset metadata, then implement a narrow fix in a separate PR. Do not assume a UI-only multi-robot button enables synchronized control.
