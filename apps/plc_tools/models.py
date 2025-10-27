from django.db import models

class PLCRegister(models.Model):
    plc_name = models.CharField(max_length=100, default="MainPLC")
    address = models.IntegerField()
    value = models.IntegerField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.plc_name} - Reg {self.address}: {self.value} at {self.timestamp:%H:%M:%S}"
