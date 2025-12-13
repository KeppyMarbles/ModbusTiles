from django.utils import timezone
from ..models import ActivatedAlarm, AlarmConfig, AlarmSubscription

def send_alarm_notifications():
    active_alarms = ActivatedAlarm.objects.filter(is_active=True)
    if not active_alarms:
        return
    
    # Group by config to batch work
    alarms_by_config: dict[int, list[ActivatedAlarm]] = {}
    for alarm in active_alarms:
        alarms_by_config.setdefault(alarm.config_id, []).append(alarm)

    configs = AlarmConfig.objects.in_bulk(alarms_by_config.keys())

    for config_id, alarms in alarms_by_config.items():
        config = configs[config_id]

        if not alarms[0].should_notify():
            continue

        subs = AlarmSubscription.objects.filter(
            alarm_config_id=config_id,
            email_enabled=True
        ).select_related("user")

        recipients = [s.user.email for s in subs if s.user.email]

        #TODO async job
        print(f"Notify {recipients}: {config.message}")

        config.last_notified = timezone.now()
        config.save(update_fields=["last_notified"])