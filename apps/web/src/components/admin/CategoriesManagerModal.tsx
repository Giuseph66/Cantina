import { useEffect, useMemo, useRef, useState } from 'react';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useDialog } from '../DialogProvider';
import styles from '../../pages/admin/Admin.module.css';

interface Category {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
}

interface CategoryFormState {
    name: string;
    sortOrder: number;
    isActive: boolean;
}

const INITIAL_FORM: CategoryFormState = {
    name: '',
    sortOrder: 0,
    isActive: true,
};

export function CategoriesManagerModal({
    isOpen,
    onClose,
}: {
    isOpen: boolean;
    onClose: () => void;
}) {
    const api = useApi();
    const { alert: showAlert, confirm: showConfirm } = useDialog();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<CategoryFormState>(INITIAL_FORM);
    const formPanelRef = useRef<HTMLElement | null>(null);

    const nextSortOrder = useMemo(() => {
        if (categories.length === 0) return 0;
        return Math.max(...categories.map((category) => category.sortOrder)) + 1;
    }, [categories]);

    useEffect(() => {
        if (!isOpen) return;

        const fetchCategories = async () => {
            setLoading(true);
            try {
                const data = await api.get<Category[]>('/admin/categories');
                setCategories(data);
                setFormData((current) => (
                    editingId
                        ? current
                        : {
                            ...current,
                            sortOrder: data.length === 0
                                ? 0
                                : Math.max(...data.map((category) => category.sortOrder)) + 1,
                        }
                ));
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchCategories();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setEditingId(null);
            setFormData(INITIAL_FORM);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    function scrollFormIntoView() {
        requestAnimationFrame(() => {
            formPanelRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        });
    }

    function resetToCreateMode() {
        setEditingId(null);
        setFormData({
            name: '',
            sortOrder: nextSortOrder,
            isActive: true,
        });
        scrollFormIntoView();
    }

    function handleEdit(category: Category) {
        setEditingId(category.id);
        setFormData({
            name: category.name,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
        });
        scrollFormIntoView();
    }

    async function handleDelete(id: string, name: string) {
        if (!await showConfirm(`Tem certeza que deseja excluir "${name}"?`)) return;

        try {
            await api.delete(`/admin/categories/${id}`);
            setCategories((current) => current.filter((category) => category.id !== id));
            if (editingId === id) {
                resetToCreateMode();
            }
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        }
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);

        try {
            if (editingId) {
                await api.put(`/admin/categories/${editingId}`, formData);
            } else {
                await api.post('/admin/categories', formData);
            }

            const refreshed = await api.get<Category[]>('/admin/categories');
            setCategories(refreshed);
            resetToCreateMode();
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div
                className={styles.adminModal}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={styles.adminModalHeader}>
                    <div className={styles.adminModalTitleBlock}>
                        <h2 className={styles.adminModalTitle}>Categorias</h2>
                        <p className={styles.adminModalSubtitle}>
                            Organize o cardapio sem sair do painel.
                        </p>
                    </div>
                    <button
                        type="button"
                        className={styles.closeBtn}
                        onClick={onClose}
                        aria-label="Fechar modal de categorias"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className={styles.adminModalToolbar}>
                    <span className={styles.categoryCounter}>
                        Total: <strong>{categories.length}</strong> categoria{categories.length === 1 ? '' : 's'}
                    </span>
                    <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={resetToCreateMode}
                    >
                        <Plus size={18} />
                        Nova categoria
                    </button>
                </div>

                <div className={styles.adminModalBody}>
                    <section className={styles.categoryListPanel}>
                        {loading ? (
                            <div className={styles.loadingState}>
                                <Plus size={40} className={styles.pulse} />
                                <p>Carregando categorias...</p>
                            </div>
                        ) : categories.length === 0 ? (
                            <div className={styles.emptyState}>
                                <Plus size={64} style={{ opacity: 0.2 }} />
                                <p>Nenhuma categoria cadastrada.</p>
                            </div>
                        ) : (
                            <div className={styles.categoryList}>
                                {categories
                                    .slice()
                                    .sort((left, right) => left.sortOrder - right.sortOrder)
                                    .map((category) => (
                                        <article
                                            key={category.id}
                                            className={`${styles.categoryCard} ${editingId === category.id ? styles.categoryCardEditing : ''}`}
                                        >
                                            <div className={styles.categoryCardMain}>
                                                <div>
                                                    <h3 className={styles.categoryName}>{category.name}</h3>
                                                    <div className={styles.categoryMeta}>
                                                        <span>ORDEM {category.sortOrder}</span>
                                                        <span
                                                            className={category.isActive ? styles.tagOpen : styles.tagClosed}
                                                        >
                                                            {category.isActive ? 'Ativa' : 'Inativa'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={styles.categoryActions}>
                                                <button
                                                    type="button"
                                                    className={styles.btnGhost}
                                                    onClick={() => handleEdit(category)}
                                                >
                                                    <Edit2 size={16} />
                                                    Editar
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.btnDanger}
                                                    onClick={() => handleDelete(category.id, category.name)}
                                                >
                                                    <Trash2 size={16} />
                                                    Excluir
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                            </div>
                        )}
                    </section>

                    <aside ref={formPanelRef} className={styles.categoryFormPanel}>
                        <div className={styles.formPanelHeader}>
                            <h3>{editingId ? 'Editar Categoria' : 'Nova Categoria'}</h3>
                            <p>
                                {editingId
                                    ? 'Atualize o nome, ordem de exibição e visibilidade desta categoria.'
                                    : 'Cadastre uma nova categoria para organizar seus produtos no cardápio.'}
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} className={styles.categoryForm}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>NOME DA CATEGORIA</label>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    className={styles.input}
                                    placeholder="Ex: Bebidas, Sobremesas..."
                                    value={formData.name}
                                    onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>ORDEM DE APARIÇÃO</label>
                                <input
                                    type="number"
                                    required
                                    className={styles.input}
                                    value={formData.sortOrder}
                                    onChange={(event) =>
                                        setFormData({
                                            ...formData,
                                            sortOrder: Number(event.target.value),
                                        })
                                    }
                                />
                            </div>

                            <label className={styles.checkboxLabel} style={{ background: 'white', padding: '1rem', borderRadius: '1rem', border: '1px solid var(--glass-border)' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(event) =>
                                        setFormData({
                                            ...formData,
                                            isActive: event.target.checked,
                                        })
                                    }
                                />
                                <span>Categoria ativa no menu</span>
                            </label>

                            <div className={styles.formActions}>
                                <button
                                    type="submit"
                                    className={styles.btnSubmit}
                                    style={{ margin: 0 }}
                                    disabled={saving}
                                >
                                    {saving ? 'PROCESSANDO...' : editingId ? 'SALVAR ALTERAÇÕES' : 'CRIAR CATEGORIA'}
                                </button>

                                {editingId ? (
                                    <button
                                        type="button"
                                        className={styles.btnGhost}
                                        onClick={resetToCreateMode}
                                    >
                                        Limpar e criar nova
                                    </button>
                                ) : (
                                    <span className={styles.formHint}>
                                        A ordem define a posição no menu mobile e totem.
                                    </span>
                                )}
                            </div>
                        </form>
                    </aside>
                </div>
            </div>
        </div>
    );
}
