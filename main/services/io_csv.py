import csv
import uuid
import ast
from django.db import models, transaction
from django.utils.dateparse import parse_duration
from ..models import Tag, Device, AlarmConfig


class BaseCSVImporter:
    model: models.Model = None
    fields = []
    required_fields = []
    lookup_fields = []

    def __init__(self, file):
        self.file = file
        self.reader = csv.DictReader(self.file)

        missing = set(self.required_fields) - set(self.reader.fieldnames)
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

    def clean_row(self, row: dict):
        """ Override for custom cleaning """
        return {k: row[k] for k in self.fields if k in row}

    def save_row(self, cleaned_row: dict):
        lookup = {f: cleaned_row[f] for f in self.lookup_fields}
        return self.model.objects.update_or_create(**lookup, defaults=cleaned_row)

    def run(self):
        with transaction.atomic():
            for row in self.reader:
                cleaned = self.clean_row(row)
                self.save_row(cleaned)

    
class DeviceImporter(BaseCSVImporter):
    model = Device
    fields = ["alias", "ip_address", "port", "protocol", "word_order", "is_active"]
    required_fields = ["alias"]
    lookup_fields = ["alias"]
    

class TagImporter(BaseCSVImporter):
    model = Tag
    fields = ["device", "unit_id", "alias", "description", "channel", "data_type", "address", "bit_index", "is_active", "restricted_write", "history_interval", "history_retention", "external_id"]
    required_fields = ["device", "alias", "channel", "data_type", "address"]
    lookup_fields = ["external_id"] #TODO?

    def clean_row(self, row: dict):
        row["device"] = Device.objects.get(alias=row["device"]) #TODO just use alias as PK?

        row["address"] = int(row["address"])

        if "unit_id" in row:
            row["unit_id"] = int(row["unit_id"])

        if "bit_index" in row:
            row["bit_index"] = int(row["bit_index"])

        if "history_interval" in row:
            row["history_interval"] = parse_duration(row["history_interval"]) 

        if "history_retention" in row:
            row["history_retention"] = parse_duration(row["history_retention"]) 

        return super().clean_row(row)
    

class AlarmConfigImporter(BaseCSVImporter):
    model = AlarmConfig
    fields = ["tag", "trigger_value", "operator", "enabled", "alias", "message", "threat_level", "notification_cooldown"]
    required_fields = ["tag", "trigger_value", "alias", "threat_level"]
    lookup_fields = ["tag", "alias"] #TODO?

    def clean_row(self, row: dict):
        row["tag"] = Tag.objects.get(external_id=row["tag"]) #TODO just use as PK?

        row["trigger_value"] = ast.literal_eval(row["trigger_value"])

        if "notification_cooldown" in row:
            row["notification_cooldown"] = parse_duration(row["notification_cooldown"])

        return super().clean_row(row)
    

class BaseCSVExporter:
    model: models.Model = None
    fields = []

    def __init__(self, file, queryset=None):
        self.file = file
        self.writer = csv.DictWriter(self.file, fieldnames=self.fields)
        self.queryset = queryset or self.get_queryset()

    def get_queryset(self):
        return self.model.objects.all()

    def serialize_row(self, obj):
        """Override for custom serialization"""
        return {field: getattr(obj, field) for field in self.fields}

    def run(self):
        self.writer.writeheader()
        for obj in self.queryset:
            row = self.serialize_row(obj)
            self.writer.writerow(row)


class DeviceExporter(BaseCSVExporter):
    model = Device
    fields = ["alias", "ip_address", "port", "protocol", "word_order", "is_active"]


class TagExporter(BaseCSVExporter):
    model = Tag
    fields = ["device", "alias", "description", "channel", "data_type", "address", "bit_index", "is_active", "restricted_write", "history_interval", "history_retention", "external_id"]

    def serialize_row(self, obj):
        row = super().serialize_row(obj)
        row["device"] = row["device"].alias
        return row


class AlarmConfigExporter(BaseCSVExporter):
    model = AlarmConfig
    fields = ["tag", "trigger_value", "operator", "enabled", "alias", "message", "threat_level", "notification_cooldown"]

    def serialize_row(self, obj):
        row = super().serialize_row(obj)
        row["tag"] = row["tag"].external_id
        return row