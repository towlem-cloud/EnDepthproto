import React from "react";
import { wordCount } from "../utils/thinking.js";

export function LogoMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="46" height="46" rx="15" fill="currentColor" />
      <path
        d="M13 14.5h21M13 24h15M13 33.5h21"
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="34" cy="24" r="4" fill="#ffedd5" />
    </svg>
  );
}

export function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const paths = {
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    spark: (
      <>
        <path d="m12 3-1.6 4.1L6 9l4.4 1.9L12 15l1.6-4.1L18 9l-4.4-1.9L12 3Z" />
        <path d="m5 16-.8 2L2 19l2.2 1 .8 2 .8-2L8 19l-2.2-1L5 16Z" />
        <path d="m19 14-1 2.5-2.5 1 2.5 1 1 2.5 1-2.5 2.5-1-2.5-1L19 14Z" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    shield: (
      <>
        <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    save: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    rotate: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.35.72.6 1 .3.32.7.5 1.1.5h.09v4h-.09c-.4 0-.8.18-1.1.5-.25.28-.46.62-.6 1Z" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
  };

  return <svg {...common}>{paths[name] || paths.spark}</svg>;
}

export function Pill({ children, tone = "neutral", icon }) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

export function FieldHeader({ label, helper, value = "", minimum, htmlFor }) {
  const count = wordCount(value);
  return (
    <div className="field-header">
      <div>
        <label htmlFor={htmlFor}>{label}</label>
        {helper ? <small>{helper}</small> : null}
      </div>
      {typeof minimum === "number" ? (
        <span className={count >= minimum ? "count-ready" : ""}>
          {count} words{minimum ? ` · ${minimum} suggested` : ""}
        </span>
      ) : null}
    </div>
  );
}

export function ProgressSteps({ readiness }) {
  const steps = [
    { label: "Think", complete: readiness.initial },
    { label: "Ground", complete: readiness.evidence },
    { label: "Complicate", complete: readiness.complication },
    { label: "Prepare", complete: readiness.card },
  ];

  return (
    <div className="progress-steps" aria-label="Preparation progress">
      {steps.map((step, index) => (
        <React.Fragment key={step.label}>
          <div className={`progress-step ${step.complete ? "complete" : ""}`}>
            <span>{step.complete ? <Icon name="check" size={14} /> : index + 1}</span>
            <small>{step.label}</small>
          </div>
          {index < steps.length - 1 ? (
            <div className={`progress-line ${step.complete ? "complete" : ""}`} />
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}

export function SignalCard({ signal }) {
  const slug = signal.state.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="signal-card">
      <div className="signal-card-heading">
        <span>{signal.label}</span>
        <strong className={`signal-state state-${slug}`}>{signal.state}</strong>
      </div>
      <p>{signal.note}</p>
    </div>
  );
}

export function StatusBadge({ status }) {
  const slug = status.toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-badge status-${slug}`}>{status}</span>;
}
