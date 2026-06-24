import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar/Sidebar'

/**
 * Admin shell: persistent sidebar nav + routed content area.
 */
export function AdminLayout() {
  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f9fafb', overflow: 'hidden' }}>
      <Sidebar />

      <main style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
