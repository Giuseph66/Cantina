import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { ProxyImage } from '../components/ProxyImage';
import { useApi } from '../hooks/useApi';
import { Utensils, ChevronRight, Plus, Minus, Zap, ShoppingBag, Store, CalendarDays } from 'lucide-react';
import styles from './LandingPage.module.css';

interface Category { id: string; name: string; }
interface Product {
    id: string; name: string; description: string | null;
    priceCents: number; imageUrl: string | null;
    stockMode: 'UNLIMITED' | 'CONTROLLED'; stockQty: number;
    categoryId: string;
    isSpecialToday: boolean;
    weeklySpecialDay: number | null;
    isWeeklySpecialToday: boolean;
    isWeeklySpecialPending: boolean;
}

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export default function LandingPage() {
    const { add, setQty, items, count, totalCents } = useCart();
    const api = useApi();
    const navigate = useNavigate();

    const [searchParams] = useSearchParams();
    const searchTerm = searchParams.get('s') || '';
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const cats = await api.get<Category[]>('/catalog/categories');
                setCategories(cats);
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

    const visibleProducts = products.filter((p: Product) => {
        let matchesTab = false;
        if (activeTab === null) {
            matchesTab = true;
        } else if (activeTab === 'especiais') {
            matchesTab = p.isSpecialToday || p.isWeeklySpecialToday;
        } else if (activeTab === 'semana') {
            matchesTab = p.weeklySpecialDay !== null;
        } else {
            matchesTab = p.categoryId === activeTab;
        }

        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesTab && matchesSearch;
    }).sort((a, b) => {
        if (activeTab === 'semana') {
            return (a.weeklySpecialDay ?? 0) - (b.weeklySpecialDay ?? 0);
        }
        if (a.isSpecialToday !== b.isSpecialToday) {
            return a.isSpecialToday ? -1 : 1;
        }
        if (a.isWeeklySpecialPending !== b.isWeeklySpecialPending) {
            return a.isWeeklySpecialPending ? 1 : -1;
        }
        return 0;
    });

    // Close modal on escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedProduct(null); };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    return (
        <div className={styles.container}>
            {/* TOP NAVIGATION HEADER */}
            {/* Persistent Header is now provided by ClientLayout */}

            {/* MAIN CONTENT AREA: Grocery Layout */}
            <main className={styles.main}>
                <div className={styles.layoutWrapper}>
                    {/* LEFT SIDEBAR (Desktop only) */}
                    <aside className={styles.sidebar}>
                        <h3 className={styles.sidebarTitle}>Categorias</h3>
                        <nav className={styles.sidebarNav}>
                            <button
                                className={`${styles.sidebarItem} ${activeTab === null ? styles.active : ''}`}
                                onClick={() => setActiveTab(null)}
                            >
                                <Zap size={18} />
                                Todos os itens
                            </button>
                            <button
                                className={`${styles.sidebarItem} ${activeTab === 'especiais' ? styles.active : ''}`}
                                onClick={() => setActiveTab('especiais')}
                            >
                                <Store size={18} />
                                Especiais de Hoje
                            </button>
                            <button
                                className={`${styles.sidebarItem} ${activeTab === 'semana' ? styles.active : ''}`}
                                onClick={() => setActiveTab('semana')}
                            >
                                <CalendarDays size={18} />
                                Especiais da Semana
                            </button>
                            {categories.map(c => (
                                <button
                                    key={c.id}
                                    className={`${styles.sidebarItem} ${activeTab === c.id ? styles.active : ''}`}
                                    onClick={() => setActiveTab(c.id)}
                                >
                                    <Utensils size={18} />
                                    {c.name}
                                </button>
                            ))}
                        </nav>
                    </aside>

                    {/* CONTENT AREA */}
                    <div className={styles.content}>
                        {/* HERO PROMO */}
                        {!searchTerm && (
                            <section className={styles.heroPromo}>
                                <div className={styles.promoText}>
                                    <span className={styles.promoTag}>Oferta Hoje</span>
                                    <h2>Fome Cedo? <br /> Pule a fila do intervalo!</h2>
                                    <p>Peça agora e retire seu lanche quentinho na hora do intervalo.</p>
                                </div>
                                <div className={styles.promoImagePlaceholder}>
                                    {/* Usually an illustration here */}
                                    <div className={styles.decorativeCircle}></div>
                                </div>
                            </section>
                        )}

                        {/* MOBILE CATEGORY PILLS */}
                        <div className={styles.mobileCategories}>
                            <button
                                className={`${styles.pill} ${activeTab === null ? styles.active : ''}`}
                                onClick={() => setActiveTab(null)}
                            >
                                Todos
                            </button>
                            <button
                                className={`${styles.pill} ${activeTab === 'especiais' ? styles.active : ''}`}
                                onClick={() => setActiveTab('especiais')}
                            >
                                ✨ Especiais
                            </button>
                            <button
                                className={`${styles.pill} ${activeTab === 'semana' ? styles.active : ''}`}
                                onClick={() => setActiveTab('semana')}
                            >
                                📅 Da Semana
                            </button>
                            {categories.map(c => (
                                <button
                                    key={c.id}
                                    className={`${styles.pill} ${activeTab === c.id ? styles.active : ''}`}
                                    onClick={() => setActiveTab(c.id)}
                                >
                                    {c.name}
                                </button>
                            ))}
                        </div>

                        {/* PRODUCT GRID SECTION */}
                        <div className={styles.sectionHeader}>
                            <h3>{searchTerm ? `Resultados para "${searchTerm}"` : (activeTab === 'especiais' ? 'Especiais de Hoje' : (activeTab === 'semana' ? 'Especiais da Semana' : (activeTab ? categories.find(c => c.id === activeTab)?.name : 'Populares')))}</h3>
                            <span className={styles.itemCount}>{visibleProducts.length} itens</span>
                        </div>

                        {loading ? (
                            <div className={styles.loadingState}>Carregando produtos...</div>
                        ) : visibleProducts.length === 0 ? (
                            <div className={styles.emptyState}>Nenhum produto encontrado.</div>
                        ) : (
                            <div className={styles.productGrid}>
                                {visibleProducts.map(p => {
                                    const isUnavailable = (p.stockMode === 'CONTROLLED' && p.stockQty <= 0) || p.isWeeklySpecialPending;
                                    const cartQty = cartQtyByProduct.get(p.id) ?? 0;
                                    const maxQty = p.stockMode === 'CONTROLLED' ? p.stockQty : undefined;
                                    const atMax = maxQty !== undefined && cartQty >= maxQty;

                                    return (
                                        <div
                                            key={p.id}
                                            className={`${styles.productCard} ${isUnavailable ? styles.unavailable : ''}`}
                                            onClick={() => !isUnavailable && setSelectedProduct(p)}
                                        >
                                            <div className={styles.productImageWrapper}>
                                                {p.imageUrl ? (
                                                    <ProxyImage src={p.imageUrl} alt={p.name} className={styles.productImage} />
                                                ) : (
                                                    <div className={styles.productPlaceholder}>
                                                        <Utensils size={32} opacity={0.2} />
                                                    </div>
                                                )}
                                                {activeTab === 'semana' && p.weeklySpecialDay !== null && (
                                                    <div className={styles.weekdayBadge}>Especial de {WEEKDAY_NAMES[p.weeklySpecialDay]}</div>
                                                )}
                                                {isUnavailable && (
                                                    <div className={styles.soldOutBadge}>
                                                        {p.isWeeklySpecialPending && p.weeklySpecialDay !== null
                                                            ? `Disponível ${WEEKDAY_NAMES[p.weeklySpecialDay]}`
                                                            : 'Esgotado'}
                                                    </div>
                                                )}
                                            </div>

                                            <div className={styles.productInfo}>
                                                <h4 className={styles.productName} title={p.name}>{p.name}</h4>
                                                <p className={styles.productDesc}>{p.description}</p>

                                                <div className={styles.productFooter}>
                                                    <span className={styles.productPrice}>{formatCurrency(p.priceCents)}</span>

                                                    {cartQty > 0 ? (
                                                        <div className={styles.qtyControls} onClick={(e) => e.stopPropagation()}>
                                                            <button className={styles.qtyBtn} onClick={() => setQty(p.id, cartQty - 1, maxQty)}>
                                                                <Minus size={22} strokeWidth={3} />
                                                            </button>
                                                            <span className={styles.qtyValue}>{cartQty}</span>
                                                            <button className={styles.qtyBtn} onClick={() => add({ productId: p.id, name: p.name, priceCents: p.priceCents }, maxQty)} disabled={isUnavailable || atMax}>
                                                                <Plus size={22} strokeWidth={3} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            className={styles.addBtn}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                add({ productId: p.id, name: p.name, priceCents: p.priceCents }, maxQty);
                                                            }}
                                                            disabled={isUnavailable}
                                                        >
                                                            <Plus size={28} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* MOBILE FIXED CHECKOUT CTA */}
            {count > 0 && (
                <div className={styles.mobileFloatingCart}>
                    <button className={styles.mobileCheckoutBtn} onClick={() => navigate('/pedido')}>
                        <div className={styles.floatingCartLeft}>
                            <div className={styles.floatingCartBadge}>{count}</div>
                            <span>Ver pedido</span>
                        </div>
                        <span className={styles.floatingCartTotal}>{formatCurrency(totalCents)} <ChevronRight size={18} /></span>
                    </button>
                </div>
            )}

            {/* PRODUCT MODAL */}
            {selectedProduct && (
                <div className={styles.modalOverlay} onClick={() => setSelectedProduct(null)}>
                    <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                        <button className={styles.modalCloseX} onClick={() => setSelectedProduct(null)}>×</button>

                        <div className={styles.modalImageWrapper}>
                            {selectedProduct.imageUrl ? (
                                <ProxyImage src={selectedProduct.imageUrl} alt={selectedProduct.name} className={styles.modalImage} />
                            ) : (
                                <div className={styles.modalPlaceholder}>
                                    <Utensils size={48} opacity={0.2} />
                                </div>
                            )}
                        </div>

                        <div className={styles.modalBody}>
                            <h2 className={styles.modalTitle}>{selectedProduct.name}</h2>
                            <p className={styles.modalDesc}>{selectedProduct.description || 'Um lanche delicioso preparado com ingredientes frescos.'}</p>

                            <div className={styles.modalPriceRow}>
                                <span className={styles.modalPrice}>{formatCurrency(selectedProduct.priceCents)}</span>
                            </div>

                            <button
                                className={styles.modalAddBtn}
                                disabled={selectedProduct.stockMode === 'CONTROLLED' && (cartQtyByProduct.get(selectedProduct.id) ?? 0) >= selectedProduct.stockQty}
                                onClick={() => {
                                    add(
                                        { productId: selectedProduct.id, name: selectedProduct.name, priceCents: selectedProduct.priceCents },
                                        selectedProduct.stockMode === 'CONTROLLED' ? selectedProduct.stockQty : undefined,
                                    );
                                    setSelectedProduct(null); // Fecha o modal após adicionar
                                }}
                            >
                                <ShoppingBag size={20} />
                                Adicionar ao Pedido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
