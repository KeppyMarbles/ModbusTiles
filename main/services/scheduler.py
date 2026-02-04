import asyncio
import logging
from django.utils import timezone
from channels.db import database_sync_to_async
from ..models import Schedule, TagWriteRequest


logger = logging.getLogger(__name__)


async def run_scheduler(interval=10): #TODO figure out a good number
    """ Background task that checks for due schedules """
    @database_sync_to_async
    def _process_schedules():
        process_schedules()

    logger.info("Starting scheduler...")
    
    while True:
        try:
            await _process_schedules()
        except Exception as e:
            logger.error(f"Scheduler Error: {e}")
        
        await asyncio.sleep(interval)
            

def process_schedules():
    now = timezone.now()
    current_day = now.weekday()

    for schedule in Schedule.objects.filter(enabled=True):
        if len(schedule.days) != 7:
            logger.error(f"Scheduler Error: schedule {schedule} has bad day list")
            continue

        if not schedule.days[current_day]:
            continue

        scheduled_datetime = now.replace(hour=schedule.time.hour, minute=schedule.time.minute, second=0, microsecond=0)

        if schedule.created_at > scheduled_datetime or scheduled_datetime > now:
            continue

        if schedule.last_run and schedule.last_run >= scheduled_datetime:
            continue

        TagWriteRequest.objects.create(tag=schedule.tag, value=schedule.write_value)
        logger.info(f"Schedule activated: {schedule.alias}")

        schedule.last_run = now
        schedule.save(update_fields=["last_run"])