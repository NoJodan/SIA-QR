from django.contrib import admin

from apps.attendance.models import SystemConfig


@admin.register(SystemConfig)
class SystemConfigAdmin(admin.ModelAdmin):
    list_display = ["config_key", "config_value", "updated_at"]
    search_fields = ["config_key"]
