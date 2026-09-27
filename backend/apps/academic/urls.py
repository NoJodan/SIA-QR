from django.urls import path

from apps.academic.views import (
    AdminClassListView,
    AdminClassUpdateView,
    AdminGroupDetailView,
    AdminGroupsListView,
    MyGroupDetailView,
    MyGroupsListView,
    ScheduledClassDetailView,
    ScheduledClassListCreateView,
)

app_name = "academic"

urlpatterns = [
    path("my-groups/", MyGroupsListView.as_view(), name="my-groups"),
    path("my-groups/<uuid:group_id>/", MyGroupDetailView.as_view(), name="my-group-detail"),
    path("groups/<uuid:group_id>/classes/", ScheduledClassListCreateView.as_view(), name="group-classes"),
    path(
        "groups/<uuid:group_id>/classes/<uuid:class_id>/",
        ScheduledClassDetailView.as_view(),
        name="group-class-detail",
    ),
    path("admin/groups/", AdminGroupsListView.as_view(), name="admin-groups"),
    path("admin/groups/<uuid:group_id>/", AdminGroupDetailView.as_view(), name="admin-group-detail"),
    path(
        "admin/groups/<uuid:group_id>/classes/",
        AdminClassListView.as_view(),
        name="admin-group-classes",
    ),
    path(
        "admin/groups/<uuid:group_id>/classes/<uuid:class_id>/",
        AdminClassUpdateView.as_view(),
        name="admin-group-class-detail",
    ),
]
