# Job scheduler measurements

On-demand workers reduce idle backend memory substantially. Profiling and
deferring unrelated imports brings fresh-worker entry down from 6–7 seconds to
about 1.5–1.9 seconds in this local measurement. Removing the cancellation
manager saves another process and about 30 MiB of aggregate RSS.

## Results

Measured on 2026-10-19. Each column reports the median of three independent runs.
Idle values are the median sampled RSS within each run; active values are the
maximum sampled RSS within each run. All memory values are **MiB of aggregate
RSS across the backend parent and its recursive child processes**.

| Metric | Resident workers | On-demand + manager | Per-job events | Events + deferred imports |
| --- | ---: | ---: | ---: | ---: |
| Idle before jobs | 1,974.5 | 737.0 | 707.3 | 707.4 |
| Dataset detection peak | 1,986.6 | 1,392.3 | 1,362.6 | 1,050.2 |
| Dataset import/commit peak | 1,986.9 | 1,393.4 | 1,362.7 | 1,050.3 |
| ACT CPU training peak | 3,792.0 | 3,184.3 | 3,155.1 | 3,144.7 |
| Idle after jobs and worker reaping | 2,482.7 | 758.0 | 728.2 | 712.4 |
| Idle process count, including parent and Python resource tracker | 5 | 3 | 2 | 2 |

Compared with resident workers, the final version reduces measured aggregate
RSS by approximately **64% before jobs**, **47% during import**, and **17% at the
training peak**. It also releases the training process's retained memory after
the job finishes. Removing the manager accounts for about **30 MiB** of the idle
reduction; most savings come from removing the resident training/import workers.

### Submission-to-worker-start latency

Seconds from immediately before the API submission/upload/finalization request
to entering the worker's per-job method, including request handling, polling,
process startup, imports, and worker setup. Training starts at
`TrainingWorker._run_training_job`; import phases start at
`DatasetImportWorker._process_job`. This is not time to the first training batch.

| Job phase | Resident workers | On-demand + manager | Per-job events | Events + deferred imports |
| --- | ---: | ---: | ---: | ---: |
| Dataset detection | 0.120 | 5.969 | 5.905 | 1.533 |
| Dataset import/commit | 0.508 | 6.691 | 6.589 | 1.893 |
| Training preparation | 1.377 | 6.264 | 6.953 | 1.787 |

Optimized startup ranges were 1.523–1.645 seconds for detection, 1.867–1.916
seconds for import/commit, and 1.727–1.938 seconds for training. The
resident-worker ranges were 0.061–0.324, 0.480–0.513, and 1.341–1.399 seconds,
respectively. Manager removal alone does not establish a latency improvement.

`python -X importtime` identified two unnecessary import paths:

- Importing `ProjectThumbnailService` eagerly loaded LeRobot through
  `internal_datasets.utils`. Deferring that import until thumbnail access cut
  the profiled `core.scheduler` import from 5.123 to 1.063 seconds.
- Importing the standard-library-only `physicalai.data.archive_safety` helper
  first executed `physicalai.data.__init__`, loading Lightning and LeRobot.
  Data exports now load on demand using the existing policy-package pattern;
  public names and object identities remain unchanged.

These changes move training-library loading to the actual training backend,
where it is needed. They do not remove that work from time to the first training
batch. End-to-end training times on this tiny workload remain dominated by
initialization, training, and checkpoint writing; faster worker entry is not a
claim of equivalent training-throughput improvement.

## Method

- **Machine:** Apple M3 Pro, 12 logical CPUs, 36 GiB RAM, macOS 27.0.1 ARM64.
- **Environment:** Python 3.13.9, PyTorch 2.11.0, existing backend uv environment.
  Both `OMP_NUM_THREADS` and `MKL_NUM_THREADS` were set to `2`.
- **Baseline:** `origin/main` at `77be16a76ec0b2452db8529234324f4fa3176d44`.
  The intermediate version uses on-demand workers with the original manager
  dictionary; the next version uses per-job multiprocessing events. The last
  version also defers the two profiled imports and atomically claims training
  jobs before preparation.
- Each run used a new Python interpreter, a separate migrated SQLite database,
  and a separate `STORAGE_DIR`. Production storage was not used.
- The harness imported the real FastAPI app, started the real scheduler using
  multiprocessing `spawn`, and used `TestClient` without FastAPI lifespan to
  avoid hardware discovery and remote-trainer startup. A consumer thread
  drained the real multiprocessing event queue throughout the run. This
  isolates scheduler/workload behavior rather than measuring a complete live
  HTTP server deployment.
- The workload followed the real API routes in
  `tests/integration/test_e2e_dataset_to_export.py`: prepare, upload, detect,
  finalize, import, then train ACT. Workers ran in real scheduler-owned
  processes, not the integration test's in-process worker helpers.
- The same synthetic LeRobot v3 archive was used in every run: two episodes,
  eight frames per episode, one 64×64 RGB camera, and two-dimensional state
  and actions. It was generated with the existing integration-test helper.
- ACT used one epoch, batch size `2`, `num_workers=0`, validation split `0.5`,
  CPU, precision `32-true`, no compilation, and `export_backends=[]`. The cached
  ResNet18 weights were available. Hugging Face offline mode was enabled. All
  twelve imports and training jobs completed successfully; no backend or training
  implementation was mocked.
- RSS was sampled with `psutil` at a nominal 50 ms interval. Workers were given
  ten seconds to initialize before the first three-second idle window. The
  final idle window began five seconds after training completion, then lasted
  three seconds. Timing hooks only recorded entry to the two worker methods.
- Baseline and final runs were alternated after the first pair. Intermediate
  runs followed afterward, and optimized runs followed the import profiling.
  OS filesystem caches were not flushed.

## Limits and next steps

Summed RSS can count shared pages more than once; these numbers are not unique
physical-memory usage, PSS, or GPU memory. Peaks are sampled rather than exact
allocation maxima. Tiny CPU-only workloads do not predict production datasets,
GPU training, remote trainers, export costs, or concurrent multi-target peaks.
The harness bypassed native Arrow/PyTorch interpreter teardown after scheduler
shutdown; resource-tracker cleanup warnings appeared in both old and new runs.

The smaller startup penalty remains a trade-off. Further optimization should
continue to use profiles rather than worker pools, which retain the memory this
change is intended to release. Separately, keep shutdown off the FastAPI event
loop so its event
processor can drain worker queues while the scheduler joins processes. The
bounded-queue lifecycle regression test covers that behavior; these memory
measurements do not quantify shutdown queue pressure.
