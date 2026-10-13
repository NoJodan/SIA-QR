from django.contrib import admin

from apps.academic.models import AcademicGroup, Course, ScheduledClass


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ["code", "name"]
    search_fields = ["code", "name"]


@admin.register(AcademicGroup)
class AcademicGroupAdmin(admin.ModelAdmin):
    list_display = ["course", "group_code", "term_period", "professor"]
    list_filter = ["term_period"]


@admin.register(ScheduledClass)
class ScheduledClassAdmin(admin.ModelAdmin):
    list_display = ["title", "group", "start_time", "modality", "status"]
    list_filter = ["status", "modality"]
