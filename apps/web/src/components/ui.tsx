import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'quiet',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`btn btn--${variant} btn--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="btn__spinner" aria-hidden /> : icon}
      {children ? <span className="btn__label">{children}</span> : null}
    </button>
  );
}

/* -------------------------------- Badge -------------------------------- */

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/* -------------------------------- Card --------------------------------- */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {title || action ? (
        <header className="card__head">
          {title ? <h2 className="card__title">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div className="card__body">{children}</div>
    </section>
  );
}

/* ------------------------------ Form fields ---------------------------- */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, id, className = '', ...rest }: FieldProps) {
  const inputId = id ?? `f-${label.replace(/\s+/g, '-')}`;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined}
        {...rest}
      />
      {hint && !error ? (
        <p className="field__hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${inputId}-err`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextArea({ label, id, className = '', ...rest }: TextAreaProps) {
  const inputId = id ?? `t-${label.replace(/\s+/g, '-')}`;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <textarea id={inputId} className="field__input field__input--area" {...rest} />
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Array<{ value: string; label: string }>;
}

export function Select({ label, options, id, className = '', ...rest }: SelectProps) {
  const inputId = id ?? `s-${label.replace(/\s+/g, '-')}`;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <select id={inputId} className="field__input" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Checkbox({
  label,
  id,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const inputId = id ?? `c-${label.replace(/\s+/g, '-')}`;
  return (
    <div className={`check ${className}`.trim()}>
      <input id={inputId} type="checkbox" className="check__box" {...rest} />
      <label className="check__label" htmlFor={inputId}>
        {label}
      </label>
    </div>
  );
}

/* --------------------------- Progress / rhythm ------------------------- */

export function ProgressRule({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'ok' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      className={`rule rule--${tone}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="rule__fill" style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------ States -------------------------------- */

export function Skeleton({ height = '1rem', width = '100%', radius }: { height?: string; width?: string; radius?: string }) {
  return (
    <span
      className="skeleton"
      style={{ blockSize: height, inlineSize: width, borderRadius: radius }}
      aria-hidden
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {body ? <p className="state__body">{body}</p> : null}
      {action ? <div className="state__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">تعذّر تحميل البيانات</p>
      <p className="state__body">{message}</p>
      {onRetry ? <Button onClick={onRetry}>إعادة المحاولة</Button> : null}
    </div>
  );
}
