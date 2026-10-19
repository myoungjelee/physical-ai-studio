# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Exercise on-demand workers with real spawn processes and an isolated SQLite DB."""

import asyncio
import multiprocessing as mp
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from core.scheduler import Scheduler
from db import get_async_db_session_ctx
from db.schema import ProjectDB
from schemas.base_job import JobStatus
from schemas.dataset_import_job import DatasetImportJobPayload, ImportStep
from schemas.job import DatasetImportJob, LocalTrainJobPayload, TrainJob
from services.job_service import JobService


def _probe_cancellation(job_id, stop_event, cancel_event, result_queue):
    from workers.training_worker import TrainingWorker

    worker = TrainingWorker(job_id=job_id, stop_event=stop_event, cancel_event=cancel_event, event_queue=result_queue)
    result_queue.put("ready")
    assert cancel_event.wait(timeout=10)
    result_queue.put((worker._should_interrupt(), worker.should_stop()))


@pytest.mark.integration
def test_cancellation_event_reaches_spawned_worker_without_signaling_shutdown(monkeypatch):
    context = mp.get_context("spawn")
    monkeypatch.setattr("core.scheduler.mp", context)
    scheduler = Scheduler()
    job_id = uuid4()
    cancel_event = context.Event()
    scheduler._cancel_events[job_id] = cancel_event
    process = context.Process(
        target=_probe_cancellation, args=(job_id, scheduler.mp_stop_event, cancel_event, scheduler.event_queue)
    )
    try:
        process.start()
        assert scheduler.event_queue.get(timeout=30) == "ready"
        scheduler.cancel_job(job_id)
        assert scheduler.event_queue.get(timeout=10) == (True, False)
        process.join(timeout=10)
        assert process.exitcode == 0
    finally:
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
        process.close()
        scheduler.shutdown()
        scheduler.event_queue.close()
        scheduler.event_queue.join_thread()


@pytest.mark.integration
@pytest.mark.anyio
async def test_spawned_workers_exit_and_release_reservations_on_failure(migrated_db, monkeypatch):
    project_id = uuid4()
    training = TrainJob(
        project_id=project_id,
        created_at=datetime.now(tz=UTC),
        payload=LocalTrainJobPayload(
            project_id=project_id, dataset_id=uuid4(), policy="act", model_name="missing-dataset"
        ),
    )
    importing = DatasetImportJob(
        project_id=project_id,
        created_at=datetime.now(tz=UTC),
        payload=DatasetImportJobPayload(archive_staging_id=str(uuid4()), step=ImportStep.QUEUED_FOR_DETECTION),
    )
    async with get_async_db_session_ctx() as session:
        session.add(ProjectDB(id=str(project_id), name="Scheduler process test"))
        await session.commit()
        service = JobService(session)
        await service.create_job(training)
        await service.create_job(importing)

    # Match production's spawn policy without changing the test runner's global context.
    monkeypatch.setattr("core.scheduler.mp", mp.get_context("spawn"))
    children_before = {process.pid for process in mp.active_children()}
    scheduler = Scheduler()
    try:
        assert {process.pid for process in mp.active_children()} == children_before
        assert not scheduler.processes
        await scheduler._schedule_jobs()
        assert set(scheduler.processes) == {"local", "dataset_import"}
        for process, _ in scheduler.processes.values():
            await asyncio.to_thread(process.join, 45)
            assert not process.is_alive(), f"Worker {process.name} did not exit after its single job"
        await scheduler._reap_processes()
        assert not scheduler.processes
        assert not scheduler._cancel_events
        async with get_async_db_session_ctx() as session:
            service = JobService(session)
            assert (await service.get_job_by_id(training.id)).status == JobStatus.FAILED
            assert (await service.get_job_by_id(importing.id)).status == JobStatus.FAILED
    finally:
        scheduler.mp_stop_event.set()
        scheduler._shutdown_processes()
        scheduler.shutdown()
