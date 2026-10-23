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

    def test_expired_no_rotate_within_window(self):
        # QR único: expirado en ventana => outcome expired, sin S2.
        _, _, group = _make_prof_group(email="p4@ut.edu.co")
        clase = _make_class(group, start_delta_min=-30)
        first = ensure_current_session(clase)
        old_id = first["session"].id
        # Simula expiración del TTL sin salir de la ventana de clase.
        sess = AttendanceSession.objects.get(pk=old_id)
        sess.expires_at = timezone.now() - timedelta(seconds=1)
        sess.save(update_fields=["expires_at"])
        out = ensure_current_session(clase)
        self.assertEqual(out["outcome"], "expired")
        self.assertEqual(out["reason"], "qr_expired")
        self.assertEqual(out["session_id"], str(old_id))
        self.assertIsNotNone(out["expires_at"])
        # Sin S2: solo 1 sesión total, 0 activas.
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )
        self.assertEqual(
            AttendanceSession.objects.filter(
                scheduled_class=clase, is_active=True
            ).count(),
            0,
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
    """QR único (deprecated): rotación deshabilitada, nunca 201."""

    def _live_class(self, email="r1@ut.edu.co"):
        user, _, group = _make_prof_group(email=email)
        clase = _make_class(group, start_delta_min=-1)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        return user, group, clase, client, url

    def test_reuse_same_session_then_rotate_blocked(self):
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

        # Segundo dispositivo: rotación deshabilitada (410, nunca 201).
        rot = client.post(url + "rotate/", {}, format="json")
        self.assertEqual(rot.status_code, 410)
        self.assertEqual(rot["Cache-Control"], "no-store")
        self.assertEqual(rot.data["reason"], "rotation_disabled")
        # Sin S2: sigue la misma sesión total, sin duplicar.
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )

    def test_expired_no_rotate_returns_410(self):
        # QR único expirado: GET 410 qr_expired, 0 activas, sin S2.
        _, _, clase, client, url = self._live_class(email="r2@ut.edu.co")
        first = client.get(url)
        old_id = first.data["session_id"]
        sess = AttendanceSession.objects.get(pk=old_id)
        sess.expires_at = timezone.now() - timedelta(seconds=1)
        sess.save(update_fields=["expires_at"])
        nxt = client.get(url)
        self.assertEqual(nxt.status_code, 410)
        self.assertEqual(nxt.data["state"], "expired")
        self.assertEqual(nxt.data["reason"], "qr_expired")
        self.assertEqual(nxt.data["session_id"], str(old_id))
        self.assertIsNotNone(nxt.data["expires_at"])
        self.assertEqual(nxt["Cache-Control"], "no-store")
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )
        self.assertEqual(
            AttendanceSession.objects.filter(
                scheduled_class=clase, is_active=True
            ).count(),
            0,
        )

    def test_rotate_in_window_returns_410_rotation_disabled(self):
        _, _, _, client, url = self._live_class(email="r6@ut.edu.co")
        first = client.get(url)
        self.assertEqual(first.status_code, 200)
        rot = client.post(url + "rotate/", {}, format="json")
        self.assertEqual(rot.status_code, 410)
        self.assertEqual(rot.data["reason"], "rotation_disabled")
        self.assertEqual(rot["Cache-Control"], "no-store")

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


class SingleSessionCreateTests(TestCase):
    """QR único: A1 crea S1 una vez; la segunda es 410 rotation_disabled."""

    def test_a1_second_create_returns_410(self):
        user, _, group = _make_prof_group(email="a1@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1, status=ClassStatus.SCHEDULED)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/sessions/"
        first = client.post(url, {}, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertIsNotNone(first.data.get("attend_url"))
        second = client.post(url, {}, format="json")
        self.assertEqual(second.status_code, 410)
        self.assertEqual(second.data["reason"], "rotation_disabled")
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )

    def test_pending_to_live_single_session(self):
        # pending -> live crea S1 única; polls siguientes reusan sin duplicar.
        user, _, group = _make_prof_group(email="a2@ut.edu.co")
        clase = _make_class(group, start_delta_min=60)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        resp = client.get(url)
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 0
        )
        clase.start_time = timezone.now() - timedelta(minutes=1)
        clase.save(update_fields=["start_time"])
        live = client.get(url)
        self.assertEqual(live.status_code, 200)
        sid = live.data["session_id"]
        again = client.get(url)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data["session_id"], sid)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )

    def test_finished_after_end_completes(self):
        user, _, group = _make_prof_group(email="a3@ut.edu.co")
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
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.COMPLETED)


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


class GeofenceTests(TestCase):
    """Rango del salón (geocerca): solo presencial; se deriva del status."""

    COORDS = {"latitude": 4.0915, "longitude": -75.2315, "accuracy": 12.5}

    def _setup(self, email, modality="PRESENTIAL", status=ClassStatus.IN_PROGRESS):
        user, _, group = _make_prof_group(email=email)
        clase = _make_class(group, start_delta_min=-1, status=status)
        clase.modality = modality
        clase.save(update_fields=["modality"])
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/geofence/"
        return user, group, clase, client, url

    def test_fix_geofence_persists_and_activates(self):
        _, _, clase, client, url = self._setup("g1@ut.edu.co")
        resp = client.post(url, self.COORDS, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["geofence_active"])
        self.assertEqual(resp.data["geofence_radius_m"], 25)
        # Las coordenadas del salón NUNCA salen por API.
        self.assertNotIn("geofence_lat", resp.data)
        self.assertNotIn("geofence_lng", resp.data)
        clase.refresh_from_db()
        self.assertIsNotNone(clase.geofence_lat)
        self.assertIsNotNone(clase.geofence_lng)
        self.assertIsNotNone(clase.geofence_activated_at)
        self.assertTrue(clase.geofence_active)

    def test_geofence_is_idempotent_and_replaces(self):
        _, _, clase, client, url = self._setup("g2@ut.edu.co")
        client.post(url, self.COORDS, format="json")
        clase.refresh_from_db()
        first_lat = clase.geofence_lat
        segunda = dict(self.COORDS, latitude=4.5, longitude=-75.5)
        resp = client.post(url, segunda, format="json")
        self.assertEqual(resp.status_code, 200)
        clase.refresh_from_db()
        self.assertNotEqual(clase.geofence_lat, first_lat)
        self.assertTrue(clase.geofence_active)

    def test_virtual_class_rejects_geofence(self):
        _, _, clase, client, url = self._setup("g3@ut.edu.co", modality="VIRTUAL")
        resp = client.post(url, self.COORDS, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("presenciales", resp.data["error"])
        clase.refresh_from_db()
        self.assertIsNone(clase.geofence_lat)
        self.assertFalse(clase.geofence_active)

    def test_virtual_class_never_shows_active_flag(self):
        # Coordenadas residuales jamás activan el rango en una clase mediada.
        _, _, clase, client, url = self._setup("g4@ut.edu.co", modality="VIRTUAL")
        clase.geofence_lat = 4.09
        clase.geofence_lng = -75.23
        clase.save(update_fields=["geofence_lat", "geofence_lng"])
        resp = client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["geofence_active"])

    def test_completed_class_conflict(self):
        _, _, clase, client, url = self._setup("g5@ut.edu.co", status=ClassStatus.COMPLETED)
        resp = client.post(url, self.COORDS, format="json")
        self.assertEqual(resp.status_code, 409)
        clase.refresh_from_db()
        self.assertIsNone(clase.geofence_lat)

    def test_missing_coordinates_returns_400(self):
        _, _, clase, client, url = self._setup("g6@ut.edu.co")
        resp = client.post(url, {"latitude": None, "longitude": None}, format="json")
        self.assertEqual(resp.status_code, 400)
        clase.refresh_from_db()
        self.assertIsNone(clase.geofence_lat)

    def test_scheduled_class_without_window_is_allowed(self):
        # Programada aún SCHEDULED: el profesor puede fijar el rango antes de
        # la hora si así lo decide (el estado activo depende del status).
        _, _, clase, client, url = self._setup("g7@ut.edu.co", status=ClassStatus.SCHEDULED)
        resp = client.post(url, self.COORDS, format="json")
        self.assertEqual(resp.status_code, 200)
        clase.refresh_from_db()
        self.assertIsNotNone(clase.geofence_lat)
        self.assertFalse(clase.geofence_active)  # aún no inicia

    def test_geofence_turns_off_when_class_completes(self):
        # Se "apaga solo": sin cron, derivando del status al cerrar la clase.
        from apps.academic.services import _close_class

        _, _, clase, client, url = self._setup("g8@ut.edu.co")
        client.post(url, self.COORDS, format="json")
        clase.refresh_from_db()
        self.assertTrue(clase.geofence_active)
        _close_class(clase)
        clase.refresh_from_db()
        self.assertFalse(clase.geofence_active)

    def test_other_professor_404(self):
        _, _, clase, client, url = self._setup("g9@ut.edu.co")
        other_user, _, _ = _make_prof_group(email="g10@ut.edu.co")
        other = APIClient()
        other.force_login(other_user)
        self.assertEqual(other.get(url).status_code, 404)
        self.assertEqual(other.post(url, self.COORDS, format="json").status_code, 404)
        # Sin tocar la clase ajena.
        clase.refresh_from_db()
        self.assertIsNone(clase.geofence_lat)

    def test_student_403(self):
        _, _, clase, client, url = self._setup("g11@ut.edu.co")
        student = APIClient()
        student.force_login(_make_student(email="g-est@ut.edu.co"))
        self.assertEqual(student.get(url).status_code, 403)
        self.assertEqual(student.post(url, self.COORDS, format="json").status_code, 403)

    def test_anonymous_401(self):
        _, _, clase, client, url = self._setup("g12@ut.edu.co")
        anon = APIClient()
        self.assertIn(anon.get(url).status_code, (401, 403))
        self.assertIn(anon.post(url, self.COORDS, format="json").status_code, (401, 403))


class InstantClassGeofenceTests(TestCase):
    """B3 + geocerca: la instantánea presencial fija el rango automáticamente."""

    COORDS = {
        "geofence_latitude": 4.0915,
        "geofence_longitude": -75.2315,
        "geofence_accuracy": 9.0,
    }

    def _client(self, email):
        user, _, group = _make_prof_group(email=email)
        client = APIClient()
        client.force_login(user)
        return user, group, client

    def test_presential_instant_persists_geofence(self):
        _, group, client = self._client("i1@ut.edu.co")
        resp = client.post(
            f"/api/academic/groups/{group.id}/classes/instant/",
            {**self.COORDS, "modality": "PRESENTIAL"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.data["class"]["geofence_active"])
        clase = ScheduledClass.objects.get(pk=resp.data["class"]["id"])
        self.assertIsNotNone(clase.geofence_lat)
        self.assertIsNotNone(clase.geofence_activated_at)

    def test_virtual_instant_ignores_geofence(self):
        _, group, client = self._client("i2@ut.edu.co")
        resp = client.post(
            f"/api/academic/groups/{group.id}/classes/instant/",
            {**self.COORDS, "modality": "VIRTUAL"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["class"]["modality"], "VIRTUAL")
        self.assertFalse(resp.data["class"]["geofence_active"])
        clase = ScheduledClass.objects.get(pk=resp.data["class"]["id"])
        self.assertIsNone(clase.geofence_lat)
        self.assertIsNone(clase.geofence_lng)

    def test_presential_instant_without_gps_creates_without_range(self):
        # RNF-06: el GPS nunca impide dar clase; se crea sin rango.
        _, group, client = self._client("i3@ut.edu.co")
        resp = client.post(
            f"/api/academic/groups/{group.id}/classes/instant/",
            {"modality": "PRESENTIAL"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.data["class"]["geofence_active"])
        clase = ScheduledClass.objects.get(pk=resp.data["class"]["id"])
        self.assertIsNone(clase.geofence_lat)

    def test_invalid_modality_rejected(self):
        _, group, client = self._client("i4@ut.edu.co")
        resp = client.post(
            f"/api/academic/groups/{group.id}/classes/instant/",
            {"modality": "PRESENCIAL"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
