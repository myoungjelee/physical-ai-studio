# Bimanual SO-101 investigation (2026-10-29)

## Goal

Record one synchronized episode from two SO-101 follower arms controlled by two SO-101 leaders, then use it for training and inference.

## Findings from source

- The project robot catalog accepts multiple individual robots.
- `application/ui/src/features/robots/environment-form/robot-form.tsx` only renders the add button when the environment is empty. The environment schema itself allows a list of robots.
- `application/ui/src/features/robots/runtime-session-provider.tsx` selects `environment.robots?.[0]`. Merely enabling the add button would silently ignore additional followers at runtime.
- `application/backend/src/api/environments.py` and `application/backend/src/api/models.py` reject runtime export unless exactly one follower exists.
- `application/docs/explanation/runtime-session-architecture.md` documents one follower per session, with bimanual arms represented as a single robot type.
- `application/backend/src/plugins/manifest.json` lists `BimanualSO101_Follower` and `BimanualSO101_Leader` under the SO-101 plugin.
- `application/ui/src/features/robots/robot-form/catalog/bimanual-so101.tsx` builds bimanual payloads from two registered, calibrated individual arms of the corresponding role.
- `application/backend/src/runtime/features.py`, `dataset_features.py`, and `callbacks/recording.py` derive observation/action keys from the runtime's joint names, and record one frame of joint positions, action, and cameras per tick.

## Expected data (to verify with hardware)

One logical bimanual follower should expose both arms' joint names. If they are uniquely prefixed by side, the single episode stores `observation.state` / `action` columns corresponding to both sides, together with camera frames. The exact LeRobot column layout, prefixes, and simultaneous sampling behavior depend on the installed SO-101 driver and dataset encoding and must be checked with a real recording. Do not assume the 2-arm data are automatically valid for all policies.

## Proposed validation

1. Register/calibrate individual left and right leaders and followers (four physical arms).
2. Create one `BimanualSO101_Leader` from two leaders; create one `BimanualSO101_Follower` from two followers.
3. Make a new environment with exactly one logical bimanual follower and its bimanual leader.
4. Test connection and teleoperation safely, with free workspace and emergency stop available.
5. Record a short episode, inspect metadata, state/action feature names, dimensions, camera timestamps, and side identification.
6. Train/evaluate a policy only after the recording schema and action mapping are verified.

## PR recommendation

Do **not** submit a UI-only 'add more robot pairs' PR: the current runtime cannot execute those extra pairs. If the bimanual workflow fails, isolate a reproducible bug in selection, driver, recording, or policy compatibility and submit a targeted fix with tests. A true multi-follower runtime requires a separate design for session orchestration, synchronized recording, collision/safety handling, and downstream policy compatibility.
