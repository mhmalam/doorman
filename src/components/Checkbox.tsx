// Custom checkbox — native checkboxes render as harsh white squares on the
// dark theme. Unchecked: subtle outlined box; checked/mixed: accent fill.

import React from 'react';

export function Checkbox({
  checked, indeterminate, onClick, label, size = 15, visualOnly,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  label?: string;
  size?: number;
  /** Render just the box (parent handles clicks), e.g. inside a clickable row. */
  visualOnly?: boolean;
}) {
  const on = checked || indeterminate;
  const box = (
    <span
      aria-hidden={!visualOnly}
      className={
        'inline-flex items-center justify-center rounded-[4px] border transition-colors shrink-0 ' +
        (on
          ? 'bg-accent border-accent text-white'
          : 'border-[#565557] bg-transparent hover:border-weak text-transparent')
      }
      style={{ width: size, height: size }}
    >
      <svg
        width={size - 5}
        height={size - 5}
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {indeterminate ? <path d="M2 5h6" /> : <path d="M1.5 5.2l2.4 2.4L8.5 2.8" />}
      </svg>
    </span>
  );

  if (visualOnly) return box;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      title={label}
      data-stop
      onClick={e => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className="flex items-center justify-center p-1 -m-1"
    >
      {box}
    </button>
  );
}
