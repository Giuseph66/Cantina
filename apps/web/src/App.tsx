import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { OfflineStorage } from './services/OfflineStorage';
import { useApi } from './hooks/useApi';
import ServerDownScreen from './components/ServerDownScreen';
import { onRecovered } from './lib/server-status';
import { useEffect, useState } from 'react';

// Pages — Auth
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Pages — CLIENT
import LandingPage from './pages/LandingPage';
import MenuPage from './pages/client/MenuPage';
import CheckoutPage from './pages/client/CheckoutPage';
import OrderConfirmedPage from './pages/client/OrderConfirmedPage';
import MyOrdersPage from './pages/client/MyOrdersPage';
import ClientDashboardPage from './pages/client/ClientDashboardPage';
import ClientLayout from './components/ClientLayout';
import TotemPage from './pages/totem/TotemPage';

// Pages — CASHIER
import ScannerPage from './pages/cashier/ScannerPage';
import ValidationDetailPage from './pages/cashier/ValidationDetailPage';
import CounterSalePage from './pages/cashier/CounterSalePage';
import CreditNotesPage from './pages/cashier/CreditNotesPage';
import CashOpenPage from './pages/cashier/CashOpenPage';
import CashClosePage from './pages/cashier/CashClosePage';

// Pages — ADMIN
import AdminDashboard from './pages/admin/AdminDashboard';
import ProductsPage from './pages/admin/ProductsPage';
import OrdersPage from './pages/admin/OrdersPage';
import ReportsPage from './pages/admin/ReportsPage';
import SettingsPage from './pages/admin/SettingsPage';
import UsersPage from './pages/admin/UsersPage';
import DashboardPage from './pages/DashboardPage';

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
    const { user, isLoading } = useAuth();
    const location = useLocation();
    if (isLoading) return null;
    if (!user) {
        const next = `${location.pathname}${location.search}`;
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }
    if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
    return <>{children}</>;
}

// Removed RoleRedirect, LandingPage now handles this

function GlobalSyncWorker() {
    const isOnline = useOnlineStatus();
    const api = useApi();
    const { user } = useAuth();

    useEffect(() => {
        if (!isOnline || !user) return; // Só sincroniza se tiver logado e online
        if (user.role !== 'CASHIER' && user.role !== 'ADMIN') return;

        const syncPending = async () => {
            try {
                const queue = await OfflineStorage.getSyncQueue();
                if (queue.length === 0) return;

                console.log(`[Sync Worker] Enviando fila de ${queue.length} consumos...`);
                const res = await api.post<any>('/tickets/sync-consumptions', { consumptions: queue });

                // Remove da fila o que foi enviado/processado com sucesso ou duplicado justificado
                if (res.results) {
                    const syncedIds = res.results.filter((r: any) => r.status === 'synced' || r.status === 'already_consumed').map((r: any) => r.ticketId);
                    await OfflineStorage.clearSyncQueue(syncedIds);
                    console.log(`[Sync Worker] ${syncedIds.length} limpos da fila local.`);
                }
            } catch (err) {
                console.error('[Sync Worker] Falha silenciosa', err);
            }
        };

        // Tenta sincronizar ao detectar online ou a cada 2 minutos conectato
        syncPending();
        const inv = setInterval(syncPending, 120_000);
        return () => clearInterval(inv);
    }, [isOnline, user]);

    // Pode renderizar um mini toast global, mas faremos no ScannerPage para UX
    return null;
}

const routes = (
    <>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route element={<ClientLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/pedido" element={<ProtectedRoute roles={['CLIENT']}><CheckoutPage /></ProtectedRoute>} />
        <Route path="/checkout" element={<Navigate to="/pedido" replace />} />
        <Route path="/order/:orderId" element={<ProtectedRoute roles={['CLIENT']}><OrderConfirmedPage /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute roles={['CLIENT']}><MyOrdersPage /></ProtectedRoute>} />
        <Route path="/minha-conta" element={<ProtectedRoute roles={['CLIENT']}><ClientDashboardPage /></ProtectedRoute>} />
    </Route>

    {/* CASHIER */}
    <Route path="/cashier/scan" element={<ProtectedRoute roles={['CASHIER', 'ADMIN']}><ScannerPage /></ProtectedRoute>} />
    <Route path="/cashier/validate" element={<ProtectedRoute roles={['CASHIER', 'ADMIN']}><ValidationDetailPage /></ProtectedRoute>} />
    <Route path="/cashier/counter" element={<ProtectedRoute roles={['CASHIER', 'ADMIN']}><CounterSalePage /></ProtectedRoute>} />
    <Route path="/cashier/credit-notes" element={<ProtectedRoute roles={['CASHIER', 'ADMIN']}><CreditNotesPage /></ProtectedRoute>} />
    <Route path="/cashier/cash-open" element={<ProtectedRoute roles={['CASHIER', 'ADMIN']}><CashOpenPage /></ProtectedRoute>} />
    <Route path="/cashier/cash-close" element={<ProtectedRoute roles={['CASHIER', 'ADMIN']}><CashClosePage /></ProtectedRoute>} />

    {/* ADMIN */}
    <Route path="/admin" element={<ProtectedRoute roles={['ADMIN']}><AdminDashboard /></ProtectedRoute>} />
    <Route path="/admin/categories" element={<Navigate to="/admin" replace />} />
    <Route path="/admin/products" element={<ProtectedRoute roles={['ADMIN']}><ProductsPage /></ProtectedRoute>} />
    <Route path="/admin/orders" element={<ProtectedRoute roles={['ADMIN']}><OrdersPage /></ProtectedRoute>} />
    <Route path="/admin/reports" element={<ProtectedRoute roles={['ADMIN']}><ReportsPage /></ProtectedRoute>} />
    <Route path="/admin/settings" element={<ProtectedRoute roles={['ADMIN']}><SettingsPage /></ProtectedRoute>} />
    <Route path="/admin/users" element={<ProtectedRoute roles={['ADMIN']}><UsersPage /></ProtectedRoute>} />

    {/* Totem Cozinha/Painel */}
    <Route path="/totem" element={<TotemPage />} />

    <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
    </>
);

/**
 * Remonta a árvore de rotas quando o servidor volta.
 * Sem isso a tela de espera some e a página fica com os dados vazios da
 * requisição que falhou. Auth e Cart ficam acima daqui, então sessão e
 * carrinho sobrevivem à remontagem.
 */
function useReconnectKey() {
    const [key, setKey] = useState(0);
    useEffect(() => onRecovered(() => setKey(current => current + 1)), []);
    return key;
}

function AppRoutes() {
    const reconnectKey = useReconnectKey();
    return <Routes key={reconnectKey}>{routes}</Routes>;
}

export default function App() {
    return (
        <AuthProvider>
            <CartProvider>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <GlobalSyncWorker />
                    <ServerDownScreen />
                    <AppRoutes />
                </BrowserRouter>
            </CartProvider>
        </AuthProvider>
    );
}
