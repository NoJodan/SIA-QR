import uuid
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models


class UserManager(BaseUserManager):
    def create_user(self, email, google_sub=None, role="ROLE_STUDENT", **extra_fields):
        if not email:
            raise ValueError("El email es obligatorio")
        email = self.normalize_email(email)
        user = self.model(email=email, google_sub=google_sub or email, role=role, **extra_fields)
        user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", "ROLE_ADMIN")
        user = self.model(email=self.normalize_email(email), google_sub=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class UserRole(models.TextChoices):
    ROLE_ADMIN = "ROLE_ADMIN", "Administrador"
    ROLE_PROFESSOR = "ROLE_PROFESSOR", "Profesor"
    ROLE_STUDENT = "ROLE_STUDENT", "Estudiante"


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.CharField(max_length=255, unique=True)
    google_sub = models.CharField(max_length=255, unique=True)
    role = models.CharField(max_length=20, choices=UserRole.choices, default=UserRole.ROLE_STUDENT)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "users"
        indexes = [
            models.Index(fields=["google_sub"], name="idx_users_google_sub"),
            models.Index(fields=["email"], name="idx_users_email"),
        ]

    def __str__(self):
        return f"{self.email} ({self.role})"


class Professor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="professor_profile", db_column="user_id")
    employee_code = models.CharField(max_length=50, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    department = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        db_table = "professors"

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.employee_code})"


class AuthorizedProfessorEmail(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "authorized_professor_emails"

    def __str__(self):
        return self.email


class Student(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="student_profile", db_column="user_id")
    student_code = models.CharField(max_length=50, unique=True)
    document_number = models.CharField(max_length=50, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    address = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "students"

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.student_code})"

