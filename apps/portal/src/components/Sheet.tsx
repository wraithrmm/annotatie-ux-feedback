// A sheet (PT-2 §5): a bottom sheet or full screen on a phone, a centred dialog on desktop.
// Built on <dialog> (showModal) so focus is trapped; Escape and the backdrop ask to close.

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

let uid = 0;

export function Sheet(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  full?: boolean;
  wide?: boolean;
  closeFirst?: boolean;
  noClose?: boolean;
  footer?: ComponentChildren;
  children: ComponentChildren;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const id = useRef(`sh-${++uid}`);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      opener.current = document.activeElement;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      d.querySelector<HTMLElement>("h2")?.focus();
    } else if (!props.open && d.open) {
      d.close();
      const o = opener.current as HTMLElement | null;
      if (o && o.isConnected) o.focus();
    }
  }, [props.open]);
  useEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );
  const cls = ["sheet", props.full ? "full" : "", props.wide ? "wide" : ""].filter(Boolean).join(" ");
  const close = (
    <button class="btn ghost icon" type="button" aria-label="Close" onClick={props.onClose}>
      ✕
    </button>
  );
  return (
    <dialog
      ref={ref}
      class={cls}
      aria-labelledby={id.current}
      data-testid={props.testId}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      {props.open && (
        <>
          <span class="grab" aria-hidden="true" />
          <div class="sh-h">
            {props.closeFirst && !props.noClose && close}
            <h2 id={id.current} tabIndex={-1}>
              {props.title}
            </h2>
            {!props.closeFirst && !props.noClose && close}
          </div>
          <div class="sh-b">{props.children}</div>
          {props.footer && <div class="sh-f">{props.footer}</div>}
        </>
      )}
    </dialog>
  );
}
