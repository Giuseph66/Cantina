import { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import {
    Save, Settings as SettingsIcon, ShieldAlert,
    RotateCcw, Clock, Wrench, RefreshCw, Ticket, Filter, X, Database, Play, Download,
} from 'lucide-react';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { useDialog } from '../../components/DialogProvider';
import styles from './SettingsPage.module.css';

type Tab = 'geral' | 'operacao' | 'auditoria' | 'backups';
type TicketValidityMode = 'DURATION' | 'UNTIL_TIME';
type TicketWindowUnit = 'MINUTES' | 'HOURS';

interface Settings {
    ticketWindowMinutes: number;
    ticketValidityMode: TicketValidityMode;
    ticketValidUntilTime: string | null;
    bannerMessage: string;
    openTime: string;
    closeTime: string;
    allowReconfirmPickup: boolean;
    allowOnPickupPayment: boolean;
    pixKey: string;
    allowCredit: boolean;
    notificationEmails: string;
}

interface AuditLog {
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    payloadJson: Record<string, unknown> | null;
    createdAt: string;
    actor: { id: string; name: string; role: string } | null;
}

interface BackupEntry {
    id: string;
    source: 'cron' | 'manual';
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    createdAt: string | null;
    completedAt: string | null;
    failedAt: string | null;
    expiresAt: string | null;
    tableCount: number;
    rowCount: number;
    imageCount: number;
    imageBytes: number;
    errorMessage: string | null;
}

interface BackupOperationProgress {
    kind: 'BACKUP' | 'RESTORE' | null;
    status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    progress: number;
    stage: string;
    backupId: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
}

const PAYLOAD_LABELS: Record<string, string> = {
    name: 'Nome', email: 'E-mail', role: 'Função', status: 'Novo status',
    priceCents: 'Preço', stockQty: 'Estoque', stockMode: 'Modo estoque',
    isActive: 'Ativo', categoryId: 'Categoria', imageUrl: 'Imagem',
    openingCashCents: 'Fundo de abertura', closingCashCents: 'Fundo no fechamento',
    notes: 'Observações', totalCents: 'Total',
    paymentMethod: 'Forma de pagamento', channel: 'Canal', ticketId: 'ID do ticket',
    orderId: 'ID do pedido', itemCount: 'Qtd. de itens', guestCheckout: 'Pedido avulso',
    offline: 'Modo offline', deviceId: 'Dispositivo', items: 'Itens',
    actorId: 'Operador ID', bannerMessage: 'Banner', pixKey: 'Chave PIX',
    allowCredit: 'Crédito interno', allowReconfirmPickup: 'Reconfirmação de retirada',
    allowOnPickupPayment: 'Pagamento no balcão',
    ticketWindowMinutes: 'Validade do ticket (min)', ticketValidityMode: 'Modo de validade do ticket',
    ticketValidUntilTime: 'Ticket válido até', openTime: 'Abertura', closeTime: 'Fechamento',
    description: 'Descrição', totals: 'Totais por método', consumedAtOffline: 'Data do consumo',
    notificationEmails: 'E-mails de notificação',
};

const STATUS_PT: Record<string, string> = {
    CREATED: 'Aguardando pagamento', CONFIRMED: 'Confirmado', PAID: 'Pago',
    IN_PREP: 'Em preparo', READY: 'Pronto', PICKED_UP: 'Retirado',
    CANCELLED: 'Cancelado', EXPIRED: 'Expirado',
};

const ROLE_PT: Record<string, string> = {
    ADMIN: 'Administrador', CASHIER: 'Caixa', KITCHEN: 'Cozinha', CLIENT: 'Cliente',
};

function formatPayloadValue(key: string, value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
    if (key === 'ticketValidityMode' && typeof value === 'string') {
        return value === 'UNTIL_TIME' ? 'Até horário' : 'Duração';
    }
    if (key.endsWith('Cents') && typeof value === 'number') {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
    }
    if (key === 'status' && typeof value === 'string') return STATUS_PT[value] ?? value;
    if (key === 'role' && typeof value === 'string') return ROLE_PT[value] ?? value;
    if (Array.isArray(value)) return `${value.length} item(s)`;
    if (key === 'totals' && typeof value === 'object' && value !== null) {
        return Object.entries(value as Record<string, number>)
            .map(([method, cents]) => `${method}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)}`)
            .join(' · ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function PayloadDetail({ payload }: { payload: Record<string, unknown> | null }) {
    if (!payload || Object.keys(payload).length === 0) {
        return <span className={styles.payloadEmpty}>Sem detalhes registrados.</span>;
    }
    return (
        <dl className={styles.payloadGrid}>
            {Object.entries(payload).map(([k, v]) => (
                <div key={k} className={styles.payloadEntry}>
                    <dt className={styles.payloadKey}>{PAYLOAD_LABELS[k] ?? k}</dt>
                    <dd className={styles.payloadVal}>{formatPayloadValue(k, v)}</dd>
                </div>
            ))}
        </dl>
    );
}

function formatTicketWindowLabel(settings: Pick<Settings, 'ticketWindowMinutes' | 'ticketValidityMode' | 'ticketValidUntilTime'>): string {
    if (settings.ticketValidityMode === 'UNTIL_TIME' && settings.ticketValidUntilTime) {
        return `Até ${settings.ticketValidUntilTime}`;
    }

    const minutes = settings.ticketWindowMinutes;
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }
    return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

const ACTION_LABELS: Record<string, string> = {
    // Pedidos
    ORDER_CREATED: 'Pedido criado',
    ORDER_PAID: 'Pedido marcado como pago',
    ORDER_STATUS_UPDATED: 'Status de pedido alterado',
    ORDER_EXPIRED: 'Pedido expirado',
    // Tickets
    TICKET_CONSUMED: 'Ticket consumido',
    TICKET_CONSUMED_OFFLINE: 'Ticket consumido (offline)',
    TICKET_ALREADY_CONSUMED: 'Ticket já consumido',
    TICKET_RECONFIRMED: 'Retirada reconfirmada',
    // Caixa
    CASH_OPENED: 'Caixa aberto',
    CASH_CLOSED: 'Caixa fechado',
    COUNTER_SALE: 'Venda no balcão',
    COUNTER_CREDIT_NOTE_CREATED: 'Notinha criada no balcão',
    CREDIT_NOTE_SETTLED: 'Notinha quitada',
    ORDER_MARKED_PENDING: 'Pedido devolvido para pendente',
    ORDER_MOVED_TO_CREDIT_NOTE: 'Pedido enviado para notinha',
    // Produtos & Categorias
    PRODUCT_CREATED: 'Produto criado',
    PRODUCT_UPDATED: 'Produto atualizado',
    PRODUCT_DEACTIVATED: 'Produto desativado',
    CATEGORY_CREATED: 'Categoria criada',
    CATEGORY_UPDATED: 'Categoria atualizada',
    CATEGORY_DELETED: 'Categoria removida',
    // Sistema
    SETTINGS_UPDATED: 'Configurações alteradas',
};

const ACTION_GROUPS: { label: string; actions: string[] }[] = [
    { label: 'Pedidos', actions: ['ORDER_CREATED', 'ORDER_PAID', 'ORDER_STATUS_UPDATED', 'ORDER_EXPIRED'] },
    { label: 'Tickets', actions: ['TICKET_CONSUMED', 'TICKET_CONSUMED_OFFLINE', 'TICKET_ALREADY_CONSUMED', 'TICKET_RECONFIRMED'] },
    { label: 'Caixa', actions: ['CASH_OPENED', 'CASH_CLOSED', 'COUNTER_SALE', 'COUNTER_CREDIT_NOTE_CREATED', 'CREDIT_NOTE_SETTLED', 'ORDER_MARKED_PENDING', 'ORDER_MOVED_TO_CREDIT_NOTE'] },
    { label: 'Cardápio', actions: ['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DEACTIVATED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED'] },
    { label: 'Sistema', actions: ['SETTINGS_UPDATED'] },
];

function Toggle({ checked, onChange, label, description }: {
    checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
    return (
        <label className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
                <span className={styles.toggleLabel}>{label}</span>
                {description && <span className={styles.toggleDesc}>{description}</span>}
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
                onClick={() => onChange(!checked)}
            >
                <span className={styles.toggleThumb} />
            </button>
        </label>
    );
}

export default function SettingsPage() {
    const api = useApi();
    const { alert: showAlert, confirm: showConfirm } = useDialog();
    const [tab, setTab] = useState<Tab>('geral');
    const [settings, setSettings] = useState<Settings>({
        ticketWindowMinutes: 30,
        ticketValidityMode: 'DURATION',
        ticketValidUntilTime: null,
        bannerMessage: '',
        openTime: '07:00', closeTime: '17:00',
        allowReconfirmPickup: true,
        allowOnPickupPayment: true,
        pixKey: '', allowCredit: true, notificationEmails: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveOk, setSaveOk] = useState(false);
    const [isTicketWindowModalOpen, setIsTicketWindowModalOpen] = useState(false);
    const [ticketValidityDraftMode, setTicketValidityDraftMode] = useState<TicketValidityMode>('DURATION');
    const [ticketWindowDraftValue, setTicketWindowDraftValue] = useState('30');
    const [ticketWindowDraftUnit, setTicketWindowDraftUnit] = useState<TicketWindowUnit>('MINUTES');
    const [ticketUntilTimeDraft, setTicketUntilTimeDraft] = useState('20:00');

    // Auditoria
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [logTotal, setLogTotal] = useState(0);
    const [logOffset, setLogOffset] = useState(0);
    const [logLoading, setLogLoading] = useState(false);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [logActionFilter, setLogActionFilter] = useState('');
    const LOG_LIMIT = 50;
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [backupsLoading, setBackupsLoading] = useState(false);
    const [backupRunning, setBackupRunning] = useState(false);
    const [restoringBackupId, setRestoringBackupId] = useState<string | null>(null);
    const [backupProgress, setBackupProgress] = useState<BackupOperationProgress | null>(null);

    useEffect(() => {
        api.get<Settings>('/admin/settings')
            .then(res => setSettings(s => ({ ...s, ...res })))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (tab === 'auditoria') loadLogs(0, logActionFilter);
        if (tab === 'backups') void loadBackups();
    }, [tab]);

    useEffect(() => {
        if (tab !== 'backups') return;

        let cancelled = false;
        const pollProgress = async () => {
            try {
                const res = await api.get<BackupOperationProgress>('/admin/backups/progress');
                if (!cancelled) setBackupProgress(res);
            } catch (err) {
                if (!cancelled) console.error(err);
            }
        };

        void pollProgress();
        const timer = window.setInterval(() => {
            void pollProgress();
        }, 1200);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [api, tab]);

    useEffect(() => {
        if (!isTicketWindowModalOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isTicketWindowModalOpen]);

    function loadLogs(offset: number, action = logActionFilter) {
        setLogLoading(true);
        const qs = new URLSearchParams({ limit: String(LOG_LIMIT), offset: String(offset) });
        if (action) qs.set('action', action);
        api.get<{ logs: AuditLog[]; total: number }>(`/admin/audit?${qs}`)
            .then(res => { setLogs(res.logs); setLogTotal(res.total); setLogOffset(offset); })
            .catch(console.error)
            .finally(() => setLogLoading(false));
    }

    function handleFilterChange(action: string) {
        setLogActionFilter(action);
        setExpandedLogId(null);
        loadLogs(0, action);
    }

    async function loadBackups() {
        setBackupsLoading(true);
        try {
            const res = await api.get<BackupEntry[]>('/admin/backups');
            setBackups(res);
        } catch (err) {
            console.error(err);
        } finally {
            setBackupsLoading(false);
        }
    }

    async function handleRunBackup() {
        if (backupProgress?.status === 'RUNNING') {
                await showAlert('Já existe uma operação em andamento.', { tone: 'warning' });
            return;
        }
        setBackupRunning(true);
        try {
            await api.post('/admin/backups/run', {});
            await loadBackups();
                await showAlert('Backup executado com sucesso.', { tone: 'success' });
        } catch (err: any) {
            await showAlert(err.message.replace(/^\[\d{3}\]\s*/, ''), { tone: 'error' });
        } finally {
            setBackupRunning(false);
            try {
                const res = await api.get<BackupOperationProgress>('/admin/backups/progress');
                setBackupProgress(res);
            } catch {
                // noop
            }
        }
    }

    async function handleRestoreBackup(backup: BackupEntry) {
        if (backupProgress?.status === 'RUNNING') {
                await showAlert('Já existe uma operação em andamento.', { tone: 'warning' });
            return;
        }
        if (backup.status !== 'COMPLETED') {
                await showAlert('Somente backups concluídos podem ser restaurados.', { tone: 'warning' });
            return;
        }

        const shouldRestore = await showConfirm(
            `Restaurar o backup ${backup.id}?\n\nIsso sobrescreve dados atuais e arquivos de imagem.`,
        );
        if (!shouldRestore) return;

        setRestoringBackupId(backup.id);
        try {
            await api.post(`/admin/backups/${backup.id}/restore`, {});
            await loadBackups();
                await showAlert('Backup restaurado com sucesso.', { tone: 'success' });
        } catch (err: any) {
            await showAlert(err.message.replace(/^\[\d{3}\]\s*/, ''), { tone: 'error' });
        } finally {
            setRestoringBackupId(null);
            try {
                const res = await api.get<BackupOperationProgress>('/admin/backups/progress');
                setBackupProgress(res);
            } catch {
                // noop
            }
        }
    }

    function openTicketWindowModal() {
        const useHours = settings.ticketWindowMinutes % 60 === 0;
        setTicketValidityDraftMode(settings.ticketValidityMode);
        setTicketWindowDraftUnit(useHours ? 'HOURS' : 'MINUTES');
        setTicketWindowDraftValue(String(useHours ? settings.ticketWindowMinutes / 60 : settings.ticketWindowMinutes));
        setTicketUntilTimeDraft(settings.ticketValidUntilTime || '20:00');
        setIsTicketWindowModalOpen(true);
    }

    async function applyTicketWindowDraft() {
        if (ticketValidityDraftMode === 'UNTIL_TIME') {
            if (!/^\d{2}:\d{2}$/.test(ticketUntilTimeDraft)) {
                await showAlert('Informe um horário válido no formato HH:mm.', { tone: 'warning' });
                return;
            }

            setSettings((current) => ({
                ...current,
                ticketValidityMode: 'UNTIL_TIME',
                ticketValidUntilTime: ticketUntilTimeDraft,
            }));
            setIsTicketWindowModalOpen(false);
            return;
        }

        const parsedValue = Number.parseInt(ticketWindowDraftValue, 10);
        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
                await showAlert('Informe um valor válido para a validade do ticket.', { tone: 'warning' });
            return;
        }

        const nextMinutes = ticketWindowDraftUnit === 'HOURS'
            ? parsedValue * 60
            : parsedValue;

        if (nextMinutes < 5 || nextMinutes > 1440) {
                await showAlert('A validade do ticket deve ficar entre 5 minutos e 24 horas.', { tone: 'warning' });
            return;
        }

        setSettings((current) => ({
            ...current,
            ticketValidityMode: 'DURATION',
            ticketWindowMinutes: nextMinutes,
            ticketValidUntilTime: null,
        }));
        setIsTicketWindowModalOpen(false);
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        try {
            await api.patch('/admin/settings', settings);
            setSaveOk(true);
            setTimeout(() => setSaveOk(false), 2500);
        } catch (err: any) {
            await showAlert(err.message.replace(/^\[\d{3}\]\s*/, ''), { tone: 'error' });
        } finally {
            setSaving(false);
        }
    }

    const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
        { id: 'geral', label: 'Geral', icon: <SettingsIcon size={16} /> },
        { id: 'operacao', label: 'Operação', icon: <Ticket size={16} /> },
        { id: 'auditoria', label: 'Auditoria', icon: <ShieldAlert size={16} /> },
        { id: 'backups', label: 'Backups', icon: <Database size={16} /> },
    ];
    const operationRunning = backupProgress?.status === 'RUNNING';

    if (loading) return (
        <AdminLayout title="Configurações">
            <div className={styles.loading}>Carregando configurações...</div>
        </AdminLayout>
    );

    return (
        <AdminLayout title="Configurações" subtitle="Ajustes globais, operação, auditoria e backups">
            <div className={styles.page}>
                {/* Tab nav */}
                <div className={styles.tabNav}>
                    {TABS.map(t => (
                        <button key={t.id}
                            className={`${styles.tabBtn} ${tab === t.id ? styles.tabBtnActive : ''}`}
                            onClick={() => setTab(t.id)}>
                            {t.icon}{t.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSave}>
                    {/* ── GERAL ── */}
                    {tab === 'geral' && (
                        <div className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <Wrench size={20} />
                                <div>
                                    <h3 className={styles.sectionTitle}>Regras Gerais</h3>
                                    <p className={styles.sectionDesc}>Defina as regras gerais da cantina</p>
                                </div>
                            </div>
                            <Toggle
                                checked={settings.allowOnPickupPayment}
                                onChange={v => setSettings(s => ({ ...s, allowOnPickupPayment: v }))}
                                label='Permitir "Pagar no Balcão" no Checkout'
                                description="Se desativado, o cliente só poderá concluir pedidos com pagamento online."
                            />

                            <Toggle
                                checked={settings.allowCredit}
                                onChange={v => setSettings(s => ({ ...s, allowCredit: v }))}
                                label='Permitir Venda "Pendura" (Crédito Interno)'
                                description="Permite que clientes autorizados comprem para pagar depois."
                            />

                            <div className={styles.field}>
                                <label className={styles.label}>E-mails para Notificação</label>
                                <input className={styles.input} placeholder="admin@cantina.com, financeiro@cantina.com"
                                    value={settings.notificationEmails}
                                    onChange={e => setSettings(s => ({ ...s, notificationEmails: e.target.value }))} />
                                <span className={styles.hint}>Separados por vírgula.</span>
                            </div>
                        </div>
                    )}

                    {/* ── OPERAÇÃO ── */}
                    {tab === 'operacao' && (
                        <div className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <Clock size={20} />
                                <div>
                                    <h3 className={styles.sectionTitle}>Operação de Caixa & Tickets</h3>
                                    <p className={styles.sectionDesc}>Regras de funcionamento da cantina e dos cupons</p>
                                </div>
                            </div>

                            <div className={styles.row2}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Horário de Abertura</label>
                                    <input type="time" className={styles.input}
                                        value={settings.openTime}
                                        onChange={e => setSettings(s => ({ ...s, openTime: e.target.value }))} />
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label}>Horário de Fechamento</label>
                                    <input type="time" className={styles.input}
                                        value={settings.closeTime}
                                        onChange={e => setSettings(s => ({ ...s, closeTime: e.target.value }))} />
                                </div>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Validade do Ticket</label>
                                <button
                                    type="button"
                                    className={styles.ticketWindowField}
                                    onClick={openTicketWindowModal}
                                >
                                    <span className={styles.ticketWindowValue}>{formatTicketWindowLabel(settings)}</span>
                                    <span className={styles.ticketWindowAction}>
                                        {settings.ticketValidityMode === 'UNTIL_TIME' ? 'Definir horário' : 'Definir duração'}
                                    </span>
                                </button>
                                <span className={styles.hint}>Pode ser por duração ou por horário fixo, como “válido até 20:00”.</span>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Mensagem no Banner do Cardápio</label>
                                <input className={styles.input} placeholder="Ex: Fechado aos finais de semana."
                                    value={settings.bannerMessage}
                                    onChange={e => setSettings(s => ({ ...s, bannerMessage: e.target.value }))} />
                            </div>

                            <div className={styles.divider} />

                            <Toggle
                                checked={settings.allowReconfirmPickup}
                                onChange={v => setSettings(s => ({ ...s, allowReconfirmPickup: v }))}
                                label="Permitir Reconfirmação de Retirada"
                                description={
                                    settings.allowReconfirmPickup
                                        ? 'Ativado — operador pode confirmar retirada mesmo em tickets já utilizados.'
                                        : 'Desativado — ticket já utilizado exibirá aviso de bloqueio ao operador.'
                                }
                            />
                        </div>
                    )}


                    {/* ── AUDITORIA ── */}
                    {tab === 'auditoria' && (
                        <div className={styles.section}>
                            <div className={styles.auditHeader}>
                                <div className={styles.sectionHeader} style={{ margin: 0 }}>
                                    <ShieldAlert size={20} />
                                    <div>
                                        <h3 className={styles.sectionTitle}>Log de Auditoria</h3>
                                        <p className={styles.sectionDesc}>{logTotal} evento{logTotal !== 1 ? 's' : ''} {logActionFilter ? 'filtrados' : 'registrados'}</p>
                                    </div>
                                </div>
                                <div className={styles.auditControls}>
                                    <div className={styles.filterWrap}>
                                        <Filter size={14} className={styles.filterIcon} />
                                        <select
                                            className={styles.filterSelect}
                                            value={logActionFilter}
                                            onChange={e => handleFilterChange(e.target.value)}
                                        >
                                            <option value="">Todas as ações</option>
                                            {ACTION_GROUPS.map(g => (
                                                <optgroup key={g.label} label={g.label}>
                                                    {g.actions.map(a => (
                                                        <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </div>
                                    <button type="button" className={styles.btnRefresh} onClick={() => loadLogs(logOffset)}>
                                        <RefreshCw size={15} />
                                        Atualizar
                                    </button>
                                </div>
                            </div>

                            {logLoading ? (
                                <div className={styles.loading}>Carregando eventos...</div>
                            ) : (
                                <>
                                    <div className={styles.auditTable}>
                                        <div className={styles.auditHead}>
                                            <span>Data/Hora</span>
                                            <span>Operador</span>
                                            <span>Ação</span>
                                            <span>Entidade</span>
                                            <span />
                                        </div>
                                        {logs.map(log => {
                                            const isExpanded = expandedLogId === log.id;
                                            return (
                                                <div key={log.id} className={`${styles.auditRowWrap} ${isExpanded ? styles.auditRowExpanded : ''}`}>
                                                    <button
                                                        type="button"
                                                        className={styles.auditRow}
                                                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                                    >
                                                        <span className={styles.auditDate}>
                                                            {new Date(log.createdAt).toLocaleString('pt-BR', {
                                                                day: '2-digit', month: '2-digit',
                                                                hour: '2-digit', minute: '2-digit', second: '2-digit'
                                                            })}
                                                        </span>
                                                        <span className={styles.auditActor}>
                                                            {log.actor ? (
                                                                <>
                                                                    <span className={styles.actorName}>{log.actor.name}</span>
                                                                    <span className={styles.actorRole}>{log.actor.role}</span>
                                                                </>
                                                            ) : <span className={styles.actorName}>Sistema</span>}
                                                        </span>
                                                        <span className={styles.auditAction}>
                                                            {ACTION_LABELS[log.action] ?? log.action}
                                                        </span>
                                                        <span className={styles.auditEntity}>
                                                            {log.entity}
                                                            {log.entityId && <code className={styles.entityId}>{log.entityId.slice(0, 8)}</code>}
                                                        </span>
                                                        <span className={styles.expandIcon}>
                                                            {isExpanded ? '▲' : '▼'}
                                                        </span>
                                                    </button>
                                                    {isExpanded && (
                                                        <div className={styles.payloadPanel}>
                                                            <p className={styles.payloadTitle}>Detalhes do evento</p>
                                                            <PayloadDetail payload={log.payloadJson} />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {logs.length === 0 && (
                                            <div className={styles.auditEmpty}>Nenhum evento registrado.</div>
                                        )}
                                    </div>

                                    {/* Paginação */}
                                    {logTotal > LOG_LIMIT && (
                                        <div className={styles.pagination}>
                                            <button type="button" className={styles.pageBtn}
                                                disabled={logOffset === 0}
                                                onClick={() => loadLogs(Math.max(0, logOffset - LOG_LIMIT))}>
                                                ← Anterior
                                            </button>
                                            <span className={styles.pageInfo}>
                                                {logOffset + 1}–{Math.min(logOffset + LOG_LIMIT, logTotal)} de {logTotal}
                                            </span>
                                            <button type="button" className={styles.pageBtn}
                                                disabled={logOffset + LOG_LIMIT >= logTotal}
                                                onClick={() => loadLogs(logOffset + LOG_LIMIT)}>
                                                Próximo →
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ── BACKUPS ── */}
                    {tab === 'backups' && (
                        <div className={styles.section}>
                            <div className={styles.auditHeader}>
                                <div className={styles.sectionHeader} style={{ margin: 0 }}>
                                    <Database size={20} />
                                    <div>
                                        <h3 className={styles.sectionTitle}>Backups (Firestore)</h3>
                                        <p className={styles.sectionDesc}>Backup automático diário às 00:00 com retenção de 7 dias.</p>
                                    </div>
                                </div>
                                <div className={styles.auditControls}>
                                    <button
                                        type="button"
                                        className={styles.btnRefresh}
                                        onClick={() => void loadBackups()}
                                        disabled={backupsLoading}
                                    >
                                        <RefreshCw size={15} />
                                        Atualizar
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.btnRefresh}
                                        onClick={() => void handleRunBackup()}
                                        disabled={backupRunning || operationRunning}
                                    >
                                        <Play size={15} />
                                        {backupRunning || (operationRunning && backupProgress?.kind === 'BACKUP')
                                            ? 'Executando...'
                                            : 'Executar backup'}
                                    </button>
                                </div>
                            </div>

                            {backupProgress && backupProgress.status !== 'IDLE' && (
                                <div className={styles.progressPanel}>
                                    <div className={styles.progressHeader}>
                                        <p className={styles.progressTitle}>
                                            {backupProgress.kind === 'RESTORE' ? 'Restauração' : 'Backup'}{' '}
                                            {backupProgress.status === 'RUNNING'
                                                ? 'em andamento'
                                                : backupProgress.status === 'COMPLETED'
                                                    ? 'concluído'
                                                    : 'falhou'}
                                        </p>
                                        <span className={styles.progressPct}>
                                            {Math.max(0, Math.min(100, Math.round(backupProgress.progress)))}%
                                        </span>
                                    </div>
                                    <div className={styles.progressTrack}>
                                        <div
                                            className={styles.progressFill}
                                            style={{ width: `${Math.max(0, Math.min(100, Math.round(backupProgress.progress)))}%` }}
                                        />
                                    </div>
                                    <p className={styles.progressStage}>{backupProgress.stage}</p>
                                    {backupProgress.errorMessage && (
                                        <p className={styles.backupError}>{backupProgress.errorMessage}</p>
                                    )}
                                </div>
                            )}

                            {backupsLoading ? (
                                <div className={styles.loading}>Carregando backups...</div>
                            ) : backups.length === 0 ? (
                                <div className={styles.auditEmpty}>Nenhum backup registrado.</div>
                            ) : (
                                <div className={styles.backupsList}>
                                    {backups.map((backup) => (
                                        <div key={backup.id} className={styles.backupCard}>
                                            <div className={styles.backupHead}>
                                                <div>
                                                    <p className={styles.backupId}>{backup.id}</p>
                                                    <p className={styles.backupMeta}>
                                                        {backup.createdAt ? new Date(backup.createdAt).toLocaleString('pt-BR') : 'Sem data'}
                                                        {' · '}
                                                        {backup.source === 'cron' ? 'Automático' : 'Manual'}
                                                    </p>
                                                </div>
                                                <span
                                                    className={`${styles.backupStatus} ${backup.status === 'COMPLETED'
                                                        ? styles.backupStatusCompleted
                                                        : backup.status === 'RUNNING'
                                                            ? styles.backupStatusRunning
                                                            : styles.backupStatusFailed
                                                        }`}
                                                >
                                                    {backup.status}
                                                </span>
                                            </div>

                                            <div className={styles.backupStats}>
                                                <span>Tabelas: <strong>{backup.tableCount}</strong></span>
                                                <span>Registros: <strong>{backup.rowCount}</strong></span>
                                                <span>Imagens: <strong>{backup.imageCount}</strong></span>
                                                <span>Expira: <strong>{backup.expiresAt ? new Date(backup.expiresAt).toLocaleDateString('pt-BR') : '—'}</strong></span>
                                            </div>

                                            {backup.errorMessage && (
                                                <p className={styles.backupError}>{backup.errorMessage}</p>
                                            )}

                                            <div className={styles.backupActions}>
                                                <button
                                                    type="button"
                                                    className={styles.pageBtn}
                                                    onClick={() => void handleRestoreBackup(backup)}
                                                    disabled={
                                                        backup.status !== 'COMPLETED'
                                                        || restoringBackupId === backup.id
                                                        || operationRunning
                                                    }
                                                >
                                                    <Download size={14} />
                                                    {restoringBackupId === backup.id
                                                        || (operationRunning
                                                            && backupProgress?.kind === 'RESTORE'
                                                            && backupProgress.backupId === backup.id)
                                                        ? 'Restaurando...'
                                                        : 'Restaurar'}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Salvar (não mostra na aba auditoria) */}
                    {(tab === 'geral' || tab === 'operacao') && (
                        <button type="submit" className={`${styles.btnSave} ${saveOk ? styles.btnSaveOk : ''}`} disabled={saving}>
                            {saveOk ? (
                                <><RotateCcw size={18} /> Salvo!</>
                            ) : saving ? 'Salvando...' : (
                                <><Save size={18} /> Salvar Configurações</>
                            )}
                        </button>
                    )}
                </form>

                <div
                    className={`${styles.modalOverlay} ${isTicketWindowModalOpen ? styles.modalOverlayOpen : ''}`}
                    onClick={() => setIsTicketWindowModalOpen(false)}
                    aria-hidden={!isTicketWindowModalOpen}
                >
                    <section
                        className={styles.ticketWindowModal}
                        onClick={(event) => event.stopPropagation()}
                        aria-label="Definir validade do ticket"
                    >
                        <div className={styles.modalHeader}>
                            <div>
                                <span className={styles.modalEyebrow}>Operação</span>
                                <h3 className={styles.modalTitle}>Definir validade do ticket</h3>
                                <p className={styles.modalDesc}>Escolha entre uma duração fixa ou um horário limite diário para o ticket.</p>
                            </div>
                            <button
                                type="button"
                                className={styles.modalClose}
                                onClick={() => setIsTicketWindowModalOpen(false)}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.modalBody}>
                            <div className={styles.modalModeTabs}>
                                <button
                                    type="button"
                                    className={`${styles.modalUnitTab} ${ticketValidityDraftMode === 'DURATION' ? styles.modalUnitTabActive : ''}`}
                                    onClick={() => setTicketValidityDraftMode('DURATION')}
                                >
                                    Duração
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.modalUnitTab} ${ticketValidityDraftMode === 'UNTIL_TIME' ? styles.modalUnitTabActive : ''}`}
                                    onClick={() => setTicketValidityDraftMode('UNTIL_TIME')}
                                >
                                    Até horário
                                </button>
                            </div>

                            {ticketValidityDraftMode === 'DURATION' ? (
                                <>
                            <div className={styles.modalUnitTabs}>
                                <button
                                    type="button"
                                    className={`${styles.modalUnitTab} ${ticketWindowDraftUnit === 'MINUTES' ? styles.modalUnitTabActive : ''}`}
                                    onClick={() => setTicketWindowDraftUnit('MINUTES')}
                                >
                                    Minutos
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.modalUnitTab} ${ticketWindowDraftUnit === 'HOURS' ? styles.modalUnitTabActive : ''}`}
                                    onClick={() => setTicketWindowDraftUnit('HOURS')}
                                >
                                    Horas
                                </button>
                            </div>

                            <label className={styles.field}>
                                <span className={styles.label}>
                                    {ticketWindowDraftUnit === 'HOURS' ? 'Quantidade de horas' : 'Quantidade de minutos'}
                                </span>
                                <input
                                    type="number"
                                    className={styles.input}
                                    min={ticketWindowDraftUnit === 'HOURS' ? 1 : 5}
                                    max={ticketWindowDraftUnit === 'HOURS' ? 24 : 1440}
                                    value={ticketWindowDraftValue}
                                    onChange={(event) => setTicketWindowDraftValue(event.target.value)}
                                />
                            </label>
                                </>
                            ) : (
                                <label className={styles.field}>
                                    <span className={styles.label}>Horário limite</span>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={ticketUntilTimeDraft}
                                        onChange={(event) => setTicketUntilTimeDraft(event.target.value)}
                                    />
                                </label>
                            )}

                            <div className={styles.modalPreview}>
                                <span className={styles.modalPreviewLabel}>Será salvo como</span>
                                <strong className={styles.modalPreviewValue}>
                                    {(() => {
                                        if (ticketValidityDraftMode === 'UNTIL_TIME') {
                                            return /^\d{2}:\d{2}$/.test(ticketUntilTimeDraft)
                                                ? `Válido até ${ticketUntilTimeDraft} (próxima ocorrência)`
                                                : '—';
                                        }
                                        const parsed = Number.parseInt(ticketWindowDraftValue, 10);
                                        if (!Number.isFinite(parsed) || parsed <= 0) return '—';
                                        const previewMinutes = ticketWindowDraftUnit === 'HOURS' ? parsed * 60 : parsed;
                                        return `${formatTicketWindowLabel({
                                            ticketWindowMinutes: previewMinutes,
                                            ticketValidityMode: 'DURATION',
                                            ticketValidUntilTime: null,
                                        })} (${previewMinutes} min)`;
                                    })()}
                                </strong>
                            </div>
                        </div>

                        <div className={styles.modalActions}>
                            <button
                                type="button"
                                className={styles.modalCancelBtn}
                                onClick={() => setIsTicketWindowModalOpen(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className={styles.modalConfirmBtn}
                                onClick={applyTicketWindowDraft}
                            >
                                Aplicar validade
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </AdminLayout>
    );
}
