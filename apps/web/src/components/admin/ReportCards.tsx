import { FileText, TrendingUp, XCircle, DollarSign } from 'lucide-react';
import styles from '../../pages/admin/Admin.module.css';

interface KPIData {
    revenueCents: number;
    orderCount: number;
    ticketMedioCents: number;
    failedOrdersCount: number;
}

export function ReportCards({ data }: { data: KPIData | null }) {
    if (!data) return <div className={styles.loadingText}>Carregando KPIs...</div>;

    const formatBRL = (cents: number) => {
        return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    return (
        <div className={styles.kpiGrid}>
            {/* FATURAMENTO */}
            <div className={styles.kpiCard}>
                <div className={styles.kpiIcon} style={{ background: 'rgba(212, 163, 115, 0.1)', color: 'var(--secondary)' }}>
                    <DollarSign size={28} strokeWidth={2.5} />
                </div>
                <div>
                    <h4 className={styles.kpiLabel}>Faturamento</h4>
                    <p className={styles.kpiValue}>{formatBRL(data.revenueCents)}</p>
                </div>
            </div>

            {/* PEDIDOS TOTAIS */}
            <div className={styles.kpiCard}>
                <div className={styles.kpiIcon} style={{ background: 'rgba(93, 64, 55, 0.1)', color: 'var(--primary)' }}>
                    <FileText size={28} strokeWidth={2.5} />
                </div>
                <div>
                    <h4 className={styles.kpiLabel}>Pedidos pagos</h4>
                    <p className={styles.kpiValue}>{data.orderCount}</p>
                </div>
            </div>

            {/* TICKET MEDIO */}
            <div className={styles.kpiCard}>
                <div className={styles.kpiIcon} style={{ background: 'rgba(188, 142, 92, 0.1)', color: 'var(--accent)' }}>
                    <TrendingUp size={28} strokeWidth={2.5} />
                </div>
                <div>
                    <h4 className={styles.kpiLabel}>Ticket Médio</h4>
                    <p className={styles.kpiValue}>{formatBRL(data.ticketMedioCents)}</p>
                </div>
            </div>

            {/* DESISTENCIAS */}
            <div className={styles.kpiCard}>
                <div className={styles.kpiIcon} style={{ background: 'rgba(239, 68, 68, 0.08)', color: '#c53030' }}>
                    <XCircle size={28} strokeWidth={2.5} />
                </div>
                <div>
                    <h4 className={styles.kpiLabel}>Cancelados</h4>
                    <p className={styles.kpiValue}>{data.failedOrdersCount}</p>
                </div>
            </div>
        </div>
    );
}
