import { useEffect, useMemo, useState } from 'react';
import {
    CalendarClock, CreditCard, Minus, Plus, Search, ShoppingCart,
    StickyNote, Trash2, UserRound, Wallet, LayoutGrid, Rows3,
    X,
} from 'lucide-react';
import { CashierLayout } from '../../components/cashier/CashierLayout';
import { useApi } from '../../hooks/useApi';
import styles from './CounterSalePage.module.css';
import { ProxyImage } from '../../components/ProxyImage';
import { useDialog } from '../../components/DialogProvider';

interface Product {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    imageUrl: string | null;
    stockMode: 'UNLIMITED' | 'CONTROLLED';
    stockQty: number;
    category: {
        id: string;
        name: string;
    };
}

interface CartItem extends Product {
    qty: number;
}

interface Customer {
    id: string;
    name: string;
    email: string;
    createdAt: string;
}

type PaymentMethod = 'CASH' | 'PIX' | 'CARD' | 'INTERNAL_CREDIT';
type CustomerMode = 'REGISTERED' | 'GUEST';
type ProductView = 'GRID' | 'LIST';

const PRODUCT_VIEW_STORAGE_KEY = 'cantina_counter_product_view';

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string; hint: string; icon: typeof Wallet }> = [
    { value: 'CASH', label: 'Dinheiro', hint: 'Entrada imediata no caixa', icon: Wallet },
    { value: 'PIX', label: 'Pix', hint: 'Recebimento instantaneo', icon: CreditCard },
    { value: 'CARD', label: 'Cartao', hint: 'Debito ou credito', icon: CreditCard },
    { value: 'INTERNAL_CREDIT', label: 'Notinha', hint: 'Pendurar no credito interno', icon: StickyNote },
];

function formatCurrency(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}


function getTodayPlusDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

export default function CounterSalePage() {
    const api = useApi();
    const { alert: showAlert } = useDialog();
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState<'ALL' | string>('ALL');
    const [loading, setLoading] = useState(false);
    const [productView, setProductView] = useState<ProductView>(() => {
        const savedView = localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY);
        return savedView === 'LIST' ? 'LIST' : 'GRID';
    });
    const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
    const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false);

    const [customerMode, setCustomerMode] = useState<CustomerMode>('REGISTERED');
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [guestName, setGuestName] = useState('');
    const [guestPhone, setGuestPhone] = useState('');
    const [dueAt, setDueAt] = useState(getTodayPlusDays(15));
    const [notes, setNotes] = useState('');

    const isCreditSale = paymentMethod === 'INTERNAL_CREDIT';
    const isListView = productView === 'LIST';

    useEffect(() => {
        api.get<Product[]>('/catalog/products')
            .then(setProducts)
            .catch(console.error);
    }, []);

    useEffect(() => {
        if (!isCreditSale || customerMode !== 'REGISTERED') {
            return;
        }

        api.get<Customer[]>(`/credit-notes/customers?search=${encodeURIComponent(customerSearch)}`)
            .then(setCustomers)
            .catch(console.error);
    }, [customerMode, customerSearch, isCreditSale]);

    useEffect(() => {
        if (!isProductPickerOpen && !isCheckoutConfirmOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isCheckoutConfirmOpen, isProductPickerOpen]);

    useEffect(() => {
        localStorage.setItem(PRODUCT_VIEW_STORAGE_KEY, productView);
    }, [productView]);

    const categories = useMemo(() => {
        const seen = new Map<string, string>();
        products.forEach((product) => seen.set(product.category.id, product.category.name));
        return [{ id: 'ALL', name: 'Todas' }, ...Array.from(seen.entries()).map(([id, name]) => ({ id, name }))];
    }, [products]);

    const filteredProducts = useMemo(() => {
        return products.filter((product) => {
            if (categoryId !== 'ALL' && product.category.id !== categoryId) return false;
            if (!search.trim()) return true;
            const term = search.toLowerCase();
            return product.name.toLowerCase().includes(term)
                || product.category.name.toLowerCase().includes(term)
                || product.description?.toLowerCase().includes(term);
        });
    }, [categoryId, products, search]);

    const total = useMemo(
        () => cart.reduce((acc, item) => acc + (item.priceCents * item.qty), 0),
        [cart],
    );

    const itemCount = useMemo(
        () => cart.reduce((acc, item) => acc + item.qty, 0),
        [cart],
    );

    const addToCart = (product: Product) => {
        setCart((prev) => {
            const existing = prev.find((item) => item.id === product.id);
            if (existing) {
                return prev.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
            }
            return [...prev, { ...product, qty: 1 }];
        });
    };

    const updateQty = (productId: string, delta: number) => {
        setCart((prev) => prev.flatMap((item) => {
            if (item.id !== productId) return [item];
            const nextQty = item.qty + delta;
            return nextQty <= 0 ? [] : [{ ...item, qty: nextQty }];
        }));
    };

    const removeFromCart = (productId: string) => {
        setCart((prev) => prev.filter((item) => item.id !== productId));
    };

    const resetCreditFields = () => {
        setSelectedCustomer(null);
        setGuestName('');
        setGuestPhone('');
        setNotes('');
        setDueAt(getTodayPlusDays(15));
        setCustomerSearch('');
    };

    const handleCheckout = async () => {
        if (cart.length === 0) return;

        if (isCreditSale) {
            const hasRegisteredCustomer = customerMode === 'REGISTERED' && selectedCustomer;
            const hasGuestCustomer = customerMode === 'GUEST' && guestName.trim();

            if (!hasRegisteredCustomer && !hasGuestCustomer) {
                setIsCheckoutConfirmOpen(false);
                await showAlert('Selecione um cliente cadastrado ou informe um nome para a notinha avulsa.', { tone: 'warning' });
                return;
            }
        }

        setLoading(true);
        try {
            await api.post('/counter/sale', {
                items: cart.map((item) => ({ productId: item.id, qty: item.qty })),
                paymentMethod,
                customerUserId: isCreditSale && customerMode === 'REGISTERED' ? selectedCustomer?.id : undefined,
                customerName: isCreditSale && customerMode === 'GUEST' ? guestName.trim() : undefined,
                customerPhone: isCreditSale && customerMode === 'GUEST' && guestPhone.trim() ? guestPhone.trim() : undefined,
                dueAt: isCreditSale && dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : undefined,
                notes: isCreditSale && notes.trim() ? notes.trim() : undefined,
            });

            setIsCheckoutConfirmOpen(false);
            setCart([]);
            resetCreditFields();
            await showAlert(isCreditSale ? 'Notinha criada com sucesso.' : 'Venda registrada com sucesso.', { tone: 'success' });
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const checkoutLabel = isCreditSale ? 'Salvar notinha' : 'Finalizar venda';
    const selectedPaymentLabel = PAYMENT_OPTIONS.find((option) => option.value === paymentMethod)?.label;
    const checkoutCustomerLabel = customerMode === 'REGISTERED'
        ? (selectedCustomer?.name || 'Cliente cadastrado nao selecionado')
        : (guestName.trim() || 'Cliente avulso nao informado');

    return (
        <CashierLayout title="Venda Balcao" subtitle="Monte o pedido, receba na hora ou pendure na notinha">
            <div className={styles.page}>
                <section className={styles.catalogSection}>
                    <div className={styles.toolbar}>
                        <div className={styles.toolbarTop}>
                            <label className={styles.searchField}>
                                <Search size={16} />
                                <input
                                    type="text"
                                    placeholder="Buscar produto, categoria ou descricao"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                            </label>
                            <button
                                type="button"
                                className={`${styles.viewToggle} ${productView === 'GRID' ? styles.viewToggleActive : ''}`}
                                onClick={() => setProductView('GRID')}
                                title="Visualizacao em grade"
                            >
                                <LayoutGrid size={16} />
                                <span>Grid</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.viewToggle} ${productView === 'LIST' ? styles.viewToggleActive : ''}`}
                                onClick={() => setProductView('LIST')}
                                title="Visualizacao em lista"
                            >
                                <Rows3 size={16} />
                                <span>Lista</span>
                            </button>
                        </div>
                        <div className={styles.categoryTabs}>
                            {categories.map((category) => (
                                <button
                                    key={category.id}
                                    type="button"
                                    className={`${styles.categoryTab} ${categoryId === category.id ? styles.categoryTabActive : ''}`}
                                    onClick={() => setCategoryId(category.id)}
                                >
                                    {category.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={`${styles.productGrid} ${isListView ? styles.productGridCompact : ''}`}>
                        {filteredProducts.map((product) => {
                            const outOfStock = product.stockMode === 'CONTROLLED' && product.stockQty <= 0;
                            const qtyInCart = cart.find((item) => item.id === product.id)?.qty ?? 0;

                            return (
                                <article
                                    key={product.id}
                                    className={`${styles.productCard} ${isListView ? styles.productCardCompact : ''} ${outOfStock ? styles.productCardDisabled : ''}`}
                                >
                                    {!isListView && (
                                        <div className={styles.productImageWrap}>
                                            {product.imageUrl ? (
                                                <ProxyImage src={product.imageUrl} alt={product.name} className={styles.productImage} />
                                            ) : (
                                                <div className={styles.productImageFallback}>{product.name.charAt(0)}</div>
                                            )}
                                            <span className={styles.productCategory}>{product.category.name}</span>
                                        </div>
                                    )}

                                    <div className={styles.productBody}>
                                        <div>
                                            {isListView && <span className={styles.productCategoryInline}>{product.category.name}</span>}
                                            <h3 className={styles.productName}>{product.name}</h3>
                                            {!isListView && (
                                                <p className={styles.productDescription}>
                                                    {product.description?.trim() || 'Item de venda rapida no balcao.'}
                                                </p>
                                            )}
                                        </div>

                                        <div className={styles.productMeta}>
                                            <span className={styles.productPrice}>{formatCurrency(product.priceCents)}</span>
                                            {product.stockMode === 'CONTROLLED' && (
                                                <span className={styles.stockInfo}>
                                                    {outOfStock ? 'Esgotado' : `${product.stockQty} em estoque`}
                                                </span>
                                            )}
                                        </div>

                                        <div className={styles.productActions}>
                                            {qtyInCart > 0 ? (
                                                <div className={styles.qtyControl}>
                                                    <button type="button" onClick={() => updateQty(product.id, -1)}>
                                                        <Minus size={16} />
                                                    </button>
                                                    <span>{qtyInCart}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => addToCart(product)}
                                                        disabled={outOfStock}
                                                    >
                                                        <Plus size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={styles.addBtn}
                                                    onClick={() => addToCart(product)}
                                                    disabled={outOfStock}
                                                >
                                                    {outOfStock ? 'Indisponivel' : 'Adicionar'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>

                <aside className={styles.salePanel}>
                    <div className={styles.saleHeader}>
                        <div>
                            <h2 className={styles.saleTitle}>
                                <ShoppingCart size={22} />
                                Pedido atual
                            </h2>
                            <p className={styles.saleSubtitle}>{itemCount} item(ns) separados para a venda</p>
                        </div>
                        <span className={styles.totalBadge}>{formatCurrency(total)}</span>
                    </div>

                    <div className={styles.mobileCatalogEntry}>
                        <button
                            type="button"
                            className={styles.mobileCatalogBtn}
                            onClick={() => setIsProductPickerOpen(true)}
                        >
                            <Plus size={18} />
                            Adicionar produtos
                        </button>
                        <span className={styles.mobileCatalogHint}>
                            {filteredProducts.length} item(ns) no catalogo
                        </span>
                    </div>

                    <div className={styles.saleBody}>
                        <div className={styles.cartList}>
                            {cart.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <ShoppingCart size={30} />
                                    <p>Selecione os produtos no catalogo para montar a venda.</p>
                                </div>
                            ) : (
                                cart.map((item) => (
                                    <div key={item.id} className={styles.cartRow}>
                                        <div className={styles.cartInfo}>
                                            <strong>{item.name}</strong>
                                            <span>{formatCurrency(item.priceCents)} cada</span>
                                        </div>
                                        <div className={styles.cartActions}>
                                            <div className={styles.compactQty}>
                                                <button type="button" onClick={() => updateQty(item.id, -1)}>
                                                    <Minus size={15} />
                                                </button>
                                                <span>{item.qty}</span>
                                                <button type="button" onClick={() => updateQty(item.id, 1)}>
                                                    <Plus size={15} />
                                                </button>
                                            </div>
                                            <button type="button" className={styles.removeBtn} onClick={() => removeFromCart(item.id)}>
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className={styles.block}>
                            <div className={styles.blockHeader}>
                                <CreditCard size={16} />
                                <span>Forma de recebimento</span>
                            </div>
                            <div className={styles.paymentGrid}>
                                {PAYMENT_OPTIONS.map((option) => {
                                    const Icon = option.icon;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={`${styles.paymentCard} ${paymentMethod === option.value ? styles.paymentCardActive : ''}`}
                                            onClick={() => setPaymentMethod(option.value)}
                                        >
                                            <Icon size={18} />
                                            <strong>{option.label}</strong>
                                            <span>{option.hint}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {isCreditSale && (
                            <div className={styles.block}>
                                <div className={styles.blockHeader}>
                                    <UserRound size={16} />
                                    <span>Responsavel pela notinha</span>
                                </div>

                                <div className={styles.modeTabs}>
                                    <button
                                        type="button"
                                        className={`${styles.modeTab} ${customerMode === 'REGISTERED' ? styles.modeTabActive : ''}`}
                                        onClick={() => setCustomerMode('REGISTERED')}
                                    >
                                        Cliente cadastrado
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.modeTab} ${customerMode === 'GUEST' ? styles.modeTabActive : ''}`}
                                        onClick={() => setCustomerMode('GUEST')}
                                    >
                                        Avulso
                                    </button>
                                </div>

                                {customerMode === 'REGISTERED' ? (
                                    <div className={styles.customerPanel}>
                                        <label className={styles.field}>
                                            <span>Buscar cliente</span>
                                            <input
                                                type="text"
                                                placeholder="Nome ou e-mail"
                                                value={customerSearch}
                                                onChange={(event) => setCustomerSearch(event.target.value)}
                                            />
                                        </label>

                                        <div className={styles.customerList}>
                                            {customers.map((customer) => (
                                                <button
                                                    key={customer.id}
                                                    type="button"
                                                    className={`${styles.customerOption} ${selectedCustomer?.id === customer.id ? styles.customerOptionActive : ''}`}
                                                    onClick={() => setSelectedCustomer(customer)}
                                                >
                                                    <strong>{customer.name}</strong>
                                                    <span>{customer.email}</span>
                                                </button>
                                            ))}
                                            {customers.length === 0 && (
                                                <p className={styles.customerHint}>Nenhum cliente encontrado para essa busca.</p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className={styles.customerPanel}>
                                        <label className={styles.field}>
                                            <span>Nome do cliente</span>
                                            <input
                                                type="text"
                                                placeholder="Ex: Joao da oficina"
                                                value={guestName}
                                                onChange={(event) => setGuestName(event.target.value)}
                                            />
                                        </label>

                                        <label className={styles.field}>
                                            <span>Telefone / referencia</span>
                                            <input
                                                type="text"
                                                placeholder="Opcional"
                                                value={guestPhone}
                                                onChange={(event) => setGuestPhone(event.target.value)}
                                            />
                                        </label>
                                    </div>
                                )}

                                <div className={styles.creditMetaGrid}>
                                    <label className={styles.field}>
                                        <span>
                                            <CalendarClock size={14} />
                                            Vencimento
                                        </span>
                                        <input
                                            type="date"
                                            value={dueAt}
                                            onChange={(event) => setDueAt(event.target.value)}
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span>Observacao interna</span>
                                        <textarea
                                            rows={3}
                                            placeholder="Ex: liberar so para o aluno no fim do turno"
                                            value={notes}
                                            onChange={(event) => setNotes(event.target.value)}
                                        />
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles.footer}>
                        <div className={styles.summaryGrid}>
                            <div>
                                <span>Total de itens</span>
                                <strong>{itemCount}</strong>
                            </div>
                            <div>
                                <span>Forma</span>
                                <strong>{PAYMENT_OPTIONS.find((option) => option.value === paymentMethod)?.label}</strong>
                            </div>
                        </div>

                        <button
                            type="button"
                            className={styles.checkoutBtn}
                            disabled={cart.length === 0 || loading}
                            onClick={() => setIsCheckoutConfirmOpen(true)}
                        >
                            {loading ? 'Processando...' : `${checkoutLabel} • ${formatCurrency(total)}`}
                        </button>
                    </div>
                </aside>
            </div>

            <div
                className={`${styles.mobilePickerOverlay} ${isProductPickerOpen ? styles.mobilePickerOverlayOpen : ''}`}
                onClick={() => setIsProductPickerOpen(false)}
                aria-hidden={!isProductPickerOpen}
            >
                <section
                    className={styles.mobilePickerSheet}
                    onClick={(event) => event.stopPropagation()}
                    aria-label="Selecionar produtos"
                >
                    <div className={styles.mobilePickerHeader}>
                        <div>
                            <h3 className={styles.mobilePickerTitle}>Selecionar produtos</h3>
                        </div>
                        <button
                            type="button"
                            className={styles.mobilePickerClose}
                            onClick={() => setIsProductPickerOpen(false)}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className={styles.mobilePickerToolbar}>
                        <label className={styles.searchField}>
                            <Search size={16} />
                            <input
                                type="text"
                                placeholder="Buscar produto, categoria ou descricao"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                        </label>

                        <div className={styles.mobileViewToggle}>
                            <button
                                type="button"
                                className={`${styles.viewToggle} ${productView === 'GRID' ? styles.viewToggleActive : ''}`}
                                onClick={() => setProductView('GRID')}
                            >
                                <LayoutGrid size={16} />
                                <span>Grid</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.viewToggle} ${productView === 'LIST' ? styles.viewToggleActive : ''}`}
                                onClick={() => setProductView('LIST')}
                            >
                                <Rows3 size={16} />
                                <span>Lista</span>
                            </button>
                        </div>

                        <div className={styles.categoryTabs}>
                            {categories.map((category) => (
                                <button
                                    key={category.id}
                                    type="button"
                                    className={`${styles.categoryTab} ${categoryId === category.id ? styles.categoryTabActive : ''}`}
                                    onClick={() => setCategoryId(category.id)}
                                >
                                    {category.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={`${styles.mobileProductList} ${productView === 'GRID' ? styles.mobileProductGrid : ''}`}>
                        {filteredProducts.map((product) => {
                            const outOfStock = product.stockMode === 'CONTROLLED' && product.stockQty <= 0;
                            const qtyInCart = cart.find((item) => item.id === product.id)?.qty ?? 0;
                            const mobileGridHasImage = productView === 'GRID' && !!product.imageUrl;

                            return (
                                <article
                                    key={product.id}
                                    className={`${styles.mobileProductCard} ${productView === 'GRID' ? styles.mobileProductCardGrid : ''} ${mobileGridHasImage ? styles.mobileProductCardGridWithImage : ''} ${outOfStock ? styles.productCardDisabled : ''}`}
                                >
                                    {mobileGridHasImage && (
                                        <div className={styles.mobileGridImageLayer} aria-hidden="true">
                                            <ProxyImage src={product.imageUrl!} alt="" className={styles.mobileGridImage} />
                                            <div className={styles.mobileGridImageOverlay} />
                                        </div>
                                    )}

                                    <div className={styles.mobileProductMain}>
                                        {productView === 'LIST' && (
                                            <div className={styles.mobileProductTop}>
                                                <span className={styles.productCategoryInline}>{product.category.name}</span>
                                            </div>
                                        )}

                                        <h4 className={`${styles.mobileProductName} ${productView === 'GRID' ? styles.mobileGridNameLabel : ''}`}>
                                            {product.name}
                                        {productView === 'GRID' && product.stockMode === 'CONTROLLED' && (
                                            <span className={styles.mobileGridStockBadge}>{product.stockQty}</span>
                                        )}
                                        </h4>
                                        <div className={styles.mobileProductMeta}>
                                            <strong className={productView === 'GRID' ? styles.mobileGridPriceLabel : ''}>
                                                {formatCurrency(product.priceCents)}
                                            </strong>
                                            {productView === 'LIST' && product.stockMode === 'CONTROLLED' && (
                                                <span>{outOfStock ? 'Esgotado' : `${product.stockQty} em estoque`}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className={styles.mobileProductActions}>
                                        {productView === 'GRID' ? qtyInCart > 0 ? (
                                            <div className={`${styles.qtyControl} ${styles.mobileGridQtyControl}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => updateQty(product.id, -1)}
                                                >
                                                    <Minus size={16} />
                                                </button>
                                                <span className={styles.mobileGridQtyValue}>{qtyInCart}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => addToCart(product)}
                                                    disabled={outOfStock}
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                className={`${styles.addBtn} ${styles.mobileGridAddBtn}`}
                                                onClick={() => addToCart(product)}
                                                disabled={outOfStock}
                                            >
                                                {outOfStock ? 'Indisponível' : '+ Adicionar'}
                                            </button>
                                        ) : qtyInCart > 0 ? (
                                            <div className={styles.qtyControl}>
                                                <button type="button" onClick={() => updateQty(product.id, -1)}>
                                                    <Minus size={16} />
                                                </button>
                                                <span>{qtyInCart}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => addToCart(product)}
                                                    disabled={outOfStock}
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                className={styles.addBtn}
                                                onClick={() => addToCart(product)}
                                                disabled={outOfStock}
                                            >
                                                {outOfStock ? 'Indisponivel' : 'Adicionar'}
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })}

                        {filteredProducts.length === 0 && (
                            <div className={styles.mobilePickerEmpty}>
                                Nenhum produto encontrado para esse filtro.
                            </div>
                        )}
                    </div>

                    <div className={styles.mobilePickerFooter}>
                        <div className={styles.mobilePickerSummary}>
                            <span>{itemCount} item(ns) no pedido</span>
                            <strong>{formatCurrency(total)}</strong>
                        </div>
                        <button
                            type="button"
                            className={styles.mobilePickerDone}
                            onClick={() => setIsProductPickerOpen(false)}
                        >
                            Voltar para o pedido
                        </button>
                    </div>
                </section>
            </div>

            <div
                className={`${styles.checkoutConfirmOverlay} ${isCheckoutConfirmOpen ? styles.checkoutConfirmOverlayOpen : ''}`}
                onClick={() => !loading && setIsCheckoutConfirmOpen(false)}
                aria-hidden={!isCheckoutConfirmOpen}
            >
                <section
                    className={styles.checkoutConfirmModal}
                    onClick={(event) => event.stopPropagation()}
                    aria-label="Confirmar venda"
                >
                    <div className={styles.checkoutConfirmHeader}>
                        <div>
                            <span className={styles.mobilePickerEyebrow}>Confirmacao</span>
                            <h3 className={styles.checkoutConfirmTitle}>Confirmar venda</h3>
                            <p className={styles.checkoutConfirmSubtitle}>
                                Revise o resumo antes de registrar para evitar cliques acidentais.
                            </p>
                        </div>
                        <button
                            type="button"
                            className={styles.mobilePickerClose}
                            onClick={() => setIsCheckoutConfirmOpen(false)}
                            disabled={loading}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className={styles.checkoutConfirmBody}>
                        <div className={styles.checkoutSummaryCard}>
                            <div className={styles.checkoutSummaryRow}>
                                <span>Itens</span>
                                <strong>{itemCount}</strong>
                            </div>
                            <div className={styles.checkoutSummaryRow}>
                                <span>Pagamento</span>
                                <strong>{selectedPaymentLabel}</strong>
                            </div>
                            {isCreditSale && (
                                <div className={styles.checkoutSummaryRow}>
                                    <span>Responsavel</span>
                                    <strong>{checkoutCustomerLabel}</strong>
                                </div>
                            )}
                            <div className={styles.checkoutSummaryRow}>
                                <span>Total</span>
                                <strong>{formatCurrency(total)}</strong>
                            </div>
                        </div>

                        <div className={styles.checkoutConfirmNotice}>
                            Esta acao registra a venda e atualiza o caixa imediatamente.
                        </div>
                    </div>

                    <div className={styles.checkoutConfirmActions}>
                        <button
                            type="button"
                            className={styles.checkoutCancelBtn}
                            onClick={() => setIsCheckoutConfirmOpen(false)}
                            disabled={loading}
                        >
                            Revisar pedido
                        </button>
                        <button
                            type="button"
                            className={styles.checkoutConfirmBtn}
                            onClick={handleCheckout}
                            disabled={loading}
                        >
                            {loading ? 'Processando...' : `${checkoutLabel} agora`}
                        </button>
                    </div>
                </section>
            </div>
        </CashierLayout>
    );
}
