from django.urls import path
from apps.authentication.views import logout_view, me, professors_whitelist

app_name = "authentication"

urlpatterns = [
    path("me/", me, name="me"),
    path("logout/", logout_view, name="logout"),
    path("professors-whitelist/", professors_whitelist, name="professors-whitelist"),
]

