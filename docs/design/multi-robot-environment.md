# Multi-Robot Environment: design and implementation plan

Status: proposed / implementation in progress. This document does not claim that multi-robot execution currently works.

## Goal

Allow an Environment to hold multiple **individually registered** follower/teleoperator pairs (e.g. left SO-101 and right SO-101). Record synchronized observations, actions, and camera frames into **one** LeRobot episode, train one policy for both arms, and route inference outputs back to each follower. Keep existing single-follower workflows compatible.

## Source constraints observed (2026-10-29)

- `application/backend/src/schemas/environment.py` already represents `robots` as a list of `RobotEnvironmentConfiguration` objects.
- `application/ui/src/features/robots/environment-form/robot-form.tsx` hides Add Robot once a pair is present.
- `application/ui/src/features/robots/runtime-session-provider.tsx` currently uses `environment.robots?.[0]`.
- `application/backend/src/api/environments.py` and `application/backend/src/api/models.py` require one follower for runtime export.
- `application/docs/explanation/runtime-session-architecture.md` says one follower per session. A bimanual robot type currently wraps two physical arms as one logical follower.
- `application/backend/src/runtime/features.py`, `dataset_features.py`, and `callbacks/recording.py` map one robot's joint names into features and record per-tick actions / observations / camera frames.

## Architecture proposal

1. **Configuration.** Keep independently registered Robot resources. Each environment robot relation references one follower plus optional teleoperator. Add stable, unique per-follower **feature namespaces**, independent of display names (e.g. by IDs or explicit aliases); persist the mapping with the dataset/model.
2. **Lifecycle.** A session coordinator owns multiple robot interfaces and one episode. It connects and validates all devices before enabling motion, sends commands to each follower, coordinates start/stop/reset, and closes every device on failure. Single-follower sessions use the same coordinator with one member only if compatibility tests pass.
3. **Sampling.** Use a single sampling timeline with monotonic timestamps. Record per-robot read and write timestamps; specify acceptable skew and missed-frame policy. Do not claim hardware-level simultaneity.
4. **Data.** One episode frame includes namespaced joint state and action values for every follower plus camera frames. Freeze per-robot joint ordering and feature manifest at recording time. Validate dimensions, finite values, unit conventions and camera names. Missing robot frames must not silently masquerade as valid data.
5. **Training.** Check policy-specific support for combined action/state dimensions (ACT first, SmolVLA separately). Refuse unsupported model/data combinations explicitly. Keep LeRobot export/import and single-robot datasets unchanged.
6. **Inference.** Validate policy schema against session manifest; split the action vector by stable feature mapping and dispatch to corresponding robots. On disconnect, stale observations, invalid action or timeout, invoke a documented safe state across the group.
7. **Presentation.** Allow multi-pair editing only when execution and recording are supported; otherwise show an explicit unsupported capability state. Display status by robot, not just first member.

## Milestones and acceptance criteria

- **M1: Contract & tests.** Define stable group membership, feature names/order, timestamps, compatibility and failure policies. Unit tests for zero/one/two pairs and duplicate hardware usage.
- **M2: Multi-device teleop.** Two independent SO-101 leader/follower pairs move correctly, no joint cross-wiring, single arm remains unchanged. Emergency stop and one-arm failure stop the group.
- **M3: Recording.** One episode contains both arms' observations/actions and expected camera frames; timestamps and skew are inspected; exported LeRobot dataset passes round-trip validation.
- **M4: ACT.** ACT training with combined state/action dimensions and inference dispatch to both arms; no regressions for single arm.
- **M5: SmolVLA and broader robot types.** Test model compatibility and heterogeneous robots before claiming general support.

## Non-goals for first PR

- An Environment-only Add button that silently ignores the second follower at runtime.
- Two unrelated episodes falsely presented as one synchronized demonstration.
- Claiming arbitrary heterogeneous-robot support without feature/units and clock validation.
- Replacing existing BimanualSO101 types before the general path is proven.

## Development workflow

Branch `feat/multi-robot-environment` starts from the fork's `main`, independent of `test/bimanual-so101`. Maintain tests and make isolated changes by milestone. Do not deploy to the company's existing Studio until a standalone test stack has been validated.
