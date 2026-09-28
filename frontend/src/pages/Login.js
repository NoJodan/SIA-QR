import React from "react";
import { googleLoginUrl } from "../services/api";
import universityLogo from "../assets/Logo_universidad_del_tolima_version_web.png";
import "./Login.css";

export default function Login() {
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");
  const next = urlParams.get("next");

  return (
    <main className="login-page">
      <div className="login-shell" aria-label="Acceso al sistema SIA-QR">
        <section className="login-brand" aria-label="Identidad institucional">
          <span className="login-circle login-circle--one" aria-hidden="true" />
          <span className="login-circle login-circle--two" aria-hidden="true" />
          <span className="login-circle login-circle--three" aria-hidden="true" />
          <div className="login-brand-content">
            <div className="login-crest">
              <img className="login-logo" src={universityLogo} alt="Universidad del Tolima" />
            </div>
            <h1 className="login-brand-title">SIA-QR</h1>
            <p className="login-brand-copy">
              Plataforma institucional para la gestión y control de asistencia académica de la Universidad del Tolima.
            </p>
          </div>

          <footer className="login-brand-footer">
            <p>© {new Date().getFullYear()} Universidad del Tolima.</p>
            <p>Todos los derechos reservados.</p>
          </footer>
        </section>

        <section className="login-form-panel" aria-label="Acceso institucional">
          <span className="login-eyebrow">Acceso exclusivo</span>
          <h2>Bienvenido, docente</h2>
          <p className="login-lead">
            Ingresa con tu cuenta institucional de Google para acceder al sistema de asistencia y gestión académica.
          </p>

          <div className="login-access-card">
            <span className="login-chip">Profesor</span>

            {error === "domain_not_allowed" && (
              <div className="login-error" role="alert">
                Solo se permiten correos del dominio institucional autorizado.
              </div>
            )}

            <a className="login-google-button" href={googleLoginUrl(next || undefined)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Continuar con Google</span>
            </a>

            <p className="login-helper">
              <strong>Importante:</strong> este portal está diseñado para personal docente de la Universidad del Tolima.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
