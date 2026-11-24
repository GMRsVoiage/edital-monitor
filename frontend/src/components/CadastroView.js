"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import FeedbackBanner from "./FeedbackBanner";
import { registerUser } from "../lib/api";
import { useAccessibleFormAria } from "../lib/formAria";
import { validateRegisterInput } from "../lib/validation";

export default function CadastroView() {
  const router = useRouter();
  const { setSession } = useAuth();
  const formRef = useRef(null);
  useAccessibleFormAria(formRef);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ message: "", state: "info" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    const check = validateRegisterInput({ name, email, password });
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
    setFeedback({ message: "Criando sua conta…", state: "loading" });

    try {
      const data = await registerUser(check.value);
      setSession({ user: data?.user, token: data?.token });
      setFeedback({
        message: "Cadastro realizado com sucesso! Redirecionando…",
        state: "ok"
      });
      router.push("/");
    } catch (err) {
      setFeedback({
        message: err?.message || "Não foi possível concluir o cadastro.",
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
          <p className="eyebrow">Novo usuário · RF001</p>
          <h1 id="conteudo-principal" tabIndex={-1}>
            Criar conta no Edital Monitor
          </h1>
          <p className="lead">
            Cadastre-se para salvar palavras-chave, organizar grupos de interesse e acompanhar
            ocorrências nos Boletins Oficiais.
          </p>
        </div>

        <FeedbackBanner
          id="register-feedback"
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
            <label className="field-label" htmlFor="register-name">
              Nome completo <span aria-hidden="true">*</span>
            </label>
            <p id="register-name-hint" className="field-hint">
              Mínimo de 2 caracteres.
            </p>
            <input
              id="register-name"
              name="name"
              type="text"
              className="field-control"
              value={name}
              onChange={(e) => {
                e.target.setCustomValidity("");
                setName(e.target.value);
              }}
              autoComplete="name"
              minLength={2}
              maxLength={80}
              enterKeyHint="next"
              aria-describedby="register-name-hint"
              data-error="register-name-error"
              required
            />
            <div id="register-name-error" className="field-error">
              <span className="error-badge" role="img" aria-label="Erro">
                !
              </span>
              <span>Informe um nome com pelo menos 2 caracteres.</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="register-email">
              E-mail <span aria-hidden="true">*</span>
            </label>
            <p id="register-email-hint" className="field-hint">
              Formato: nome@exemplo.com
            </p>
            <input
              id="register-email"
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
              aria-describedby="register-email-hint"
              data-error="register-email-error"
              required
            />
            <div id="register-email-error" className="field-error">
              <span className="error-badge" role="img" aria-label="Erro">
                !
              </span>
              <span>Informe um endereço de e-mail válido.</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="register-password">
              Senha <span aria-hidden="true">*</span>
            </label>
            <ul id="register-password-rules" className="rules-list">
              <li>Entre 6 e 128 caracteres</li>
            </ul>
            <div className="password-wrapper">
              <input
                id="register-password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="field-control"
                value={password}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setPassword(e.target.value);
                }}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                enterKeyHint="done"
                aria-describedby="register-password-rules"
                data-error="register-password-error"
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
            <div id="register-password-error" className="field-error">
              <span className="error-badge" role="img" aria-label="Erro">
                !
              </span>
              <span>A senha deve ter entre 6 e 128 caracteres.</span>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="aero-gel-btn aero-gel-btn--eco"
              disabled={submitting}
            >
              Criar conta
            </button>
            <Link href="/login" className="doc-link-secondary">
              Já possui conta? Entrar
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
