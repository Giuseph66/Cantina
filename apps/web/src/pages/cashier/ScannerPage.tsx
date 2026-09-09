import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { QrReader } from 'react-qr-reader';
import { AlertTriangle, Camera, Keyboard, Wifi, WifiOff } from 'lucide-react';
import styles from './ScannerPage.module.css';
import { CashierLayout } from '../../components/cashier/CashierLayout';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { OfflineStorage } from '../../services/OfflineStorage';
import { useApi } from '../../hooks/useApi';

if (import.meta.env.DEV) {
    const originalConsoleError = console.error;
    if (!(window as any).__qrReaderWarningFiltered) {
        (window as any).__qrReaderWarningFiltered = true;
        console.error = (...args: unknown[]) => {
            const [firstArg, secondArg] = args;
            const isQrReaderDefaultPropsWarning =
                typeof firstArg === 'string'
                && firstArg.includes('Support for defaultProps will be removed from function components')
                && secondArg === 'QrReader';

            if (isQrReaderDefaultPropsWarning) return;
            originalConsoleError(...args);
        };
    }
}

export default function ScannerPage() {
    const navigate = useNavigate();
    const api = useApi();

    const [mode, setMode] = useState<'QR' | 'MANUAL'>('MANUAL');
    const [shortCode, setShortCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // Evita processar o mesmo código múltiplas vezes enquanto há uma chamada em andamento
    const processingRef = useRef(false);

    const isOnline = useOnlineStatus();

    // Fix for "willReadFrequently" warning in Chrome/Edge context
    useEffect(() => {
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        // @ts-ignore
        HTMLCanvasElement.prototype.getContext = function (type, attributes) {
            if (type === '2d') {
                return originalGetContext.call(this, type, { ...attributes, willReadFrequently: true });
            }
            return originalGetContext.call(this, type, attributes);
        };
        return () => {
            HTMLCanvasElement.prototype.getContext = originalGetContext;
        };
    }, []);

    const attemptValidation = async (code: string) => {
        if (processingRef.current) return; // já processando, ignora chamada duplicada
        processingRef.current = true;
        setLoading(true);
        setError('');
        try {
            if (!isOnline) {
                return handleOfflineValidation(code);
            }
            const data = await api.post('/tickets/validate', { code });
            navigate('/cashier/validate', { state: { validationData: data, isOfflineMode: false } });
        } catch (err: any) {
            // useApi lança Error com mensagem "[STATUS] ..." para erros HTTP
            // Só cai no offline se for erro de rede real (sem status HTTP)
            const isHttpError = typeof err.message === 'string' && /^\[\d{3}\]/.test(err.message);
            if (!isOnline || !isHttpError) {
                return handleOfflineValidation(code);
            }
            // Erro HTTP real (400, 404, etc.) — mostra mensagem limpa
            const cleanMessage = err.message.replace(/^\[\d{3}\]\s*/, '');
            setError(cleanMessage || 'Erro ao validar ticket');
        } finally {
            setLoading(false);
            processingRef.current = false;
        }
    };

    const handleOfflineValidation = async (codeOrToken: string) => {
        const localTicket = await OfflineStorage.findTicket(codeOrToken);

        if (!localTicket) {
            setError('Ticket não encontrado na Base Offline. Sincronize antes ou verifique a conexão.');
            setLoading(false);
            return;
        }

        if (new Date(localTicket.expiresAt) < new Date()) {
            setError('Ticket expirado localmente.');
            setLoading(false);
            return;
        }

        if (localTicket.consumedAt) {
            // Offline mode considera consumido se foi batido no próprio aparelho antes do sync
            setError('Ticket JÁ FOI CONSUMIDO neste aparelho pendendo envio!');
            setLoading(false);
            return;
        }

        // Molda objeto parecido com backend para re-utilizar tela
        const fakeData = {
            ticket: localTicket,
            order: localTicket.order,
            alreadyConsumed: false
        };

        navigate('/cashier/validate', { state: { validationData: fakeData, isOfflineMode: true } });
        setLoading(false);
    };

    function handleScan(result: any, _scanError: any) {
        if (result?.text) {
            attemptValidation(result.text);
        }
        // Ignora ruído do decoder entre frames. Mantemos a UI limpa e só tratamos
        // erros reais quando a validação do código acontece.
    }

    function handleManualSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!shortCode.trim()) return;
        attemptValidation(shortCode.trim());
    }

    return (
        <CashierLayout title="Entregar pedido" subtitle="Digite o código ou leia o QR do aluno. Confira os itens antes de entregar.">
            <div className={styles.card}>
                <div className={`${styles.statusBar} ${isOnline ? styles.statusOnline : styles.statusOffline}`}>
                    {isOnline ? <Wifi size={18} strokeWidth={2.4} /> : <WifiOff size={18} strokeWidth={2.4} />}
                    <div className={styles.statusText}>
                        <strong>{isOnline ? 'Online e sincronizado' : 'Offline no aparelho'}</strong>
                        <span>
                            {isOnline
                                ? 'Confira o pedido antes de confirmar a entrega.'
                                : 'A retirada sera validada localmente e sincronizada depois.'}
                        </span>
                    </div>
                </div>

                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${mode === 'QR' ? styles.activeTab : ''}`}
                        onClick={() => setMode('QR')}
                    >
                        <Camera size={20} strokeWidth={2.5} /> Ler QR Code
                    </button>
                    <button
                        className={`${styles.tab} ${mode === 'MANUAL' ? styles.activeTab : ''}`}
                        onClick={() => setMode('MANUAL')}
                    >
                        <Keyboard size={20} strokeWidth={2.5} /> Digitar código
                    </button>
                </div>

                <div className={styles.scannerArea}>
                    {mode === 'QR' ? (
                        <div className={styles.qrWrapper}>
                            <div className={styles.modeHeader}>
                                <span className={styles.modePill}>Leitura por camera</span>
                                <p className={styles.modeCopy}>Posicione o codigo dentro da moldura e mantenha o aparelho firme por alguns segundos.</p>
                            </div>
                            <p className={styles.instruction}>
                                {loading ? 'Processando QRCode...' : 'Aponte a câmera para o QR Code de retirada do aluno.'}
                            </p>
                            <div className={styles.cameraViewport}>
                                <QrReader
                                    onResult={handleScan}
                                    constraints={{ facingMode: 'environment' }}
                                    containerStyle={{ width: '100%', height: '100%' }}
                                    videoContainerStyle={{
                                        width: '100%',
                                        height: '100%',
                                        paddingTop: 0,
                                        position: 'relative',
                                        overflow: 'hidden',
                                        borderRadius: '1.25rem',
                                        background: '#0f0f10',
                                    }}
                                    videoStyle={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                    }}
                                />
                                <div className={styles.scanOverlay} aria-hidden="true">
                                    <div className={styles.scanFrame}>
                                        <span className={`${styles.corner} ${styles.cornerTopLeft}`} />
                                        <span className={`${styles.corner} ${styles.cornerTopRight}`} />
                                        <span className={`${styles.corner} ${styles.cornerBottomLeft}`} />
                                        <span className={`${styles.corner} ${styles.cornerBottomRight}`} />
                                        <span className={styles.scanLine} />
                                    </div>
                                </div>
                            </div>
                            <p className={styles.helperText}>Aponte a câmera para o QR Code do aluno</p>
                            {error && (
                                <div className={styles.errorBanner}>
                                    <AlertTriangle size={18} strokeWidth={2.4} />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <form onSubmit={handleManualSubmit} className={styles.manualForm}>
                            <div className={styles.modeHeader}>
                                <span className={styles.modePill}>Entrada manual</span>
                                <p className={styles.modeCopy}>Peça ao aluno o código de retirada exibido em Meus pedidos.</p>
                            </div>
                            <label htmlFor="pickup-code" className={styles.label}>Código de retirada</label>
                            <input
                                id="pickup-code"
                                autoComplete="off"
                                type="text"
                                value={shortCode}
                                onChange={(e) => setShortCode(e.target.value.toUpperCase())}
                                placeholder="EX: A7KF29"
                                className={styles.input}
                                maxLength={6}
                            />
                            <p className={styles.manualHint}>Digite as 6 letras e números do código de retirada.</p>
                            <button type="submit" className={styles.submitBtn} disabled={loading || shortCode.trim().length !== 6}>
                                {loading ? 'Buscando pedido...' : 'Conferir pedido'}
                            </button>
                            {error && <p className={styles.error}>{error}</p>}
                        </form>
                    )}
                </div>
            </div>
        </CashierLayout>
    );
}
