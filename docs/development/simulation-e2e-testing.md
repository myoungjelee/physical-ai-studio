# Simulation library E2E testing

The simulation suite separates **training regression**, **deployment wiring**, and **task quality**. Moving the arm is not a sorting success. An earlier three-epoch ACT run scored 0% (100 missed items), with about 2 Hz control against 30 Hz demonstrations; those results do not qualify a checkpoint.

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

Both workflows offer a **dataset** dropdown on manual dispatch: `50` (the default) or `100`. Scheduled weekly runs keep the original `50` choice. Repository-reviewed IDs and immutable revisions live in `library/tests/integration/simulation_e2e.py`; downloads use separate directories for each choice.

| Choice | Hugging Face dataset                                                                                  | Episodes / frames | Pinned revision                            |
| ------ | ----------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| `50`   | [Original recording](https://huggingface.co/datasets/Albertvh97/conveyor-sort-sim-demos)              | 50 / 62,866       | `6a949360761fee17089fbaaf8bc53f59715cb575` |
| `100`  | [Expanded recording](https://huggingface.co/datasets/Albertvh97/conveyor-sort-sim-demos-100-episodes) | 100 / 132,547     | `17db8f758b32141d795a71a064cfa9f5c6341b5b` |

Both contain overview/wrist cameras, six-dimensional state/actions, and a 0.04 m/s belt at 30 FPS. The expanded dataset preserves the original 50 episodes and adds 50 stock-expert episodes with seeds 40000–40049: 500 correct items, none wrong or missed, and all 24 shape/colour/damage combinations. It preserves the natural spawn distribution rather than equal bin counts. New videos use H.264 CRF 18; original videos are copied without re-encoding, so encoding differs between sources. The original recording seeds were not captured, so evaluation seeds cannot be certified as unseen across either dataset.

Selection changes the recording used for training and the camera/action schema used during evaluation. Rollouts pass the recording's exact task instruction from `meta/tasks.parquet` to Runtime; missing, blank, or multiple instructions fail before export. It does not retrain or replace a qualified checkpoint, change evaluation seeds, or change the five-episode scoring protocol. Provenance records the selected repository and revision. Downloads and training reject a recording with the wrong episode count.

Each trial pauses the conveyor during setup, fixes a seed, resets, verifies queued commands have taken effect, connects the policy runtime, then resumes the belt. Do not disable episode auto-reset during scoring: in this simulator that also pauses the belt. Scoring stops on the first completed episode and validates all 10 items as correct/wrong/missed. The score is `correct / (correct + wrong + missed)`.

HTTP health polling runs on a separate thread, not inside the control tick callback. Results record wall-clock control frequency, inference p95 latency, unique camera timestamps, simulator speed/camera rates, seeds, checkpoint identity, and code/dependency provenance. The timing gate requires at least 80% of the recorded control and camera frequency (24 Hz), with simulator real-time factor between 0.9 and 1.1. It includes startup-to-first-action delay after a paused warmup and reseed/reset. Investigate camera blocking, inference cost, action units/order, and preprocessing parity when timing or task scores regress; do not slow the belt to make a policy pass.

ACT rollouts consume each exported action horizon completely with `SyncExecution(request_threshold=0.0)` and an explicit `ChunkedActionQueue()` without crossfading. This matches native ACT's default queue behavior: the current 100-step configuration predicts again after 100 actions, rather than after approximately 51. Other policies retain half-chunk refill and five-frame crossfade. Each `runtime.run()` reconnects and resets its policy source automatically; calling `source.reset()` between runs is invalid because the source is disconnected.

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

`.github/workflows/simulation-library-training.yml` is manual-only, separate from the weekly gate. Select a policy and dataset to train three full epochs (94,299 optimizer steps for the original 50-episode dataset at batch size 2; the expanded dataset takes more steps). It saves `last.ckpt` every 1,000 steps and explicitly saves the exact final training state after a successful fit. A five-day self-hosted timeout still applies. Long and weekly workflows share a concurrency group to avoid competing on the same GPU.

To resume, dispatch the same source revision, policy, and dataset with `resume_run_id` pointing to a completed run of the training workflow. It verifies recorded policy/source identity and the dataset repository/revision, then restores optimizer and scheduler state from the checkpoint. Artifacts missing dataset identity are rejected. Checkpoint artifacts are large and expire after seven days; publish valuable candidates before expiry. These artifacts are not automatically promoted to weekly baselines.

## Local commands

From `library/`, install the `tests`, `policies`, `sim-e2e`, and appropriate hardware extras, then set `SIM_E2E_DATASET_DIR`, `SIM_E2E_POLICY`, and `SIM_E2E_OUTPUT_DIR`. Set `SIM_E2E_DATASET=50` (default) or `SIM_E2E_DATASET=100` to match the pinned recording in that directory:

```bash
# Bounded training regression, no simulator required
SIM_E2E_MODE=train uv run --no-sync pytest tests/integration/test_simulation_training_e2e.py -k test_train_export_and_run_in_simulation -v

# Three full epochs; optionally set SIM_E2E_RESUME_CHECKPOINT to your trusted local last.ckpt
SIM_E2E_MODE=train SIM_E2E_TRAIN_STEPS=-1 uv run --no-sync pytest tests/integration/test_simulation_training_e2e.py -k test_train_export_and_run_in_simulation -v
```

For evaluation/controls, separately start the pinned `physicalai-mujoco` owner in `conveyor_sort`, set `SIM_E2E_HTTP_URL` and `SIM_E2E_OWNER`, and select `-k test_simulator_controls` or set `SIM_E2E_MODE=evaluate` with `-k test_train_export_and_run_in_simulation`. Set `SIM_E2E_RECORD_VIDEO=true` to retain video (requires FFmpeg). `SIM_E2E_MODE=full` keeps the manual train→export→rollout route, but an unqualified candidate's score is not a quality pass.

The retained ACT candidate trained at `6d2f0c22` completed three epochs (94,299 steps; final reported training loss 0.05229). Its original rollout crashed before scoring. A 2026-10-20 re-evaluation with the seeded protocol, EGL, the previous half-chunk refill/crossfade settings, and both dependencies attested at the pinned revision scored **0/50 correct, 1 wrong, 49 missed** through OpenVINO. All five trials passed timing: 27.89–28.06 Hz control, approximately 30 FPS cameras, and real-time physics. Matched controls on seed 104729 scored 10/10 for the expert and 0/10 for no actions. A native PyTorch/GPU rollout on that seed scored 1/10 at 29.34 Hz using the same Runtime execution settings; one episode does not establish a native success rate or explain the backend difference. Native/OpenVINO predictions on five recorded observations differed by at most 0.000237 action units. These results used half-chunk execution; the full-chunk follow-up is recorded below. This candidate remains unqualified. Reports, source snapshots, and videos are under `~/sim-e2e-weekly-validation/act-evaluation-20261020T122416Z-YBIf/` on the GPU server, with the native check in its `native/` subdirectory.

A subsequent full-chunk/no-crossfade test reused that exact export without retraining. Seed 104729 scored 1/10, seed 104743 timed out at the unchanged 180-second deadline with an item unresolved, and seeds 104759, 104761, and 104773 each scored 0/10. The strict sweep failed on the timeout; the remaining seeds were then attempted independently without changing scoring. Four completed episodes totaled **1 correct, 2 wrong, 37 missed**. There is no valid five-completed-episode aggregate score, and 2.5% on the completed subset is not a clean improvement over the previous five-episode result. All completed episodes passed timing at 28.64–28.74 Hz control with approximately 30 FPS cameras and real-time physics. A queue preflight verified predictions at action indexes 0, 100, and 200 without blending. The checkpoint remains unqualified: correcting chunk consumption alone did not fix sorting. Reports, videos, source snapshots, and the timeout evidence are under `~/sim-e2e-weekly-validation/act-fullchunk-20261020T125640Z-zezF/` on the GPU server, with continuation trials in `continuation/`.

### Native reference and conveyor-motion diagnostics

A subsequent native CUDA reference bypassed `RobotRuntime`, `PolicySource`, and Runtime's queue entirely, using ACT's own `select_action()` and an absolute 30-Hz clock. All five nominal-speed episodes completed with **0 correct, 1 wrong, 49 missed**, at 29.94–30.01 Hz control. Measured p95 command-phase lag corresponded to 0.65–1.04 mm of belt travel; camera backend/read timestamps do not establish the full exposure-to-actuation delay. The same two matched seeds scored 3/20 at 0.02 m/s, 0/20 at approximately 0.044 m/s, and 0/20 at nominal speed with only 10 of 100 predicted actions consumed before refreshing. These speed/horizon variants are diagnostics, not qualification results. The checkpoint weights were unchanged.

The candidate trained on all 50 original episodes without a validation split. Deployment-mode predictions on 400 sampled observations from those episodes had normalized full-chunk L1 error 0.103; 400 observations from 50 unused, newer expert recordings had error 0.612. First-action MAE on the first three joints rose from 1.86 to 6.04 normalized robot units. Sampling included uniformly spaced observations and gripper transitions. New recordings also contain wrist-roll states outside the old training range. This demonstrates a trajectory-generalization/data-distribution gap, not proof that extra epochs alone will fix it; the old training seeds are unknown, so unused recordings are not certified unseen seed values.

Live entry-object world-coordinate tracks measured 0.03976 m/s for a 0.04 m/s command and 0.01998 m/s for 0.02 m/s. However, long linear object tracks in the original training videos moved about 10% faster per declared video second than newer synchronous recordings (23.94 versus 21.74 pixels/s). If entirely due to a capture-clock discrepancy, that would be consistent with about 27.24-Hz capture encoded as 30 FPS, but original capture timestamps are unavailable and the exact cause is unconfirmed. Matching the apparent motion with a 0.044 m/s diagnostic did not restore sorting. Verify the recording timebase and use representative current-scene data with a real held-out split before retraining; do not silently change the task speed or resample on this hypothesis alone. Reports, scripts, videos, timing arrays, and object traces are under `~/sim-e2e-weekly-validation/act-diagnosis-20261020T131923Z-lERD/` on the GPU server.

### Controlled synchronous-only retraining

`library/configs/simulation-e2e/act-synchronous-holdout.json` records the controlled follow-up specification; it is not a standalone CLI config. The experiment excludes the original recordings and uses only the 50 newer synchronous expert episodes. An independent audit checked every episode's frame count against its recorded physics duration, verified 30-Hz video timestamps, and replayed all 1,513 frames of seed 40000: recorded states and actions matched exactly, the maximum frame/physics timing discrepancy was 0.667 ms, rendered sentinel images matched within video-compression tolerance, and the replay scored 10/10. The originals were not retimed or changed.

The fixed split is 40 training episodes and 10 validation episodes, selected with seed 104729. State/action normalization is fitted on training frames only; visual normalization stays at ImageNet statistics. The training set covers all 24 object combinations; the unchanged natural validation split covers 23, missing the cracked blue cylinder. A fresh ACT uses the same default architecture, learning rates, 100-step horizon, and three-epoch budget, at batch size 2: 55,670 training frames and 83,505 optimizer steps.

Checkpoint selection uses deployment-mode action predictions on 200 fixed full, non-padded held-out chunks, not the ground-truth-conditioned VAE training/validation objective. Validation runs in eval/inference mode, supplies no target actions to the model, and does not update BatchNorm statistics. It saves resumable best/last checkpoints every 1,000 steps and at completion. The GPU smoke test verified one training step, checkpoint reload and held-out metric reproduction; an export smoke check verified native/OpenVINO parity. On this exact held-out sample set and common training-only normalization scale, the untouched old checkpoint scores 0.3820 normalized L1; this is an imitation reference, not a task-quality pass.

The run is retained under `~/sim-e2e-weekly-validation/act-controlled-20261020T135642Z-UnFH/` on the GPU server, with resolved configuration and runner/source hashes. `phase`, `training/status.json`, and the progress/validation JSONL files report its state. After successful training, the guarded pipeline checks scripted/no-action controls and runs both native CUDA and OpenVINO CPU rollouts on reserved seeds 50000–50004, which are disjoint from training and validation collection seeds. Export parity is checked again before OpenVINO rollouts. Results and videos are retained; the pipeline never automatically publishes or qualifies the candidate.

The three-epoch run completed on 2026-10-20: 83,505 steps in 5 h 47 min, with the best held-out deployment L1 0.16696 at step 83,000 versus 0.38203 for the old checkpoint on the same sample set and scale. Despite that 56% prediction-error reduction, reserved-seed sorting remained **0/50 for native CUDA and 0/50 for OpenVINO**, with all candidate timing gates passing. The scripted expert scored 49/50 and no actions scored 0/50. Best and last resumable checkpoints remain under the run's `training/checkpoints/`; 18 read-only initial/milestone/final snapshots were retained under `~/sim-e2e-weekly-validation/act-overnight-20261020T150049Z-tvsr/retained-checkpoints/` and all hashes were verified the next morning. The separately planned overnight six-epoch continuation was not deployed or queued and did not run. The candidate remains unqualified; improved recorded-data imitation did not establish closed-loop task success.

After the next-day review, a new continuation was explicitly launched on 2026-10-21 under `~/sim-e2e-weekly-validation/act-continuation-20261021T072715Z-sf8f/`. Its specification is `library/configs/simulation-e2e/act-synchronous-six-epochs.json`. It restores the final parent step 83,505 with AdamW/loop state and trains to six total epochs, 167,010 steps, keeping the same split, statistics and learning rates. A full-size GPU smoke test verified the restored loop/optimizer step advanced to 83,506 and that the inherited best at 83,000 remained available with the identical validation metric. Working best/last files stay writable; separate epoch, milestone and final snapshots are read-only and never cleaned up. The baseline and its 18 retained snapshots are untouched. The new pipeline repeats controls and native/OpenVINO evaluation after training; it is not a claim that the missing overnight run happened or that the continued model has qualified.
