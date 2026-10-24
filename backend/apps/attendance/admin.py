from django.contrib import admin

from apps.attendance.models import Attendance, AttendanceSession, AuditLog, SystemConfig


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


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "event_type", "actor", "resource", "ip_address"]
    list_filter = ["event_type", "created_at"]
    search_fields = ["resource", "actor__email"]
    readonly_fields = [field.name for field in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
