"""Tests del QR automático (current-session idempotente + auto-rotación)."""

import threading
from datetime import datetime, timedelta

from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.academic.models import (
    AcademicGroup,
    ClassStatus,
    Course,
    ScheduledClass,
)
from apps.academic.services import (
    class_window,
    ensure_current_session,
    get_early_grace_seconds,
    get_valid_session,
    should_auto_start,
)
from apps.attendance.models import AttendanceSession, SystemConfig
from apps.authentication.models import Professor, Student, User


def _make_prof_group(email="auto@ut.edu.co"):
    user = User.objects.create_user(
        email=email, google_sub=f"sub-{email}", role="ROLE_PROFESSOR"
    )
    prof = Professor.objects.create(
        user=user,
        employee_code=f"AUTO-{email[:3].upper()}",
        first_name="Auto",
        last_name="Prof",
    )
    course = Course.objects.create(code=f"A-{email[:3].upper()}", name="Curso Auto")
    group = AcademicGroup.objects.create(
        course=course, professor=prof, group_code="01", term_period="2026-1"
    )
    return user, prof, group


def _make_class(group, start_delta_min=-1, duration=60, status=ClassStatus.SCHEDULED):
    return ScheduledClass.objects.create(
        group=group,
        title="Clase Auto",
        start_time=timezone.now() + timedelta(minutes=start_delta_min),
        duration_minutes=duration,
        qr_duration_minutes=10,
        modality="PRESENTIAL",
        status=status,
    )


class ClassWindowTests(TestCase):
    def test_window_and_auto_start(self):
        _, _, group = _make_prof_group()
        clase = _make_class(group, start_delta_min=-1)
        start, end = class_window(clase)
        self.assertEqual(end - start, timedelta(minutes=60))
        self.assertTrue(should_auto_start(clase))

    def test_no_auto_start_before_grace(self):
        _, _, group = _make_prof_group(email="auto2@ut.edu.co")
        clase = _make_class(group, start_delta_min=5)
        self.assertFalse(should_auto_start(clase))

    def test_auto_start_within_early_grace(self):
        _, _, group = _make_prof_group(email="auto3@ut.edu.co")
        # Inicia en 20s: dentro de la gracia previa de 30s.
        clase = ScheduledClass.objects.create(
            group=group,
            title="Clase Gracia",
            start_time=timezone.now() + timedelta(seconds=20),
            duration_minutes=60,
            modality="PRESENTIAL",
            status=ClassStatus.SCHEDULED,
        )
        self.assertTrue(should_auto_start(clase))


class EnsureCurrentSessionTests(TestCase):
    def test_pending_before_window_creates_nothing(self):
        _, _, group = _make_prof_group(email="p1@ut.edu.co")
        clase = _make_class(group, start_delta_min=5)
        out = ensure_current_session(clase)
        self.assertEqual(out["outcome"], "pending")
        self.assertGreater(out["starts_in_s"], 0)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 0
        )

    def test_live_creates_and_flips_to_in_progress(self):
        _, _, group = _make_prof_group(email="p2@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        out = ensure_current_session(clase)
        self.assertEqual(out["outcome"], "live")
        self.assertTrue(out["created"])
        self.assertIn("attend?token=", out["result"]["attend_url"])
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.IN_PROGRESS)

    def test_idempotent_no_duplicates(self):
        _, _, group = _make_prof_group(email="p3@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        first = ensure_current_session(clase)
        second = ensure_current_session(clase)
        self.assertEqual(first["session"].id, second["session"].id)
        self.assertFalse(second["created"])
        self.assertIsNone(second["result"])
        self.assertEqual(
            AttendanceSession.objects.filter(
                scheduled_class=clase, is_active=True
            ).count(),
            1,
        )

    def test_expired_rotates_within_window(self):
        _, _, group = _make_prof_group(email="p4@ut.edu.co")
        clase = _make_class(group, start_delta_min=-30)
        first = ensure_current_session(clase)
        old_id = first["session"].id
        # Simula expiración del TTL sin salir de la ventana de clase.
        sess = AttendanceSession.objects.get(pk=old_id)
        sess.expires_at = timezone.now() - timedelta(seconds=1)
        sess.save(update_fields=["expires_at"])
        out = ensure_current_session(clase)
        self.assertEqual(out["outcome"], "live")
        self.assertTrue(out["created"])
        self.assertNotEqual(out["session"].id, old_id)
        sess.refresh_from_db()
        self.assertFalse(sess.is_active)
        self.assertEqual(
            AttendanceSession.objects.filter(
                scheduled_class=clase, is_active=True
            ).count(),
            1,
        )

    def test_no_generate_after_end_lazy_completes(self):
        _, _, group = _make_prof_group(email="p5@ut.edu.co")
        clase = _make_class(
            group, start_delta_min=-120, duration=60, status=ClassStatus.IN_PROGRESS
        )
        out = ensure_current_session(clase)
        self.assertEqual(out["outcome"], "finished")
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.COMPLETED)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 0
        )

    def test_no_generate_on_closed_class(self):
        _, _, group = _make_prof_group(email="p6@ut.edu.co")
        clase = _make_class(
            group, start_delta_min=-1, status=ClassStatus.COMPLETED
        )
        out = ensure_current_session(clase)
        self.assertEqual(out["outcome"], "finished")
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 0
        )

    def test_get_valid_session_ignores_expired(self):
        _, _, group = _make_prof_group(email="p7@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        out = ensure_current_session(clase)
        sess = out["session"]
        sess.expires_at = timezone.now() - timedelta(seconds=1)
        sess.save(update_fields=["expires_at"])
        self.assertIsNone(get_valid_session(clase))


class CurrentSessionViewTests(TestCase):
    def test_flow_pending_to_live_same_session(self):
        user, _, group = _make_prof_group(email="v1@ut.edu.co")
        clase = _make_class(group, start_delta_min=5)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"

        resp = client.get(url)
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.data["state"], "pending")
        self.assertIn("starts_in_s", resp.data)
        self.assertEqual(resp["Cache-Control"], "no-store")

        # Avanza el inicio a la ventana: el mismo endpoint crea el QR.
        clase.start_time = timezone.now() - timedelta(minutes=1)
        clase.save(update_fields=["start_time"])
        resp = client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(resp.data["attend_url"])
        sid = resp.data["session_id"]

        # Segundo poll: reusado (mismo id, sin attend_url, sin duplicar).
        resp2 = client.get(url)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data["session_id"], sid)
        self.assertIsNone(resp2.data["attend_url"])
        self.assertEqual(
            AttendanceSession.objects.filter(
                scheduled_class=clase, is_active=True
            ).count(),
            1,
        )

    def test_finished_after_end(self):
        user, _, group = _make_prof_group(email="v2@ut.edu.co")
        clase = _make_class(
            group, start_delta_min=-120, duration=60, status=ClassStatus.IN_PROGRESS
        )
        client = APIClient()
        client.force_login(user)
        resp = client.get(
            f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        )
        self.assertEqual(resp.status_code, 410)
        self.assertEqual(resp.data["state"], "finished")

    def test_other_professor_gets_404(self):
        _, _, group = _make_prof_group(email="v3@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        other, _, _ = _make_prof_group(email="other@ut.edu.co")
        client = APIClient()
        client.force_login(other)
        resp = client.get(
            f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        )
        self.assertEqual(resp.status_code, 404)

    def test_anonymous_gets_401(self):
        _, _, group = _make_prof_group(email="v4@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        resp = APIClient().get(
            f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        )
        self.assertEqual(resp.status_code, 401)


def _make_student(email="est@ut.edu.co"):
    user = User.objects.create_user(
        email=email, google_sub=f"sub-{email}", role="ROLE_STUDENT"
    )
    Student.objects.create(
        user=user, student_code=f"EST-{email[:3].upper()}", document_number=f"DOC-{email[:3].upper()}",
        first_name="Est", last_name="Uno",
    )
    return user


class NaiveDatetimeTests(TestCase):
    """m1: datetimes naive no deben romper la ventana (antes TypeError->500)."""

    def test_class_window_accepts_naive_start(self):
        _, _, group = _make_prof_group(email="n1@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        # Fuerza un start naive (como llegaría de un payload sin tz).
        naive = datetime.now().replace(tzinfo=None) - timedelta(minutes=1)
        clase.start_time = naive
        start, end = class_window(clase)
        self.assertTrue(timezone.is_aware(start))
        self.assertEqual(end - start, timedelta(minutes=60))
        self.assertTrue(should_auto_start(clase))

    def test_should_auto_start_accepts_naive_now(self):
        _, _, group = _make_prof_group(email="n2@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        self.assertTrue(should_auto_start(clase, now=datetime.now().replace(tzinfo=None)))

    def test_serializer_accepts_naive_start_time(self):
        from apps.academic.serializers import ScheduledClassSerializer

        ser = ScheduledClassSerializer(
            data={
                "title": "Naive",
                "start_time": "2099-01-01T10:00:00",  # sin offset -> naive
                "duration_minutes": 60,
                "modality": "PRESENTIAL",
            }
        )
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertTrue(timezone.is_aware(ser.validated_data["start_time"]))


class EarlyGraceConfigTests(TestCase):
    """m2: EARLY_QR_GRACE_SECONDS configurable vía SystemConfig (0-300)."""

    def test_default_grace_is_30(self):
        self.assertEqual(get_early_grace_seconds(), 30)

    def test_system_config_overrides_grace(self):
        SystemConfig.objects.create(config_key="EARLY_QR_GRACE_SECONDS", config_value="120")
        self.assertEqual(get_early_grace_seconds(), 120)
        _, _, group = _make_prof_group(email="g1@ut.edu.co")
        clase = _make_class(group, start_delta_min=1)  # inicia en 60s
        self.assertTrue(should_auto_start(clase))

    def test_invalid_config_falls_back(self):
        SystemConfig.objects.create(config_key="EARLY_QR_GRACE_SECONDS", config_value="999")
        self.assertEqual(get_early_grace_seconds(), 30)
        SystemConfig.objects.filter(config_key="EARLY_QR_GRACE_SECONDS").update(
            config_value="abc"
        )
        self.assertEqual(get_early_grace_seconds(), 30)


class RotateViewTests(TestCase):
    """M1 (opción b): reuso mismo dispositivo muestra QR; segundo
    dispositivo rota; expirado no reusa el token anterior."""

    def _live_class(self, email="r1@ut.edu.co"):
        user, _, group = _make_prof_group(email=email)
        clase = _make_class(group, start_delta_min=-1)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        return user, group, clase, client, url

    def test_reuse_same_session_then_rotate_new_device(self):
        _, group, clase, client, url = self._live_class()
        first = client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertIsNotNone(first.data["attend_url"])
        self.assertEqual(first["Cache-Control"], "no-store")
        sid = first.data["session_id"]

        # Reuso (mismo dispositivo tras reload con caché): mismo id, sin QR.
        second = client.get(url)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data["session_id"], sid)
        self.assertIsNone(second.data["attend_url"])
        self.assertEqual(second["Cache-Control"], "no-store")

        # Segundo dispositivo: rota y obtiene QR mostrable nuevo.
        rot = client.post(url + "rotate/", {}, format="json")
        self.assertEqual(rot.status_code, 201)
        self.assertEqual(rot["Cache-Control"], "no-store")
        self.assertIsNotNone(rot.data["attend_url"])
        self.assertNotEqual(rot.data["session_id"], sid)
        self.assertTrue(rot.data["rotated"])
        old = AttendanceSession.objects.get(pk=sid)
        self.assertFalse(old.is_active)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase, is_active=True).count(), 1
        )

    def test_expired_session_is_not_reused(self):
        _, _, clase, client, url = self._live_class(email="r2@ut.edu.co")
        first = client.get(url)
        old_id = first.data["session_id"]
        sess = AttendanceSession.objects.get(pk=old_id)
        sess.expires_at = timezone.now() - timedelta(seconds=1)
        sess.save(update_fields=["expires_at"])
        # Expirado: el GET auto-rota (nuevo QR), nunca reusa el token viejo.
        nxt = client.get(url)
        self.assertEqual(nxt.status_code, 200)
        self.assertNotEqual(nxt.data["session_id"], old_id)
        self.assertIsNotNone(nxt.data["attend_url"])
        sess.refresh_from_db()
        self.assertFalse(sess.is_active)

    def test_rotate_finished_returns_410_no_store(self):
        user, _, group = _make_prof_group(email="r3@ut.edu.co")
        clase = _make_class(group, start_delta_min=-120, duration=60, status=ClassStatus.IN_PROGRESS)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        resp = client.get(url)
        self.assertEqual(resp.status_code, 410)
        self.assertEqual(resp["Cache-Control"], "no-store")
        rot = client.post(url + "rotate/", {}, format="json")
        self.assertEqual(rot.status_code, 410)
        self.assertEqual(rot["Cache-Control"], "no-store")

    def test_rotate_pending_returns_202(self):
        _, group, _, client, _url = self._live_class(email="r4@ut.edu.co")
        # Clase futura del mismo grupo: pending, sin rotar.
        futura = _make_class(group, start_delta_min=60)
        furl = f"/api/academic/groups/{group.id}/classes/{futura.id}/current-session/rotate/"
        rot = client.post(furl, {}, format="json")
        self.assertEqual(rot.status_code, 202)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=futura, is_active=True).count(), 0
        )

    def test_student_gets_403(self):
        _, _, group = _make_prof_group(email="r5@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        student = _make_student(email="est403@ut.edu.co")
        client = APIClient()
        client.force_login(student)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        self.assertEqual(client.get(url).status_code, 403)
        self.assertEqual(client.post(url + "rotate/", {}, format="json").status_code, 403)


class SingleActiveConcurrencyTests(TransactionTestCase):
    """m5: carrera de hilos sobre generate_session mantiene single-active."""

    def test_concurrent_generate_keeps_single_active(self):
        from django.db import connections

        from apps.attendance.services import generate_session

        _, _, group = _make_prof_group(email="cc@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        errors = []

        def worker():
            try:
                generate_session(clase)
            except Exception as exc:  # pragma: no cover - solo registro
                errors.append(exc)
            finally:
                # Cierra las conexiones del hilo para no bloquear el
                # teardown de la DB de pruebas.
                connections.close_all()

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase, is_active=True).count(), 1
        )
        self.assertEqual(errors, [])
