# Simulation library E2E testing

The simulation suite separates **training regression**, **deployment wiring**, and **task quality**. Moving the arm is not a sorting success. The previous three-epoch ACT run scored 0% (100 missed items), with about 2 Hz control against 30 Hz demonstrations; those results do not qualify a checkpoint.

## Weekly checks

`.github/workflows/simulation-library-e2e.yml` runs weekly/manual on one self-hosted GPU. It attempts all six policies: ACT, MolmoAct2, Pi0.5, RLDX1, SmolVLA, and XR0. Cosmos3 remains excluded until an embodiment is configured.

1. **Simulator controls:** compare scripted autopilot (`drive`) and no actions (`off`) on the same five seeds at 0.04 m/s. The expert must outperform no actions. Failure blocks policy quality evaluation, not training regression.
2. **Training regression:** run 20 optimizer steps at batch size 2; save and reload a checkpoint with restricted unpickling. No simulator is needed. This does not establish model quality.
3. **Export and evaluation:** load a qualified checkpoint from the repository-reviewed manifest, verify its SHA-256, export with the current library to OpenVINO, and run five completed conveyor episodes with Runtime. The 180-second per-episode deadline is a failure safeguard, not a scoring window.

Job limits are 20 minutes for training and 30 minutes for evaluation/controls. The serial six-policy matrix has a maximum configured budget of approximately six hours plus setup/report overhead. Cache misses or slow hardware can hit these limits; an incomplete job is not a pass.

The report shows training/reload, export/actions, timing, and quality separately. A missing qualified checkpoint is explicitly **baseline unavailable**, not a quality pass. Logs, JUnit, scores, timing, and short inference videos are retained for 14 days; weekly checkpoints and exports are deleted to bound storage.

### A100 settings

MolmoAct2 uses rank-64 LoRA with gradient checkpointing. XR0 freezes its vision encoder and derives learning-rate decay from the training budget. Other policies use constructor defaults. Batch size is 2 throughout. These settings passed short training probes on a 40 GB A100; XR0 and Pi0.5 have little spare memory.

Rendering uses EGL rather than software OSMesa, which was observed delivering only about 2 FPS. Configure `SIM_E2E_CUDA_VISIBLE_DEVICES` as a repository variable to select the physical GPU (`0` by default). Provide `HF_TOKEN` as a repository secret with access to gated PaliGemma tokenizer assets. GPU selection does not combine memory across cards.

Both installed Runtime and MuJoCo plugin commits are checked against `91338224c67f0d17f166eb062e3ac9a6762db784` before expensive work. Mixed installations fail rather than silently evaluating another deployment stack. This check caught an inconsistent library lockfile that still resolved Runtime to `f90b3767` despite the configured `91338224` source; the resolved lock entry is now corrected and regression-tested.

## Reproducible episodes

The recording is the 50-episode [conveyor dataset](https://huggingface.co/datasets/Albertvh97/conveyor-sort-sim-demos), pinned at `6a949360761fee17089fbaaf8bc53f59715cb575`. It contains 62,866 samples, overview/wrist cameras, six-dimensional state/actions, and a 0.04 m/s belt. Its recording seed was not captured, so the fixed evaluation seeds cannot be certified as unseen during collection.

Each trial pauses the conveyor during setup, fixes a seed, resets, verifies queued commands have taken effect, connects the policy runtime, then resumes the belt. Do not disable episode auto-reset during scoring: in this simulator that also pauses the belt. Scoring stops on the first completed episode and validates all 10 items as correct/wrong/missed. The score is `correct / (correct + wrong + missed)`.

HTTP health polling runs on a separate thread, not inside the control tick callback. Results record wall-clock control frequency, inference p95 latency, unique camera timestamps, simulator speed/camera rates, seeds, checkpoint identity, and code/dependency provenance. The timing gate requires at least 80% of the recorded control and camera frequency (24 Hz), with simulator real-time factor between 0.9 and 1.1. It includes startup-to-first-action delay after a paused warmup and reseed/reset. Investigate camera blocking, inference cost, action units/order, and preprocessing parity when timing or task scores regress; do not slow the belt to make a policy pass.

ACT evaluation matches native ACT's default action queue: `SyncExecution(request_threshold=0.0)` drains each returned chunk completely, and an explicit `ChunkedActionQueue()` replaces rather than crossfades predictions. With the default 100-step horizon, predictions refresh after 100 actions, not halfway through the chunk. After the paused warmup and scene reset, ACT's source is reset so the scored episode starts with fresh predictions. Other policies retain their existing half-chunk refill and five-frame crossfade. This matches queue semantics, not the inference backend or latency: ACT still runs exported OpenVINO inference synchronously on CPU.

An isolated CPU-only calibration on the GPU server passed all five scripted episodes at 100% and all five no-action episodes at 0%, with both dependencies attested at the intended revision. OSMesa cameras still measured about 2 FPS while physics stayed near real time. Logs and `controls.json` are under `~/sim-e2e-weekly-validation/results/` on that server. This validates the scoring protocol, not hardware-rendered camera throughput or learned-policy quality.

### ACT export parity diagnostic

A bounded CPU-only ACT probe compared native predictions with OpenVINO predictions on five recorded conveyor observations, using Runtime's real camera-input conversion. It exposed integer interpolation rounding when uint8 camera bytes were resized before float conversion. ACT export recipes now use the existing `to_float_tensor` processor before `resize`, matching training's float resize order. Re-export existing checkpoints to receive this metadata fix; model weights and state-dict keys are unchanged.

On a two-step diagnostic model, maximum action difference fell from approximately 0.115 to 0.00011. This validates preprocessing/export parity for those samples, not sorting quality or the old trained ACT checkpoint. Reports and the reproduction script are under `~/sim-e2e-weekly-validation/act-parity/` and `act-parity.py` on the GPU server. Neither GPU was used or reconfigured for this probe.

## Qualifying a checkpoint

`library/configs/simulation-e2e/checkpoints.json` deliberately starts with `null` for each policy. No usable task-performance baseline has been demonstrated yet. To qualify one:

1. Train a candidate outside the weekly gate and retain its training provenance.
2. Confirm simulator controls and compare native versus exported predictions on representative recorded observations. Check camera views/order, normalization, action units, and timing.
3. Evaluate the candidate repeatedly on the fixed protocol, inspect videos, and measure score variability.
4. Publish the trusted Studio-generated `.ckpt` to a versioned model repository. Record its immutable revision, SHA-256, and a positive minimum score justified by measured results in the manifest, reviewed as code.

Each entry has exactly these fields (placeholders below must be replaced):

```json
{
  "repo_id": "organization/qualified-conveyor-policy",
  "revision": "<40-character commit SHA>",
  "filename": "model.ckpt",
  "sha256": "<64-character SHA-256>",
  "min_score": 0.5
}
```

`0.5` is an example, not a measured threshold. Use a threshold supported by qualification trials and their variability. Only trusted, checksum-verified training artifacts belong in this manifest. Loading uses the allowlisted first-party policy class and `weights_only=True`; adapters merge through the existing export contract. Checkpoint reload, export, timing, and score must all pass; a 0% sorting score cannot pass qualification.

## Long training and resuming

`.github/workflows/simulation-library-training.yml` is manual-only, separate from the weekly gate. Select one policy to train three full epochs (94,299 optimizer steps at batch size 2). It saves `last.ckpt` every 1,000 steps and explicitly saves the exact final training state after a successful fit. A five-day self-hosted timeout still applies. Long and weekly workflows share a concurrency group to avoid competing on the same GPU.

To resume, dispatch the same source revision and policy with `resume_run_id` pointing to a completed run of the training workflow. It verifies recorded policy/source identity and restores optimizer and scheduler state from the checkpoint. Checkpoint artifacts are large and expire after seven days; publish valuable candidates before expiry. These artifacts are not automatically promoted to weekly baselines.

## Local commands

From `library/`, install the `tests`, `policies`, `sim-e2e`, and appropriate hardware extras, then set `SIM_E2E_DATASET_DIR`, `SIM_E2E_POLICY`, and `SIM_E2E_OUTPUT_DIR`:

```bash
# Bounded training regression, no simulator required
SIM_E2E_MODE=train uv run --no-sync pytest tests/integration/test_simulation_training_e2e.py -k test_train_export_and_run_in_simulation -v

# Three full epochs; optionally set SIM_E2E_RESUME_CHECKPOINT to your trusted local last.ckpt
SIM_E2E_MODE=train SIM_E2E_TRAIN_STEPS=-1 uv run --no-sync pytest tests/integration/test_simulation_training_e2e.py -k test_train_export_and_run_in_simulation -v
```

For evaluation/controls, separately start the pinned `physicalai-mujoco` owner in `conveyor_sort`, set `SIM_E2E_HTTP_URL` and `SIM_E2E_OWNER`, and select `-k test_simulator_controls` or set `SIM_E2E_MODE=evaluate` with `-k test_train_export_and_run_in_simulation`. Set `SIM_E2E_RECORD_VIDEO=true` to retain video (requires FFmpeg). `SIM_E2E_MODE=full` keeps the manual train→export→rollout route, but an unqualified candidate's score is not a quality pass.

The old GPU1 MolmoAct2 run and its batch runner were cancelled at the user's request. A subsequent seeded three-epoch ACT run with corrected float-before-resize preprocessing completed 94,299 steps and scored 2%: one correct, four wrong, and 45 missed items. EGL cameras delivered about 30 FPS, Runtime control about 28.5 Hz, and simulation ran at real time. That run used the previous half-chunk refill/crossfade setup; it does not validate native-style ACT execution or qualify a checkpoint.

For the next ACT diagnostic run, retain the final checkpoint and OpenVINO export alongside configuration, dependency/source provenance, logs, and results so execution variants can be compared without retraining. The earlier report-only cleanup removed its model artifacts. Weekly artifact cleanup is unchanged. Native-style execution still needs a live task-quality evaluation; offline queue tests cannot establish sorting performance.
