import { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { useNavigate } from 'react-router-dom';
import { Calculator, CircleDollarSign, Loader2, LogOut, ReceiptText } from 'lucide-react';
import styles from './CashPage.module.css';
import { CashierLayout } from '../../components/cashier/CashierLayout';
import { useCashSession } from '../../hooks/useCashSession';

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

type TotalsByMethod = Record<string, number>;

interface CashCloseData {
    openedAt: string;
    openingCashCents: number;
    movements: Array<unknown>;
    openedBy: { name: string };
    summary: {
        movementCount: number;
        expectedCashCents: number;
        totalsByMethod: TotalsByMethod;
    };
}

const METHOD_LABELS: Record<string, string> = {
    ONLINE: 'Pagamento online',
    CASH: 'Dinheiro',
    PIX: 'Pix',
    CARD: 'Cartao',
    INTERNAL_CREDIT: 'Notinha',
    ON_PICKUP: 'Pagar na retirada',
};

export default function CashClosePage() {
    const api = useApi();
    const navigate = useNavigate();
    const { hasOpenSession, isLoading: isCashLoading } = useCashSession();
    const [data, setData] = useState<CashCloseData | null>(null);
    const [notes, setNotes] = useState('');
    const [countedCashStr, setCountedCashStr] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isCashLoading) return;
        if (!hasOpenSession) {
            navigate('/cashier/cash-open', { replace: true });
            return;
        }

        api.get<CashCloseData | null>('/cash/today')
            .then((res) => {
                setData(res);

            })
            .catch(() => setError('Não foi possível carregar o caixa. Tente novamente.'))
            .finally(() => setLoading(false));
    }, [api, hasOpenSession, isCashLoading, navigate]);

    const countedCashValue = Number.parseFloat(countedCashStr.replace(',', '.'));
    const hasCountedCash = countedCashStr.trim() !== '' && Number.isFinite(countedCashValue) && countedCashValue >= 0;
    const countedCashCents = Number.isFinite(countedCashValue) ? Math.round(countedCashValue * 100) : 0;
    const cashDifferenceCents = data ? countedCashCents - data.summary.expectedCashCents : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!data) return;
        if (!Number.isFinite(countedCashValue) || countedCashValue < 0) {
            alert('Informe o valor contado em caixa.');
            return;
        }
        if (!window.confirm(`Fechar o caixa com ${formatCurrency(countedCashCents)} em dinheiro? Diferença: ${hasCountedCash ? formatCurrency(cashDifferenceCents) : 'A conferir'}. A sessão atual será encerrada.`)) return;

        setSubmitting(true);
        try {
            const res = await api.post<{
                session: { closingCashCents: number; countedCashCents: number; cashDifferenceCents: number };
                summary: { expectedCashCents: number };
            }>('/cash/close', {
                notes,
                countedCashCents,
            });
            alert(
                `Caixa fechado. Esperado: ${formatCurrency(res.summary.expectedCashCents)} | Contado: ${formatCurrency(res.session.countedCashCents)} | Diferença: ${formatCurrency(res.session.cashDifferenceCents)}`,
            );
            navigate('/cashier/cash-open');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return (
        <div className={styles.loading}>
            <Loader2 className={styles.spin} size={32} />
            <span>Sincronizando dados do caixa...</span>
        </div>
    );

    if (!hasOpenSession) return null;

    if (!data) return (
        <CashierLayout title="Fechar Caixa" subtitle="Encerramento de sessão">
            <div className={styles.emptyState}>
                <p>{error || 'Nenhuma sessão de caixa aberta no momento.'}</p>
                <button className={styles.btnSecondary} onClick={() => navigate('/cashier/scan')}>
                    Voltar ao Painel
                </button>
            </div>
        </CashierLayout>
    );

    return (
        <CashierLayout title="Conferir caixa" subtitle="Conte o dinheiro da gaveta antes de fechar o caixa.">
            <div className={`${styles.card} ${styles.cashCloseCard}`}>
                <div className={styles.cashCloseHero}>
                    <div className={styles.iconWrapperOut}>
                        <LogOut size={48} strokeWidth={2.5} />
                    </div>
                    <div className={styles.cashCloseHeroText}>
                        <span className={styles.heroEyebrow}>Fechamento do turno</span>
                        <h2 className={styles.heroTitle}>Quanto há na gaveta?</h2>
                        <p className={styles.heroDescription}>
                            Conte apenas notas e moedas. Pix e cartão não entram no dinheiro da gaveta.
                        </p>
                    </div>
                </div>

                <div className={styles.cashCloseGrid}>
                    <div className={styles.cashCloseMain}>
                        <div className={styles.infoBlock}>
                            <div className={styles.infoBlockHeader}>
                                <div>
                                    <span className={styles.infoBlockLabel}>Caixa aberto</span>
                                    <h3 className={styles.infoBlockTitle}>Resumo do turno</h3>
                                </div>
                                <ReceiptText size={18} strokeWidth={2.3} />
                            </div>
                            <div className={styles.infoRows}>
                                <p><strong>Operador:</strong> {data.openedBy.name}</p>
                                <p><strong>Abertura:</strong> {new Date(data.openedAt).toLocaleTimeString()}</p>
                                <p><strong>Troco inicial:</strong> {formatCurrency(data.openingCashCents)}</p>
                                <p><strong>Movimentações:</strong> {data.summary.movementCount} registros</p>
                            </div>
                        </div>

                        <div className={styles.summaryGrid}>
                            <div className={styles.summaryCard}>
                                <span className={styles.summaryLabel}>Dinheiro esperado</span>
                                <strong className={styles.summaryValue}>{formatCurrency(data.summary.expectedCashCents)}</strong>
                                <span className={styles.summaryCaption}>Fundo inicial + vendas em dinheiro</span>
                            </div>
                            <div className={styles.summaryCard}>
                                <span className={styles.summaryLabel}>Contado agora</span>
                                <strong className={styles.summaryValue}>{hasCountedCash ? formatCurrency(countedCashCents) : 'A conferir'}</strong>
                                <span className={styles.summaryCaption}>Informe sua contagem no campo abaixo</span>
                            </div>
                            <div className={`${styles.summaryCard} ${cashDifferenceCents === 0 ? styles.summaryNeutral : cashDifferenceCents > 0 ? styles.summaryPositive : styles.summaryNegative}`}>
                                <span className={styles.summaryLabel}>Diferença</span>
                                <strong className={styles.summaryValue}>{hasCountedCash ? formatCurrency(cashDifferenceCents) : 'A conferir'}</strong>
                                <span className={styles.summaryCaption}>
                                    {!hasCountedCash ? 'Informe o dinheiro contado' : cashDifferenceCents === 0
                                        ? 'Valores conferem'
                                        : cashDifferenceCents > 0
                                            ? 'Dinheiro a mais'
                                            : 'Dinheiro a menos'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <aside className={styles.cashCloseAside}>
                        <form onSubmit={handleSubmit} className={`${styles.form} ${styles.cashCloseForm}`}>
                            <div className={styles.formHeader}>
                                <div>
                                    <span className={styles.infoBlockLabel}>Conte o dinheiro</span>
                                    <h3 className={styles.infoBlockTitle}>Registrar contagem</h3>
                                </div>
                                <Calculator size={18} strokeWidth={2.3} />
                            </div>

                            <div className={styles.balanceNotice}>
                                <strong>Esperado agora: {formatCurrency(data.summary.expectedCashCents)}</strong>
                                <span>Preencha o valor contado e registre observacoes do turno, se houver.</span>
                            </div>

                            <label htmlFor="counted-cash" className={styles.label}>Valor contado em caixa (R$)</label>
                            <input
                                id="counted-cash"
                                inputMode="decimal"
                                placeholder="Ex.: 50,00"
                                type="number"
                                step="0.01"
                                min="0"
                                value={countedCashStr}
                                onChange={(e) => setCountedCashStr(e.target.value)}
                                className={styles.input}
                                required
                            />

                            <div className={styles.liveDifference}>
                                <span>Diferença apurada no momento</span>
                                <strong className={cashDifferenceCents === 0 ? styles.summaryNeutralText : cashDifferenceCents > 0 ? styles.summaryPositiveText : styles.summaryNegativeText}>
                                    {hasCountedCash ? formatCurrency(cashDifferenceCents) : 'A conferir'}
                                </strong>
                            </div>

                            <label htmlFor="closing-notes" className={styles.label}>Observações (opcional)</label>
                            <textarea
                                id="closing-notes"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="Ex: divergencia de valores, motivo de sangria, observacoes do turno..."
                                className={styles.textarea}
                                rows={4}
                            />

                            <button type="submit" className={styles.btnSubmitRed} disabled={submitting || !hasCountedCash}>
                                {submitting ? 'Fechando...' : 'Fechar caixa'}
                            </button>
                        </form>
                    </aside>
                </div>

                <div className={styles.methodList}>
                    <div className={styles.methodListHeader}>
                        <div>
                            <span className={styles.infoBlockLabel}>Recebimentos por forma de pagamento</span>
                            <h3 className={styles.infoBlockTitle}>Entradas registradas</h3>
                        </div>
                        <CircleDollarSign size={18} strokeWidth={2.3} />
                    </div>
                    {Object.entries(data.summary.totalsByMethod).map(([method, amount]) => (
                        <div key={method} className={styles.methodRow}>
                            <span>{METHOD_LABELS[method] ?? method}</span>
                            <strong>{formatCurrency(amount)}</strong>
                        </div>
                    ))}
                </div>
            </div>
        </CashierLayout>
    );
}
