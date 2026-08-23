import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { UnreadProvider } from '../contexts/UnreadContext'
import { getCabinetAuthor } from '../api/cabinet'
import styles from './AdminLayout.module.css'

interface AdminLayoutProps {
  variant?: 'admin' | 'author'
}

export function AdminLayout({ variant = 'admin' }: AdminLayoutProps) {
  const [authorName, setAuthorName] = useState('')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (variant !== 'author') return
    getCabinetAuthor()
      .then(({ author }) => setAuthorName(author.name))
      .catch(() => {})
  }, [variant]);

  const content = (
    <div className={styles.container}>
      <div className={styles.mobileHeader}>
        <button className={styles.menuBtn} onClick={() => setIsMobileMenuOpen(true)}>
          <Menu size={24} />
        </button>
        <img src="/logo-dark.svg" alt="Rapport" className={styles.mobileLogo} />
      </div>

      <Sidebar 
        variant={variant} 
        subtitle={variant === 'author' ? authorName : undefined} 
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )

  return variant === 'author' ? content : <UnreadProvider>{content}</UnreadProvider>
}
