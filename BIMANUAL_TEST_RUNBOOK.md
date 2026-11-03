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

1. Choose `BimanualSO101_Leader` or `BimanualSO101_Follower` in the robot catalog. Choose one of two registration methods:
   - **Use two registered, calibrated arms (existing method):** register and calibrate the two individual SO-101 arms first, then select the left and right arms.
   - **Set up both arms directly (new method; source only, not yet deployed):** select distinct left and right USB controllers identified by serial number. Run the existing SO-101 diagnostics, motor setup (if needed), calibration and verification on **left first**, then **right**. Only after verifying both sides does the wizard save **one** logical bimanual robot. No individual arm records are created.
2. Repeat for the other role if the setup includes both a bimanual leader and bimanual follower. Use the correct power supplies and verify the type before motor setup.
3. Create an Environment containing **one logical Bimanual Follower** and selecting the logical Bimanual Leader as teleoperator, plus the cameras. Do **not** add two individual follower rows.
4. Begin with unobstructed arm travel, low speed and readily available power cutoff. Verify left/right leader-to-follower movement before recording.
5. Record one short, low-risk test episode, and export it in LeRobot v3 format. Verify that both arm positions and actions, as well as every expected camera, are represented in one episode.
6. Check dimensions, left/right prefixes, missing values, timestamps/relative synchronization, and camera feature names before any model training.

**Direct method restrictions:** The controllers must have unique discoverable serial numbers. The wizard reuses the single-arm setup WebSocket per side, and a newly registered bimanual robot is not saved unless both side-specific calibrations are available. Reconfiguring motors/calibration changes real hardware, so test with hardware idle. The direct flow has passed TypeScript and UI unit tests but **has not been tested on physical two-arm hardware**.

## What is implemented vs unknown

The runtime recording callback translates **all exposed joint names** to `<joint>.pos` observation and action features, and records camera images in the same frame. But the exact driver-provided joint names, axis order, LeRobot Parquet schema and whether actions are correctly aligned for both arms **must be validated from an actual episode**. Studio's configured runtime FPS is 30; this is not proof of zero timestamp skew or a sustained 30 real frames/sec.

Use `BIMANUAL_SO101_INVESTIGATION.md` for source references. If test fails, capture the error logs and exported dataset metadata, then implement a narrow fix in a separate PR. Do not assume a UI-only multi-robot button enables synchronized control.
