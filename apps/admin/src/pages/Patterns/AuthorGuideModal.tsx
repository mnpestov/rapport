import { useEffect, useState, ReactNode } from "react";
import { Check, Pen, Shield, ShieldX, ChevronDown, X, ChevronsUpDown } from "lucide-react";
import { ModalCheckbox } from "./formShared";
import styles from "./AuthorGuideModal.module.css";

// Памятки автора (Figma node-id 1159-6492 / 1159-6582). Показываются один
// раз: закрытие с галочкой «Не показывать больше» пишет флаг в localStorage.
//
//  welcome    — после первого входа автора в кабинет
//  form-rules — при первом нажатии «Добавить описание», поверх формы

type GuideVariant = "welcome" | "form-rules";

const DISMISS_KEY: Record<GuideVariant, string> = {
  welcome: "author_guide_welcome_dismissed",
  "form-rules": "author_guide_form_dismissed",
};

export function isGuideDismissed(variant: GuideVariant): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY[variant]) === "1";
  } catch {
    return false;
  }
}

function markDismissed(variant: GuideVariant): void {
  try {
    localStorage.setItem(DISMISS_KEY[variant], "1");
  } catch {
    // приватный режим — просто покажем в следующий раз
  }
}

function clearDismissed(variant: GuideVariant): void {
  try {
    localStorage.removeItem(DISMISS_KEY[variant]);
  } catch {
    /* noop */
  }
}

interface Props {
  variant: GuideVariant;
  onClose: () => void;
}

export function AuthorGuideModal({ variant, onClose }: Props) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  // Чекбокс «Не показывать больше». Флаг в localStorage пишем сразу по
  // клику — момент закрытия (кнопка/оверлей) уже неважен.
  const [dismissed, setDismissed] = useState(() => isGuideDismissed(variant));
  const toggleDismiss = (v: boolean) => {
    setDismissed(v);
    if (v) markDismissed(variant);
    else clearDismissed(variant);
  };

  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayMouseDown}>
      <div className={styles.modal}>
        <div className={styles.scroll}>
          {variant === "welcome" ? <WelcomeContent /> : <FormRulesContent />}

          <div className={styles.footer}>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              Закрыть
            </button>
            <label className={styles.dismissRow}>
              <ModalCheckbox
                checked={dismissed}
                onChange={toggleDismiss}
                label="Не показывать больше"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Строка статуса: цветной бейдж + название + описание ──────────────────────

function StatusRow({
  icon,
  bg,
  name,
  children,
}: {
  icon: ReactNode;
  bg: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.statusRow}>
      <div className={styles.statusHead}>
        <span className={styles.statusBadge} style={{ background: bg }}>
          {icon}
        </span>
        <span className={styles.statusName}>{name}</span>
      </div>
      <p className={styles.statusText}>{children}</p>
    </div>
  );
}

// ── Памятка 1: приветствие ──────────────────────────────────────────────────

function WelcomeContent() {
  return (
    <div className={styles.body}>
      <div className={styles.introCentered}>
        <h2 className={styles.h2}>Привет, вы получили доступ к Кабинету автора</h2>
        <p className={styles.paragraph}>
          Кабинет автора — это ваше рабочее пространство на платформе «Раппорт»,
          созданное для полного контроля над каталогом описаний. Здесь вы можете
          оперативно добавлять новые карточки, редактировать уже опубликованные
          материалы, корректировать цены и характеристики, а также поддерживать
          актуальность всех ваших изделий в едином каталоге сервиса.
        </p>
        <p className={styles.paragraphItalic}>
          Обратите внимание: интерфейс кабинета оптимизирован для десктопных
          устройств — для комфортной работы мы рекомендуем использовать компьютер
          или ноутбук.
        </p>
        <p className={styles.paragraphItalic}>
          Если в процессе работы вы заметите ошибку, неточность или у вас
          возникнут вопросы, — напишите нам. Мы всегда на связи и поможем
          разобраться.
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.h3}>
          Руководство автора по добавлению и управлению описаниями в «Раппорт»
        </h3>
        <div className={styles.sectionHeader}>Личный кабинет. Основное.</div>

        <div className={styles.statusList}>
          <StatusRow
            icon={<Check size={14} strokeWidth={1.5} color="#ffffff" />}
            bg="var(--brand-bright)"
            name="Опубликовано"
          >
            описание прошло проверку и отображается в общем каталоге приложения.
          </StatusRow>
          <StatusRow
            icon={<Pen size={13} strokeWidth={1.5} color="#000000" />}
            bg="#E5E5E5"
            name="Черновики"
          >
            созданные, но ещё не отправленные описания. В этом статусе карточку
            можно свободно редактировать и удалять.
          </StatusRow>
          <StatusRow
            icon={<Shield size={13} strokeWidth={1.5} color="#000000" />}
            bg="#BEC1F4"
            name="На модерации"
          >
            описание проверяется командой «Раппорт». Редактировать, удалять или
            отзывать описание на этапе модерации нельзя.
          </StatusRow>
          <StatusRow
            icon={<ShieldX size={13} strokeWidth={1.5} color="#ffffff" />}
            bg="var(--warning)"
            name="Отклонено"
          >
            модератор вернул карточку с замечаниями.
          </StatusRow>

          <ul className={styles.bullets}>
            <li>Причина отклонения отображается в оранжевом блоке.</li>
            <li>
              Нажмите иконку карандаша, исправьте указанные недочёты и повторно
              отправьте карточку<br /> на проверку.
            </li>
            <li>Отклонённое описание при необходимости можно удалить.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Памятка 2: правила заполнения карточки ──────────────────────────────────
//
// Два столбца: слева — превью поля формы (label + статичный контрол, вид как
// в реальной форме создания), справа — заголовок поля и текст-правило.

function Rule({
  preview,
  title,
  children,
}: {
  preview: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.rule}>
      <div className={styles.rulePreview}>{preview}</div>
      <div className={styles.ruleBody}>
        <p className={styles.fieldTitle}>{title}</p>
        {children}
      </div>
    </div>
  );
}

// ── Статичные превью контролов (только вид, без интерактива) ─────────────────

function PreviewLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <p className={styles.pvLabel}>
      {text}
      {required && <span className={styles.pvRequired}>*</span>}
    </p>
  );
}

function PreviewInput({
  label,
  value,
  placeholder,
  required,
  highlighted,
  trailingIcon,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  highlighted?: boolean;
  trailingIcon?: ReactNode;
}) {
  return (
    <div className={styles.pvField}>
      <PreviewLabel text={label} required={required} />
      <div
        className={`${styles.pvInput} ${highlighted ? styles.pvInputActive : ""}`}
      >
        <span className={value ? styles.pvValue : styles.pvPlaceholder}>
          {value ?? placeholder}
        </span>
        {trailingIcon && <span className={styles.pvTrailing}>{trailingIcon}</span>}
      </div>
    </div>
  );
}

function PreviewSelect({
  label,
  chip,
  placeholder,
  required,
}: {
  label: string;
  chip?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className={styles.pvField}>
      <PreviewLabel text={label} required={required} />
      <div className={styles.pvInput}>
        {chip ? (
          <span className={styles.pvChip}>
            {chip}
            <X size={12} strokeWidth={1.5} />
          </span>
        ) : (
          <span className={styles.pvPlaceholder}>{placeholder}</span>
        )}
        <span className={styles.pvTrailing}>
          <ChevronDown size={18} strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

function PreviewCheckbox({ label }: { label: string }) {
  return (
    <div className={styles.pvCheckbox}>
      <span className={styles.pvCheckboxBox} />
      <span className={styles.pvCheckboxLabel}>{label}</span>
    </div>
  );
}

function PreviewPairInputs({
  label,
  left,
  right,
  leftCaption,
  rightCaption,
}: {
  label: string;
  left: string;
  right: string;
  leftCaption: string;
  rightCaption: string;
}) {
  return (
    <div className={styles.pvField}>
      <PreviewLabel text={label} />
      <div className={styles.pvPair}>
        <div className={styles.pvPairCol}>
          <div className={styles.pvSmallInput}>{left}</div>
          <span className={styles.pvCaption}>{leftCaption}</span>
        </div>
        <span className={styles.pvTimes}>×</span>
        <div className={styles.pvPairCol}>
          <div className={styles.pvSmallInput}>{right}</div>
          <span className={styles.pvCaption}>{rightCaption}</span>
        </div>
      </div>
    </div>
  );
}

function PreviewPlus({ label }: { label: string }) {
  return (
    <div className={styles.pvField}>
      <PreviewLabel text={label} />
      <div className={styles.pvPlus}>+</div>
    </div>
  );
}

function FormRulesContent() {
  return (
    <div className={styles.body}>
      <div className={styles.intro}>
        <h2 className={styles.h3}>Правила заполнения карточки описания</h2>
        <p className={styles.paragraphItalic}>
          Чем подробнее и точнее заполнена карточка, тем выше вероятность её
          попадания в раздел «Популярное» и тем проще пользователям найти её по
          фильтрам.
        </p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>Основные параметры</div>

        <div className={styles.ruleList}>
          <Rule
            preview={<PreviewInput label="Название" value="Барбарис" required highlighted />}
            title="Название"
          >
            <ul className={styles.bullets}>
              <li>Делайте его ёмким и лаконичным.</li>
              <li>
                Можно использовать хештег изделия из социальных сетей (например,
                #сумка_кругивквадрате).
              </li>
              <li>
                Если тип изделия уже есть в категориях «Раппорта», дублировать его
                в названии не нужно.
              </li>
              <li>
                Не используйте слова: «мастер-класс», «МК», «описание» и т. п.
              </li>
            </ul>
          </Rule>

          <Rule
            preview={<PreviewSelect label="Категория" chip="джемпер" required />}
            title="Категория"
          >
            выберите категорию, максимально точно характеризующую изделие (не
            более 2 категорий на одно описание).
          </Rule>

          <Rule preview={<PreviewCheckbox label="Новое" />} title="Новинка">
            отметьте чекбокс, если это свежий релиз.
          </Rule>

          <Rule preview={<PreviewCheckbox label="Бесплатное" />} title="Бесплатное">
            отметьте чекбокс, если описание распространяется бесплатно.
          </Rule>

          <Rule
            preview={<PreviewInput label="Характеристики" value="Ажур" />}
            title="Характеристики"
          >
            <p className={styles.fieldText}>
              ключевой инструмент поиска в каталоге. Выберите подходящие теги из
              списка (максимум 4 характеристики на карточку)
            </p>
            <ul className={styles.bullets}>
              <li>
                Вырезы и воротники: V-образный вырез, Круглый вырез, Высокий
                ворот, Акцентный воротник.
              </li>
              <li>
                Покрой / детали кроя: Реглан, Реглан-погон, Японское плечо,
                Спущенное плечо, Сшивное изделие, Круглая кокетка, Капюшон.
              </li>
              <li>
                Узоры и техники вязания: Ажуры, Араны, Косы, Жаккард, Интарсия,
                Филейная техника, Мотивы, Бахрома, Бабушкин квадрат, Полоска,
                Узор.
              </li>
              <li>Застёжки и фурнитура: Пуговицы, Молния, Фермуар.</li>
              <li>Назначение: Мужское, Детское, Летнее, Фантазийное.</li>
              <li>Материалы: Мохер.</li>
              <li>Аксессуары / дополнения: Аксессуары, Головные уборы.</li>
            </ul>
          </Rule>

          <Rule
            preview={
              <PreviewInput label="Ссылка" placeholder="Вставить ссылку" required />
            }
            title="Ссылка"
          >
            прямая ссылка на ресурс, где пользователь может приобрести или скачать
            описание (сайт, соцсеть, маркетплейс).
          </Rule>

          <Rule
            preview={
              <PreviewSelect
                label="Инструмент"
                placeholder="Инструмент"
              />
            }
            title="Инструмент"
          >
            выберите инструмент, которым выполняется работа.
          </Rule>

          <Rule
            preview={
              <PreviewInput
                label="Пряжа"
                placeholder="Начните вводить название пряжи"
              />
            }
            title="Пряжа"
          >
            <p className={styles.fieldText}>
              начните вводить название/артикул рекомендованной пряжи и выберите
              нужный вариант из выпадающего списка.
            </p>
            <ul className={styles.bullets}>
              <li>
                Если нужного артикула нет в базе — нажмите «Создать артикул». В
                открывшемся окне заполните Бренд, Линейку, метраж (м/100г),
                состав. Плотность, указанную на мотке, заполнять не обязательно,
                но если знаете — будет здорово.
              </li>
            </ul>
          </Rule>

          <Rule
            preview={
              <PreviewInput
                label="Толщина пряжи"
                placeholder="Толщина пряжи"
                required
                trailingIcon={<ChevronsUpDown size={14} strokeWidth={1.5} />}
              />
            }
            title="Толщина пряжи (м/100г):"
          >
            выберите метражный диапазон, в который попадает рекомендованная пряжа
            (например, 251–350).
          </Rule>

          <Rule
            preview={
              <PreviewPairInputs
                label="Плотность (петли × ряды) в лицевой глади"
                left="46"
                right="52"
                leftCaption="Петли"
                rightCaption="Ряды"
              />
            }
            title="Плотность (петли × ряды) в лицевой глади"
          >
            укажите количество петель и рядов в стандартном образце 10 × 10 см.
          </Rule>

          <Rule
            preview={
              <PreviewPairInputs
                label="Цена, ₽"
                left=""
                right=""
                leftCaption="Текущая"
                rightCaption="Старая (если есть скидка)"
              />
            }
            title="Цена, ₽"
          >
            укажите актуальную стоимость. Для бесплатных описаний оставьте поле
            пустым.
          </Rule>

          <Rule preview={<PreviewPlus label="Фото" />} title="Фото">
            <ul className={styles.bullets}>
              <li>
                Загрузите до 5 качественных фотографий изделия с разных ракурсов
                при хорошем освещении.
              </li>
              <li>
                Первое фото в списке автоматически становится главной обложкой.
                Меняйте порядок изображений простым перетаскиванием
                (drag-and-drop).
              </li>
            </ul>
          </Rule>

          <Rule preview={<PreviewPlus label="Подробности" />} title="Подробности">
            поле для свободных заметок (материалы, техника, размеры). На данный
            момент носит служебный характер и не отображается покупателям в
            каталоге.
          </Rule>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>Сохранение и публикация</div>
        <p className={styles.fieldText}>В нижней части формы доступны два действия:</p>
        <ol className={styles.numbered}>
          <li>
            «Сохранить» — сохраняет карточку в раздел «Черновики». Вы сможете
            вернуться к её заполнению и редактированию в любое удобное время.
          </li>
          <li>
            «Отправить на модерацию» — сразу отправляет готовую карточку на
            проверку модераторам сервиса.
          </li>
        </ol>
      </div>
    </div>
  );
}
