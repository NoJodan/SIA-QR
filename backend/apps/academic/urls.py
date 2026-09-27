from django.urls import path

from apps.academic.views import (
    AdminClassListView,
    AdminClassUpdateView,
    AdminGroupDetailView,
    AdminGroupsListView,
    ClassCurrentSessionRotateView,
    ClassCurrentSessionView,
    ClassSessionCreateView,
    InstantClassCreateView,
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
    # A1: generar sesión QR sobre una clase (profesor dueño, single-active).
    # Se mantiene como fallback interno; la UI usa current-session (automático).
    path(
        "groups/<uuid:group_id>/classes/<uuid:class_id>/sessions/",
        ClassSessionCreateView.as_view(),
        name="group-class-sessions",
    ),
    # QR automático: sesión vigente idempotente (pending/live/finished).
    path(
        "groups/<uuid:group_id>/classes/<uuid:class_id>/current-session/",
        ClassCurrentSessionView.as_view(),
        name="group-class-current-session",
    ),
    # M1 (opción b): rotar el QR para mostrarlo en este dispositivo.
    path(
        "groups/<uuid:group_id>/classes/<uuid:class_id>/current-session/rotate/",
        ClassCurrentSessionRotateView.as_view(),
        name="group-class-current-session-rotate",
    ),
    # B3: clase instantánea IN_PROGRESS + sesión QR atómica.
    path(
        "groups/<uuid:group_id>/classes/instant/",
        InstantClassCreateView.as_view(),
        name="group-classes-instant",
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
