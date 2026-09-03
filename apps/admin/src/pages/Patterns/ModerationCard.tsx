import { ReactNode, useRef, useState } from "react";
import { Button } from "../../components/Button/Button";
import { AdminDraft } from "../../api/admin-drafts";
import { API_URL } from "../../api/config";
import styles from "./ModerationCard.module.css";

interface ModerationCardProps {
  draft: AdminDraft;
  onApprove: (id: string) => Promise<void>;
  onReject: (draft: AdminDraft) => void;
  onEdit?: (draft: AdminDraft) => void;
  /** Клик по карточке (кроме кнопок и ссылок) — открыть просмотр. */
  onView?: (draft: AdminDraft) => void;
  approveLabel?: string;
  rejectLabel?: string;
}

function getImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Целые/дробные рубли без лишних нулей ("800.00" -> "800", "799.50" -> "799.5").
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

// Листаемая галерея — тот же приём, что PatternDetails в mini-app:
// CSS scroll-snap + точки, без библиотеки. Одно фото рендерится само по себе.
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

export function ModerationCard({ draft, onApprove, onReject, onEdit, onView, approveLabel = "Опубликовать", rejectLabel = "Отклонить" }: ModerationCardProps) {
  const price = formatPrice(draft.price);
  const oldPrice = formatPrice(draft.oldPrice);
  const hasDensity = draft.densityStitches != null || draft.densityRows != null;

  // Клик по карточке открывает просмотр — но не по кнопкам/ссылкам/точкам
  // галереи (у них своя обработка + stopPropagation).
  const handleCardClick = (e: React.MouseEvent) => {
    if (!onView) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a")) return;
    onView(draft);
  };

  return (
    <div
      className={`${styles.card}${onView ? " " + styles.cardClickable : ""}`}
      onClick={handleCardClick}
    >
      <div className={styles.left}>
        <div className={styles.img}>
          <Gallery images={draft.images} alt={draft.title} />
        </div>
        <div className={styles.authorName}>{draft.author.name}</div>
        <div className={styles.row}>
          <span className={styles.label}>Дата</span>
          <span className={styles.value}>{new Date(draft.createdAt).toLocaleDateString("ru-RU")}</span>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.rows}>
          <Row label="Название">
            <span className={styles.titleValue}>{draft.title}</span>
            {draft.patternId && <span className={styles.editBadge}>Правка</span>}
          </Row>
          {!!draft.isNew && <Row label="Новинка"><CheckboxGlyph checked={draft.isNew} /></Row>}
          {!!draft.isFree && <Row label="Бесплатное"><CheckboxGlyph checked={draft.isFree} /></Row>}
          {draft.categories.length > 0 && <Row label="Категория"><Stack items={draft.categories} /></Row>}
          {draft.tags.length > 0 && <Row label="Хар-ки"><Stack items={draft.tags} /></Row>}
          {!!draft.url && (
            <Row label="Ссылка">
              <a href={draft.url} target="_blank" rel="noreferrer" className={styles.link}>ссылка</a>
            </Row>
          )}
          {draft.instruments.length > 0 && <Row label="Инструмент"><Stack items={draft.instruments} /></Row>}
          {draft.yarnRanges.length > 0 && (
            <Row label="Толщина нити">
              <span>{draft.yarnRanges.map((y) => y.label).join(", ")}</span>
            </Row>
          )}
          {hasDensity && (
            <Row label="Плотность">
              <span>{`${draft.densityStitches ?? "—"} х ${draft.densityRows ?? "—"}`}</span>
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
          {/* Распознанные артикулы — чипами, нераспознанные упоминания —
              сырыми строками. Разделение намеренное: первое модератору
              достаточно взглядом проверить, второе требует решения. */}
          {!!draft.yarns?.length && (
            <Row label="Пряжа">
              <span className={styles.yarnChips}>
                {draft.yarns.map((y) => (
                  <span key={y.id} className={styles.yarnChip} title={y.name}>{y.name}</span>
                ))}
              </span>
            </Row>
          )}
          {!!draft.yarnMentions?.length && (
            <Row label="Не опознано">
              <span className={styles.yarnChips}>
                {draft.yarnMentions.map((m) => (
                  <span key={m.rawText} className={styles.yarnMention} title={
                    m.kind === "FAMILY" ? "семейство, а не артикул"
                      : m.kind === "BRAND_ONLY" ? "названа только марка" : "нет в справочнике"
                  }>
                    {m.rawText}
                  </span>
                ))}
              </span>
            </Row>
          )}
        </div>

        <div className={styles.actions}>
          <Button onClick={() => onApprove(draft.id)}>
            {approveLabel}
          </Button>
          <Button variant="danger" onClick={() => onReject(draft)}>
            {rejectLabel}
          </Button>
          {onEdit && (
            <Button variant="secondary" onClick={() => onEdit(draft)}>
              Редактировать
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
