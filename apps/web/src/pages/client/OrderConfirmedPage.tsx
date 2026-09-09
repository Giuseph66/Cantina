import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { QRCodeSVG } from 'qrcode.react';
import {
    AlertCircle,
    Banknote,
    CheckCircle2,
    Clock,
    Copy,
    CreditCard,
    Loader2,
    RefreshCcw,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import styles from './OrderConfirmedPage.module.css';

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

const PAYMENT_LABELS: Record<string, string> = {
    ONLINE: 'Pagamento online', PIX: 'Pix', ON_PICKUP: 'Pagar no balcao', CASH: 'Dinheiro', CARD: 'Cartao', INTERNAL_CREDIT: 'Notinha',
};

interface OrderTicket {
    id: string;
    codeShort: string;
    expiresAt: string;
    consumedAt: string | null;
}

interface LatestPayment {
    id: string;
    paymentMethod: string;
    status: string;
    qrCode: string | null;
    qrCodeBase64: string | null;
    lastError: string | null;
    statusDetail: string | null;
    expiresAt: string | null;
}

interface OrderItem {
    productId: string;
    productName: string;
    qty: number;
}

interface OrderDetails {
    id: string;
    ticket: OrderTicket | null;
    status: string;
    paymentMethod: string;
    totalCents: number;
    createdAt: string;
    items: OrderItem[];
    latestPayment: LatestPayment | null;
}

interface ReconciledOrderPayment {
    orderId: string;
    orderStatus: string;
    paymentMethod: string;
    totalCents: number;
    latestPayment: LatestPayment | null;
}

function normalizeQrCodeImageSrc(value: string | null) {
    if (!value) return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.startsWith('data:image')) {
        return normalized;
    }
    return `data:image/png;base64,${normalized}`;
}

export default function OrderConfirmedPage() {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const api = useApi();
    const [orderInfo, setOrderInfo] = useState<OrderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshingPayment, setRefreshingPayment] = useState(false);

    async function fetchOrder() {
        const data = await api.get<OrderDetails>(`/orders/${orderId}`);
        setOrderInfo(data);
        return data;
    }

    async function reconcilePayment() {
        if (!orderId) return;

        setRefreshingPayment(true);
        try {
            const data = await api.get<ReconciledOrderPayment>(`/payments/orders/${orderId}/reconcile`);
            setOrderInfo((current) => current ? {
                ...current,
                status: data.orderStatus,
                paymentMethod: data.paymentMethod,
                totalCents: data.totalCents,
                latestPayment: data.latestPayment,
            } : current);
        } catch (err) {
            console.error('Erro ao reconciliar pagamento', err);
        } finally {
            setRefreshingPayment(false);
        }
    }

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const data = await fetchOrder();
                if (!cancelled && data.status === 'CREATED') {
                    await reconcilePayment();
                }
            } catch (err) {
                console.error('Erro ao carregar ticket', err);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [orderId]);

    useEffect(() => {
        if (!orderInfo || orderInfo.status !== 'CREATED') return;

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void reconcilePayment();
            }
        }, 8000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [orderInfo?.id, orderInfo?.status]);

    if (loading) return (
        <div className={styles.loading}>
            <Loader2 size={40} strokeWidth={1} className={styles.pulse} />
            <p>Gerando seu ticket premium...</p>
        </div>
    );

    const ticket = orderInfo?.ticket;

    if (!orderInfo || !ticket) return (
        <div className={styles.errorState}>
            <AlertCircle size={64} strokeWidth={1} color="#ef4444" />
            <h2>Pedido nao encontrado</h2>
            <p>Nao conseguimos localizar este pedido ou ticket no sistema.</p>
            <button className={styles.btn} style={{ width: 'auto', padding: '0.75rem 2rem' }} onClick={() => navigate('/orders')}>
                Ver Meus Pedidos
            </button>
        </div>
    );

    const isExpired = new Date(ticket.expiresAt) < new Date();
    const isConsumed = !!ticket.consumedAt;
    const isAwaitingPayment = orderInfo.status === 'CREATED';
    const isOnlinePayment = orderInfo.paymentMethod === 'ONLINE' || orderInfo.paymentMethod === 'PIX' || orderInfo.paymentMethod === 'CARD';
    const pendingPayment = isAwaitingPayment ? orderInfo.latestPayment : null;
    const isReadyForPickup = orderInfo.status === 'READY';

    let HeaderIcon = <CheckCircle2 size={42} strokeWidth={2.5} color="var(--secondary)" />;
    let headerTitle = orderInfo.status === 'READY' ? 'Pronto para retirar' : ['PAID', 'IN_PREP'].includes(orderInfo.status) ? 'Pago · aguardando separação' : 'Pedido confirmado';
    let statusColor = 'var(--secondary)';

    if (isConsumed) {
        HeaderIcon = <CheckCircle2 size={42} strokeWidth={2.5} color="#059669" />;
        headerTitle = 'Pedido Entregue';
        statusColor = '#059669';
    } else if (isExpired) {
        HeaderIcon = <AlertCircle size={42} strokeWidth={2.5} color="#94a3b8" />;
        headerTitle = 'Ticket Expirado';
        statusColor = '#94a3b8';
    } else if (isAwaitingPayment) {
        HeaderIcon = <Clock size={42} strokeWidth={2.5} color="#d97706" />;
        headerTitle = 'Aguardando Pagamento';
        statusColor = '#d97706';
    }

    return (
        <div className={styles.page}>

            <div className={styles.dashboardContainer}>
                <div className={styles.detailsColumn}>
                    <div className={styles.headerBlock}>
                        {HeaderIcon}
                        <h2 style={{ color: statusColor }}>{headerTitle}</h2>
                        {isAwaitingPayment && (
                            <p className={styles.headerSubtitle}>
                                Conclua o pagamento para liberar seu pedido no balcao.
                            </p>
                        )}
                    </div>

                    <div className={styles.receiptCard}>
                        <h3 className={styles.receiptTitle}>Detalhes do Pedido</h3>

                        <div className={styles.receiptTop}>
                            <div>
                                <p className={styles.receiptLabel}>Realizado em</p>
                                <p className={styles.receiptValue}>{format(new Date(orderInfo.createdAt), "dd 'de' MMM, HH:mm", { locale: ptBR })}</p>
                            </div>
                            {orderInfo.paymentMethod && (
                                <div style={{ textAlign: 'right' }}>
                                    <p className={styles.receiptLabel}>Pagamento</p>
                                    <span className={styles.paymentChip}>
                                        <Banknote size={14} />
                                        {PAYMENT_LABELS[orderInfo.paymentMethod] ?? orderInfo.paymentMethod}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className={styles.itemsList}>
                            {orderInfo.items.map(item => (
                                <div key={item.productId} className={styles.itemRow}>
                                    <span className={styles.itemQty}>{item.qty}x</span>
                                    <span className={styles.itemName}>{item.productName}</span>
                                </div>
                            ))}
                        </div>

                        <div className={styles.receiptTotal}>
                            <span>Total</span>
                            <span className={styles.totalValue}>{formatCurrency(orderInfo.totalCents)}</span>
                        </div>
                    </div>
                </div>

                <div className={styles.ticketColumn}>
                    <div className={styles.card}>
                        <div className={styles.qrContainer}>
                            <div className={`${styles.qrWrapper} ${(!isReadyForPickup || isConsumed || isExpired) ? styles.disabledQr : ''}`}>
                                <QRCodeSVG
                                    value={ticket.codeShort}
                                    size={220}
                                    level="H"
                                    includeMargin={false}
                                    fgColor="var(--primary)"
                                />
                            </div>
                            {(!isReadyForPickup || isConsumed || isExpired) && (
                                <div className={styles.qrOverlay} style={{ color: statusColor, borderColor: `${statusColor}40` }}>
                                    {isAwaitingPayment ? 'Bloqueado' : isExpired ? 'Expirado' : isConsumed ? 'Consumido' : 'Em separação'}
                                </div>
                            )}
                            <p className={styles.qrHelper}>{isReadyForPickup ? 'Mostre este QR Code no balcão' : 'O QR Code será liberado quando seu pedido estiver separado'}</p>
                        </div>

                        <div className={styles.codeDiv}>
                            <p className={styles.codeHelper}>Código de retirada</p>
                            {isReadyForPickup ? (
                                <>
                                    <div className={styles.shortCode}>{ticket.codeShort}</div>
                                    <p className={styles.qrHelper}>Você também pode informar seu nome e este código. Confira os lanches antes de sair.</p>
                                </>
                            ) : (
                                <p className={styles.qrHelper}>Acompanhe o status nesta tela. O código aparecerá quando estiver pronto para retirada.</p>
                            )}
                        </div>

                        <div className={styles.infoDiv}>
                            <div className={styles.infoRow}>
                                <Clock size={16} strokeWidth={2.5} />
                                <span>
                                    Válido até: {format(new Date(ticket.expiresAt), "HH:mm 'de' dd/MM", { locale: ptBR })}
                                </span>
                            </div>
                        </div>

                        {isAwaitingPayment && isOnlinePayment && (
                            <div className={styles.pendingActions}>
                                <button className={styles.btn} onClick={() => navigate(`/pedido?orderId=${orderInfo.id}`)}>
                                    <CreditCard size={18} />
                                    Continuar pagamento online
                                </button>
                                <button className={styles.secondaryBtn} onClick={() => void reconcilePayment()}>
                                    {refreshingPayment ? <Loader2 size={16} className={styles.pulse} /> : <RefreshCcw size={16} />}
                                    Atualizar status
                                </button>
                            </div>
                        )}

                        {isAwaitingPayment && isOnlinePayment && pendingPayment?.paymentMethod === 'PIX' && pendingPayment.qrCode && (
                            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {normalizeQrCodeImageSrc(pendingPayment.qrCodeBase64) && (
                                    <img
                                        src={normalizeQrCodeImageSrc(pendingPayment.qrCodeBase64) || undefined}
                                        alt="QR Code PIX"
                                        style={{ width: '100%', borderRadius: '1rem', border: '1px solid var(--glass-border)', background: 'white', padding: '1rem' }}
                                    />
                                )}
                                <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, padding: '1rem', borderRadius: '1rem', background: 'var(--bg-main)', border: '1px solid var(--glass-border)', wordBreak: 'break-all' }}>
                                    {pendingPayment.qrCode}
                                </div>
                                <button
                                    className={styles.btn}
                                    style={{ marginBottom: 0 }}
                                    onClick={() => navigator.clipboard.writeText(pendingPayment.qrCode || '')}
                                >
                                    <Copy size={18} strokeWidth={2.5} />
                                    Copiar codigo PIX
                                </button>
                            </div>
                        )}

                        {isAwaitingPayment && isOnlinePayment && pendingPayment?.paymentMethod === 'CARD' && (
                            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', borderRadius: '1rem', background: 'var(--bg-main)', border: '1px solid var(--glass-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: statusColor, fontWeight: 800 }}>
                                    <CreditCard size={18} />
                                    Pagamento em analise.
                                </div>
                                {pendingPayment.lastError && (
                                    <span style={{ color: '#dc2626', fontWeight: 700 }}>{pendingPayment.lastError}</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
