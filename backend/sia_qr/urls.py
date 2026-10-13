from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    # Las URLs propias van primero: allauth cuelga sus account urls de la raiz y
    # su "logout/" (account_logout) sombrearia el nuestro.
    path("api/auth/", include("apps.authentication.urls")),
    path("api/auth/", include("allauth.urls")),
    path("api/academic/", include("apps.academic.urls")),
    path("api/attendance/", include("apps.attendance.urls")),
]
