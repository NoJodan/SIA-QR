from django.db import migrations

AUTH_COLUMNS = {
    "password": "varchar(128) NOT NULL DEFAULT ''",
    "last_login": "timestamptz NULL",
    "is_superuser": "boolean NOT NULL DEFAULT false",
    "is_staff": "boolean NOT NULL DEFAULT false",
}


def add_missing_columns(apps, schema_editor):
    cursor = schema_editor.connection.cursor()
    cursor.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
    )
    existing = {row[0] for row in cursor.fetchall()}
    for name, definition in AUTH_COLUMNS.items():
        if name not in existing:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(add_missing_columns, noop),
    ]