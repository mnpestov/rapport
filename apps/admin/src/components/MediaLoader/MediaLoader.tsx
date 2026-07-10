import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../../api/fetchWithAuth';
import styles from './MediaLoader.module.css';

interface Props {
  url: string;
  children: (objectUrl: string) => React.ReactNode;
  className?: string;
}

export function MediaLoader({ url, children, className }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
      try {
        const res = await fetchWithAuth(url);
        if (!res.ok) throw new Error('media load failed');
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  if (state === 'loading') {
    return <div className={`${styles.skeleton} ${className ?? ''}`} />;
  }

  if (state === 'error') {
    return <div className={`${styles.error} ${className ?? ''}`}>⚠</div>;
  }

  return <>{children(objectUrl!)}</>;
}
