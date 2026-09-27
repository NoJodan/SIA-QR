import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework import generics, status
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.academic.models import AcademicGroup, ClassStatus, Course, ScheduledClass
from apps.academic.pagination import StandardResultsPagination
from apps.academic.permissions import IsProfessor
from apps.academic.serializers import (
    AcademicGroupSerializer,
    AcademicGroupWriteSerializer,
    ScheduledClassSerializer,
)
from apps.authentication.views import CsrfExemptSessionAuthentication, IsAdminUserRole

BOGOTA_TZ = ZoneInfo("America/Bogota")
_AUTH = [CsrfExemptSessionAuthentication]
_PERMS = [IsAuthenticated, IsProfessor]
_ADMIN_PERMS = [IsAuthenticated, IsAdminUserRole]


def current_term():
    now = datetime.now(BOGOTA_TZ)
    return f"{now.year}-{'1' if now.month <= 6 else '2'}"


def get_professor(user):
    from apps.authentication.models import Professor

    return get_object_or_404(Professor, user=user)


class MyGroupsListView(generics.ListCreateAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    filter_backends = [SearchFilter]
    search_fields = ["course__name"]
    pagination_class = StandardResultsPagination

    def get_serializer_class(self):
        if self.request.method == "POST":
            return AcademicGroupWriteSerializer
        return AcademicGroupSerializer

    def get_queryset(self):
        prof = getattr(self.request.user, "professor_profile", None)
        if prof is None:
            return AcademicGroup.objects.none()
        return (
            AcademicGroup.objects.filter(professor=prof)
            .select_related("course", "professor", "professor__user")
            .annotate(classes_count=Count("classes"))
            .order_by("course__code", "group_code")
        )

    def create(self, request, *args, **kwargs):
        ser = AcademicGroupWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        name = ser.validated_data["name"]
        with transaction.atomic():
            base = slugify(name)[:12].upper() or "CURSO"
            course = Course.objects.create(
                code=f"{base}{uuid.uuid4().hex[:6].upper()}",
                name=name,
            )
            group = AcademicGroup.objects.create(
                course=course,
                professor=get_professor(request.user),
                group_code="01",
                term_period=current_term(),
            )
        out = AcademicGroupSerializer(group).data
        out["classes_count"] = 0
        return Response(out, status=status.HTTP_201_CREATED)


class MyGroupDetailView(generics.RetrieveUpdateDestroyAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    lookup_url_kwarg = "group_id"

    def get_serializer_class(self):
        if self.request.method == "GET":
            return AcademicGroupSerializer
        return AcademicGroupWriteSerializer

    def get_object(self):
        prof = getattr(self.request.user, "professor_profile", None)
        return get_object_or_404(
            AcademicGroup.objects.select_related("course", "professor", "professor__user"),
            pk=self.kwargs["group_id"],
            professor=prof,
        )

    def update(self, request, *args, **kwargs):
        group = self.get_object()
        ser = AcademicGroupWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        group.course.name = ser.validated_data["name"]
        group.course.save(update_fields=["name"])
        # GET-serializado para respuesta consistente; PATCH/PUT solo renombran
        out = AcademicGroupSerializer(group).data
        out["classes_count"] = group.classes.count()
        return Response(out)

    def perform_destroy(self, instance):
        course = instance.course
        instance.delete()  # CASCADE a scheduled_classes
        if not AcademicGroup.objects.filter(course=course).exists():
            course.delete()


class ScheduledClassListCreateView(generics.ListCreateAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    serializer_class = ScheduledClassSerializer
    filter_backends = [SearchFilter]
    search_fields = ["title"]
    pagination_class = StandardResultsPagination

    def get_group(self):
        prof = getattr(self.request.user, "professor_profile", None)
        # 404 si el grupo no existe o pertenece a otro profesor
        return get_object_or_404(AcademicGroup, pk=self.kwargs["group_id"], professor=prof)

    def get_queryset(self):
        return ScheduledClass.objects.filter(group=self.get_group()).order_by("start_time")

    def perform_create(self, serializer):
        serializer.save(group=self.get_group(), status=ClassStatus.SCHEDULED)


class ScheduledClassDetailView(generics.RetrieveUpdateDestroyAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    serializer_class = ScheduledClassSerializer
    lookup_url_kwarg = "class_id"

    def get_group(self):
        prof = getattr(self.request.user, "professor_profile", None)
        return get_object_or_404(AcademicGroup, pk=self.kwargs["group_id"], professor=prof)

    def get_object(self):
        return get_object_or_404(ScheduledClass, pk=self.kwargs["class_id"], group=self.get_group())


# --- Vistas admin (solo lectura de cursos + edición de clases, sin post/delete) ---
class AdminGroupsListView(generics.ListAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = AcademicGroupSerializer
    filter_backends = [SearchFilter]
    search_fields = ["course__name"]
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        return (
            AcademicGroup.objects.all()
            .select_related("course", "professor", "professor__user")
            .annotate(classes_count=Count("classes"))
            .order_by("course__name")
        )


class AdminGroupDetailView(generics.RetrieveAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = AcademicGroupSerializer
    lookup_url_kwarg = "group_id"

    def get_object(self):
        return get_object_or_404(
            AcademicGroup.objects.select_related("course", "professor", "professor__user").annotate(
                classes_count=Count("classes")
            ),
            pk=self.kwargs["group_id"],
        )


class AdminClassListView(generics.ListAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = ScheduledClassSerializer
    filter_backends = [SearchFilter]
    search_fields = ["title"]
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        return ScheduledClass.objects.filter(group_id=self.kwargs["group_id"]).order_by("start_time")


class AdminClassUpdateView(generics.RetrieveUpdateAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = ScheduledClassSerializer
    lookup_url_kwarg = "class_id"
    http_method_names = ["get", "patch", "put", "head", "options"]

    def get_object(self):
        return get_object_or_404(
            ScheduledClass, pk=self.kwargs["class_id"], group_id=self.kwargs["group_id"]
        )
