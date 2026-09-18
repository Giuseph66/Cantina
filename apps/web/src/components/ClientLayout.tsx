import { Outlet } from 'react-router-dom';
import { Header } from './Header';

export default function ClientLayout() {
    return (
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <Header />
            <main style={{ flex: 1 }}>
                <Outlet />
            </main>
        </div>
    );
}
