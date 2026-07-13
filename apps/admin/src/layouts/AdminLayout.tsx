import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { UnreadProvider } from '../contexts/UnreadContext'
import { getCabinetAuthor } from '../api/cabinet'

interface AdminLayoutProps {
  variant?: 'admin' | 'author'
}

export function AdminLayout({ variant = 'admin' }: AdminLayoutProps) {
  const [authorName, setAuthorName] = useState('')

  useEffect(() => {
    if (variant !== 'author') return
    getCabinetAuthor()
      .then(({ author }) => setAuthorName(author.name))
      .catch(() => {})
  }, [variant]);

  const content = (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f9fafb', overflow: 'hidden' }}>
      <Sidebar variant={variant} subtitle={variant === 'author' ? authorName : undefined} />

      <main style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )

  return variant === 'author' ? content : <UnreadProvider>{content}</UnreadProvider>
}
