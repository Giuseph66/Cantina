import { useState } from 'react';
import { X, Save, Plus, Minus, Package } from 'lucide-react';
import adminStyles from '../../pages/admin/Admin.module.css';
import { useDialog } from '../DialogProvider';
import styles from './StockBulkModal.module.css';

interface Product {
    id: string;
    name: string;
    stockQty: number;
    stockMode: string;
    category: { name: string };
}

interface StockBulkModalProps {
    isOpen: boolean;
    onClose: () => void;
    products: Product[];
    onSave: (updates: { productId: string; qty: number }[]) => Promise<void>;
}

export function StockBulkModal({ isOpen, onClose, products, onSave }: StockBulkModalProps) {
    const controlledProducts = products.filter(p => p.stockMode === 'CONTROLLED');
    const { alert: showAlert } = useDialog();
    const [entries, setEntries] = useState<Record<string, number>>({});
    const [saving, setSaving] = useState(false);

    if (!isOpen) return null;

    const handleQtyChange = (id: string, val: number) => {
        setEntries(prev => ({ ...prev, [id]: val }));
    };

    const handleSave = async () => {
        const updates = Object.entries(entries)
            .filter(([_, qty]) => qty !== 0)
            .map(([productId, qty]) => ({ productId, qty }));

        if (updates.length === 0) {
            onClose();
            return;
        }

        setSaving(true);
        try {
            await onSave(updates);
            setEntries({});
            onClose();
        } catch (err: any) {
            await showAlert(err.message, { tone: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={adminStyles.modalOverlay}>
            <div className={adminStyles.adminModal} style={{ maxWidth: 700 }}>
                <header className={adminStyles.adminModalHeader}>
                    <div className={adminStyles.adminModalTitleBlock}>
                        <h2 className={adminStyles.adminModalTitle}>Lançamento de Estoque</h2>
                        <p className={adminStyles.adminModalSubtitle}>Adicione ou remova quantidades dos produtos controlados</p>
                    </div>
                    <button className={adminStyles.closeBtn} onClick={onClose}>
                        <X size={24} />
                    </button>
                </header>

                <div className={styles.modalBody}>
                    <div className={styles.productList}>
                        {controlledProducts.map(p => (
                            <div key={p.id} className={styles.productRow}>
                                <div className={styles.productInfo}>
                                    <span className={styles.productName}>{p.name}</span>
                                    <span className={styles.productStock}>Atual: <strong>{p.stockQty}</strong></span>
                                </div>
                                <div className={styles.qtyActions}>
                                    <button 
                                        className={styles.qtyBtn}
                                        onClick={() => handleQtyChange(p.id, (entries[p.id] || 0) - 1)}
                                    >
                                        <Minus size={16} />
                                    </button>
                                    <input 
                                        type="number"
                                        className={styles.qtyInput}
                                        value={entries[p.id] || 0}
                                        onChange={(e) => handleQtyChange(p.id, parseInt(e.target.value) || 0)}
                                    />
                                    <button 
                                        className={styles.qtyBtn}
                                        onClick={() => handleQtyChange(p.id, (entries[p.id] || 0) + 1)}
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {controlledProducts.length === 0 && (
                            <div className={styles.empty}>
                                <Package size={48} opacity={0.2} />
                                <p>Nenhum produto com estoque controlado encontrado.</p>
                            </div>
                        )}
                    </div>
                </div>

                <footer className={styles.modalFooter}>
                    <button className={adminStyles.secondaryBtn} onClick={onClose} disabled={saving}>
                        CANCELAR
                    </button>
                    <button className={adminStyles.btnSubmit} onClick={handleSave} disabled={saving}>
                        {saving ? 'SALVANDO...' : (
                            <>
                                <Save size={18} /> SALVAR LANÇAMENTOS
                            </>
                        )}
                    </button>
                </footer>
            </div>
        </div>
    );
}
