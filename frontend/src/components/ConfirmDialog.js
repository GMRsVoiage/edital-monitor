"use client";

import { useEffect, useId, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel
}) {
  const dialogRef = useRef(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  }, [onConfirm, onCancel]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close("");
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const handleClose = () => {
      const choice = dialog.returnValue;
      dialog.returnValue = "";
      if (choice === "confirm") {
        onConfirmRef.current?.();
      } else {
        onCancelRef.current?.();
      }
    };

    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="aero-dialog"
      aria-labelledby={titleId}
    >
      <h1 id={titleId}>{title}</h1>
      <p>{message}</p>
      <form method="dialog" className="dialog-actions">
        <button
          type="submit"
          value="cancel"
          className="aero-gel-btn aero-gel-btn--ghost aero-gel-btn--sm"
          autoFocus
        >
          {cancelLabel}
        </button>
        <button
          type="submit"
          value="confirm"
          className="aero-gel-btn aero-gel-btn--danger aero-gel-btn--sm"
        >
          {confirmLabel}
        </button>
      </form>
    </dialog>
  );
}
