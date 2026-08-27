import { useState } from "react";
import { Button } from "../../components/Button/Button";
import { Modal } from "../../components/Modal/Modal";
import { YarnItem } from "../../api/yarns";
import { YarnPicker, PickedYarn } from "../../components/YarnPicker/YarnPicker";
import styles from "./Yarns.module.css";

interface Props {
  source: YarnItem;
  onClose: () => void;
  onMerge: (targetId: string) => void;
}

/**
 * Слияние дублей. Карточка-источник не исчезает: связи на неё уже разошлись
 * по описаниям, и удаление порвало бы их. Она помечается ссылкой на
 * победителя, а её название уезжает в написания — автор мог написать именно
 * так, и поиск должен продолжать находить.
 */
export function YarnMergeModal({ source, onClose, onMerge }: Props) {
  const [target, setTarget] = useState<PickedYarn[]>([]);

  return (
    <Modal isOpen onClose={onClose} title="Слить артикул" maxWidth={460}>
      <div className={styles.mergeBody}>
          <p className={styles.mergeText}>
            «<b>{source.name}</b>»
            {source._count.patterns > 0 && ` (${source._count.patterns} опис.)`} перестанет быть
            отдельной карточкой. Все его связи и написания перейдут к выбранному артикулу, а само
            название станет ещё одним написанием.
          </p>
          <YarnPicker
            value={target}
            onChange={(v) => setTarget(v.slice(-1))}
          />
        </div>

      <div className={styles.modalFoot}>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button
          disabled={target.length === 0 || target[0].id === source.id}
          onClick={() => onMerge(target[0].id)}
        >
          Слить
        </Button>
      </div>
    </Modal>
  );
}
