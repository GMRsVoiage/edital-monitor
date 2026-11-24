"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import FeedbackBanner from "./FeedbackBanner";
import { loginUser } from "../lib/api";
import { useAccessibleFormAria } from "../lib/formAria";
import { validateLoginInput } from "../lib/validation";

export default function LoginView() {
  const router = useRouter();
  const { setSession } = useAuth();
  const formRef = useRef(null);
  useAccessibleFormAria(formRef);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ message: "", state: "info" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    const check = validateLoginInput({ email, password });
    if (!check.valid) {
      const target = check.field
        ? formRef.current?.elements?.namedItem?.(check.field)
        : null;
      if (target && typeof target.setCustomValidity === "function") {
        target.setCustomValidity(check.error);
      }
      formRef.current?.checkValidity();
      const firstInvalid = formRef.current?.querySelector(":invalid");
      firstInvalid?.focus();
      setFeedback({ message: check.error, state: "error" });
      return;
    }

    setSubmitting(true);
    setFeedback({ message: "Autenticando sua conta…", state: "loading" });

    try {
      const data = await loginUser(check.value);
      setSession({ user: data?.user, token: data?.token });
      setFeedback({
        message: "Login realizado com sucesso. Redirecionando…",
        state: "ok"
      });
      router.push("/");
    } catch (err) {
      setFeedback({
        message: err?.message || "E-mail ou senha inválidos.",
        state: "error"
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="hero-panel auth-panel">
        <div>
          <p className="eyebrow">Acesso autenticado</p>
          <h1 id="conteudo-principal" tabIndex={-1}>
            Entrar no Edital Monitor
          </h1>
          <p className="lead">
            Acesse sua conta para gerenciar palavras-chave salvas, grupos temáticos, alertas e
            relatórios filtrados.
          </p>
        </div>

        <FeedbackBanner
          id="login-feedback"
          message={feedback.message}
          state={feedback.state}
        />

        <form
          ref={formRef}
          className="aero-form doc-surface"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="field">
            <label className="field-label" htmlFor="login-email">
              E-mail <span aria-hidden="true">*</span>
            </label>
            <p id="login-email-hint" className="field-hint">
              Formato: nome@exemplo.com
            </p>
            <input
              id="login-email"
              name="email"
              type="email"
              className="field-control"
              value={email}
              onChange={(e) => {
                e.target.setCustomValidity("");
                setEmail(e.target.value);
              }}
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              aria-describedby="login-email-hint"
              data-error="login-email-error"
              required
            />
            <div id="login-email-error" className="field-error">
              <span className="error-badge" role="img" aria-label="Erro">
                !
              </span>
              <span>Informe um endereço de e-mail válido.</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="login-password">
              Senha <span aria-hidden="true">*</span>
            </label>
            <div className="password-wrapper">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="field-control"
                value={password}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setPassword(e.target.value);
                }}
                autoComplete="current-password"
                enterKeyHint="done"
                data-error="login-password-error"
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                aria-pressed={showPassword}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            <div id="login-password-error" className="field-error">
              <span className="error-badge" role="img" aria-label="Erro">
                !
              </span>
              <span>Informe sua senha para continuar.</span>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="aero-gel-btn"
              disabled={submitting}
            >
              Entrar
            </button>
            <Link href="/cadastro" className="doc-link-secondary">
              Não tem conta? Cadastre-se
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
