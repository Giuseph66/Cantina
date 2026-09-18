import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import styles from './DialogProvider.module.css';

type DialogKind = 'alert' | 'confirm';
type DialogTone = 'info' | 'success' | 'warning' | 'error';

interface DialogOptions {
    title?: string;
    tone?: DialogTone;
    confirmLabel?: string;
    cancelLabel?: string;
}

interface DialogRequest extends DialogOptions {
    kind: DialogKind;
    message: string;
    resolve: (value: boolean) => void;
}

interface DialogContextValue {
    alert: (message: string, options?: DialogOptions) => Promise<void>;
    confirm: (message: string, options?: DialogOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

const TONE_CONFIG: Record<DialogTone, { label: string; Icon: typeof Info }> = {
    info: { label: 'Atenção', Icon: Info },
    success: { label: 'Tudo certo', Icon: CircleCheck },
    warning: { label: 'Confirme a ação', Icon: TriangleAlert },
    error: { label: 'Não foi possível concluir', Icon: CircleAlert },
};

export function DialogProvider({ children }: { children: ReactNode }) {
    const [queue, setQueue] = useState<DialogRequest[]>([]);
    const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
    const activeDialog = queue[0] ?? null;

    const open = useCallback((kind: DialogKind, message: string, options?: DialogOptions) => {
        return new Promise<boolean>((resolve) => {
            setQueue((current) => [...current, { kind, message, resolve, ...options }]);
        });
    }, []);

    const close = useCallback((confirmed: boolean) => {
        setQueue((current) => {
            const [dialog] = current;
            dialog?.resolve(confirmed);
            return current.slice(1);
        });
    }, []);

    const alert = useCallback(async (message: string, options?: DialogOptions) => {
        await open('alert', message, options);
    }, [open]);

    const confirm = useCallback((message: string, options?: DialogOptions) => {
        return open('confirm', message, { tone: 'warning', ...options });
    }, [open]);

    useEffect(() => {
        if (!activeDialog) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        primaryButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeDialog, close]);

    const contextValue: DialogContextValue = { alert, confirm };

    return (
        <DialogContext.Provider value={contextValue}>
            {children}
            {activeDialog && (() => {
                const tone = activeDialog.tone ?? 'info';
                const { Icon, label } = TONE_CONFIG[tone];
                const isConfirm = activeDialog.kind === 'confirm';

                return (
                    <div className={styles.overlay}>
                        <section
                            className={styles.dialog}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="app-dialog-title"
                            aria-describedby="app-dialog-message"
                        >
                            <div className={`${styles.icon} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
                                <Icon size={23} strokeWidth={2.4} />
                            </div>
                            <button
                                type="button"
                                className={styles.close}
                                aria-label="Fechar"
                                onClick={() => close(false)}
                            >
                                <X size={19} />
                            </button>
                            <p className={styles.eyebrow}>{activeDialog.title ?? label}</p>
                            <h2 id="app-dialog-title" className={styles.title}>
                                {isConfirm ? 'Você confirma?' : activeDialog.title ?? label}
                            </h2>
                            <p id="app-dialog-message" className={styles.message}>{activeDialog.message}</p>
                            <div className={styles.actions}>
                                {isConfirm && (
                                    <button type="button" className={styles.cancelButton} onClick={() => close(false)}>
                                        {activeDialog.cancelLabel ?? 'Cancelar'}
                                    </button>
                                )}
                                <button
                                    ref={primaryButtonRef}
                                    type="button"
                                    className={`${styles.confirmButton} ${tone === 'error' ? styles.confirmButtonDanger : ''}`}
                                    onClick={() => close(true)}
                                >
                                    {activeDialog.confirmLabel ?? (isConfirm ? 'Confirmar' : 'Entendi')}
                                </button>
                            </div>
                        </section>
                    </div>
                );
            })()}
        </DialogContext.Provider>
    );
}

export function useDialog() {
    const context = useContext(DialogContext);
    if (!context) throw new Error('useDialog deve ser usado dentro de DialogProvider');
    return context;
}
