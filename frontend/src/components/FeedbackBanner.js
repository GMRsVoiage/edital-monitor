"use client";

export default function FeedbackBanner({
  id,
  message = "",
  state = "info",
  role = "status"
}) {
  const stateClass =
    state === "ok"
      ? "is-ok"
      : state === "error"
        ? "is-error"
        : state === "loading"
          ? "is-loading"
          : "";

  return (
    <div
      id={id}
      className={`feedback${stateClass ? ` ${stateClass}` : ""}`}
      role={state === "error" ? "alert" : role}
      aria-live={state === "error" ? "assertive" : "polite"}
    >
      {state === "loading" && message ? (
        <span className="spinner" aria-hidden="true" />
      ) : null}
      {message ? <span>{message}</span> : null}
    </div>
  );
}
