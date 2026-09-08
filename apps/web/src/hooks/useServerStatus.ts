import { useSyncExternalStore } from 'react';
import { getServerStatus, subscribe } from '../lib/server-status';

/**
 * Estado de disponibilidade do servidor, compartilhado por toda a aplicação.
 * A fonte da verdade fica em lib/server-status, alimentada pela camada de fetch.
 */
export function useServerStatus() {
    return useSyncExternalStore(
        listener => subscribe(listener),
        getServerStatus,
        getServerStatus,
    );
}
