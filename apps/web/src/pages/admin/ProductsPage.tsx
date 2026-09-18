import { useState, useEffect, useMemo } from 'react';
import { ProxyImage } from '../../components/ProxyImage';
import { useApi } from '../../hooks/useApi';
import { Plus, Edit2, Trash2, X, Search, Package, ImageOff } from 'lucide-react';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { useDialog } from '../../components/DialogProvider';
import { CategoriesManagerModal } from '../../components/admin/CategoriesManagerModal';
import { StockBulkModal } from '../../components/admin/StockBulkModal';
import styles from './ProductsPage.module.css';
import adminStyles from './Admin.module.css';

interface Product {
    id: string; name: string; priceCents: number; isActive: boolean; categoryId: string;
    stockMode: 'UNLIMITED' | 'CONTROLLED'; stockQty: number; description: string | null; imageUrl: string | null;
    isSpecialToday: boolean;
    weeklySpecialDay: number | null;
    hasOrderHistory?: boolean;
    category: { name: string };
}
interface Category { id: string; name: string; }

const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function stockLabel(p: Product) {
    if (p.stockMode === 'UNLIMITED') return { text: 'Ilimitado', cls: '' };
    if (p.stockQty === 0) return { text: 'Esgotado', cls: styles.cardStockOut };
    if (p.stockQty <= 10) return { text: `${p.stockQty} restantes`, cls: styles.cardStockLow };
    return { text: `${p.stockQty} un.`, cls: '' };
}

function ProductsPage() {
    const api = useApi();
    const { alert: showAlert, confirm: showConfirm } = useDialog();
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState<string | null>(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isStockModalOpen, setIsStockModalOpen] = useState(false);
    const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const initialForm = {
        name: '', description: '', priceCentsStr: '', categoryId: '',
        stockMode: 'UNLIMITED' as 'UNLIMITED' | 'CONTROLLED', stockQty: 0, isActive: true, imageUrl: '', isSpecialToday: false,
        weeklySpecialDay: null as number | null,
    };
    const [formData, setFormData] = useState(initialForm);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const editingProduct = editingId ? products.find(p => p.id === editingId) : null;

    useEffect(() => { fetchData(); }, []);

    const fetchCategories = async () => {
        const data = await api.get<Category[]>('/admin/categories');
        setCategories(data);
        return data;
    };

    const fetchData = async () => {
        setLoading(true);
        setLoadError('');
        try {
            const [pdts] = await Promise.all([
                api.get<Product[]>('/admin/products'),
                fetchCategories()
            ]);
            setProducts(pdts);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Falha ao carregar produtos');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const visible = useMemo(() => {
        return products.filter(p => {
            const matchCat = !filterCat || p.categoryId === filterCat;
            const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
            return matchCat && matchSearch;
        });
    }, [products, filterCat, search]);

    const handleOpenNew = () => {
        setEditingId(null);
        setFormData({ ...initialForm, categoryId: categories[0]?.id || '' });
        setSelectedFile(null);
        setIsModalOpen(true);
    };

    const handleOpenEdit = (p: Product) => {
        setEditingId(p.id);
        setFormData({
            name: p.name, description: p.description || '',
            priceCentsStr: (p.priceCents / 100).toFixed(2),
            categoryId: p.categoryId, stockMode: p.stockMode,
            stockQty: p.stockQty, isActive: p.isActive, imageUrl: p.imageUrl || '', isSpecialToday: p.isSpecialToday,
            weeklySpecialDay: p.weeklySpecialDay,
        });
        setSelectedFile(null);
        setIsModalOpen(true);
    };

    const handleDeactivate = async (id: string, name: string) => {
        if (!await showConfirm(`Desativar o produto "${name}"?`)) return;
        try {
            await api.delete(`/admin/products/${id}`);
            fetchData();
        } catch (err: any) { await showAlert(err.message, { tone: 'error' }); }
    };

    const handleHardDelete = async (id: string, name: string) => {
        if (!await showConfirm(`Excluir definitivamente o produto inativo "${name}"? Essa ação não pode ser desfeita.`, { confirmLabel: 'Excluir definitivamente' })) return;
        try {
            await api.delete(`/admin/products/${id}`);
            if (editingId === id) {
                setIsModalOpen(false);
            }
            fetchData();
        } catch (err: any) {
            const message = String(err?.message ?? '');
            if (message.includes('[409]')) {
            await showAlert('Não foi possível excluir definitivamente: este produto já tem histórico de pedidos. Ele pode permanecer apenas como inativo.', { tone: 'warning' });
                return;
            }
            await showAlert(message || 'Falha ao excluir produto.', { tone: 'error' });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            let uploadedUrl = formData.imageUrl;
            if (selectedFile) {
                const form = new FormData();
                form.append('file', selectedFile);
                const uploadRes = await fetch('/api/v1/uploads', {
                    method: 'POST',
                    credentials: 'include',
                    body: form
                });
                if (!uploadRes.ok) throw new Error('Falha no upload da imagem');
                const uploadData = await uploadRes.json();
                uploadedUrl = uploadData.url;
            }
            const payload = {
                name: formData.name,
                description: formData.description || undefined,
                priceCents: Math.round(parseFloat(formData.priceCentsStr.replace(',', '.')) * 100),
                categoryId: formData.categoryId,
                stockMode: formData.stockMode,
                stockQty: formData.stockMode === 'CONTROLLED' ? formData.stockQty : undefined,
                isActive: formData.isActive,
                isSpecialToday: formData.isSpecialToday,
                weeklySpecialDay: formData.weeklySpecialDay,
                imageUrl: uploadedUrl || undefined
            };
            if (editingId) {
                await api.put(`/admin/products/${editingId}`, payload);
            } else {
                await api.post('/admin/products', payload);
            }
            setIsModalOpen(false);
            fetchData();
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleBulkStockSave = async (updates: { productId: string; qty: number }[]) => {
        await api.patch('/admin/products/bulk-stock', { items: updates });
        fetchData();
    };

    const handleCloseCategoriesModal = async () => {
        setIsCategoriesModalOpen(false);

        try {
            const refreshedCategories = await fetchCategories();
            setFormData((current) => {
                if (refreshedCategories.length === 0) {
                    return { ...current, categoryId: '' };
                }

                const currentCategoryExists = refreshedCategories.some(
                    (category) => category.id === current.categoryId,
                );

                if (currentCategoryExists) return current;

                return { ...current, categoryId: refreshedCategories[0].id };
            });
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <AdminLayout title="Produtos" subtitle="Gerencie seus itens e categorias">
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <h2 className={styles.title}>Lista de Produtos</h2>
                </div>
                <div className={styles.headerActions}>
                    <button className={styles.stockBtn} onClick={() => setIsStockModalOpen(true)}>
                        <Package size={20} /> LANÇAMENTO DE ESTOQUE
                    </button>
                    <button className={styles.newBtn} onClick={handleOpenNew}>
                        <Plus size={20} strokeWidth={3} /> NOVO PRODUTO
                    </button>
                </div>
            </div>

            <div className={styles.toolbar}>
                <div className={styles.searchWrapper}>
                    <Search size={20} className={styles.searchIcon} />
                    <input
                        className={styles.searchInput}
                        placeholder="Buscar produto pelo nome..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div className={styles.filters}>
                    <button
                        className={`${styles.filterBtn} ${!filterCat ? styles.filterActive : ''}`}
                        onClick={() => setFilterCat(null)}
                    >
                        Todos os Itens
                    </button>
                    {categories.map(c => (
                        <button
                            key={c.id}
                            className={`${styles.filterBtn} ${filterCat === c.id ? styles.filterActive : ''}`}
                            onClick={() => setFilterCat(c.id)}
                        >
                            {c.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.grid}>
                {loading ? (
                    <div className={styles.loading}>
                        <Package size={40} className={adminStyles.pulse} />
                        Carregando produtos...
                    </div>
                ) : loadError ? (
                    <div className={styles.empty}>
                        <Package size={64} strokeWidth={1.2} className={styles.emptyIcon} />
                        <p className={styles.emptyText}>{loadError}</p>
                    </div>
                ) : visible.length === 0 ? (
                    <div className={styles.empty}>
                        <Package size={64} strokeWidth={1.2} className={styles.emptyIcon} />
                        <p className={styles.emptyText}>Nenhum produto encontrado</p>
                    </div>
                ) : visible.map(p => {
                    const stock = stockLabel(p);
                    return (
                        <div key={p.id} className={`${styles.card} ${!p.isActive ? styles.cardInactive : ''}`}>
                            <div className={styles.cardImageWrapper}>
                                {p.imageUrl
                                    ? <ProxyImage src={p.imageUrl} alt={p.name} className={styles.cardImage} />
                                    : <div className={styles.cardImagePlaceholder}>
                                        <ImageOff size={40} strokeWidth={1.2} />
                                    </div>
                                }
                                <div className={styles.cardStatus}>
                                    <span className={`${styles.badge} ${p.isActive ? styles.badgeActive : styles.badgeInactive}`}>
                                        {p.isActive ? 'Ativo' : 'Inativo'}
                                    </span>
                                </div>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.cardTop}>
                                    <h3 className={styles.cardName}>{p.name}</h3>
                                    {p.isSpecialToday && (
                                        <span className={styles.badgeSpecial}>Especial de Hoje</span>
                                    )}
                                    {p.weeklySpecialDay !== null && (
                                        <span className={styles.badgeSpecial}>Especial de {WEEKDAY_NAMES[p.weeklySpecialDay]}</span>
                                    )}
                                </div>
                                {p.description && <p className={styles.cardDesc}>{p.description}</p>}
                                <div style={{ marginBottom: '1rem' }}>
                                    <span className={styles.badgeCategory}>
                                        {p.category.name}
                                    </span>
                                </div>
                                <div className={styles.cardMeta}>
                                    <span className={styles.cardPrice}>{formatCurrency(p.priceCents)}</span>
                                    <span className={`${styles.cardStock} ${stock.cls}`}>{stock.text}</span>
                                </div>
                            </div>
                            <div className={styles.cardActions}>
                                <button className={styles.btnEdit} onClick={() => handleOpenEdit(p)}>
                                    <Edit2 size={16} /> Editar
                                </button>
                                {p.isActive ? (
                                    <button className={styles.btnDelete} title="Desativar" onClick={() => handleDeactivate(p.id, p.name)}>
                                        <Trash2 size={18} />
                                    </button>
                                ) : !p.hasOrderHistory ? (
                                    <button className={styles.btnDelete} title="Excluir definitivamente" onClick={() => handleHardDelete(p.id, p.name)}>
                                        <Trash2 size={18} />
                                    </button>
                                ) : (
                                    <button className={styles.btnDelete} title="Produto com histórico (não pode excluir definitivamente)" disabled>
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {isModalOpen && (
                <div className={adminStyles.modalOverlay}>
                    <div className={adminStyles.adminModal} style={{ maxWidth: 800 }}>
                        <header className={adminStyles.adminModalHeader}>
                            <div className={adminStyles.adminModalTitleBlock}>
                                <h2 className={adminStyles.adminModalTitle}>{editingId ? 'Editar Produto' : 'Novo Produto'}</h2>
                                <p className={adminStyles.adminModalSubtitle}>Defina os detalhes, preço e estoque do item</p>
                            </div>
                            <button className={adminStyles.closeBtn} onClick={() => setIsModalOpen(false)}>
                                <X size={24} />
                            </button>
                        </header>

                        <div className={adminStyles.adminModalToolbar}>
                            <div className={adminStyles.categoryCounter}>
                                Total: <strong>{categories.length}</strong> Categorias cadastradas
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
                            <div className={styles.modalFormBody}>
                                <div className={styles.productFormGrid}>
                                    <div className={adminStyles.formGroup}>
                                        <label className={adminStyles.label}>Nome do Produto</label>
                                        <input
                                            type="text" required autoFocus className={adminStyles.input}
                                            placeholder="Ex: Misto Quente Especial"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div className={adminStyles.formGroup}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                                            <label className={adminStyles.label} style={{ margin: 0 }}>Categoria</label>
                                            <button
                                                type="button"
                                                className={adminStyles.secondaryBtn}
                                                onClick={() => setIsCategoriesModalOpen(true)}
                                                style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                                            >
                                                Gerenciar
                                            </button>
                                        </div>
                                        <select
                                            className={adminStyles.input} required
                                            value={formData.categoryId}
                                            onChange={e => setFormData({ ...formData, categoryId: e.target.value })}
                                        >
                                            <option value="" disabled>Selecione uma categoria...</option>
                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div className={adminStyles.formGroup}>
                                        <label className={adminStyles.label}>Preço de Venda (R$)</label>
                                        <input
                                            type="number" step="0.01" min="0" required className={adminStyles.input}
                                            placeholder="0,00"
                                            value={formData.priceCentsStr}
                                            onChange={e => setFormData({ ...formData, priceCentsStr: e.target.value })}
                                        />
                                    </div>
                                    <div className={adminStyles.formGroup}>
                                        <label className={adminStyles.label}>Modo de Estoque</label>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                type="button"
                                                className={formData.stockMode === 'UNLIMITED' ? adminStyles.primaryBtn : adminStyles.btnGhost}
                                                style={{ flex: 1, padding: '0.8rem' }}
                                                onClick={() => setFormData({ ...formData, stockMode: 'UNLIMITED' })}
                                            >
                                                ILIMITADO
                                            </button>
                                            <button
                                                type="button"
                                                className={formData.stockMode === 'CONTROLLED' ? adminStyles.primaryBtn : adminStyles.btnGhost}
                                                style={{ flex: 1, padding: '0.8rem' }}
                                                onClick={() => setFormData({ ...formData, stockMode: 'CONTROLLED' })}
                                            >
                                                CONTROLADO
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.productFormGrid}>
                                    {formData.stockMode === 'CONTROLLED' && (
                                        <div className={adminStyles.formGroup}>
                                            <label className={adminStyles.label}>Quantidade Disponível</label>
                                            <input
                                                type="number" min="0" required className={adminStyles.input}
                                                value={formData.stockQty}
                                                onChange={e => setFormData({ ...formData, stockQty: Number(e.target.value) })}
                                            />
                                        </div>
                                    )}

                                    <div className={adminStyles.formGroup}>
                                        <label className={adminStyles.label}>Imagem do Produto</label>
                                        <input
                                            type="file" accept="image/*" className={adminStyles.input}
                                            onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
                                        />
                                    </div>
                                </div>

                                {formData.imageUrl && !selectedFile && (
                                    <div className={styles.currentImageWrapper}>
                                        <div className={styles.currentImageLabel}>IMAGEM ATUAL ATIVA:</div>
                                        <ProxyImage src={formData.imageUrl} alt="Atual" className={styles.currentImageThumb} />
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>A imagem acima será mantida se você não selecionar um novo arquivo.</div>
                                    </div>
                                )}

                                <div className={adminStyles.formGroup}>
                                    <label className={adminStyles.label}>Descrição / Ingredientes</label>
                                    <textarea
                                        className={adminStyles.input} rows={3}
                                        style={{ resize: 'none' }}
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        placeholder="Ex: Pão de forma integral, queijo mussarela, presunto..."
                                    />
                                </div>

                                <label className={adminStyles.checkboxLabel} style={{ background: 'var(--bg-main)', padding: '1.5rem', borderRadius: '1.25rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.isSpecialToday}
                                        onChange={e => setFormData({ ...formData, isSpecialToday: e.target.checked })}
                                    />
                                    <div>
                                        <div style={{ fontWeight: 900, color: 'var(--primary)' }}>DESTACAR COMO ESPECIAL DE HOJE</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600 }}>Este item aparece na categoria “Especiais de Hoje” da tela inicial.</div>
                                    </div>
                                </label>

                                <div className={adminStyles.formGroup} style={{ background: 'var(--bg-main)', padding: '1.5rem', borderRadius: '1.25rem' }}>
                                    <label className={adminStyles.label} style={{ fontWeight: 900, color: 'var(--primary)' }}>ESPECIAL DA SEMANA</label>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600, marginBottom: '0.75rem' }}>
                                        Escolha o dia da semana em que este item é o especial. Nos outros dias, ele aparece no fim do cardápio como esgotado.
                                    </div>
                                    <select
                                        className={adminStyles.input}
                                        value={formData.weeklySpecialDay === null ? '' : formData.weeklySpecialDay}
                                        onChange={e => setFormData({ ...formData, weeklySpecialDay: e.target.value === '' ? null : Number(e.target.value) })}
                                    >
                                        <option value="">Nenhum</option>
                                        {WEEKDAY_NAMES.map((name, idx) => (
                                            <option key={idx} value={idx}>{name}</option>
                                        ))}
                                    </select>
                                </div>

                                {editingId && (
                                    <label className={adminStyles.checkboxLabel} style={{ background: 'var(--bg-main)', padding: '1.5rem', borderRadius: '1.25rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={formData.isActive}
                                            onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 900, color: 'var(--primary)' }}>PRODUTO ATIVO NO SISTEMA</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600 }}>Tornar este item visível ou oculto para os clientes no totem e menu mobile.</div>
                                        </div>
                                    </label>
                                )}

                                {editingProduct && !editingProduct.isActive && !editingProduct.hasOrderHistory && (
                                    <div className={styles.modalDangerZone}>
                                        <div className={styles.modalDangerText}>Produto inativo: você pode excluir definitivamente.</div>
                                        <button
                                            type="button"
                                            className={styles.modalDangerBtn}
                                            onClick={() => handleHardDelete(editingProduct.id, editingProduct.name)}
                                        >
                                            <Trash2 size={16} /> EXCLUIR DEFINITIVAMENTE
                                        </button>
                                    </div>
                                )}

                                {editingProduct && !editingProduct.isActive && !!editingProduct.hasOrderHistory && (
                                    <div className={styles.modalDangerZone}>
                                        <div className={styles.modalDangerText}>
                                            Este produto está inativo, mas possui histórico de pedidos e não pode ser excluído definitivamente.
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className={styles.modalFormFooter}>
                                <button type="button" onClick={() => setIsModalOpen(false)} className={adminStyles.secondaryBtn} style={{ flex: 1, padding: '1.25rem' }}>
                                    CANCELAR
                                </button>
                                <button type="submit" className={adminStyles.btnSubmit} style={{ flex: 2, margin: 0 }} disabled={saving}>
                                    {saving ? 'PROCESSANDO...' : (editingId ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR PRODUTO')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <CategoriesManagerModal
                isOpen={isCategoriesModalOpen}
                onClose={handleCloseCategoriesModal}
            />

            <StockBulkModal
                isOpen={isStockModalOpen}
                onClose={() => setIsStockModalOpen(false)}
                products={products}
                onSave={handleBulkStockSave}
            />
        </AdminLayout>
    );
}

export default ProductsPage;
