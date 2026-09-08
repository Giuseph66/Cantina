import { useEffect, useState } from 'react';
import { Coffee, RefreshCw, BellRing, WifiOff, CheckCircle2 } from 'lucide-react';
import { useServerStatus } from '../hooks/useServerStatus';
import { retryNow, onRecovered } from '../lib/server-status';
import './ServerDownScreen.css';

const NOTIFY_KEY = 'cantina_notify_on_recover';

function formatCountdown(ms: number) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    if (total < 60) return `${total}s`;
    return `${Math.floor(total / 60)}min ${String(total % 60).padStart(2, '0')}s`;
}

function formatElapsed(since: number) {
    const total = Math.floor((Date.now() - since) / 1000);
    if (total < 60) return 'há poucos segundos';
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `há ${minutes} min`;
    return `há ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
}

/**
 * Tela de espera exibida quando a API para de responder.
 * Mantém o cliente informado, tenta reconectar sozinha com backoff e
 * avisa por notificação do navegador assim que o servidor volta.
 */
export default function ServerDownScreen() {
    const status = useServerStatus();
    const [now, setNow] = useState(Date.now());
    const [notifyArmed, setNotifyArmed] = useState(() => localStorage.getItem(NOTIFY_KEY) === '1');
    const [justRecovered, setJustRecovered] = useState(false);

    // Relógio de 1s só enquanto a tela está visível.
    useEffect(() => {
        if (status.state !== 'down') return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [status.state]);

    // Callback de recuperação: notificação do navegador + confirmação na tela.
    useEffect(() => {
        return onRecovered(() => {
            setJustRecovered(true);
            setTimeout(() => setJustRecovered(false), 6000);

            if (localStorage.getItem(NOTIFY_KEY) !== '1') return;
            localStorage.removeItem(NOTIFY_KEY);
            setNotifyArmed(false);
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            new Notification('Cantina disponível', {
                body: 'O sistema voltou. Pode continuar seu pedido.',
                icon: '/icon-192.png',
                tag: 'cantina-server-back',
            });
        });
    }, []);

    async function armNotification() {
        if (typeof Notification === 'undefined') return;
        const permission = Notification.permission === 'granted'
            ? 'granted'
            : await Notification.requestPermission();
        if (permission !== 'granted') return;
        localStorage.setItem(NOTIFY_KEY, '1');
        setNotifyArmed(true);
    }

    if (status.state === 'up') {
        if (!justRecovered) return null;
        return (
            <div className="server-back" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                Conexão restabelecida
            </div>
        );
    }

    const offline = status.reason === 'offline';
    const remaining = status.nextRetryAt ? status.nextRetryAt - now : 0;
    // Progresso do ciclo de espera atual, não de uma janela fixa.
    const elapsedPercent = status.retryDelayMs
        ? Math.min(100, Math.max(0, ((status.retryDelayMs - remaining) / status.retryDelayMs) * 100))
        : 0;
    const canNotify = typeof Notification !== 'undefined' && !offline;

    return (
        <div className="server-down" role="alertdialog" aria-live="assertive" aria-labelledby="server-down-title">
            <div className="server-down__card">
                <div className="server-down__cup" aria-hidden="true">
                    {offline ? <WifiOff size={30} /> : <Coffee size={30} />}
                </div>

                <h1 className="server-down__title" id="server-down-title">
                    {offline ? 'Sem conexão com a internet' : 'Já voltamos — só um instante'}
                </h1>

                <p className="server-down__text">
                    {offline
                        ? 'Seu dispositivo está sem rede. Assim que a conexão voltar, retomamos de onde você parou.'
                        : 'Nosso sistema está passando por uma instabilidade rápida. Não precisa fazer nada: reconectamos automaticamente e seu carrinho continua salvo.'}
                </p>

                <div className={`server-down__bar${status.checking ? ' server-down__bar--indeterminate' : ''}`} aria-hidden="true">
                    <span style={status.checking ? undefined : { width: `${elapsedPercent}%` }} />
                </div>

                <div className="server-down__meta">
                    {status.downSince && <span>Instabilidade detectada {formatElapsed(status.downSince)}</span>}
                    <span>
                        {status.checking
                            ? 'Verificando o servidor…'
                            : remaining > 0
                                ? `Nova tentativa em ${formatCountdown(remaining)}`
                                : 'Preparando nova tentativa…'}
                    </span>
                    {status.attempt > 1 && <span>Tentativas: {status.attempt}</span>}
                </div>

                <div className="server-down__actions">
                    <button
                        type="button"
                        className="server-down__btn server-down__btn--primary"
                        onClick={() => void retryNow()}
                        disabled={status.checking}
                    >
                        <RefreshCw size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: '0.4rem' }} />
                        {status.checking ? 'Verificando…' : 'Tentar agora'}
                    </button>

                    {canNotify && (
                        <button
                            type="button"
                            className="server-down__btn server-down__btn--ghost"
                            onClick={() => void armNotification()}
                            disabled={notifyArmed}
                        >
                            <BellRing size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: '0.4rem' }} />
                            {notifyArmed ? 'Avisaremos quando voltar' : 'Avise-me quando voltar'}
                        </button>
                    )}
                </div>

                <p className="server-down__note">
                    Pedidos já confirmados estão registrados e não se perdem. Se precisar de ajuda,
                    procure o atendimento da cantina.
                </p>
            </div>
        </div>
    );
}
