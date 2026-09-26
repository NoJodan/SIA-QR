import uuid
from django.db import models


class SystemConfig(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    config_key = models.CharField(max_length=100, unique=True)
    config_value = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_configs"

    def __str__(self):
        return f"{self.config_key}: {self.config_value}"
