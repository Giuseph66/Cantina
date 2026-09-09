import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
    LogOut, Package, Settings as SettingsIcon, Store,
    TrendingUp, ClipboardList, Menu, X, ChevronLeft, ChevronRight,
    QrCode, ShoppingBag, Wallet, Users, NotebookText, BarChart3,
} from 'lucide-react';
import styles from '../../pages/admin/Admin.module.css';

interface AdminLayoutProps {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
}

function NavSection({ label, collapsed }: { label: string; collapsed: boolean }) {
    if (collapsed) return <div className={styles.navDivider} />;
    return <p className={styles.navSection}>{label}</p>;
}

export function AdminLayout({ children, title, subtitle }: AdminLayoutProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const { logout } = useAuth();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const isDrawerCollapsed = isCollapsed && !isMobileOpen;

    const isActive = (path: string) => location.pathname === path;

    const go = (path: string) => { navigate(path); setIsMobileOpen(false); };

    return (
        <div className={`${styles.page} ${isDrawerCollapsed ? styles.pageCollapsed : ''}`}>
            {/* Mobile Header */}
            <header className={styles.mobileHeader}>
                <div className={styles.mobileLogo}>
                    <Store size={24} strokeWidth={3} />
                    <span>Cantina</span>
                </div>
                <button aria-label={isMobileOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={isMobileOpen} className={styles.menuBtn} onClick={() => setIsMobileOpen(o => !o)}>
                    {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </header>

            {isMobileOpen && <div className={styles.overlay} onClick={() => setIsMobileOpen(false)} />}

            <aside className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarMobileOpen : ''} ${isDrawerCollapsed ? styles.sidebarCollapsed : ''}`}>
                <div className={styles.sidebarHeader}>
                    <div className={styles.logo}>
                        <Store size={isDrawerCollapsed ? 28 : 32} strokeWidth={3} />
                        {!isDrawerCollapsed && <span>Cantina</span>}
                    </div>
                    {!isDrawerCollapsed && <span className={styles.logoSub}>Painel Administrativo</span>}
                </div>

                <nav className={styles.nav}>
                    {/* ── Administração ── */}
                    <NavSection label="Administração" collapsed={isDrawerCollapsed} />

                    <button className={`${styles.navBtn} ${isActive('/admin') ? styles.activeNav : ''}`}
                        onClick={() => go('/admin')} title="Dashboard">
                        <TrendingUp size={20} />
                        {!isDrawerCollapsed && <span>Dashboard</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/admin/products') ? styles.activeNav : ''}`}
                        onClick={() => go('/admin/products')} title="Produtos">
                        <Package size={20} />
                        {!isDrawerCollapsed && <span>Produtos</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/admin/orders') ? styles.activeNav : ''}`}
                        onClick={() => go('/admin/orders')} title="Pedidos">
                        <ClipboardList size={20} />
                        {!isDrawerCollapsed && <span>Pedidos</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/admin/reports') ? styles.activeNav : ''}`}
                        onClick={() => go('/admin/reports')} title="Relatórios">
                        <BarChart3 size={20} />
                        {!isDrawerCollapsed && <span>Relatórios</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/admin/users') ? styles.activeNav : ''}`}
                        onClick={() => go('/admin/users')} title="Usuários">
                        <Users size={20} />
                        {!isDrawerCollapsed && <span>Usuários</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/admin/settings') ? styles.activeNav : ''}`}
                        onClick={() => go('/admin/settings')} title="Configurações">
                        <SettingsIcon size={20} />
                        {!isDrawerCollapsed && <span>Configurações</span>}
                    </button>

                    {/* ── Operação de Caixa ── */}
                    <NavSection label="Operação de Caixa" collapsed={isDrawerCollapsed} />

                    <button className={`${styles.navBtn} ${isActive('/cashier/scan') ? styles.activeNav : ''}`}
                        onClick={() => go('/cashier/scan')} title="Entregar pedido">
                        <QrCode size={20} />
                        {!isDrawerCollapsed && <span>Entregar pedido</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/cashier/counter') ? styles.activeNav : ''}`}
                        onClick={() => go('/cashier/counter')} title="Venda Balcão">
                        <Store size={20} />
                        {!isDrawerCollapsed && <span>Venda Balcão</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/cashier/credit-notes') ? styles.activeNav : ''}`}
                        onClick={() => go('/cashier/credit-notes')} title="Notinhas">
                        <NotebookText size={20} />
                        {!isDrawerCollapsed && <span>Notinhas</span>}
                    </button>

                    <button className={`${styles.navBtn} ${isActive('/cashier/cash-open') ? styles.activeNav : ''}`}
                        onClick={() => go('/cashier/cash-open')} title="Gestão de Caixa">
                        <Wallet size={20} />
                        {!isDrawerCollapsed && <span>Gestão de Caixa</span>}
                    </button>

                    {/* ── Modo Cliente ── */}
                    <NavSection label="Modo Cliente" collapsed={isDrawerCollapsed} />

                    <button className={`${styles.navBtn} ${isActive('/menu') ? styles.activeNav : ''}`}
                        onClick={() => go('/menu')} title="Ver Cardápio">
                        <ShoppingBag size={20} />
                        {!isDrawerCollapsed && <span>Ver Cardápio</span>}
                    </button>
                </nav>

                <div className={styles.sidebarFooter}>
                    <button className={styles.logoutBtn}
                        onClick={async () => { await logout(); navigate('/login'); }}
                        title="Sair">
                        <LogOut size={18} />
                        {!isDrawerCollapsed && <span>Sair do Sistema</span>}
                    </button>
                    <button className={styles.collapseBtn} onClick={() => setIsCollapsed(c => !c)}
                        title={isDrawerCollapsed ? 'Expandir' : 'Recolher'}>
                        {isDrawerCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    </button>
                </div>
            </aside>

            <nav className={styles.mobileOperations} aria-label="Atendimento">
                <button aria-current={isActive('/admin/orders') ? 'page' : undefined} onClick={() => go('/admin/orders')}><ClipboardList size={20} />Pedidos</button>
                <button aria-current={location.pathname.startsWith('/cashier/scan') || isActive('/cashier/validate') ? 'page' : undefined} onClick={() => go('/cashier/scan')}><QrCode size={20} />Entregar</button>
                <button aria-current={location.pathname.startsWith('/cashier/cash-') ? 'page' : undefined} onClick={() => go('/cashier/cash-open')}><Wallet size={20} />Caixa</button>
            </nav>
            <main className={styles.main}>
                <header className={styles.header}>
                    <div className={styles.titleBlock}>
                        <h1 className={styles.title}>{title}</h1>
                        <p className={styles.subtitle}>{subtitle ?? 'Gestão e monitoramento em tempo real'}</p>
                    </div>
                </header>
                <div className={styles.content}>
                    {children}
                </div>
            </main>
        </div>
    );
}
