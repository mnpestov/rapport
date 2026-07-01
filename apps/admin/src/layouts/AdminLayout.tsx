import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar/Sidebar'
import { UnreadProvider } from '../contexts/UnreadContext'

export function AdminLayout() {
  return (
    <UnreadProvider>
      <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f9fafb', overflow: 'hidden' }}>
        <Sidebar />

        <main style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </UnreadProvider>
  )
}
