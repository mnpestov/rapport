import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal/Modal";
import { getReportById, processSyncBatch, rejectSyncItem, SyncReport, SyncReportItem } from "../../api/authors";
import toast from "react-hot-toast";
import styles from "./Authors.module.css";
import { Loader2 } from "lucide-react";
import { ModerationCard } from "../Patterns/ModerationCard";
import { AdminDraft } from "../../api/admin-drafts";

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string | null;
  authorName: string;
  onSuccess: () => void;
}

export function SyncModal({ isOpen, onClose, reportId, authorName, onSuccess }: SyncModalProps) {
  const [report, setReport] = useState<SyncReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && reportId) {
      loadReport();
    }
  }, [isOpen, reportId]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const data = await getReportById(reportId!);
      setReport(data);
    } catch (e: any) {
      toast.error(e.message || "Ошибка загрузки отчета");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await processSyncBatch(reportId!, [{ itemId: id }]);
      toast.success("Сгенерировано в архив");
      
      const newItems = report?.items?.filter(i => i.id !== id);
      if (newItems && newItems.length === 0) {
        onSuccess();
        onClose();
      } else {
        setReport(prev => prev ? { ...prev, items: newItems } : null);
        onSuccess(); // Refresh sidebar/authors list since count might change
      }
    } catch (e: any) {
      toast.error(e.message || "Ошибка при генерации");
    }
  };

  const handleReject = async (draft: AdminDraft) => {
    try {
      await rejectSyncItem(draft.id);
      toast.success("Отклонено");
      
      const newItems = report?.items?.filter(i => i.id !== draft.id);
      if (newItems && newItems.length === 0) {
        onSuccess();
        onClose();
      } else {
        setReport(prev => prev ? { ...prev, items: newItems } : null);
      }
    } catch (e: any) {
      toast.error(e.message || "Ошибка при отклонении");
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Новинки: ${authorName}`} maxWidth={1024} noPadding={true}>
      <div style={{ minWidth: "1000px", padding: "16px", boxSizing: "border-box", maxHeight: "calc(90vh - 80px)", overflowY: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
            <Loader2 className={styles.spinner} size={32} />
          </div>
        ) : !report?.items?.length ? (
          <div style={{ padding: "40px", textAlign: "center" }}>Нет новых описаний для проверки.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))", gap: "16px" }}>
            {report.items.map(item => {
              const pd = item.parsedData || {};
              const draft: AdminDraft = {
                id: item.id,
                patternId: null,
                pattern: null,
                authorId: report.authorId,
                title: item.title,
                url: item.url,
                imageUrl: pd.imageUrl || "",
                isNew: true,
                isFree: pd.isFree || false,
                densityStitches: pd.densityStitches || null,
                densityRows: pd.densityRows || null,
                status: "PENDING",
                author: { id: report.authorId, name: authorName },
                categories: pd.categories || [],
                tags: pd.tags || [],
                instruments: pd.instruments || [],
                yarnRanges: pd.yarnRanges || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                closedAt: null,
                moderationComment: null,
              };

              return (
                <ModerationCard 
                  key={item.id} 
                  draft={draft} 
                  onApprove={handleApprove} 
                  onReject={handleReject}
                  approveLabel="В архив"
                />
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
