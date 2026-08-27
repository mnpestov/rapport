import { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "neutral" | "danger";
type Size = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

/**
 * Кнопка с текстом.
 *
 * `type` по умолчанию "button": без этого кнопка внутри формы отправляет её,
 * и на нескольких страницах это уже приводило к перезагрузке.
 */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  block,
  children,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.btn, styles[size], styles[variant], block ? styles.block : "", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type Tone = "ghost" | "brand" | "neutral" | "danger";

const TONE_CLASS: Record<Exclude<Tone, "ghost">, string> = {
  brand: styles.toneBrand,
  neutral: styles.toneNeutral,
  danger: styles.toneDanger,
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  children: ReactNode;
}

/**
 * Кнопка без текста, только иконка.
 *
 * `ghost` — прозрачная, для действий в строках таблиц. Остальные — залитые
 * квадраты 28×28, как в «Справочниках». `title` обязателен: у кнопки нет
 * подписи, и без него она недоступна с клавиатуры и в скринридере.
 */
export function IconButton({ tone = "ghost", children, className, type = "button", title, ...props }: IconButtonProps) {
  const shape = tone === "ghost" ? styles.ghost : `${styles.filled} ${TONE_CLASS[tone]}`;
  return (
    <button
      type={type}
      title={title}
      aria-label={props["aria-label"] ?? title}
      className={[styles.icon, shape, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
