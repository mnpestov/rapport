import { useEffect, useState } from "react";
import { getYarnStats, YarnStats } from "../../api/yarns";
import styles from "./YarnCoverage.module.css";

const RULE_LABEL: Record<string, string> = {
  EXACT: "точное",
  PARTIAL: "частичное",
  SHORT_FORM: "краткое написание",
  BRAND_LEVEL: "уровень бренда",
  GENERIC: "родовое название",
  MANUAL: "вручную",
  FAMILY: "по семейству",
  LINE_NAME: "по названию линейки",
  AUTHOR_METRAGE: "метраж автора",
};

const KIND_LABEL: Record<string, string> = {
  FAMILY: "семейство, а не артикул",
  BRAND_ONLY: "названа только марка",
  UNKNOWN_ARTICLE: "нет в справочнике",
};

/**
 * Покрытие описаний артикулами пряжи.
 *
 * Периода у виджета нет: это состояние справочника и связей на сейчас, а не
 * поток событий. Главное здесь — не доля покрытия (она упирается в потолок,
 * который справочником не лечится), а два счётчика внизу: они показывают,
 * что связи начали расходиться с данными.
 */
export function YarnCoverage() {
  const [stats, setStats] = useState<YarnStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getYarnStats().then(setStats).catch(() => setError(true));
  }, []);

  if (error || !stats) return null;

  const share = stats.patternsWithDetails
    ? Math.round((stats.patternsWithYarn / stats.patternsWithDetails) * 1000) / 10
    : 0;
  const mentionsTotal = stats.mentionsByKind.reduce((a, m) => a + m.count, 0);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Пряжа: покрытие описаний</span>
        <span className={styles.subtitle}>
          Состояние на сейчас — пересчитывается прогоном разбора, а не по событиям
        </span>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <div className={styles.value}>{stats.patternsWithYarn}</div>
          <div className={styles.label}>Описаний с артикулом</div>
          <div className={styles.hint}>
            {share}% от {stats.patternsWithDetails} с подробностями
          </div>
        </div>
        <div className={styles.cell}>
          <div className={styles.value}>{stats.links}</div>
          <div className={styles.label}>Связей всего</div>
          <div className={styles.hint}>
            {stats.linksByRule.map((r) => `${RULE_LABEL[r.rule] ?? r.rule} ${r.count}`).join(" · ")}
          </div>
        </div>
        <div className={styles.cell}>
          <div className={styles.value}>{mentionsTotal}</div>
          <div className={styles.label}>Упоминаний отложено</div>
          <div className={styles.hint}>
            {stats.mentionsByKind.map((m) => `${KIND_LABEL[m.kind] ?? m.kind} ${m.count}`).join(" · ")}
          </div>
        </div>
        <div className={styles.cell}>
          <div className={styles.value}>
            {stats.genericLinks.reduce((a, g) => a + g.count, 0)}
          </div>
          <div className={styles.label}>Связей на родовые</div>
          <div className={styles.hint}>
            {stats.genericLinks.map((g) => `${g.name} ${g.count}`).join(" · ") || "нет"}
          </div>
        </div>
      </div>

      {/* Два счётчика ниже — не статистика, а сигнал. В норме оба нули. */}
      {(stats.staleLinks > 0 || stats.brandLevelNoLongerPassing > 0) && (
        <div className={styles.alerts}>
          {stats.staleLinks > 0 && (
            <div className={styles.alert}>
              <b>{stats.staleLinks}</b> связей собраны не с текущего текста описания — подробности
              правили после разбора. Лечится перезапуском бэкофила.
            </div>
          )}
          {stats.brandLevelNoLongerPassing > 0 && (
            <div className={styles.alert}>
              <b>{stats.brandLevelNoLongerPassing}</b> связей уровня бренда держатся на правиле,
              которое сейчас не сработало бы: у марки появилась линейка с другим метражом.
            </div>
          )}
        </div>
      )}

      {stats.topUnresolved.length > 0 && (
        <div className={styles.top}>
          <div className={styles.topTitle}>
            Чаще всего просят, а карточки нет — рабочий список на пополнение
          </div>
          <div className={styles.topList}>
            {stats.topUnresolved.map((t) => (
              <span key={t.rawText + t.kind} className={styles.topItem} title={KIND_LABEL[t.kind] ?? t.kind}>
                {t.rawText}
                <span className={styles.topCount}>{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
