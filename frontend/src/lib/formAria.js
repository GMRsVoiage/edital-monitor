"use client";

import { useEffect } from "react";

function spokenText(node) {
  if (!node) return "";
  const copy = node.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  copy
    .querySelectorAll('[role="img"][aria-label]')
    .forEach((n) => n.replaceWith(`${n.getAttribute("aria-label")}: `));
  return (copy.textContent || "").replace(/\s+/g, " ").trim();
}

function linkError(el, shown) {
  const errorId = el?.dataset?.error;
  if (!errorId) return;
  const ids = (el.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
}

let sharedAnnouncer = null;
let activeHooks = 0;

function acquireAnnouncer() {
  if (!sharedAnnouncer) {
    sharedAnnouncer = document.createElement("div");
    sharedAnnouncer.setAttribute("aria-live", "polite");
    sharedAnnouncer.classList.add("visually-hidden");
    document.body.append(sharedAnnouncer);
  }
  activeHooks += 1;
  return sharedAnnouncer;
}

function releaseAnnouncer() {
  activeHooks = Math.max(0, activeHooks - 1);
  if (activeHooks === 0 && sharedAnnouncer) {
    sharedAnnouncer.remove();
    sharedAnnouncer = null;
  }
}

export function useAccessibleFormAria(formRef, dependency = null) {
  useEffect(() => {
    const form = formRef?.current;
    if (!form || typeof document === "undefined") return undefined;

    const announcer = acquireAnnouncer();

    const supportsUserInvalid =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("selector(:user-invalid)");

    const dirtyState = new WeakMap();
    const flagged = new WeakSet();
    const announced = new WeakSet();
    let announceTimer;
    let announcedField = null;

    const announceError = (el) => {
      const error = document.getElementById(el?.dataset?.error || "");
      if (!error) return;
      const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
      clearTimeout(announceTimer);
      announcer.textContent = "";
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = label + spokenText(error);
      }, 500);
    };

    const syncAria = (el, announce = false, forceFallbackState = false) => {
      if (!el?.matches?.("input, select, textarea")) return;
      let invalid = false;

      if (supportsUserInvalid) {
        invalid = el.matches(":user-invalid");
      } else {
        const state = dirtyState.get(el);
        const shouldCheck = forceFallbackState || Boolean(state?.hasInteracted && state?.hasBlurred);
        invalid = shouldCheck && !el.validity.valid;
        if (shouldCheck) {
          el.classList.toggle("user-invalid-fallback", !el.validity.valid);
          el.classList.toggle("user-valid-fallback", el.validity.valid);
        }
      }

      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute("aria-invalid", "true");
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
        el.setAttribute("aria-invalid", "false");
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = "";
        }
      }
    };

    form.querySelectorAll("input, select, textarea").forEach((el) => syncAria(el));

    const onBlur = (e) => {
      const el = e.target;
      if (!el?.matches?.("input, select, textarea")) return;
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasBlurred = true;
      dirtyState.set(el, state);
      syncAria(el, true, state.hasInteracted);
    };

    const onInput = (e) => {
      const el = e.target;
      if (!el?.matches?.("input, select, textarea")) return;
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(el, state);
      if (el.getAttribute("aria-invalid") === "true" || !supportsUserInvalid) {
        syncAria(el, false, state.hasBlurred);
      }
    };

    const onChange = (e) => {
      const el = e.target;
      if (!el?.matches?.("input, select, textarea")) return;
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      state.hasBlurred = true;
      dirtyState.set(el, state);
      syncAria(el, true, true);
    };

    const onInvalid = (e) => {
      const el = e.target;
      if (!el?.matches?.("input, select, textarea")) return;
      dirtyState.set(el, { hasInteracted: true, hasBlurred: true });
      announced.add(el);
      syncAria(el, false, true);
    };

    const onReset = () => {
      setTimeout(() => {
        form.querySelectorAll("input, select, textarea").forEach((el) => {
          dirtyState.delete(el);
          el.classList.remove("user-invalid-fallback", "user-valid-fallback");
          syncAria(el);
        });
      }, 0);
    };

    form.addEventListener("blur", onBlur, true);
    form.addEventListener("input", onInput);
    form.addEventListener("change", onChange, true);
    form.addEventListener("invalid", onInvalid, true);
    form.addEventListener("reset", onReset, true);

    return () => {
      clearTimeout(announceTimer);
      form.removeEventListener("blur", onBlur, true);
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onChange, true);
      form.removeEventListener("invalid", onInvalid, true);
      form.removeEventListener("reset", onReset, true);
      releaseAnnouncer();
    };
  }, [formRef, dependency]);
}
