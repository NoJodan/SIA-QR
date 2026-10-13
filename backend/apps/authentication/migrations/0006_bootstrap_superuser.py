"""Bootstrap del superuser inicial sin shell (plan free de Render).

Se ejecuta con el `migrate` del arranque: si existen DJANGO_SUPERUSER_EMAIL
y DJANGO_SUPERUSER_PASSWORD y el usuario no existe, lo crea como admin con
esa clave. Sin las variables (o si ya existe) es no-op.
"""

import os

from django.db import migrations


def bootstrap_superuser(apps, schema_editor):
    # OJO: el modelo histórico de migraciones no trae métodos como
    # set_password; se hashea con make_password directamente.
    from django.contrib.auth.hashers import make_password

    email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "").strip()
    password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")
    if not email or not password:
        return
    User = apps.get_model("authentication", "User")
    if User.objects.filter(email=email).exists():
        return
    User(
        email=email,
        google_sub=email,
        role="ROLE_ADMIN",
        is_staff=True,
        is_superuser=True,
        is_active=True,
        password=make_password(password),
    ).save()


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0005_student_phone"),
    ]

    operations = [
        migrations.RunPython(bootstrap_superuser, migrations.RunPython.noop),
    ]
