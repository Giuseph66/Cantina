import { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { useDialog } from '../../components/DialogProvider';
import { UserPlus, ShieldCheck, ShoppingBag, CookingPot, Crown, UserX, UserCheck, Search, Pencil } from 'lucide-react';
import styles from './UsersPage.module.css';

interface User {
    id: string;
    name: string;
    email: string;
    cpf?: string | null;
    phone?: string | null;
    role: 'CLIENT' | 'CASHIER' | 'KITCHEN' | 'ADMIN';
    isActive: boolean;
    createdAt: string;
}

const ROLE_LABELS: Record<User['role'], string> = {
    CLIENT: 'Cliente',
    CASHIER: 'Operador de Caixa',
    KITCHEN: 'Cozinha',
    ADMIN: 'Administrador',
};

const ROLE_ICONS: Record<User['role'], JSX.Element> = {
    CLIENT: <ShoppingBag size={13} strokeWidth={2.5} />,
    CASHIER: <ShieldCheck size={13} strokeWidth={2.5} />,
    KITCHEN: <CookingPot size={13} strokeWidth={2.5} />,
    ADMIN: <Crown size={13} strokeWidth={2.5} />,
};

type FilterTab = 'ALL' | 'CLIENT' | 'STAFF';

const EMPTY_CREATE = { name: '', email: '', password: '', cpf: '', phone: '', role: 'CASHIER' as User['role'] };

export default function UsersPage() {
    const api = useApi();
    const { alert: showAlert } = useDialog();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<FilterTab>('ALL');

    // Modal criar
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState(EMPTY_CREATE);
    const [createError, setCreateError] = useState('');
    const [creating, setCreating] = useState(false);

    // Modal editar
    const [editUser, setEditUser] = useState<User | null>(null);
    const [editForm, setEditForm] = useState({ name: '', email: '', role: 'CLIENT' as User['role'], password: '', cpf: '', phone: '' });
    const [editError, setEditError] = useState('');
    const [editing, setEditing] = useState(false);

    const load = () => {
        setLoading(true);
        api.get<User[]>('/users')
            .then(setUsers)
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const filtered = users.filter(u => {
        if (tab === 'CLIENT' && u.role !== 'CLIENT') return false;
        if (tab === 'STAFF' && u.role === 'CLIENT') return false;
        if (search && !u.name.toLowerCase().includes(search.toLowerCase()) &&
            !u.email.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const counts = {
        ALL: users.length,
        CLIENT: users.filter(u => u.role === 'CLIENT').length,
        STAFF: users.filter(u => u.role !== 'CLIENT').length,
    };

    function openEdit(u: User) {
        setEditUser(u);
        setEditForm({ name: u.name, email: u.email, role: u.role, password: '', cpf: u.cpf ?? '', phone: u.phone ?? '' });
        setEditError('');
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        setCreateError('');
        setCreating(true);
        try {
            await api.post('/users', createForm);
            setShowCreate(false);
            setCreateForm(EMPTY_CREATE);
            load();
        } catch (err: any) {
            setCreateError(err.message.replace(/^\[\d{3}\]\s*/, '') || 'Erro ao criar usuário');
        } finally {
            setCreating(false);
        }
    }

    async function handleEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editUser) return;
        setEditError('');
        setEditing(true);
        try {
            const payload: any = {
                name: editForm.name,
                email: editForm.email,
                role: editForm.role,
                cpf: editForm.cpf || undefined,
                phone: editForm.phone || undefined,
            };
            if (editForm.password) payload.password = editForm.password;

            const updated = await api.patch<User>(`/users/${editUser.id}`, payload);
            setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
            setEditUser(null);
        } catch (err: any) {
            setEditError(err.message.replace(/^\[\d{3}\]\s*/, '') || 'Erro ao atualizar usuário');
        } finally {
            setEditing(false);
        }
    }

    async function toggleActive(user: User) {
        const endpoint = user.isActive ? `/users/${user.id}/deactivate` : `/users/${user.id}/activate`;
        try {
            const updated = await api.patch<User>(endpoint, {});
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: updated.isActive } : u));
        } catch (err: any) {
            await showAlert(err.message.replace(/^\[\d{3}\]\s*/, ''), { tone: 'error' });
        }
    }

    return (
        <AdminLayout title="Usuários" subtitle="Gerencie clientes e funcionários do sistema">
            <div className={styles.page}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.searchWrap}>
                        <Search size={16} className={styles.searchIcon} />
                        <input className={styles.searchInput} placeholder="Buscar por nome ou e-mail..."
                            value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                    <button className={styles.btnCreate} onClick={() => setShowCreate(true)}>
                        <UserPlus size={18} strokeWidth={2.5} />
                        Novo Usuário
                    </button>
                </div>

                {/* Tabs */}
                <div className={styles.tabs}>
                    {(['ALL', 'CLIENT', 'STAFF'] as FilterTab[]).map(t => (
                        <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                            onClick={() => setTab(t)}>
                            {t === 'ALL' ? 'Todos' : t === 'CLIENT' ? 'Clientes' : 'Funcionários'}
                            <span className={styles.tabCount}>{counts[t]}</span>
                        </button>
                    ))}
                </div>

                {/* Lista */}
                {loading ? (
                    <div className={styles.loading}>Carregando usuários...</div>
                ) : filtered.length === 0 ? (
                    <div className={styles.empty}>Nenhum usuário encontrado.</div>
                ) : (
                    <div className={styles.list}>
                        {filtered.map(u => (
                            <div key={u.id} className={`${styles.card} ${!u.isActive ? styles.cardInactive : ''}`}>
                                <div className={styles.avatar} data-role={u.role}>
                                    {u.name.charAt(0).toUpperCase()}
                                </div>
                                <div className={styles.info}>
                                    <div className={styles.nameRow}>
                                        <span className={styles.name}>{u.name}</span>
                                        <span className={`${styles.roleBadge} ${styles[`role${u.role}`]}`}>
                                            {ROLE_ICONS[u.role]}
                                            {ROLE_LABELS[u.role]}
                                        </span>
                                        {!u.isActive && <span className={styles.inactiveBadge}>Inativo</span>}
                                    </div>
                                    <span className={styles.email}>{u.email}</span>
                                    <span className={styles.date}>
                                        Criado em {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                                    </span>
                                </div>
                                <div className={styles.cardActions}>
                                    <button className={styles.editBtn} onClick={() => openEdit(u)} title="Editar">
                                        <Pencil size={15} strokeWidth={2.5} />
                                        Editar
                                    </button>
                                    <button
                                        className={`${styles.toggleBtn} ${u.isActive ? styles.toggleBtnDeact : styles.toggleBtnAct}`}
                                        onClick={() => toggleActive(u)}
                                        title={u.isActive ? 'Desativar' : 'Reativar'}
                                    >
                                        {u.isActive ? <UserX size={15} strokeWidth={2.5} /> : <UserCheck size={15} strokeWidth={2.5} />}
                                        {u.isActive ? 'Desativar' : 'Reativar'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal Criar Usuário */}
            {showCreate && (
                <div className={styles.overlay} onClick={() => setShowCreate(false)}>
                    <div className={styles.modal} onClick={e => e.stopPropagation()}>
                        <h2 className={styles.modalTitle}>Novo Usuário</h2>
                        <form onSubmit={handleCreate} className={styles.form}>
                            <label className={styles.label}>Nome completo</label>
                            <input className={styles.input} required placeholder="Ex: João Silva"
                                value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />

                            <label className={styles.label}>E-mail</label>
                            <input className={styles.input} type="email" required placeholder="email@exemplo.com"
                                value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} />

                            <label className={styles.label}>Senha</label>
                            <input className={styles.input} type="password" required={createForm.role !== 'CLIENT'} placeholder={createForm.role === 'CLIENT' ? 'Opcional para cliente pré-cadastrado' : 'Mínimo 6 caracteres'}
                                minLength={6} value={createForm.password}
                                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} />

                            <label className={styles.label}>CPF</label>
                            <input className={styles.input} placeholder="Opcional"
                                value={createForm.cpf} onChange={e => setCreateForm(f => ({ ...f, cpf: e.target.value }))} />

                            <label className={styles.label}>Celular</label>
                            <input className={styles.input} placeholder="Opcional"
                                value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} />

                            <label className={styles.label}>Função</label>
                            <select className={styles.select} value={createForm.role}
                                onChange={e => setCreateForm(f => ({ ...f, role: e.target.value as User['role'] }))}>
                                <option value="CLIENT">Cliente</option>
                                <option value="CASHIER">Operador de Caixa (PDV)</option>
                                <option value="KITCHEN">Cozinha</option>
                                <option value="ADMIN">Administrador</option>
                            </select>

                            {createForm.role === 'CASHIER' && (
                                <p className={styles.roleHint}>
                                    Crie um usuário por terminal (ex: <strong>"Caixa 01"</strong>, <strong>"Caixa 02"</strong>).
                                </p>
                            )}

                            {createForm.role === 'CLIENT' && (
                                <p className={styles.roleHint}>
                                    Cliente pode ser pré-cadastrado sem senha. O acesso do app será feito depois com Google.
                                </p>
                            )}

                            {createError && <p className={styles.error}>{createError}</p>}

                            <div className={styles.modalActions}>
                                <button type="button" className={styles.btnCancel}
                                    onClick={() => { setShowCreate(false); setCreateError(''); }}>
                                    Cancelar
                                </button>
                                <button type="submit" className={styles.btnSubmit} disabled={creating}>
                                    {creating ? 'Criando...' : 'Criar Usuário'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Editar Usuário */}
            {editUser && (
                <div className={styles.overlay} onClick={() => setEditUser(null)}>
                    <div className={styles.modal} onClick={e => e.stopPropagation()}>
                        <h2 className={styles.modalTitle}>Editar Usuário</h2>
                        <form onSubmit={handleEdit} className={styles.form}>
                            <label className={styles.label}>Nome completo</label>
                            <input className={styles.input} required
                                value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />

                            <label className={styles.label}>E-mail</label>
                            <input className={styles.input} type="email" required
                                value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />

                            <label className={styles.label}>CPF</label>
                            <input className={styles.input} placeholder="Opcional"
                                value={editForm.cpf} onChange={e => setEditForm(f => ({ ...f, cpf: e.target.value }))} />

                            <label className={styles.label}>Celular</label>
                            <input className={styles.input} placeholder="Opcional"
                                value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />

                            <label className={styles.label}>Nova senha <span className={styles.optional}>{editForm.role === 'CLIENT' ? '(opcional)' : '(deixe em branco para manter)'}</span></label>
                            <input className={styles.input} type="password" placeholder={editForm.role === 'CLIENT' ? 'Opcional para cliente' : 'Nova senha (opcional)'}
                                minLength={6} value={editForm.password}
                                onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} />

                            <label className={styles.label}>Função</label>
                            <select className={styles.select} value={editForm.role}
                                onChange={e => setEditForm(f => ({ ...f, role: e.target.value as User['role'] }))}>
                                <option value="CLIENT">Cliente</option>
                                <option value="CASHIER">Operador de Caixa (PDV)</option>
                                <option value="KITCHEN">Cozinha</option>
                                <option value="ADMIN">Administrador</option>
                            </select>

                            {editError && <p className={styles.error}>{editError}</p>}

                            <div className={styles.modalActions}>
                                <button type="button" className={styles.btnCancel}
                                    onClick={() => { setEditUser(null); setEditError(''); }}>
                                    Cancelar
                                </button>
                                <button type="submit" className={styles.btnSubmit} disabled={editing}>
                                    {editing ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
