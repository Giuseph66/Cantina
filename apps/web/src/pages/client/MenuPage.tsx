import { useMemo, useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { useCart } from '../../contexts/CartContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Utensils, Plus, Minus, ShoppingBag } from 'lucide-react';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { ProxyImage } from '../../components/ProxyImage';
import styles from './MenuPage.module.css';

interface Category { id: string; name: string; }
interface Product {
    id: string; name: string; description: string | null;
    priceCents: number; imageUrl: string | null;
    stockMode: 'UNLIMITED' | 'CONTROLLED'; stockQty: number;
    categoryId: string;
}

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export default function MenuPage() {
    const api = useApi();
    const { add, setQty, items, count, totalCents } = useCart();
    const { user } = useAuth();
    const navigate = useNavigate();

    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const cats = await api.get<Category[]>('/catalog/categories');
                setCategories(cats);
                // No need to set default tab to first cat, "Todos" is better fallback

                const prods = await api.get<Product[]>('/catalog/products');
                setProducts(prods);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    const cartQtyByProduct = useMemo(
        () => new Map(items.map((item) => [item.productId, item.qty])),
        [items],
    );

    const visibleProducts = products.filter((p: Product) => !activeTab || p.categoryId === activeTab);

    if (loading) return <div className={styles.loading}>Carregando cardápio...</div>;

    const productCards = visibleProducts.map(p => {
        const isUnavailable = p.stockMode === 'CONTROLLED' && p.stockQty <= 0;
        const cartQty = cartQtyByProduct.get(p.id) ?? 0;
        return (
            <div
                key={p.id}
                className={`${styles.card} ${isUnavailable ? styles.unavailable : ''} ${cartQty > 0 ? styles.inCart : ''}`}
            >
                {p.imageUrl ? (
                    <ProxyImage src={p.imageUrl} alt={p.name} className={styles.image} />
                ) : (
                    <div className={styles.imagePlaceholder}>
                        <Utensils size={40} strokeWidth={1.5} color="var(--primary)" opacity={0.3} />
                    </div>
                )}
                <div className={styles.content}>
                    {cartQty > 0 && (
                        <div className={styles.cartIndicator}>{cartQty} no pedido</div>
                    )}
                    <h3 className={styles.name}>{p.name}</h3>
                    <p className={styles.desc}>{p.description || 'Sem descrição'}</p>

                    <div className={styles.footer}>
                        <div className={styles.priceBlock}>
                            <span className={styles.price}>{formatCurrency(p.priceCents)}</span>
                            {cartQty > 0 && <span className={styles.qtyHint}>Adicionado {cartQty}x</span>}
                        </div>
                        {cartQty > 0 ? (
                            <div className={styles.qtyControls}>
                                <button type="button" className={styles.qtyBtn}
                                    aria-label={`Remover uma unidade de ${p.name}`}
                                    onClick={() => setQty(p.id, cartQty - 1)}>
                                    <Minus size={24} strokeWidth={3} />
                                </button>
                                <span className={styles.qtyValue}>{cartQty}</span>
                                <button type="button" className={styles.qtyBtn}
                                    aria-label={`Adicionar mais uma unidade de ${p.name}`}
                                    onClick={() => add({ productId: p.id, name: p.name, priceCents: p.priceCents })}
                                    disabled={isUnavailable}>
                                    <Plus size={24} strokeWidth={3} />
                                </button>
                            </div>
                        ) : (
                            <button className={styles.addBtn}
                                aria-label={`Adicionar ${p.name} ao pedido`}
                                onClick={() => add({ productId: p.id, name: p.name, priceCents: p.priceCents })}
                                disabled={isUnavailable}>
                                <Plus size={28} strokeWidth={3} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    });

    const isAdmin = user?.role === 'ADMIN';

    const content = (
        <div className={styles.page}>
            {!isAdmin && (
                <div className={styles.titleBlock} style={{ padding: '2rem 1rem 1rem', textAlign: 'center' }}>
                    <h1 className={styles.title}>Cardápio</h1>
                    <p className={styles.subtitle}>Escolha seus itens e acompanhe seu pedido.</p>
                </div>
            )}

            {/* Mobile: tabs horizontais */}
            <div className={styles.tabs}>
                <button className={`${styles.tab} ${activeTab === null ? styles.active : ''}`}
                    onClick={() => setActiveTab(null)}>Todos</button>
                {categories.map(c => (
                    <button key={c.id}
                        className={`${styles.tab} ${activeTab === c.id ? styles.active : ''}`}
                        onClick={() => setActiveTab(c.id)}>{c.name}</button>
                ))}
            </div>

            {/* Desktop: sidebar de categorias + grid */}
            <div className={styles.desktopLayout}>
                <aside className={styles.categorySidebar}>
                    <p className={styles.sidebarLabel}>Categorias</p>
                    <button className={`${styles.sidebarTab} ${activeTab === null ? styles.active : ''}`}
                        onClick={() => setActiveTab(null)}>Todos os itens</button>
                    {categories.map(c => (
                        <button key={c.id}
                            className={`${styles.sidebarTab} ${activeTab === c.id ? styles.active : ''}`}
                            onClick={() => setActiveTab(c.id)}>{c.name}</button>
                    ))}
                </aside>

                <main className={styles.grid}>
                    {productCards}
                </main>
            </div>

            {count > 0 && (
                <button className={styles.checkoutCta} onClick={() => navigate('/pedido')}>
                    <ShoppingBag size={20} strokeWidth={2.5} />
                    <span>Finalizar pedido</span>
                    <strong>{formatCurrency(totalCents)}</strong>
                    <ArrowRight size={18} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );

    if (isAdmin) {
        return <AdminLayout title="Cardápio" subtitle="Visualização do cardápio como cliente">{content}</AdminLayout>;
    }

    return content;
}
