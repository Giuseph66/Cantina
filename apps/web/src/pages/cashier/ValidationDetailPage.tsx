import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { AlertTriangle, Banknote, Check, CreditCard, QrCode, ReceiptText, ShieldAlert, UserRound, XCircle } from 'lucide-react';
import styles from './ValidationDetailPage.module.css';
import { CashierLayout } from '../../components/cashier/CashierLayout';
import { OfflineStorage } from '../../services/OfflineStorage';

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function getTodayPlusDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<string, string> = {
    CREATED: 'Aguardando pagamento',
    CONFIRMED: 'Aguardando retirada',
    PAID: 'Pago',
    IN_PREP: 'Em separação',
    READY: 'Pronto',
    PICKED_UP: 'Retirado',
    CANCELLED: 'Cancelado',
    EXPIRED: 'Expirado',
};

const PAYMENT_LABELS: Record<string, string> = {
    ONLINE: 'Pagamento online',
    PIX: 'Pix',
    ON_PICKUP: 'Pagar no balcão',
    CASH: 'Dinheiro',
    CARD: 'Cartão',
    INTERNAL_CREDIT: 'Notinha',
};

export default function ValidationDetailPage() {
    const { state } = useLocation();
    const navigate = useNavigate();
    const api = useApi();

    const code = state?.code as string;
    // Pega as variaveis pré injetadas via SCAN ou manual API calls
    const validationData = state?.validationData;
    const isOfflineMode = state?.isOfflineMode;

    const [data, setData] = useState<any>(validationData || null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(!validationData);
    const [actionLoading, setActionLoading] = useState(false);
    const [allowReconfirm, setAllowReconfirm] = useState(true); // default permissivo enquanto carrega
    const [showCreditForm, setShowCreditForm] = useState(false);
    const [creditCustomerName, setCreditCustomerName] = useState(validationData?.order?.user?.name ?? '');
    const [creditCustomerPhone, setCreditCustomerPhone] = useState('');
    const [creditDueAt, setCreditDueAt] = useState(getTodayPlusDays(15));
    const [creditNotes, setCreditNotes] = useState('');

    useEffect(() => {
        api.get<any>('/admin/settings')
            .then(s => setAllowReconfirm(s.allowReconfirmPickup !== false))
            .catch(() => { }); // silencioso — mantém default true
    }, []);

    useEffect(() => {
        if (data) return; // Se ja veio injetado
        if (!code) { navigate('/cashier/scan'); return; }

        api.post<any>('/tickets/validate', { code })
            .then(setData)
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [code, data, navigate]);

    useEffect(() => {
        if (data?.order?.user?.name && !creditCustomerName) {
            setCreditCustomerName(data.order.user.name);
        }
    }, [creditCustomerName, data]);

    async function handleMarkPaid() {
        if (!data) return;
        if (isOfflineMode) {
            alert('Não é possível dar baixa em pagamentos na catraca Offline. É exigido internet.');
            return;
        }

        setActionLoading(true);
        try {
            await api.post('/tickets/mark-paid', { ticketId: data.ticket.id });
            setData({ ...data, order: { ...data.order, status: 'PAID' } });
        } catch (err: any) {
            alert(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleMarkPending() {
        if (!data) return;
        if (isOfflineMode) {
            alert('Não é possível alterar o status em modo offline.');
            return;
        }

        setActionLoading(true);
        try {
            const updatedOrder = await api.post<any>('/tickets/mark-pending', { ticketId: data.ticket.id });
            setData({ ...data, order: { ...data.order, ...updatedOrder } });
            setShowCreditForm(false);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleMoveToCredit() {
        if (!data) return;
        if (isOfflineMode) {
            alert('Não é possível lançar notinha em modo offline.');
            return;
        }

        if (!data.order.user && !creditCustomerName.trim()) {
            alert('Informe o nome do cliente para lançar na notinha.');
            return;
        }

        setActionLoading(true);
        try {
            const updatedOrder = await api.post<any>('/tickets/mark-internal-credit', {
                ticketId: data.ticket.id,
                customerName: !data.order.user ? creditCustomerName.trim() : undefined,
                customerPhone: creditCustomerPhone.trim() || undefined,
                dueAt: creditDueAt ? new Date(`${creditDueAt}T12:00:00`).toISOString() : undefined,
                notes: creditNotes.trim() || undefined,
            });
            setData({ ...data, order: { ...data.order, ...updatedOrder } });
            setShowCreditForm(false);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleConsume() {
        if (!data) return;

        const confirmMsg = alreadyConsumed ? 'Re-confirmar (ESTE TICKET JÁ FOI LIDO ANTES)?' : 'Confirmar Retirada do Pedido?';
        if (!window.confirm(confirmMsg)) return;

        setActionLoading(true);
        try {
            if (isOfflineMode) {
                // CONSUMO OFFLINE (BANCO LOCAL)
                await OfflineStorage.markTicketConsumedLocally(data.ticket.id);
                await OfflineStorage.enqueueConsumption(data.ticket.id);
                alert('Consumido LOCALMENTE.\nSerá enviado pra nuvem na próxima vez que conectar.');
                navigate('/cashier/scan');
                return;
            }

            await api.post('/tickets/consume', { ticketId: data.ticket.id });
            navigate('/cashier/scan');
        } catch (err: any) {
            alert(err.message || 'Erro ao comunicar consumo.');
            setActionLoading(false);
        }
    }

    if (loading) return <div className={styles.loading}>Validando...</div>;

    if (error) {
        return (
            <div className={styles.page}>
                <div className={styles.errorCard}>
                    <AlertTriangle size={64} color="#ef4444" />
                    <h2 className={styles.errorTitle}>Tentativa Inválida</h2>
                    <p className={styles.errorMsg}>{error}</p>
                    <button className={styles.backBtnWrapper} onClick={() => navigate('/cashier/scan')}>
                        Escanear Outro
                    </button>
                </div>
            </div>
        );
    }

    if (!data?.order || !data?.ticket) {
        return (
            <div className={styles.page}>
                <div className={styles.errorCard}>
                    <AlertTriangle size={64} color="#ef4444" />
                    <h2 className={styles.errorTitle}>Dados do ticket indisponíveis</h2>
                    <p className={styles.errorMsg}>Não foi possível carregar os detalhes deste ticket.</p>
                    <button className={styles.backBtnWrapper} onClick={() => navigate('/cashier/scan')}>
                        Voltar ao scanner
                    </button>
                </div>
            </div>
        );
    }

    const { order, ticket, alreadyConsumed } = data;
    // CREATED = pagamento ainda não confirmado (PIX pendente ou qualquer método reportado pelo cliente)
    // ON_PICKUP + CONFIRMED = pedido confirmado mas ainda não pago no balcão
    const isAwaitingPix = order.status === 'CREATED' && order.paymentMethod === 'PIX';
    const isReportedPix = order.status === 'CONFIRMED' && order.paymentMethod === 'PIX';
    const isPendingPayment = order.status === 'CREATED' ||
        (order.paymentMethod === 'ON_PICKUP' && order.status === 'CONFIRMED') ||
        isReportedPix;
    const canReturnToPending = order.status !== 'CREATED';
    const isInternalCredit = order.paymentMethod === 'INTERNAL_CREDIT';
    const needsSeparation = order.channel === 'ONLINE' && order.status !== 'READY' && !alreadyConsumed;
    const customerName = order.user?.name?.trim() || 'Cliente sem cadastro';
    const customerEmail = order.user?.email?.trim() || 'Pedido avulso / convidado';
    const customerInitial = customerName.charAt(0).toUpperCase();
    const statusLabel = STATUS_LABELS[order.status] ?? order.status;
    const paymentLabel = PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod;
    const totalItems = order.items.reduce((sum: number, item: any) => sum + item.qty, 0);

    return (
        <CashierLayout title="Conferir entrega" subtitle="Confira nome, código e lanches antes de confirmar.">
            <div className={styles.shell}>
                {isOfflineMode && (
                    <div className={`${styles.notice} ${styles.noticeWarning}`}>
                        <AlertTriangle size={20} />
                        <div>
                            <strong>Modo offline.</strong> Esta validação está acontecendo localmente e sem baixa remota.
                        </div>
                    </div>
                )}

                {alreadyConsumed && (
                    <div className={`${styles.notice} ${styles.noticeConsumed}`}>
                        <ShieldAlert size={20} />
                        <div>
                            <strong>Ticket já consumido.</strong> Só reconfirme se a retirada anterior realmente falhou.
                        </div>
                    </div>
                )}

                <section className={styles.heroCard}>
                    <div className={styles.heroIntro}>
                        <div>
                            <span className={styles.eyebrow}>Código de retirada</span>
                            <h2 className={styles.ticketCode}>#{ticket.codeShort}</h2>
                            <p className={styles.heroText}>Confirme os dados do pedido antes de concluir a retirada.</p>
                        </div>
                        <div className={styles.badgeRow}>
                            <span className={`${styles.badge} ${styles.badgeStatus}`}>{statusLabel}</span>
                            <span className={`${styles.badge} ${styles.badgePayment}`}>
                                {order.paymentMethod === 'PIX' ? <QrCode size={14} /> : <CreditCard size={14} />}
                                {paymentLabel}
                            </span>
                        </div>
                    </div>

                    <div className={styles.heroGrid}>
                        <div className={styles.customerCard}>
                            <div className={styles.avatar}>{customerInitial}</div>
                            <div>
                                <div className={styles.infoLabel}>Cliente</div>
                                <h3 className={styles.userName}>{customerName}</h3>
                                <p className={styles.userEmail}>{customerEmail}</p>
                            </div>
                        </div>

                        <div className={styles.metricCard}>
                            <span className={styles.infoLabel}>Itens</span>
                            <strong>{totalItems}</strong>
                            <span>{totalItems === 1 ? 'item no pedido' : 'itens no pedido'}</span>
                        </div>

                        <div className={styles.metricCard}>
                            <span className={styles.infoLabel}>Total</span>
                            <strong>{formatCurrency(order.totalCents)}</strong>
                            <span>{paymentLabel}</span>
                        </div>
                    </div>
                </section>

                <div className={styles.contentGrid}>
                    <section className={styles.card}>
                        <div className={styles.sectionHeader}>
                            <div>
                                <span className={styles.eyebrow}>Resumo</span>
                                <h3 className={styles.sectionTitle}>Itens do pedido</h3>
                            </div>
                            <ReceiptText size={18} className={styles.sectionIcon} />
                        </div>

                        <ul className={styles.itemsList}>
                            {order.items.map((item: any) => (
                                <li key={item.id} className={styles.itemRow}>
                                    <div className={styles.itemMain}>
                                        <span className={styles.qty}>{item.qty}x</span>
                                        <div>
                                            <div className={styles.productName}>{item.product?.name ?? item.productName ?? 'Produto removido'}</div>
                                            <div className={styles.itemMeta}>
                                                {formatCurrency(item.unitPriceCents)} cada
                                            </div>
                                        </div>
                                    </div>
                                    <strong className={styles.itemSubtotal}>
                                        {formatCurrency(item.subtotalCents ?? item.unitPriceCents * item.qty)}
                                    </strong>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <aside className={styles.sidePanel}>
                        <section className={styles.sideCard}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <span className={styles.eyebrow}>Conferência rápida</span>
                                    <h3 className={styles.sectionTitle}>Dados do atendimento</h3>
                                </div>
                                <UserRound size={18} className={styles.sectionIcon} />
                            </div>

                            <div className={styles.summaryList}>
                                <div className={styles.summaryRow}>
                                    <span>Status</span>
                                    <strong>{statusLabel}</strong>
                                </div>
                                <div className={styles.summaryRow}>
                                    <span>Pagamento</span>
                                    <strong>{paymentLabel}</strong>
                                </div>
                                <div className={styles.summaryRow}>
                                    <span>Total</span>
                                    <strong>{formatCurrency(order.totalCents)}</strong>
                                </div>
                            </div>
                        </section>

                        <section className={styles.actionCard}>
                            {needsSeparation ? (
                                <>
                                    <div className={styles.actionLead} style={{ color: '#7c3aed' }}>
                                        Pedido ainda em separação
                                    </div>
                                    <p className={styles.actionText}>
                                        O pagamento está confirmado, mas os lanches ainda não foram marcados como prontos para retirada.
                                    </p>
                                    <div className={styles.blockedNotice} style={{ background: '#f5f3ff', borderColor: '#ddd6fe', color: '#5b21b6' }}>
                                        <AlertTriangle size={24} strokeWidth={2.5} />
                                        <p>Não entregue agora. Aguarde a separação e valide novamente quando o pedido estiver pronto.</p>
                                    </div>
                                    <button className={styles.btnBack} onClick={() => navigate('/cashier/scan')}>
                                        Ler outro pedido
                                    </button>
                                </>
                            ) : isPendingPayment ? (
                                <>
                                    <div className={styles.actionLead} style={{ color: '#d97706' }}>
                                        Pagamento pendente
                                    </div>
                                    <p className={styles.actionText}>
                                        {isReportedPix ? `O cliente informou o pagamento via ${paymentLabel}. Verifique o comprovante.` :
                                            isAwaitingPix ? `Este pedido aguarda pagamento via ${paymentLabel}. Verifique o comprovante.` :
                                                `Receba ${formatCurrency(order.totalCents)} no balcão antes de liberar a retirada.`}
                                    </p>
                                    <div className={styles.blockedNotice} style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#92400e', marginBottom: '1.5rem' }}>
                                        <AlertTriangle size={24} strokeWidth={2.5} color="#d97706" style={{ flexShrink: 0 }} />
                                        <p style={{ margin: 0, fontSize: '0.875rem' }}>
                                            <strong>Não libere a retirada sem confirmar o pagamento.</strong><br />
                                            Clique no botão abaixo apenas se o valor já foi recebido.
                                        </p>
                                    </div>
                                    <button
                                        className={styles.btnSecondary}
                                        onClick={handleMarkPaid}
                                        disabled={actionLoading}
                                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: '#059669', color: 'white', borderColor: '#047857' }}
                                    >
                                        <Banknote size={20} />
                                        Confirmar Pagamento
                                    </button>
                                    <div className={styles.actionGrid}>
                                        {canReturnToPending && (
                                            <button
                                                className={styles.btnBack}
                                                onClick={handleMarkPending}
                                                disabled={actionLoading}
                                            >
                                                Voltar para pendente
                                            </button>
                                        )}
                                        <button
                                            className={styles.btnBack}
                                            onClick={() => setShowCreditForm((value) => !value)}
                                            disabled={actionLoading}
                                        >
                                            {showCreditForm ? 'Cancelar notinha' : 'Mandar para notinha'}
                                        </button>
                                    </div>

                                    {showCreditForm && (
                                        <div className={styles.inlineForm}>
                                            {!order.user && (
                                                <label className={styles.inlineField}>
                                                    <span>Nome do cliente</span>
                                                    <input
                                                        type="text"
                                                        value={creditCustomerName}
                                                        onChange={(event) => setCreditCustomerName(event.target.value)}
                                                        placeholder="Quem vai assumir a notinha?"
                                                    />
                                                </label>
                                            )}
                                            <label className={styles.inlineField}>
                                                <span>Telefone / referência</span>
                                                <input
                                                    type="text"
                                                    value={creditCustomerPhone}
                                                    onChange={(event) => setCreditCustomerPhone(event.target.value)}
                                                    placeholder="Opcional"
                                                />
                                            </label>
                                            <label className={styles.inlineField}>
                                                <span>Vencimento</span>
                                                <input
                                                    type="date"
                                                    value={creditDueAt}
                                                    onChange={(event) => setCreditDueAt(event.target.value)}
                                                />
                                            </label>
                                            <label className={styles.inlineField}>
                                                <span>Observação</span>
                                                <textarea
                                                    rows={3}
                                                    value={creditNotes}
                                                    onChange={(event) => setCreditNotes(event.target.value)}
                                                    placeholder="Ex: liberar só no fechamento do turno"
                                                />
                                            </label>
                                            <button
                                                className={styles.btnPrimary}
                                                onClick={handleMoveToCredit}
                                                disabled={actionLoading}
                                            >
                                                {actionLoading ? 'Salvando...' : 'Salvar na notinha'}
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : alreadyConsumed && !allowReconfirm ? (
                                /* Reconfirmação BLOQUEADA pela configuração do admin */
                                <>
                                    <div className={styles.actionLead} style={{ color: '#dc2626' }}>
                                        Cupom já utilizado
                                    </div>
                                    <div className={styles.blockedNotice}>
                                        <XCircle size={32} strokeWidth={2} color="#dc2626" />
                                        <p>
                                            Este cupom já foi utilizado anteriormente.<br />
                                            <strong>Por favor, verifique o que pode ter acontecido.</strong>
                                        </p>
                                    </div>
                                    <button className={styles.btnBack} onClick={() => navigate('/cashier/scan')}>
                                        Escanear outro ticket
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className={styles.actionLead}>
                                        {alreadyConsumed ? 'Retirada já registrada' : isInternalCredit ? 'Pedido lançado na notinha' : 'Confira os lanches para entregar'}
                                    </div>
                                    <p className={styles.actionText}>
                                        {alreadyConsumed
                                            ? 'Use a reconfirmação apenas se precisar corrigir uma validação anterior.'
                                            : isInternalCredit
                                                ? 'A cobrança foi movida para a notinha do cliente. Se os dados estiverem corretos, conclua a retirada.'
                                                : 'Se os dados estiverem corretos, finalize a entrega para concluir o atendimento.'}
                                    </p>
                                    <button
                                        className={`${styles.btnPrimary} ${alreadyConsumed ? styles.btnConsumed : ''}`}
                                        onClick={handleConsume}
                                        disabled={actionLoading}
                                    >
                                        <Check size={22} />
                                        {alreadyConsumed ? 'Reconfirmar retirada' : 'Confirmar retirada'}
                                    </button>
                                </>
                            )}
                        </section>
                    </aside>
                </div>
            </div>
        </CashierLayout>
    );
}
