import { useState } from "react";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/Modal/ConfirmDialog";
import { AuthorItem } from "../../api/authors";
import {
  grantAuthorCredentials,
  revokePassword,
  resendCredentials,
  revokeAccess,
} from "../../api/authorCredentials";
import toast from "react-hot-toast";
import styles from "./Authors.module.css";

// implementation_plan.md §8 — three states, driven by AuthorItem.cabinet:
//   1. no linked User            → disabled button, tooltip
//   2. User, no credential       → "Выдать доступ"
//   3. User + credential         → login, lastLoginAt, Переотправить / Отозвать пароль / Отозвать доступ
export function CabinetSection({
  author,
  onChanged,
}: {
  author: AuthorItem;
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [confirmRevokeAccess, setConfirmRevokeAccess] = useState(false);
  const [confirmRevokePassword, setConfirmRevokePassword] = useState(false);

  const cabinet = author.cabinet;

  if (!cabinet) {
    return (
      <div className={styles.formGroup}>
        <label>Кабинет автора</label>
        <div className={styles.cabinetRow}>
          <Button variant="secondary" disabled title="Автор не связан с пользователем Rapport">
            Выдать доступ
          </Button>
        </div>
      </div>
    );
  }

  const handleGrant = async () => {
    try {
      setIsBusy(true);
      const result = await grantAuthorCredentials(cabinet.userId, author.id);
      toast.success(
        result.credentialUnchanged
          ? `Доступ выдан. Логин: ${result.login}. У пользователя уже была учётка для входа — пароль не менялся.`
          : `Доступ выдан. Логин: ${result.login}`,
        { duration: 8000 },
      );
      onChanged();
    } catch (err: any) {
      toast.error(err.message || "Не удалось выдать доступ");
    } finally {
      setIsBusy(false);
    }
  };

  const handleResend = async () => {
    try {
      setIsBusy(true);
      const result = await resendCredentials(cabinet.userId);
      toast.success(`Новый временный пароль отправлен. Логин: ${result.login}`, { duration: 6000 });
      onChanged();
    } catch (err: any) {
      toast.error(err.message || "Не удалось переотправить пароль");
    } finally {
      setIsBusy(false);
    }
  };

  const confirmedRevokePassword = async () => {
    setConfirmRevokePassword(false);
    try {
      setIsBusy(true);
      await revokePassword(cabinet.userId);
      toast.success("Пароль отозван");
      onChanged();
    } catch (err: any) {
      toast.error(err.message || "Не удалось отозвать пароль");
    } finally {
      setIsBusy(false);
    }
  };

  const confirmedRevokeAccess = async () => {
    setConfirmRevokeAccess(false);
    try {
      setIsBusy(true);
      await revokeAccess(cabinet.userId);
      toast.success("Доступ к кабинету отозван");
      onChanged();
    } catch (err: any) {
      toast.error(err.message || "Не удалось отозвать доступ");
    } finally {
      setIsBusy(false);
    }
  };

  if (!cabinet.credential) {
    return (
      <div className={styles.formGroup}>
        <label>Кабинет автора</label>
        <div className={styles.cabinetRow}>
          <Button variant="secondary" onClick={handleGrant} disabled={isBusy}>
            {isBusy ? "Выдача..." : "Выдать доступ"}
          </Button>
        </div>
      </div>
    );
  }

  const { login, lastLoginAt, locked } = cabinet.credential;

  return (
    <div className={styles.formGroup}>
      <label>Кабинет автора</label>
      <div className={styles.cabinetInfo}>
        <div>
          Логин: <strong>{login}</strong>
          {locked && <span className={styles.cabinetLockedBadge}>заблокирован</span>}
        </div>
        <div className={styles.tdMuted}>
          Последний вход:{" "}
          {lastLoginAt
            ? new Date(lastLoginAt).toLocaleString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "не входил"}
        </div>
      </div>
      <div className={styles.cabinetRow}>
        <Button variant="secondary" onClick={handleResend} disabled={isBusy}>
          Переотправить пароль
        </Button>
        <Button variant="secondary" onClick={() => setConfirmRevokePassword(true)} disabled={isBusy}>
          Отозвать пароль
        </Button>
        <Button variant="danger" onClick={() => setConfirmRevokeAccess(true)} disabled={isBusy}>
          Отозвать доступ
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmRevokePassword}
        title="Отозвать пароль"
        message="Автор потеряет возможность входа по логину и паролю. Доступ через Telegram и роль автора сохранятся."
        confirmText="Отозвать"
        variant="danger"
        onConfirm={confirmedRevokePassword}
        onCancel={() => setConfirmRevokePassword(false)}
      />

      <ConfirmDialog
        isOpen={confirmRevokeAccess}
        title="Отозвать доступ к кабинету"
        message="Автор потеряет доступ к кабинету полностью: логин и пароль, права AUTHOR_CABINET, роль будет понижена, все активные сессии завершены."
        confirmText="Отозвать доступ"
        variant="danger"
        onConfirm={confirmedRevokeAccess}
        onCancel={() => setConfirmRevokeAccess(false)}
      />
    </div>
  );
}
