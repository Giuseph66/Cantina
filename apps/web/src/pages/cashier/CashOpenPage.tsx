import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogIn } from 'lucide-react';
import styles from './CashPage.module.css';
import { CashierLayout } from '../../components/cashier/CashierLayout';
import { useCashSession } from '../../hooks/useCashSession';

export default function CashOpenPage() {
    const api = useApi();
    const navigate = useNavigate();
    const { hasOpenSession, isLoading: isCashLoading } = useCashSession();
    const [openingCentsStr, setOpeningCentsStr] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isCashLoading && hasOpenSession) {
            navigate('/cashier/cash-close', { replace: true });
        }
    }, [hasOpenSession, isCashLoading, navigate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const val = parseFloat(openingCentsStr.replace(',', '.'));
        if (isNaN(val) || val < 0) {
            alert('Valor inválido. Use um valor numérico válido (ex: 50.00)');
            return;
        }

        setLoading(true);
        try {
            await api.post('/cash/open', { openingCashCents: Math.round(val * 100) });
            alert('Caixa aberto com sucesso!');
            navigate('/cashier/scan');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (isCashLoading) return (
        <div className={styles.loading}>
            <Loader2 className={styles.spin} size={32} />
            <span>Verificando sessão de caixa...</span>
        </div>
    );

    if (hasOpenSession) return null;

    return (
        <CashierLayout title="Abrir Caixa" subtitle="Informe quanto dinheiro há na gaveta para dar troco.">
            <div className={styles.card}>
                <div className={styles.iconWrapper}>
                    <LogIn size={48} strokeWidth={2.5} />
                </div>
                <p className={styles.description}>
                    Conte apenas notas e moedas. Pix e cartão não entram aqui. Se não houver troco, informe 0.
                </p>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <label htmlFor="opening-cash" className={styles.label}>Dinheiro para troco (R$)</label>
                    <input
                        id="opening-cash"
                        inputMode="decimal"
                        type="number"
                        step="0.01"
                        min="0"
                        value={openingCentsStr}
                        onChange={e => setOpeningCentsStr(e.target.value)}
                        placeholder="0.00"
                        className={styles.input}
                        required
                    />

                    <button type="submit" className={styles.btnSubmit} disabled={loading}>
                        {loading ? 'Processando...' : 'Confirmar Abertura'}
                    </button>
                </form>
            </div>
        </CashierLayout>
    );
}
