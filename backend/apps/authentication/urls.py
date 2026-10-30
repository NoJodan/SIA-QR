from django.urls import path
from apps.authentication.views import (
    AdminStudentListView,
    admin_clear_users,
    admin_login_view,
    csrf_view,
    logout_view,
    me,
    professors_whitelist,
)

app_name = "authentication"

urlpatterns = [
    path("csrf/", csrf_view, name="csrf"),
    path("admin/login/", admin_login_view, name="admin-login"),
    path("me/", me, name="me"),
    path("logout/", logout_view, name="logout"),
    path("professors-whitelist/", professors_whitelist, name="professors-whitelist"),
    path("admin/students/", AdminStudentListView.as_view(), name="admin-students"),
    path("admin/clear-users/", admin_clear_users, name="admin-clear-users"),
]
