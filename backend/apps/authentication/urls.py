from django.urls import path
from apps.authentication.views import csrf_view, logout_view, me, professors_whitelist

app_name = "authentication"

urlpatterns = [
    path("csrf/", csrf_view, name="csrf"),
    path("me/", me, name="me"),
    path("logout/", logout_view, name="logout"),
    path("professors-whitelist/", professors_whitelist, name="professors-whitelist"),
]

