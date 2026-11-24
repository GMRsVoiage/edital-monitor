"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import FeedbackBanner from "./FeedbackBanner";
import { updateCurrentUser } from "../lib/api";
import { useAccessibleFormAria } from "../lib/formAria";
import { formatDateTimePtBr, validateProfileInput } from "../lib/validation";

export default function PerfilView() {
  const router = useRouter();
  const { user, token, loading, isAuthenticated, setSession, logout } = useAuth();
  const profileFormRef = useRef(null);
  const passwordFormRef = useRef(null);

  const formsActive = !loading && isAuthenticated;
  useAccessibleFormAria(profileFormRef, formsActive);
  useAccessibleFormAria(passwordFormRef, formsActive);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [feedback, setFeedback] = useState({ message: "", state: "info" });

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
    }
  }, [user]);

  const handleProfileUpdate = async (event) => {
    event.preventDefault();
    const check = validateProfileInput({ name, email });
    if (!check.valid) {
      const target = check.field
        ? profileFormRef.current?.elements?.namedItem?.(check.field)
        : null;
      if (target && typeof target.setCustomValidity === "function") {
        target.setCustomValidity(check.error);
      }
      profileFormRef.current?.checkValidity();
      const firstInvalid = profileFormRef.current?.querySelector(":invalid");
      firstInvalid?.focus();
      setFeedback({ message: check.error, state: "error" });
      return;
    }

    setSavingProfile(true);
    setFeedback({ message: "Atualizando dados cadastrais…", state: "loading" });

    try {
      const data = await updateCurrentUser(check.value, { token, method: "PUT" });
      if (data?.user) {
        setSession({ user: data.user, token });
      }
      setFeedback({
        message: "Dados cadastrais atualizados com sucesso.",
        state: "ok"
      });
    } catch (err) {
      setFeedback({
        message: err?.message || "Não foi possível atualizar os dados cadastrais.",
        state: "error"
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordUpdate = async (event) => {
    event.preventDefault();
    const check = validateProfileInput({
      current_password: currentPassword,
      password: newPassword
    });
    if (!check.valid || !check.value?.password) {
      const errorMsg =
        check.error || "Informe sua senha atual e uma nova senha (6 a 128 caracteres).";
      const targetField = !newPassword
        ? "password"
        : check.field || "current_password";
      const target = passwordFormRef.current?.elements?.namedItem?.(targetField);
      if (target && typeof target.setCustomValidity === "function") {
        target.setCustomValidity(errorMsg);
      }
      passwordFormRef.current?.checkValidity();
      const firstInvalid = passwordFormRef.current?.querySelector(":invalid");
      firstInvalid?.focus();
      setFeedback({
        message: errorMsg,
        state: "error"
      });
      return;
    }

    setSavingPassword(true);
    setFeedback({ message: "Atualizando senha…", state: "loading" });

    try {
      const data = await updateCurrentUser(
        {
          current_password: check.value.current_password,
          password: check.value.password
        },
        { token, method: "PATCH" }
      );
      if (data?.user) {
        setSession({ user: data.user, token });
      }
      setCurrentPassword("");
      setNewPassword("");
      setFeedback({
        message: "Senha alterada com sucesso.",
        state: "ok"
      });
    } catch (err) {
      setFeedback({
        message: err?.message || "Não foi possível alterar a senha.",
        state: "error"
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  if (loading) {
    return (
      <section className="hero-panel">
        <h1 id="conteudo-principal" tabIndex={-1}>
          Perfil do usuário
        </h1>
        <div className="feedback is-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Verificando sessão…</span>
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="hero-panel auth-guard-panel">
        <p className="eyebrow">Área autenticada · RF002 / RF009</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Perfil do usuário
        </h1>
        <p className="lead">
          Entre na sua conta para visualizar e editar seus dados cadastrais ou alterar sua senha.
        </p>
        <div className="form-actions">
          <Link href="/login" className="aero-gel-btn">
            Entrar
          </Link>
          <Link href="/cadastro" className="aero-gel-btn aero-gel-btn--eco">
            Criar conta
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="hero-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Conta autenticada · RF002 / RF003</p>
            <h1 id="conteudo-principal" tabIndex={-1}>
              Perfil de {user?.name}
            </h1>
            <p className="lead">
              Gerencie suas informações cadastrais e credenciais de acesso com segurança.
            </p>
          </div>
          <button
            type="button"
            className="aero-gel-btn aero-gel-btn--danger aero-gel-btn--sm"
            onClick={handleLogout}
          >
            Sair da conta
          </button>
        </div>

        <dl className="profile-meta-grid">
          <div className="profile-meta-item">
            <dt>ID do usuário</dt>
            <dd className="tabular">#{user?.id}</dd>
          </div>
          <div className="profile-meta-item">
            <dt>Perfil de acesso</dt>
            <dd>{user?.role || "user"}</dd>
          </div>
          <div className="profile-meta-item">
            <dt>Cadastro</dt>
            <dd className="tabular">{formatDateTimePtBr(user?.created_at)}</dd>
          </div>
          <div className="profile-meta-item">
            <dt>Última atualização</dt>
            <dd className="tabular">{formatDateTimePtBr(user?.updated_at)}</dd>
          </div>
        </dl>

        <FeedbackBanner
          id="profile-feedback"
          message={feedback.message}
          state={feedback.state}
        />
      </section>

      <section className="doc-surface" aria-labelledby="profile-edit-heading">
        <h2 id="profile-edit-heading">Editar dados cadastrais</h2>
        <form
          ref={profileFormRef}
          className="aero-form"
          aria-labelledby="profile-edit-heading"
          onSubmit={handleProfileUpdate}
          noValidate
        >
          <div className="form-row-2">
            <div className="field">
              <label className="field-label" htmlFor="profile-name">
                Nome completo <span aria-hidden="true">*</span>
              </label>
              <input
                id="profile-name"
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
                data-error="profile-name-error"
                required
              />
              <div id="profile-name-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Informe um nome com pelo menos 2 caracteres.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="profile-email">
                E-mail <span aria-hidden="true">*</span>
              </label>
              <input
                id="profile-email"
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
                data-error="profile-email-error"
                required
              />
              <div id="profile-email-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Informe um endereço de e-mail válido.</span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="aero-gel-btn"
              disabled={savingProfile}
            >
              Salvar dados cadastrais
            </button>
          </div>
        </form>
      </section>

      <section className="doc-surface" aria-labelledby="password-edit-heading">
        <div className="section-header">
          <h2 id="password-edit-heading">Alterar senha</h2>
          <button
            type="button"
            className="password-toggle-btn"
            aria-pressed={showPasswords}
            onClick={() => setShowPasswords((prev) => !prev)}
          >
            {showPasswords ? "Ocultar senhas" : "Mostrar senhas"}
          </button>
        </div>

        <form
          ref={passwordFormRef}
          className="aero-form"
          aria-labelledby="password-edit-heading"
          onSubmit={handlePasswordUpdate}
          noValidate
        >
          <div className="form-row-2">
            <div className="field">
              <label className="field-label" htmlFor="current-password">
                Senha atual <span aria-hidden="true">*</span>
              </label>
              <input
                id="current-password"
                name="current_password"
                type={showPasswords ? "text" : "password"}
                className="field-control"
                value={currentPassword}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setCurrentPassword(e.target.value);
                }}
                autoComplete="current-password"
                data-error="current-password-error"
                required
              />
              <div id="current-password-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>Informe sua senha atual.</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="new-password">
                Nova senha <span aria-hidden="true">*</span>
              </label>
              <p id="new-password-hint" className="field-hint">
                Entre 6 e 128 caracteres.
              </p>
              <input
                id="new-password"
                name="password"
                type={showPasswords ? "text" : "password"}
                className="field-control"
                value={newPassword}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setNewPassword(e.target.value);
                }}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                aria-describedby="new-password-hint"
                data-error="new-password-error"
                required
              />
              <div id="new-password-error" className="field-error">
                <span className="error-badge" role="img" aria-label="Erro">
                  !
                </span>
                <span>A nova senha deve ter entre 6 e 128 caracteres.</span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="aero-gel-btn aero-gel-btn--eco"
              disabled={savingPassword}
            >
              Alterar senha
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
