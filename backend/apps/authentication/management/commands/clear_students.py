"""Comando para depurar la base de datos de estudiantes (QA / desarrollo).

Borra TODOS los usuarios con ``role=ROLE_STUDENT`` usando el ORM
(``QuerySet.delete()``), de modo que la cascada de la BD/ORM arrastra:

- ``Student`` (OneToOne ``on_delete=CASCADE``),
- ``Attendance`` (FK ``student -> CASCADE``, UNIQUE sesion+estudiante),
- ``SocialAccount`` / ``Token`` / ``EmailAddress`` de allauth
  (FK a ``User`` con CASCADE).

Incluye tanto estudiantes CON perfil ``Student`` como SIN perfil
(``needs_profile``: usuarios ROLE_STUDENT sin fila en ``students``).

Preserva SIEMPRE: ROLE_ADMIN, ROLE_PROFESSOR, superusers, perfiles
``Professor``, whitelist ``authorized_professor_emails``, cursos, grupos,
clases, sesiones (``token_hash``) y ``system_configs``.

Uso::

    python manage.py clear_students --dry-run
    python manage.py clear_students --yes
    python manage.py clear_students --domain ut.edu.co --exclude-emails a@ut.edu.co,b@ut.edu.co --batch-size 500

Idempotente: si no hay estudiantes, informa y sale con codigo 0.
Nunca usa SQL crudo ni TRUNCATE.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

BOGOTA_TZ = ZoneInfo("America/Bogota")
CONFIRM_WORD = "BORRAR"


def _parse_exclude_emails(raw):
    """Normaliza ``--exclude-emails`` a lista de emails en minusculas."""
    if not raw:
        return []
    if isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        items = str(raw).split(",")
    return [e.strip().lower() for e in items if e and e.strip()]


class Command(BaseCommand):
    help = (
        "Borra todos los usuarios ROLE_STUDENT via ORM (arrastra Student, "
        "Attendance y cuentas sociales por CASCADE). Preserva admins, "
        "profesores, whitelist, cursos/grupos/clases/sesiones y system_configs. "
        "Idempotente. Soporta --dry-run, --yes/-y, --domain, "
        "--exclude-emails y --batch-size. Con DEBUG=False exige --yes; "
        "sin --yes pide confirmacion interactiva 'Escribe BORRAR'."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Solo muestra conteos previos y lo que se borraria, sin modificar la BD.",
        )
        parser.add_argument(
            "--yes",
            "-y",
            action="store_true",
            default=False,
            help="Omite la confirmacion interactiva. Obligatorio cuando DEBUG=False.",
        )
        parser.add_argument(
            "--domain",
            type=str,
            default=None,
            help="Solo borra estudiantes cuyo email termine en @DOMINIO (ej. ut.edu.co).",
        )
        parser.add_argument(
            "--exclude-emails",
            type=str,
            default="",
            help="Emails a excluir, separados por coma (comparacion case-insensitive).",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=1000,
            help="Tamano de lote para el borrado por chunks (default: 1000).",
        )

    # -- helpers ---------------------------------------------------------
    def _build_queryset(self, User, domain, exclude_emails):
        """Construye el QS objetivo. SIEMPRE filtrado por ROLE_STUDENT."""
        from apps.authentication.models import UserRole

        qs = User.objects.filter(role=UserRole.ROLE_STUDENT)
        if domain:
            dom = domain.strip().lower().lstrip("@")
            if dom:
                qs = qs.filter(email__iendswith="@" + dom)
        if exclude_emails:
            q = Q()
            for email in exclude_emails:
                q |= Q(email__iexact=email)
            qs = qs.exclude(q)
        return qs

    def _assert_student_only(self, qs, User):
        """Guarda: el QS a borrar solo puede contener ROLE_STUDENT."""
        from apps.authentication.models import UserRole

        assert qs.model is User, "clear_students: QS inesperado (no es User)"
        # El filtro por rol debe estar presente; re-aplicarlo seria inocuo,
        # pero si alguien lo retira a futuro, esto lo detecta en tests.
        where_sql = str(qs.query)
        assert UserRole.ROLE_STUDENT in where_sql, (
            "clear_students: el QS a borrar perdio el filtro role=ROLE_STUDENT. "
            "Abortado por seguridad."
        )
        # Doble verificacion semantica: ningun otro rol en el conjunto.
        otros = qs.exclude(role=UserRole.ROLE_STUDENT).count()
        assert otros == 0, (
            f"clear_students: el QS contiene {otros} usuarios no-STUDENT. Abortado."
        )

    def _count_social(self, user_ids):
        """Cuenta cuentas sociales vinculadas. Import perezoso (allauth opcional)."""
        if not user_ids:
            return 0
        try:
            from allauth.socialaccount.models import SocialAccount
        except Exception:
            return 0
        return SocialAccount.objects.filter(user_id__in=user_ids).count()

    # -- handle ----------------------------------------------------------
    def handle(self, *args, **options):
        from apps.authentication.models import Student, UserRole
        from apps.attendance.models import Attendance
        from django.contrib.auth import get_user_model

        User = get_user_model()
        dry_run = bool(options.get("dry_run"))
        skip_confirm = bool(options.get("yes"))
        domain = options.get("domain")
        exclude_emails = _parse_exclude_emails(options.get("exclude_emails"))
        batch_size = int(options.get("batch_size") or 1000)
        if batch_size < 1:
            raise CommandError("--batch-size debe ser >= 1.")

        if not settings.DEBUG and not skip_confirm and not dry_run:
            raise CommandError(
                "Con DEBUG=False debes pasar --yes para borrar estudiantes "
                "(o usa --dry-run para simular)."
            )

        qs = self._build_queryset(User, domain, exclude_emails)
        self._assert_student_only(qs, User)

        target_ids = list(qs.order_by("pk").values_list("pk", flat=True))
        n_target = len(target_ids)
        ahora = datetime.now(BOGOTA_TZ).isoformat(timespec="seconds")

        # Conteos previos.
        users_total = User.objects.count()
        n_students = (
            Student.objects.filter(user_id__in=target_ids).count() if target_ids else 0
        )
        n_sin_perfil = n_target - n_students
        n_attendances = (
            Attendance.objects.filter(student__user_id__in=target_ids).count()
            if target_ids
            else 0
        )
        n_social = self._count_social(target_ids)

        self.stdout.write(f"[{ahora} America/Bogota] clear_students: conteo previo")
        self.stdout.write(f"  users totales:        {users_total}")
        self.stdout.write(f"  students objetivo:    {n_target}")
        self.stdout.write(f"    con perfil Student: {n_students}")
        self.stdout.write(f"    sin perfil:         {n_sin_perfil}")
        self.stdout.write(f"  attendances a borrar: {n_attendances}")
        self.stdout.write(f"  social accounts:      {n_social}")
        if domain:
            self.stdout.write(f"  filtro dominio:       {domain}")
        if exclude_emails:
            self.stdout.write(f"  excluidos ({len(exclude_emails)}): {', '.join(exclude_emails)}")

        if n_target == 0:
            self.stdout.write(
                self.style.SUCCESS("No hay estudiantes para borrar. Nada que hacer.")
            )
            return

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] Se borrarian {n_target} usuarios STUDENT "
                    f"({n_students} con perfil, {n_sin_perfil} sin perfil), "
                    f"{n_attendances} attendances y {n_social} cuentas sociales. "
                    "Sin cambios en la BD."
                )
            )
            return

        if not skip_confirm:
            self.stdout.write(
                self.style.WARNING(
                    f"Vas a BORRAR {n_target} usuarios STUDENT "
                    f"({n_students} con perfil, {n_sin_perfil} sin perfil), "
                    f"{n_attendances} attendances y {n_social} cuentas sociales."
                )
            )
            try:
                answer = input(f"Escribe {CONFIRM_WORD} para confirmar: ").strip()
            except (EOFError, KeyboardInterrupt):
                self.stdout.write("Operacion cancelada. Sin cambios.")
                return
            if answer != CONFIRM_WORD:
                self.stdout.write("Operacion cancelada. Sin cambios.")
                return

        # Borrado via ORM (CASCADE arrastra Student/Attendance/SocialAccount).
        # Chunk por batch-size para no cargar miles de filas de una vez.
        borrados = 0
        with transaction.atomic():
            remaining = list(target_ids)
            for i in range(0, len(remaining), batch_size):
                chunk = remaining[i : i + batch_size]
                chunk_qs = User.objects.filter(pk__in=chunk, role=UserRole.ROLE_STUDENT)
                self._assert_student_only(chunk_qs, User)
                n, _ = chunk_qs.delete()  # ORM delete(), jamas raw SQL/TRUNCATE
                borrados += n

        # Conteos posteriores.
        users_total_post = User.objects.count()
        students_rest = User.objects.filter(role=UserRole.ROLE_STUDENT).count()
        profiles_rest = Student.objects.count()
        self.stdout.write(f"[{datetime.now(BOGOTA_TZ).isoformat(timespec='seconds')} America/Bogota] clear_students: posterior")
        self.stdout.write(f"  users totales:        {users_total_post}")
        self.stdout.write(f"  students restantes:   {students_rest}")
        self.stdout.write(f"  perfiles Student:     {profiles_rest}")
        self.stdout.write(
            self.style.SUCCESS(
                f"Borrado completado: {n_target} usuarios STUDENT eliminados "
                f"(filas afectadas ORM: {borrados}). "
                "Admins/profesores/whitelist/cursos/grupos/clases/sesiones preservados."
            )
        )
