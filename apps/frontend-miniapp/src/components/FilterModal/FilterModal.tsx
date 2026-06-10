import React, { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { CustomSquareUncheck, CustomSquareCheck, CustomChevronDown, CustomChevronUp } from '../Icons/Icons';
import { fetchFilters, FiltersResponse, FilterOption } from '../../api/patternsApi';
import './FilterModal.css';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedFilters: SelectedFilters) => void;
  initialFilters: SelectedFilters;
}

export interface SelectedFilters {
  categories: string[];
  tags: string[];
  instruments: string[];
  authors: string[];
}

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selectedFilters: SelectedFilters) => void;
  initialFilters: SelectedFilters;
  filtersData: FiltersResponse | null;
  loading: boolean;
}

export const FilterModal: React.FC<FilterModalProps> = ({ isOpen, onClose, onApply, initialFilters, filtersData, loading }) => {
  const [selected, setSelected] = useState<SelectedFilters>(initialFilters);
  const [expandedSections, setExpandedSections] = useState<Array<keyof FiltersResponse>>([]);
  const [filterSearches, setFilterSearches] = useState<Record<keyof FiltersResponse, string>>({
    categories: '',
    tags: '',
    instruments: '',
    authors: ''
  });

  useEffect(() => {
    if (isOpen) {
      setSelected(initialFilters);
    }
  }, [isOpen, initialFilters]);

  if (!isOpen) return null;

  const handleToggle = (section: keyof FiltersResponse, id: string) => {
    setSelected(prev => {
      const currentList = prev[section];
      if (currentList.includes(id)) {
        return { ...prev, [section]: currentList.filter(item => item !== id) };
      } else {
        return { ...prev, [section]: [...currentList, id] };
      }
    });
  };

  const handleReset = () => {
    setSelected({ categories: [], tags: [], instruments: [], authors: [] });
  };

  const handleApply = () => {
    onApply(selected);
    onClose();
  };

  const renderSection = (title: string, sectionKey: keyof FiltersResponse) => {
    const isExpanded = expandedSections.includes(sectionKey);
    const hasData = filtersData && filtersData[sectionKey];
    let options = hasData ? [...filtersData[sectionKey]] : [];
    
    // Alphabetical sort
    options.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    // Apply search
    const q = filterSearches[sectionKey]?.trim().toLowerCase();
    if (q) {
      options = options.filter(o => o.name.toLowerCase().includes(q));
    }

    return (
      <div className="filter-section">
        <button 
          className="filter-section-header" 
          onClick={() => setExpandedSections(prev => 
            prev.includes(sectionKey) ? prev.filter(k => k !== sectionKey) : [...prev, sectionKey]
          )}
        >
          <span className="filter-section-title">{title}</span>
          {isExpanded ? <CustomChevronDown size={32} /> : <CustomChevronUp size={32} />}
        </button>
        {isExpanded && (
          <div className="filter-section-body">
            {sectionKey !== 'instruments' && (
              <div className="filter-search-input-wrapper filter-search-inline">
                <Search size={20} className="filter-search-icon" />
                <input
                  type="text"
                  placeholder="Поиск..."
                  className="filter-search-input"
                  value={filterSearches[sectionKey]}
                  onChange={(e) => setFilterSearches(prev => ({ ...prev, [sectionKey]: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                {filterSearches[sectionKey] && (
                  <button 
                    className="filter-search-clear" 
                    onClick={(e) => { e.stopPropagation(); setFilterSearches(prev => ({ ...prev, [sectionKey]: '' })); }}
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}
            {loading && <p className="filter-loading">Загрузка...</p>}
            {!loading && options.length === 0 && <p className="filter-empty">Ничего не найдено</p>}
            {!loading && options.map((opt: FilterOption) => {
              const isChecked = selected[sectionKey].includes(opt.id);
              return (
                <div 
                  key={opt.id} 
                  className="filter-checkbox-label"
                  onClick={() => handleToggle(sectionKey, opt.id)}
                >
                  <div className="filter-checkbox-custom">
                    {isChecked ? <CustomSquareCheck size={32} /> : <CustomSquareUncheck size={32} />}
                  </div>
                  <span className="filter-checkbox-text">{opt.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="filter-modal-overlay">
      <div className="filter-modal-content">
        <div className="filter-modal-header">
          <button className="filter-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
          <h2 className="filter-modal-title">Фильтр</h2>
          <div style={{width: 24}}></div> {/* Spacer for centering */}
        </div>

        <div className="filter-modal-body">
          {renderSection("Тип изделия", "categories")}
          <div className="filter-divider" />
          {renderSection("Характеристики", "tags")}
          <div className="filter-divider" />
          {renderSection("Инструмент", "instruments")}
          <div className="filter-divider" />
          {renderSection("Автор", "authors")}
        </div>

        <div className="filter-modal-footer">
          <button className="filter-reset-btn" onClick={handleReset}>Сбросить все</button>
          <button 
            className="filter-apply-btn" 
            onClick={handleApply}
            disabled={selected.categories.length === 0 && selected.tags.length === 0 && selected.instruments.length === 0 && selected.authors.length === 0}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};
