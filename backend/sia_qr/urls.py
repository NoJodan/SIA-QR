from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.authentication.urls")),
    path("api/academic/", include("apps.academic.urls")),
    path("api/attendance/", include("apps.attendance.urls")),
]