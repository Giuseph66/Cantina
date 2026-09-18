import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export interface CartItem {
    productId: string;
    name: string;
    priceCents: number;
    qty: number;
}

interface CartContextValue {
    items: CartItem[];
    add: (item: Omit<CartItem, 'qty'>, maxQty?: number) => void;
    remove: (productId: string) => void;
    setQty: (productId: string, qty: number, maxQty?: number) => void;
    clear: () => void;
    totalCents: number;
    count: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<CartItem[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);

    // Carrega do localStorage ao montar o componente
    useEffect(() => {
        try {
            const stored = localStorage.getItem('@cantina:cart');
            if (stored) {
                setItems(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Erro ao carregar a sacola do localStorage:', e);
        } finally {
            setIsInitialized(true);
        }
    }, []);

    // Salva no localStorage sempre que os itens mudarem
    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem('@cantina:cart', JSON.stringify(items));
        }
    }, [items, isInitialized]);

    const add = useCallback((item: Omit<CartItem, 'qty'>, maxQty?: number) => {
        setItems((prev) => {
            const existing = prev.find((i) => i.productId === item.productId);
            const nextQty = (existing?.qty ?? 0) + 1;
            const cappedQty = maxQty !== undefined ? Math.min(nextQty, maxQty) : nextQty;
            if (existing) {
                if (cappedQty === existing.qty) return prev;
                return prev.map((i) => i.productId === item.productId ? { ...i, qty: cappedQty } : i);
            }
            if (maxQty !== undefined && maxQty <= 0) return prev;
            return [...prev, { ...item, qty: cappedQty }];
        });
    }, []);

    const remove = useCallback((productId: string) => {
        setItems((prev) => prev.filter((i) => i.productId !== productId));
    }, []);

    const setQty = useCallback((productId: string, qty: number, maxQty?: number) => {
        const cappedQty = maxQty !== undefined ? Math.min(qty, maxQty) : qty;
        if (cappedQty <= 0) { remove(productId); return; }
        setItems((prev) => prev.map((i) => i.productId === productId ? { ...i, qty: cappedQty } : i));
    }, [remove]);

    const clear = useCallback(() => setItems([]), []);

    const totalCents = items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
    const count = items.reduce((sum, i) => sum + i.qty, 0);

    return (
        <CartContext.Provider value={{ items, add, remove, setQty, clear, totalCents, count }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error('useCart deve ser usado dentro de CartProvider');
    return ctx;
}
