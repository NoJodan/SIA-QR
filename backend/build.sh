#!/usr/bin/env bash
set -o errexit
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
# Crea el superuser inicial sin shell (plan free): solo actúa si están
# DJANGO_SUPERUSER_EMAIL y DJANGO_SUPERUSER_PASSWORD. Es idempotente
# (falla silenciosamente si el usuario ya existe).
python manage.py createsuperuser --no-input || true
