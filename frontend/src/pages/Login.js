import React, { useEffect } from "react";
import { googleLoginUrl } from "../services/api";
import universityLogo from "../assets/logo.png";
import "./Login.css";

export default function Login() {
  useEffect(() => {
    document.documentElement.classList.add("login-viewport-locked");
    document.body.classList.add("login-viewport-locked");

    return () => {
      document.documentElement.classList.remove("login-viewport-locked");
      document.body.classList.remove("login-viewport-locked");
    };
  }, []);

  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");
  const next = urlParams.get("next");
  const updatePointerPosition = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <main className="login-page">
      <div className="portal-login-shell" aria-label="Acceso al sistema SIA-QR">
        <section
          onPointerMove={updatePointerPosition}
          className="portal-login-brand sidebar-pointer-glow"
          aria-label="Identidad institucional"
        >
          <div className="portal-login-glow" aria-hidden="true">
            <span className="portal-login-glow-one" />
            <span className="portal-login-glow-two" />
            <span className="portal-login-glow-three" />
          </div>

          <div className="portal-login-brand-heading">
            <div className="portal-login-brand-logo">
              <img src={universityLogo} alt="" />
            </div>
            <div>
              <p className="portal-login-brand-name">SIA-QR</p>
              <p className="portal-login-university">Universidad del Tolima</p>
            </div>
          </div>

          <div className="portal-login-brand-message">
            <div className="portal-login-badge">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
                <path d="M7 10v5c2.7 2.2 7.3 2.2 10 0v-5M21 8v6" />
              </svg>
              Acceso institucional seguro
            </div>
            <h1>La asistencia académica, más simple.</h1>
            <p>
              Gestiona tus clases y registra la asistencia de forma rápida y segura con tu cuenta institucional.
            </p>
          </div>

          <footer className="portal-login-brand-footer">
            Universidad del Tolima <span aria-hidden="true">·</span> Plataforma académica
          </footer>
        </section>

        <section className="portal-login-content" aria-label="Acceso institucional">
          <header className="portal-login-header">
            <div className="portal-login-mobile-brand">
              <div className="portal-login-mobile-logo">
                <img src={universityLogo} alt="" />
              </div>
              <div>
                <p className="portal-login-brand-name">SIA-QR</p>
                <p className="portal-login-university">Universidad del Tolima</p>
              </div>
            </div>
            <span className="portal-login-audience">Portal para docentes</span>
          </header>

          <div className="portal-login-card-wrap">
            <div className="portal-login-card">
              <div className="portal-login-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
                  <path d="M7 10v5c2.7 2.2 7.3 2.2 10 0v-5M21 8v6" />
                </svg>
              </div>
              <h2>Bienvenido a SIA-QR</h2>
              <p className="portal-login-description">
                Ingresa con tu cuenta institucional para acceder a tus cursos y gestionar la asistencia.
              </p>

            {error === "domain_not_allowed" && (
                <div className="portal-login-error" role="alert">
                Solo se permiten correos del dominio institucional autorizado.
              </div>
            )}

              <a className="portal-login-google" href={googleLoginUrl(next || undefined)}>
                <span className="portal-login-google-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                </span>
                <span>Continuar con Google</span>
              </a>

              <div className="portal-login-notice">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M2 21h20M9 7h1m4 0h1M9 11h1m4 0h1m-6 10v-5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5" />
                </svg>
                <span>Usa tu cuenta institucional de Google para acceder.</span>
              </div>

              <p className="portal-login-terms">
                Al continuar, autorizas el uso de tu identidad institucional para autenticar el acceso a SIA-QR.
              </p>
            </div>
          </div>

          <footer className="portal-login-footer">
            <span>© {new Date().getFullYear()} SIA-QR</span>
            <span className="portal-login-secure">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 11V7a7 7 0 0 1 14 0v4M4 11h16v10H4zM12 15v3" />
              </svg>
              Conexión segura
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}
