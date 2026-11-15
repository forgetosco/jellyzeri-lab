import React, { useRef, useState } from 'react';

interface VirtualStickProps {
  label: string;
  onChange: (x: number, y: number) => void;
  accentClass: string;
  testId: string;
}

function VirtualStick({ label, onChange, accentClass, testId }: VirtualStickProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const maxRadius = 34;

  const updateFromClient = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    setKnob({ x: dx, y: dy });
    // Up on screen (negative dy) corresponds to forward (+y)
    onChange(dx / maxRadius, -dy / maxRadius);
  };

  const resetStick = () => {
    activePointerId.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        ref={padRef}
        data-testid={testId}
        role="application"
        aria-label={label}
        onPointerDown={(e) => {
          e.stopPropagation();
          activePointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromClient(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          updateFromClient(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          resetStick();
        }}
        onPointerCancel={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          resetStick();
        }}
        className="relative w-24 h-24 rounded-full border border-slate-500/50 bg-slate-900/75 touch-none flex items-center justify-center cursor-grab active:cursor-grabbing"
      >
        <div
          className={`w-10 h-10 rounded-full border border-white/30 ${accentClass}`}
          style={{
            transform: `translate(${knob.x}px, ${knob.y}px)`,
          }}
        />
      </div>
      <span className="text-[11px] font-medium text-slate-300 tracking-wide">{label}</span>
    </div>
  );
}

interface TouchControlsOverlayProps {
  visible: boolean;
  chargeLabel: string;
  chargeRatio: number;
  onLeftStick: (x: number, y: number) => void;
  onRightStick: (x: number, y: number) => void;
  onChargeChange: (charging: boolean) => void;
}

export function TouchControlsOverlay({
  visible,
  chargeLabel,
  chargeRatio,
  onLeftStick,
  onRightStick,
  onChargeChange,
}: TouchControlsOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-28 sm:bottom-24 z-20 flex items-end justify-between px-4 sm:px-8"
      data-testid="touch-controls-overlay"
    >
      <div className="pointer-events-auto">
        <VirtualStick
          label="Move / Aim"
          onChange={onLeftStick}
          accentClass="bg-purple-500/80"
          testId="virtual-left-stick"
        />
      </div>

      <div className="pointer-events-auto flex items-end gap-4">
        <button
          type="button"
          data-testid="touch-charge-button"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            onChargeChange(true);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            onChargeChange(false);
          }}
          onPointerCancel={() => onChargeChange(false)}
          className="min-w-[84px] min-h-[56px] px-4 py-3 rounded-xl border border-cyan-400/50 bg-slate-900/85 text-cyan-300 font-semibold text-xs tracking-wider active:scale-95 transition-transform touch-none flex flex-col items-center justify-center gap-1"
        >
          <span>{chargeLabel}</span>
          <span className="w-14 h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <span
              className="block h-full bg-cyan-400 transition-[width] duration-75"
              style={{ width: `${Math.round(chargeRatio * 100)}%` }}
            />
          </span>
        </button>

        <VirtualStick
          label="Camera"
          onChange={onRightStick}
          accentClass="bg-cyan-500/80"
          testId="virtual-right-stick"
        />
      </div>
    </div>
  );
}
