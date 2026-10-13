from django.contrib import admin

from apps.attendance.models import Attendance, AttendanceSession, SystemConfig


@admin.register(SystemConfig)
class SystemConfigAdmin(admin.ModelAdmin):
    list_display = ["config_key", "config_value", "updated_at"]
    search_fields = ["config_key"]


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ["id", "scheduled_class", "is_active", "expires_at", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["token_hash"]


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ["id", "session", "student", "registered_at", "ip_address"]
    search_fields = ["student__student_code", "student__document_number"]
