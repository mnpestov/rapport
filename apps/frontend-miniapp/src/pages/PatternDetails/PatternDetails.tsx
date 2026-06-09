import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { fetchPatternById, Pattern } from '../../api/patternsApi';
import './PatternDetails.css';

export const PatternDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!id) return;

    const loadPattern = async () => {
      try {
        const data = await fetchPatternById(id);
        if (isMounted) setPattern(data);
      } catch (err) {
        console.error(err);
        if (isMounted) setError("Описание не найдено");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPattern();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleBack = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div className="details-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Загрузка описания...</p>
      </div>
    );
  }

  if (error || !pattern) {
    return (
      <div className="details-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Описание не найдено</h2>
        <button className="back-button" onClick={handleBack} style={{ marginTop: '16px' }}>← Вернуться в каталог</button>
      </div>
    );
  }

  return (
    <div className="details-container">
      <div className="details-header">
        <button className="back-button" onClick={handleBack}>← Назад</button>
      </div>

      <div className="details-image-wrapper">
        <div className="details-image-container">
          <img src={pattern.imageUrl} alt={pattern.title} className="details-image" />
          <button className="favorite-button" aria-label="Add to favorites">
            <Heart size={32} strokeWidth={1} />
          </button>
          {pattern.isFree && <span className="badge-free badge-free--details">Бесплатно</span>}
        </div>
      </div>

      <div className="details-content">
        <div className="details-row">
          <span className="details-product-type">{pattern.primaryProductType}</span>
        </div>
        <div className="details-row">
          <h1 className="details-title">{pattern.title}</h1>
        </div>

        <div className="details-row-spaced">
          <span className="details-label">Инструмент:</span>
          <span className="details-value">{pattern.instruments.join(', ')}</span>
        </div>

        <div className="details-row-spaced">
          <span className="details-label">Автор:</span>
          <span className="details-value">{pattern.author}</span>
        </div>

        {pattern.tags && pattern.tags.length > 0 && (
          <div className="details-col">
            <span className="details-label">Характеристики:</span>
            <ul className="details-value-list">
              {pattern.tags.map((tag, index) => (
                <li key={index}>{tag}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="details-footer">
        <button className="btn btn--primary details-cta">Перейти к описанию</button>
      </div>
    </div>
  );
};
