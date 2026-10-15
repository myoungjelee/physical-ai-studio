from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from db import get_async_db_session_ctx
from internal_datasets.lerobot.editor import optimize_dataset
from schemas.base_job import JobStatus
from schemas.job import DatasetOptimizationJob
from services.dataset_service import DatasetService
from services.event_processor import EventType
from services.job_service import JobService
from workers.base import BaseProcessWorker

if TYPE_CHECKING:
    import multiprocessing as mp
    from multiprocessing.synchronize import Event as EventClass


class DatasetOptimizationWorker(BaseProcessWorker):
    ROLE = "DatasetOptimizationWorker"

    def __init__(self, stop_event: EventClass, event_queue: mp.Queue):
        super().__init__(stop_event=stop_event)
        self.queue = event_queue

    async def run_loop(self) -> None:
        while not self.should_stop():
            async with get_async_db_session_ctx() as session:
                job = await JobService(session).claim_pending_dataset_optimization_job()
            if isinstance(job, DatasetOptimizationJob):
                await self._run_job(job)
            self.stop_aware_sleep(0.5)

    async def _run_job(self, job: DatasetOptimizationJob) -> None:
        try:
            async with get_async_db_session_ctx() as session:
                dataset = await DatasetService(session).get_dataset_by_id(job.payload.dataset_id)
            backup = await asyncio.to_thread(optimize_dataset, dataset.path)
            job.payload.backup_path = str(backup)
            async with get_async_db_session_ctx() as session:
                completed = await JobService(session).update_job_payload(
                    job.id,
                    job.payload,
                    status=JobStatus.COMPLETED,
                    message="Dataset optimization completed",
                    progress=100,
                )
        except Exception as error:
            async with get_async_db_session_ctx() as session:
                completed = await JobService(session).update_job_status(
                    job.id, JobStatus.FAILED, message=f"Dataset optimization failed: {error}"
                )
        self.queue.put((EventType.JOB_UPDATE, completed))
