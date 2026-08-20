import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, MailCheck } from 'lucide-react';
import { submitErrorReport } from '../../api/reportApi';
import { useSheetTransition } from '../../hooks/useSheetTransition';
import '../../styles/sheet.css';
import './ReportErrorModal.css';

interface ReportErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

export const ReportErrorModal: React.FC<ReportErrorModalProps> = ({ isOpen, onClose }) => {
  // Держит шторку в дереве на время выезда вниз и даёт класс для
  // открытого состояния — сам по себе `isOpen` размонтировал бы её
  // мгновенно, до анимации закрытия.
  const { isMounted, isVisible, sheetRef } = useSheetTransition(isOpen);
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setStep('form');
      setMessage('');
      setScreenshot(null);
      setFileError(null);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isMounted) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-selecting the same file after removing it
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Поддерживаются только JPG и PNG');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('Файл больше 5MB');
      return;
    }
    setFileError(null);
    setScreenshot(file);
  };

  const handleSubmit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const ok = await submitErrorReport(message.trim(), screenshot);
    setSubmitting(false);
    if (ok) {
      setStep('success');
    } else {
      setSubmitError('Не удалось отправить сообщение. Попробуйте ещё раз.');
    }
  };

  return (
    <div ref={sheetRef} className={`report-modal-overlay sheet-overlay ${isVisible ? 'sheet-open' : ''}`} onClick={onClose}>
      <div className="report-modal-content sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-grabber" />

        {step === 'form' ? (
          <>
            <div className="report-modal-header">
              <h2 className="report-modal-title">Сообщить об ошибке</h2>
              <p className="report-modal-subtitle">
                Помогите нам стать лучше.
                <br />
                Если вы нашли неточность или сбой, опишите проблему ниже.
              </p>
            </div>

            <div className="report-modal-body">
              <div className="report-field">
                <span className="report-field-label">Описание ошибки</span>
                <textarea
                  className="report-textarea"
                  placeholder="Введите детали..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={4}
                />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="report-file-input"
                onChange={handleFileChange}
              />
              <div className="report-attach-row">
                <button type="button" className="report-attach-btn" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip size={16} />
                  Прикрепить файл (JPG/PNG, до 5MB)
                </button>
                {screenshot && (
                  <button type="button" className="report-attach-filename" onClick={() => setScreenshot(null)}>
                    [ {screenshot.name} ]
                  </button>
                )}
              </div>
              {fileError && <p className="report-error-text">{fileError}</p>}
              {submitError && <p className="report-error-text">{submitError}</p>}
            </div>

            <div className="report-modal-buttons">
              <button
                type="button"
                className="report-submit-btn"
                onClick={handleSubmit}
                disabled={!message.trim() || submitting}
              >
                {submitting ? 'Отправка...' : 'Отправить'}
              </button>
              <button type="button" className="report-close-btn" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </>
        ) : (
          <div className="report-modal-success">
            <MailCheck size={107} strokeWidth={0.75} color="#A9AE36" />
            <div className="report-success-text-group">
              <h2 className="report-modal-title">Спасибо за вашу бдительность!</h2>
              <p className="report-success-text">
                Мы получили ваше сообщение и обязательно проверим информацию в ближайшее время.
              </p>
            </div>
            <div className="report-modal-buttons">
              <button type="button" className="report-close-btn" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
