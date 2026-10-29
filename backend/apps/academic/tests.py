"""Tests del QR automático (current-session idempotente + auto-rotación)."""

import hashlib
import threading
import time
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
from apps.attendance.models import Attendance, AttendanceSession, SystemConfig
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

    def test_second_ensure_keeps_first_token_alive(self):
        # Carrera de dos polls: el segundo reusa en vez de revocar el token
        # que el primero ya entregó.
        _, _, group = _make_prof_group(email="p8@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        first = ensure_current_session(clase)
        raw = first["result"]["token_raw"]

        second = ensure_current_session(clase)
        self.assertFalse(second["created"])
        self.assertEqual(second["session"].id, first["session"].id)

        student = _make_student(email="p8est@ut.edu.co")
        client = APIClient()
        client.force_login(student)
        resp = client.get("/api/attendance/resolve/", {"token": raw})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["session_id"], str(first["session"].id))


class EnsureCurrentSessionConcurrencyTests(TransactionTestCase):
    """Dos polls concurrentes: el lock de la clase deja una sola S1."""

    def test_concurrent_ensure_creates_one_session(self):
        from django.db import connections, transaction

        _, _, group = _make_prof_group(email="ec@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        results = []
        errors = []
        barrier = threading.Barrier(2)

        def worker():
            try:
                barrier.wait(timeout=10)
                results.append(ensure_current_session(clase))
            except Exception as exc:  # pragma: no cover - solo registro
                errors.append(exc)
            finally:
                connections.close_all()

        # El lock de la clase retiene a ambos hilos hasta soltarlo: garantiza
        # que la carrera ocurra dentro de ensure_current_session.
        with transaction.atomic():
            ScheduledClass.objects.select_for_update().get(pk=clase.pk)
            threads = [threading.Thread(target=worker) for _ in range(2)]
            for t in threads:
                t.start()
            time.sleep(0.5)
        for t in threads:
            t.join(timeout=60)

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )
        self.assertEqual(len({str(r["session"].id) for r in results}), 1)
        created = [r for r in results if r["created"]]
        self.assertEqual(len(created), 1)

        # El token crudo del que creó la sesión sigue resolviendo después.
        student = _make_student(email="ecest@ut.edu.co")
        client = APIClient()
        client.force_login(student)
        resp = client.get(
            "/api/attendance/resolve/", {"token": created[0]["result"]["token_raw"]}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["session_id"], str(created[0]["session"].id))


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
    """Rotación manual: genera un QR nuevo y revoca el anterior."""

    def _live_class(self, email="r1@ut.edu.co"):
        user, _, group = _make_prof_group(email=email)
        clase = _make_class(group, start_delta_min=-1)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        return user, group, clase, client, url

    def test_reuse_then_rotate_revokes_old_token(self):
        _, group, clase, client, url = self._live_class()
        first = client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertIsNotNone(first.data["attend_url"])
        self.assertEqual(first["Cache-Control"], "no-store")
        sid = first.data["session_id"]
        old_raw = first.data["token_raw"]

        # Reuso (mismo dispositivo tras reload con caché): mismo id, sin QR.
        second = client.get(url)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data["session_id"], sid)
        self.assertIsNone(second.data["attend_url"])
        self.assertEqual(second["Cache-Control"], "no-store")

        # Rotación manual: QR nuevo con el mismo shape que el inicial.
        rot = client.post(url + "rotate/", {}, format="json")
        self.assertEqual(rot.status_code, 201)
        self.assertEqual(rot["Cache-Control"], "no-store")
        self.assertNotEqual(rot.data["session_id"], sid)
        self.assertIn("attend?token=", rot.data["attend_url"])
        self.assertEqual(rot.data["ttl_minutes"], 10)
        self.assertIsNotNone(rot.data["expires_at"])

        old = AttendanceSession.objects.get(pk=sid)
        self.assertFalse(old.is_active)

        student = _make_student(email="rest@ut.edu.co")
        student_client = APIClient()
        student_client.force_login(student)
        old_resp = student_client.get("/api/attendance/resolve/", {"token": old_raw})
        self.assertEqual(old_resp.status_code, 410)
        new_resp = student_client.get(
            "/api/attendance/resolve/", {"token": rot.data["token_raw"]}
        )
        self.assertEqual(new_resp.status_code, 200)
        self.assertEqual(new_resp.data["session_id"], rot.data["session_id"])
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 2
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

    def test_rotate_in_window_creates_session(self):
        _, _, clase, client, url = self._live_class(email="r6@ut.edu.co")
        rot = client.post(url + "rotate/", {}, format="json")
        self.assertEqual(rot.status_code, 201)
        self.assertEqual(rot["Cache-Control"], "no-store")
        self.assertIsNotNone(rot.data["token_raw"])
        self.assertEqual(
            AttendanceSession.objects.filter(
                scheduled_class=clase, is_active=True
            ).count(),
            1,
        )

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


class RotateConcurrencyTests(TransactionTestCase):
    """Dos rotaciones simultáneas: nunca dos 201 con tokens distintos."""

    def test_concurrent_rotate_keeps_one_live_token(self):
        from django.db import connections, transaction

        user, _, group = _make_prof_group(email="rc@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        url = (
            f"/api/academic/groups/{group.id}/classes/{clase.id}"
            "/current-session/rotate/"
        )
        results = []
        errors = []
        barrier = threading.Barrier(2)

        def worker():
            try:
                client = APIClient()
                client.force_login(user)
                barrier.wait(timeout=10)
                results.append(client.post(url, {}, format="json"))
            except Exception as exc:  # pragma: no cover - solo registro
                errors.append(exc)
            finally:
                connections.close_all()

        # El lock de la clase retiene a ambos POST hasta soltarlo: garantiza
        # que las dos rotaciones se solapen.
        with transaction.atomic():
            ScheduledClass.objects.select_for_update().get(pk=clase.pk)
            threads = [threading.Thread(target=worker) for _ in range(2)]
            for t in threads:
                t.start()
            time.sleep(0.5)
        for t in threads:
            t.join(timeout=60)

        self.assertEqual(errors, [])
        codes = sorted(r.status_code for r in results)
        # Una rotación gana; la otra no revoca su token (409 reintentable).
        self.assertEqual(codes, [201, 409])
        winner = next(r for r in results if r.status_code == 201)
        live = AttendanceSession.objects.get(scheduled_class=clase, is_active=True)
        self.assertEqual(str(live.id), winner.data["session_id"])
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase).count(), 1
        )


class SingleSessionCreateTests(TestCase):
    """QR único: current-session crea S1 una vez y luego reusa sin duplicar."""

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

    def test_finished_keeps_last_session_for_attendances(self):
        # La clase terminada devuelve la última sesión: su lista no se pierde.
        user, _, group = _make_prof_group(email="a4@ut.edu.co")
        clase = _make_class(group, start_delta_min=-1)
        client = APIClient()
        client.force_login(user)
        url = f"/api/academic/groups/{group.id}/classes/{clase.id}/current-session/"
        live = client.get(url)
        self.assertEqual(live.status_code, 200)
        sid = live.data["session_id"]

        estudiante = _make_student(email="a4est@ut.edu.co")
        Attendance.objects.create(
            session_id=sid,
            student=estudiante.student_profile,
            ip_address="127.0.0.1",
            user_agent="test",
        )
        list_url = f"/api/attendance/sessions/{sid}/attendances/"
        self.assertEqual(client.get(list_url).data["count"], 1)

        clase.start_time = timezone.now() - timedelta(minutes=120)
        clase.save(update_fields=["start_time"])

        resp = client.get(url)
        self.assertEqual(resp.status_code, 410)
        self.assertEqual(resp.data["state"], "finished")
        self.assertEqual(resp.data["session_id"], sid)
        self.assertEqual(client.get(list_url).data["count"], 1)


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


class DurationValidationTests(TestCase):
    def test_zero_duration_is_400(self):
        user, _, group = _make_prof_group(email="dur@ut.edu.co")
        client = APIClient()
        client.force_login(user)
        resp = client.post(
            f"/api/academic/groups/{group.id}/classes/",
            {
                "title": "Duración cero",
                "start_time": (timezone.now() + timedelta(hours=1)).isoformat(),
                "duration_minutes": 0,
                "modality": "PRESENTIAL",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("duration_minutes", resp.data)


class DeleteWithHistoryTests(TestCase):
    """Borrar grupo/clase con asistencias se bloquea (409); sin ellas, 204."""

    def _setup(self, email):
        user, _, group = _make_prof_group(email=email)
        clase = _make_class(group, start_delta_min=-1)
        client = APIClient()
        client.force_login(user)
        return group, clase, client

    def _attendance(self, clase, suffix):
        session = AttendanceSession.objects.create(
            scheduled_class=clase,
            token_hash=hashlib.sha256(f"del-{suffix}".encode()).hexdigest(),
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        user = User.objects.create_user(
            email=f"del{suffix}@ut.edu.co",
            google_sub=f"del{suffix}",
            role="ROLE_STUDENT",
        )
        student = Student.objects.create(
            user=user,
            student_code=f"DEL-{suffix}",
            document_number=f"DOC-DEL-{suffix}",
            first_name="Del",
            last_name="Test",
        )
        Attendance.objects.create(
            session=session,
            student=student,
            ip_address="127.0.0.1",
            user_agent="test",
        )

    def test_group_with_attendance_is_409(self):
        group, clase, client = self._setup("dh1@ut.edu.co")
        self._attendance(clase, "G1")
        resp = client.delete(f"/api/academic/my-groups/{group.id}/")
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(AcademicGroup.objects.filter(pk=group.pk).exists())

    def test_class_with_attendance_is_409(self):
        group, clase, client = self._setup("dh2@ut.edu.co")
        self._attendance(clase, "C1")
        resp = client.delete(f"/api/academic/groups/{group.id}/classes/{clase.id}/")
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(ScheduledClass.objects.filter(pk=clase.pk).exists())

    def test_group_without_attendance_is_204(self):
        group, _, client = self._setup("dh3@ut.edu.co")
        resp = client.delete(f"/api/academic/my-groups/{group.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AcademicGroup.objects.filter(pk=group.pk).exists())

    def test_class_without_attendance_is_204(self):
        group, clase, client = self._setup("dh4@ut.edu.co")
        resp = client.delete(f"/api/academic/groups/{group.id}/classes/{clase.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(ScheduledClass.objects.filter(pk=clase.pk).exists())


class ClassStatusFilterTests(TestCase):
    """Filtro ?status= en listados de clases (profesor y admin)."""

    def setUp(self):
        self.user, _, self.group = _make_prof_group(email="status@ut.edu.co")
        self.live = _make_class(
            self.group, start_delta_min=-1, status=ClassStatus.IN_PROGRESS
        )
        self.scheduled = _make_class(
            self.group, start_delta_min=60, status=ClassStatus.SCHEDULED
        )
        self.client = APIClient()
        self.client.force_login(self.user)
        self.url = f"/api/academic/groups/{self.group.id}/classes/"

    def test_filters_by_status(self):
        resp = self.client.get(self.url, {"status": "IN_PROGRESS"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            [row["id"] for row in resp.data["results"]], [str(self.live.id)]
        )

    def test_missing_status_returns_all(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["results"]), 2)

    def test_invalid_status_is_400(self):
        resp = self.client.get(self.url, {"status": "BOGUS"})
        self.assertEqual(resp.status_code, 400)

    def test_admin_list_filters_and_rejects_invalid(self):
        admin = User.objects.create_user(
            email="statusadmin@ut.edu.co",
            google_sub="sub-statusadmin",
            role="ROLE_ADMIN",
        )
        client = APIClient()
        client.force_login(admin)
        url = f"/api/academic/admin/groups/{self.group.id}/classes/"
        ok = client.get(url, {"status": "SCHEDULED"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(
            [row["id"] for row in ok.data["results"]], [str(self.scheduled.id)]
        )
        bad = client.get(url, {"status": "BOGUS"})
        self.assertEqual(bad.status_code, 400)


class LazyStatusSyncTests(TestCase):
    """El listado alinea el status persistido con el reloj antes de filtrar."""

    def setUp(self):
        self.user, _, self.group = _make_prof_group(email="sync@ut.edu.co")
        self.client = APIClient()
        self.client.force_login(self.user)
        self.url = f"/api/academic/groups/{self.group.id}/classes/"

    def test_started_class_becomes_in_progress(self):
        clase = _make_class(self.group, start_delta_min=-5, duration=60)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.IN_PROGRESS)

    def test_finished_class_becomes_completed(self):
        clase = _make_class(self.group, start_delta_min=-60, duration=5)
        self.client.get(self.url)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.COMPLETED)

    def test_future_class_stays_scheduled(self):
        clase = _make_class(self.group, start_delta_min=60, duration=60)
        self.client.get(self.url)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.SCHEDULED)

    def test_cancelled_finished_class_stays_cancelled(self):
        clase = _make_class(
            self.group, start_delta_min=-60, duration=5, status=ClassStatus.CANCELLED
        )
        self.client.get(self.url)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.CANCELLED)

    def test_status_filter_uses_synced_status(self):
        clase = _make_class(self.group, start_delta_min=-5, duration=60)
        live = self.client.get(self.url, {"status": "IN_PROGRESS"})
        self.assertEqual([row["id"] for row in live.data["results"]], [str(clase.id)])
        scheduled = self.client.get(self.url, {"status": "SCHEDULED"})
        self.assertEqual(scheduled.data["results"], [])

    def test_finished_class_revokes_active_session(self):
        clase = _make_class(self.group, start_delta_min=-60, duration=5)
        AttendanceSession.objects.create(
            scheduled_class=clase,
            token_hash=hashlib.sha256(b"sync-session").hexdigest(),
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        self.client.get(self.url)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.COMPLETED)
        self.assertFalse(
            AttendanceSession.objects.get(scheduled_class=clase).is_active
        )

    def test_admin_list_syncs_statuses(self):
        clase = _make_class(self.group, start_delta_min=-5, duration=60)
        admin = User.objects.create_user(
            email="syncadmin@ut.edu.co",
            google_sub="sub-syncadmin",
            role="ROLE_ADMIN",
        )
        client = APIClient()
        client.force_login(admin)
        resp = client.get(f"/api/academic/admin/groups/{self.group.id}/classes/")
        self.assertEqual(resp.status_code, 200)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.IN_PROGRESS)

    def test_class_starting_in_10s_stays_scheduled(self):
        clase = ScheduledClass.objects.create(
            group=self.group,
            title="Clase 10s",
            start_time=timezone.now() + timedelta(seconds=10),
            duration_minutes=60,
            modality="PRESENTIAL",
            status=ClassStatus.SCHEDULED,
        )
        self.client.get(self.url)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.SCHEDULED)

    def test_in_progress_finished_class_becomes_completed(self):
        clase = _make_class(
            self.group, start_delta_min=-120, duration=60, status=ClassStatus.IN_PROGRESS
        )
        self.client.get(self.url)
        clase.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.COMPLETED)

    def test_in_window_active_session_is_not_revoked(self):
        clase = _make_class(
            self.group, start_delta_min=-1, duration=60, status=ClassStatus.IN_PROGRESS
        )
        session = AttendanceSession.objects.create(
            scheduled_class=clase,
            token_hash=hashlib.sha256(b"live-session").hexdigest(),
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        self.client.get(self.url)
        clase.refresh_from_db()
        session.refresh_from_db()
        self.assertEqual(clase.status, ClassStatus.IN_PROGRESS)
        self.assertTrue(session.is_active)

    def test_sync_does_not_touch_other_groups(self):
        _, _, other_group = _make_prof_group(email="otro@ut.edu.co")
        ajena = _make_class(other_group, start_delta_min=-60, duration=5)
        self.client.get(self.url)
        ajena.refresh_from_db()
        self.assertEqual(ajena.status, ClassStatus.SCHEDULED)


class RescheduleCompletedClassTests(TestCase):
    """Reprogramar una clase auto-COMPLETED la reabre si la ventana es futura."""

    def setUp(self):
        self.user, _, self.group = _make_prof_group(email="resched@ut.edu.co")
        self.clase = _make_class(
            self.group, start_delta_min=-120, duration=60, status=ClassStatus.COMPLETED
        )
        self.client = APIClient()
        self.client.force_login(self.user)
        self.url = f"/api/academic/groups/{self.group.id}/classes/{self.clase.id}/"

    def _patch_start(self, start, duration=60):
        return self.client.patch(
            self.url,
            {"start_time": start.isoformat(), "duration_minutes": duration},
            format="json",
        )

    def test_reschedule_to_future_reopens_as_scheduled(self):
        resp = self._patch_start(timezone.now() + timedelta(hours=2))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], ClassStatus.SCHEDULED)
        self.clase.refresh_from_db()
        self.assertEqual(self.clase.status, ClassStatus.SCHEDULED)
        # Ya no responde 410 closed: la clase vuelve a estar pendiente.
        live = self.client.get(self.url + "current-session/")
        self.assertEqual(live.status_code, 202)
        self.assertEqual(live.data["state"], "pending")

    def test_reschedule_into_current_window_is_in_progress(self):
        resp = self._patch_start(timezone.now() - timedelta(minutes=1))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], ClassStatus.IN_PROGRESS)
        self.clase.refresh_from_db()
        self.assertEqual(self.clase.status, ClassStatus.IN_PROGRESS)

    def test_reschedule_to_past_stays_completed(self):
        # Ventana aún pasada (dentro de la tolerancia de 5 min del validador).
        resp = self._patch_start(timezone.now() - timedelta(minutes=4), duration=1)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], ClassStatus.COMPLETED)
        self.clase.refresh_from_db()
        self.assertEqual(self.clase.status, ClassStatus.COMPLETED)
