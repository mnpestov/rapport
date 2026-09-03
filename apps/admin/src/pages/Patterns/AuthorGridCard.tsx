import { ReactNode, useRef, useState } from "react";
import { MessageCircleX } from "lucide-react";
import { Button } from "../../components/Button/Button";
import { CabinetItem } from "../../api/cabinet";
import { API_URL } from "../../api/config";
import type { PatternStatus } from "./PatternCard";
import styles from "./ModerationCard.module.css";

// Карточный вид кабинета автора. Показывает все заполненные поля описания
// (кроме подробностей) + листаемую галерею фото, по клику по карточке —
// просмотр в модалке (read-only). Аналог ModerationCard у админа.
interface AuthorGridCardProps {
  item: CabinetItem;
  status: PatternStatus;
  isSelected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onEdit: (id: string) => void;
  /** Клик по карточке (кроме чекбокса, кнопок, ссылок) — открыть просмотр. */
  onView?: (item: CabinetItem) => void;
  editDisabled?: boolean;
}

function getImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatPrice(value: number | string | null): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function CheckboxGlyph({ checked }: { checked: boolean }) {
  return checked ? (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 16L14.6667 18.6667L20 13.3333M6.66667 4H25.3333C26.8061 4 28 5.19391 28 6.66667V25.3333C28 26.8061 26.8061 28 25.3333 28H6.66667C5.19391 28 4 26.8061 4 25.3333V6.66667C4 5.19391 5.19391 4 6.66667 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M25.3333 4H6.66667C5.19391 4 4 5.19391 4 6.66667V25.3333C4 26.8061 5.19391 28 6.66667 28H25.3333C26.8061 28 28 26.8061 28 25.3333V6.66667C28 5.19391 26.8061 4 25.3333 4Z" stroke="#1D1C1C" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

function Stack({ items }: { items: { id: string; name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.stack}>
      {items.map((item) => (
        <span key={item.id}>{item.name}</span>
      ))}
    </div>
  );
}

// Листаемая галерея — тот же приём, что PatternDetails / ModerationCard:
// CSS scroll-snap + точки, без библиотеки.
function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const srcs = images.map(getImageUrl).filter((s): s is string => !!s);

  if (srcs.length === 0) {
    return <div className={styles.imgPlaceholder}>Нет фото</div>;
  }
  if (srcs.length === 1) {
    return <img src={srcs[0]} alt={alt} className={styles.galleryOne} />;
  }

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setActiveIndex(Math.round(track.scrollLeft / track.clientWidth));
  };

  const scrollToIndex = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  };

  return (
    <>
      <div className={styles.galleryTrack} ref={trackRef} onScroll={handleScroll}>
        {srcs.map((src, index) => (
          <img
            key={index}
            src={src}
            alt={`${alt} ${index + 1}`}
            className={styles.gallerySlide}
            loading={index <= 1 ? "eager" : "lazy"}
            decoding="async"
          />
        ))}
      </div>
      <div className={styles.galleryDots}>
        {srcs.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`${styles.galleryDot}${index === activeIndex ? " " + styles.galleryDotActive : ""}`}
            onClick={(e) => { e.stopPropagation(); scrollToIndex(index); }}
            aria-label={`Фото ${index + 1}`}
          />
        ))}
      </div>
    </>
  );
}

const STATUS_BADGE_STYLE: Record<PatternStatus["kind"], { background: string; color: string }> = {
  draft: { background: "var(--surface-gray)", color: "var(--text-muted)" },
  pending: { background: "#fef3c7", color: "#92400e" },
  rejected: { background: "var(--danger)", color: "var(--surface)" },
  published: { background: "var(--brand)", color: "var(--surface)" },
};

export function AuthorGridCard({ item, status, isSelected, onSelect, onEdit, onView, editDisabled = false }: AuthorGridCardProps) {
  const badgeStyle = STATUS_BADGE_STYLE[status.kind];
  const price = formatPrice(item.price);
  const oldPrice = formatPrice(item.oldPrice);
  const hasDensity = item.densityStitches != null || item.densityRows != null;

  // Клик по карточке открывает просмотр — но не по чекбоксу/кнопкам/
  // ссылкам/точкам галереи (у них своя обработка + stopPropagation).
  const handleCardClick = (e: React.MouseEvent) => {
    if (!onView) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [role='checkbox']")) return;
    onView(item);
  };

  return (
    <div
      className={`${styles.card}${onView ? " " + styles.cardClickable : ""}`}
      onClick={handleCardClick}
    >
      <div className={styles.left}>
        <div className={styles.img}>
          <Gallery images={item.images} alt={item.title} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span
            role="checkbox"
            aria-checked={isSelected}
            onClick={() => onSelect(item.id, !isSelected)}
            style={{ display: "inline-flex", cursor: "pointer" }}
          >
            <CheckboxGlyph checked={isSelected} />
          </span>
          <span
            style={{
              ...badgeStyle,
              borderRadius: 4,
              padding: "1px 8px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {status.label}
          </span>
        </label>
      </div>

      <div className={styles.right}>
        <div className={styles.rows}>
          <Row label="Название">
            <span className={styles.titleValue}>{item.title}</span>
          </Row>
          {!!item.isNew && <Row label="Новинка"><CheckboxGlyph checked /></Row>}
          {!!item.isFree && <Row label="Бесплатное"><CheckboxGlyph checked /></Row>}
          {item.categories.length > 0 && <Row label="Категория"><Stack items={item.categories} /></Row>}
          {item.tags.length > 0 && <Row label="Хар-ки"><Stack items={item.tags} /></Row>}
          {!!item.url && (
            <Row label="Ссылка">
              <a href={item.url} target="_blank" rel="noreferrer" className={styles.link}>ссылка</a>
            </Row>
          )}
          {item.instruments.length > 0 && <Row label="Инструмент"><Stack items={item.instruments} /></Row>}
          {item.yarnRanges.length > 0 && (
            <Row label="Толщина нити">
              <span>{item.yarnRanges.map((y) => y.label).join(", ")}</span>
            </Row>
          )}
          {hasDensity && (
            <Row label="Плотность">
              <span>{`${item.densityStitches ?? "—"} х ${item.densityRows ?? "—"}`}</span>
            </Row>
          )}
          {price && (
            <Row label="Цена">
              <span>{price} ₽</span>
            </Row>
          )}
          {oldPrice && (
            <Row label="Старая цена">
              <span className={styles.oldPrice}>{oldPrice} ₽</span>
            </Row>
          )}
          {!!item.yarns?.length && (
            <Row label="Пряжа">
              <span className={styles.yarnChips}>
                {item.yarns.map((y) => (
                  <span key={y.id} className={styles.yarnChip} title={y.name}>{y.name}</span>
                ))}
              </span>
            </Row>
          )}
        </div>

        {status.kind === "rejected" && status.comment && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 2, background: "var(--warning)", color: "var(--surface)", fontSize: 13 }}>
            <MessageCircleX size={16} strokeWidth={1} />
            <span>{status.comment}</span>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" disabled={editDisabled} onClick={() => onEdit(item.id)} block>
            Редактировать
          </Button>
        </div>
      </div>
    </div>
  );
}
