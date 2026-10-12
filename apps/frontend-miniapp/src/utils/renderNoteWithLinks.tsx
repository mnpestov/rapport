import React from 'react';

// Разбивает произвольный текст заметки на фрагменты, находит URL
// (http:// и https://) и рендерит их как кликабельные ссылки.
// Открывается в браузере через target="_blank" — в Telegram WebView это
// означает InAppBrowser или системный браузер в зависимости от клиента.
// Общий для карточки пряжи (StashSkeinDetails.tsx) и карточки проекта
// (ProjectDetails.tsx) — те же .stash-notes-text/.stash-note-link классы
// (StashSkeinDetails.css, который ProjectDetails.tsx уже импортирует).
const URL_REGEX = /https?:\/\/[^\s]+/g;

export function renderNoteWithLinks(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // reset перед каждым вызовом (глобальные regex имеют состояние)
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="stash-note-link"
        // Не всплываем клик выше — карточка/кнопка-предок (и переключение
        // заметки в режим редактирования по клику) не должны реагировать
        // на тап по ссылке внутри текста.
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}
