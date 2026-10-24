from django.urls import path

from apps.academic.views import (
    AdminClassListView,
    AdminClassUpdateView,
    AdminGroupDetailView,
    AdminGroupsListView,
    ClassCurrentSessionRotateView,
    ClassCurrentSessionView,
    ClassGeofenceView,
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
    # Rango del salón (solo presencial): fija/reubica la referencia GPS del
    # profesor. Se apaga solo al finalizar la clase (sin cron).
    path(
        "groups/<uuid:group_id>/classes/<uuid:class_id>/geofence/",
        ClassGeofenceView.as_view(),
        name="group-class-geofence",
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
