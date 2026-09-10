'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';

type HoldToConfirmButtonProps = Readonly<{
  children: ReactNode;
  disabled?: boolean;
  durationMs?: number;
  onConfirm: () => void;
}>;

const BUTTON_STYLE: CSSProperties = {
  appearance: 'none',
  background: 'rgba(255,68,68,0.10)',
  border: '1px solid #ff4444',
  borderRadius: 5,
  color: '#ff7777',
  cursor: 'pointer',
  fontFamily: 'Orbitron, monospace',
  fontSize: 10,
  letterSpacing: 1.2,
  minHeight: 36,
  overflow: 'hidden',
  padding: '8px 14px',
  position: 'relative',
  touchAction: 'none',
};

export default function HoldToConfirmButton({
  children,
  disabled = false,
  durationMs = 1500,
  onConfirm,
}: HoldToConfirmButtonProps) {
  const [holding, setHolding] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pointerIdRef.current = null;
    setHolding(false);
  }, []);

  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (disabled) cancel();
  }, [cancel, disabled]);

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0 || pointerIdRef.current !== null) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
    timerRef.current = setTimeout(() => {
      const pointerId = pointerIdRef.current;
      timerRef.current = null;
      pointerIdRef.current = null;
      setHolding(false);
      if (pointerId !== null && buttonRef.current?.hasPointerCapture(pointerId)) {
        buttonRef.current.releasePointerCapture(pointerId);
      }
      onConfirm();
    }, durationMs);
  };

  const stop = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    cancel();
  };

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) stop(event);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      aria-label={`${String(children)}. Pointer hold for ${durationMs / 1000} seconds to confirm.`}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      }}
      onPointerCancel={stop}
      onPointerDown={start}
      onPointerLeave={stop}
      onPointerMove={move}
      onPointerUp={stop}
      style={{ ...BUTTON_STYLE, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <span
        aria-hidden="true"
        style={{
          background: 'rgba(255,68,68,0.26)',
          bottom: 0,
          left: 0,
          position: 'absolute',
          top: 0,
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transformOrigin: 'left center',
          transition: holding ? `transform ${durationMs}ms linear` : 'none',
          width: '100%',
        }}
      />
      <span style={{ position: 'relative' }}>{children}</span>
    </button>
  );
}
