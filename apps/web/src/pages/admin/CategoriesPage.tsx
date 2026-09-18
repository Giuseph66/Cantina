import { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { Plus, Edit2, Trash2, X, List } from 'lucide-react';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { useDialog } from '../../components/DialogProvider';
import styles from './Admin.module.css';

interface Category { id: string; name: string; sortOrder: number; isActive: boolean; }

export default function CategoriesPage() {
    const api = useApi();
    const { alert: showAlert, confirm: showConfirm } = useDialog();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({ name: '', sortOrder: 0, isActive: true });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const data = await api.get<Category[]>('/admin/categories');
            setCategories(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenNew = () => {
        setEditingId(null);
        setFormData({ name: '', sortOrder: categories.length, isActive: true });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (c: Category) => {
        setEditingId(c.id);
        setFormData({ name: c.name, sortOrder: c.sortOrder, isActive: c.isActive });
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string, name: string) => {
        if (!await showConfirm(`Tem certeza que deseja excluir "${name}"?`)) return;
        try {
            await api.delete(`/admin/categories/${id}`);
            setCategories(prev => prev.filter(c => c.id !== id));
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (editingId) {
                await api.put(`/admin/categories/${editingId}`, formData);
            } else {
                await api.post('/admin/categories', formData);
            }
            setIsModalOpen(false);
            fetchData();
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminLayout title="Categorias" subtitle="Gerencie as seções do seu cardápio">
            <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Suas Categorias</h2>
                <button className={styles.primaryBtn} onClick={handleOpenNew}>
                    <Plus size={18} /> Nova Categoria
                </button>
            </div>

            <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div className={styles.loadingState}>
                        <List size={40} className={styles.pulse} />
                        <p>Carregando categorias...</p>
                    </div>
                ) : categories.length === 0 ? (
                    <div className={styles.emptyState}>
                        <List size={64} style={{ opacity: 0.2 }} />
                        <p>Nenhuma categoria cadastrada.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Ordem</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categories.map(c => (
                                    <tr key={c.id}>
                                        <td><strong>{c.name}</strong></td>
                                        <td>{c.sortOrder}</td>
                                        <td>
                                            <span className={c.isActive ? styles.tagOpen : styles.tagClosed}>
                                                {c.isActive ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                                                <button className={styles.iconBtn} onClick={() => handleOpenEdit(c)}><Edit2 size={16} /></button>
                                                <button className={styles.iconBtn} onClick={() => handleDelete(c.id, c.name)} style={{ color: '#ef4444' }}><Trash2 size={16} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div className={styles.modalOverlay}>
                    <div className={styles.adminModal} style={{ maxWidth: 500 }}>
                        <header className={styles.adminModalHeader}>
                            <div className={styles.adminModalTitleBlock}>
                                <h2 className={styles.adminModalTitle}>{editingId ? 'Editar Categoria' : 'Nova Categoria'}</h2>
                                <p className={styles.adminModalSubtitle}>Organize como seus produtos aparecem </p>
                            </div>
                            <button className={styles.closeBtn} onClick={() => setIsModalOpen(false)}><X /></button>
                        </header>

                        <form onSubmit={handleSubmit} style={{ padding: '2rem' }}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Nome da Categoria</label>
                                <input
                                    type="text" required autoFocus className={styles.input}
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>Ordenação</label>
                                <input
                                    type="number" required className={styles.input}
                                    value={formData.sortOrder}
                                    onChange={e => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                                />
                            </div>

                            {editingId && (
                                <div className={styles.formGroup} style={{ marginTop: '1rem' }}>
                                    <label className={styles.checkboxLabel} style={{ background: 'var(--bg-main)', padding: '1rem', borderRadius: '1rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={formData.isActive}
                                            onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                        />
                                        <span>Categoria Ativa e Visível no Menu</span>
                                    </label>
                                </div>
                            )}

                            <button type="submit" className={styles.btnSubmit} disabled={saving}>
                                {saving ? 'SALVANDO...' : 'SALVAR CATEGORIA'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
