from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.authentication.models import AuthorizedProfessorEmail, Professor, Student, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "role", "is_active", "is_staff"]
    list_filter = ["role", "is_active"]
    search_fields = ["email"]
    ordering = ["email"]
    fieldsets = (
        (None, {"fields": ("email", "google_sub", "role")}),
        ("Permisos", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {"fields": ("email", "google_sub", "role", "is_staff", "is_superuser")}),
    )


@admin.register(Professor)
class ProfessorAdmin(admin.ModelAdmin):
    list_display = ["employee_code", "first_name", "last_name", "department"]
    search_fields = ["employee_code", "first_name", "last_name"]


@admin.register(AuthorizedProfessorEmail)
class AuthorizedProfessorEmailAdmin(admin.ModelAdmin):
    list_display = ["email", "created_at"]
    search_fields = ["email"]


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ["student_code", "document_number", "first_name", "last_name", "created_at"]
    search_fields = ["student_code", "document_number", "first_name", "last_name"]
